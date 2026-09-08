# Architecture — `@curry-battle/react-multiple-video-form-manager`

## 設計方針

99% フォーム非依存の動画管理ロジックを中立コアに閉じ込め、フォームライブラリ毎の差分を薄いアダプタ（Port）で吸収する Ports & Adapters 構成。
RHF / TanStack Form のどちらからでも同一コアロジックを利用できる。

```
┌──────────────────────────────────────────────────────────────────┐
│                       消費側アプリケーション                       │
└─────────────────────┬──────────────────────┬─────────────────────┘
        RHF経路        ▼                       ▼     TanStack経路
┌─────────────────────────────┐  ┌─────────────────────────────────┐
│ ./react-hook-form           │  │ ./tanstack-form                 │
│  - useVideoFieldAdapter     │  │  - useVideoFieldAdapter         │
│  - useMultiVideoController  │  │  - useMultiVideoController      │
│  - MultiVideoController     │  │  - MultiVideoController         │
└──────────┬──────────────────┘  └──────────┬──────────────────────┘
           │ VideoFieldAdapter (port)        │
           └──────────────┬──────────────────┘
                          ▼
              ┌──────────────────────────┐
              │ core (root ".")          │
              │  - useMultiVideoCore     │ ← フォーム非依存
              │  - VideoFieldAdapter     │
              │  - types / utils         │
              └──────────────────────────┘
```

## Port: `VideoFieldAdapter`

`src/core/VideoFieldAdapter.ts` で定義される中立インターフェース。

```ts
interface VideoFieldAdapter {
  readonly videos: readonly Video[];          // 描画用 reactive 値
  setVideos(next: Video[]): void;             // 配列全体を 1 回で置き換える
  getVideos(): Video[];                       // mutation 用の同期 read
  readonly deletedVideoIds: readonly string[];// 描画用 reactive 値
  setDeletedVideoIds(next: string[]): void;   // 削除済みID配列を置き換える
  getDeletedVideoIds(): string[];             // mutation 用の同期 read
  validate(): Promise<void>;                  // 検証を発火するだけ
  errors: VideosError;                        // 中立エラー
}
```

`getVideos()` / `getDeletedVideoIds()` は mutation 用の同期 read メソッド。
reactive な `videos` / `deletedVideoIds` は再レンダー経由でしか更新されないため、
連続 mutation（`await handlers.delete(a); await handlers.delete(b)`）で lost update を防ぐために
ストアの現在値を直接返す。

## Discriminated Union: Video

動画は `VideoNew`（新規追加・File 保持）と `VideoExisting`（サーバー由来・uploadedUrl 保持）の
2 ステータスを持つ。削除済み動画は配列から除外し、ID は別フィールド `deletedVideoIds` で追跡する。

## 中立エラーモデル

```ts
type VideoFieldError = { message?: string; type?: string; source?: unknown };
type SingleVideoError = Partial<Record<VideoKey, VideoFieldError>>;
type VideosError = {
  items: Record<string, SingleVideoError>;  // tempId をキーとした per-item エラー
  root: VideoFieldError[];                  // 配列レベル（maxVideos 等）
};
```

エラーは tempId でキーイングされ、mutation 直後の index ずれ（削除・並び替え）で別動画に
ミスアラインしない。`items` は `videos` と `errors.items` を tempId で突合し、
各動画にエラーを付与する。

## `useMultiVideoCore` の戻り値

- `items: VideoItem[]` — 動画ごとに `errors` / `canMoveUp` / `canMoveDown` / `errorMessages` / `isPending` / tempId バインド済み `handlers` を付与した配列。バインド済み handler は tempId ごとの Map キャッシュで identity を生涯安定化している
- `rootErrors: VideoFieldError[]` — `adapter.errors.root` をそのまま公開
- `handlers: UseMultiVideoCoreHandlers` — add / changeFile / delete / moveUp / moveDown / move / thumbnail 系
- `pendingOperations: ReadonlySet<string>` — 項目ごとの handler が走行中の tempId 集合。覆うのは加工・書き込み・検証までで、転送の時間は含まない（転送は `uploads` と `items[].uploadState` が持つ）
- `isAdding: boolean` — `handlers.add` 実行中フラグ
- `isBusy: boolean` — `isAdding || pendingOperations.size > 0` の集約フラグ。`uploads.getReady()` 構成では保存の gate として使う。`uploads.wait()` 構成では待ち合わせが同じ役目を果たすので gate に使わない
- `uploads: UploadsApi` — 転送の `pending` / `failed` と、`wait` / `getReady` / `retry`
- `raw: { videos, deletedVideoIds }` — debug 用途

全 handler は `tempId` で動画を特定する。`handlers.move(tempId, toIndex)` は任意位置への移動をサポートし、
D&D などの操作に対応する。

## Render Props (`MultiVideoRenderProps`)

Controller の `render` prop に渡される型。hook の戻り値からリスト操作の `addVideo` だけを直接公開し、per-item 操作は `item.handlers` 経由に閉じ込めることで API 面を縮小している。

- `items` / `rootErrors` / `addVideo` / `isBusy` / `isAdding` / `pendingOperations` / `uploads` / `raw`

## 純関数レイヤー: `videoListOps`

`src/core/videoListOps.ts` はフォーム非依存・React 非依存の純関数群。
各 handler は「`videoListOps` で次の配列を計算 → `adapter.setVideos(next)` を 1 回呼ぶ」パターンで動作する。

- `addVideo` / `changeFile` / `deleteVideo` / `moveUp` / `moveDown` / `moveTo` / `setThumbnail`
- 入力配列は不変（新配列を返す）
- 戻り値に操作成否を含む（例: `{ videos: Video[]; added: boolean }`）

## 非同期安全性

- **lost update 防止**: handler は `adapterRef.current.getVideos()` でストアの最新値を取得してから mutation する。reactive な `videos` は再レンダーまで stale なため、直接参照しない。
- **完了順逆転防止**: 転送は `token`（`File` / `Blob` の参照）の同一性比較で書き戻しの可否を決める。スロットの中身が発行時と別物になっていれば結果を捨てる。選択の側は下記の「選択の競合」が担う。

## 選択の競合

ファイルの加工とフレームキャプチャは await を挟むため、フォームへ書き込むのは選択の直後ではない。その間に同じ場所へ別の選択が来ると、解決の速い順ではなく選んだ順で勝敗を決める必要がある。

`currentSelectionsRef` が「この競合単位で現行の選択は誰か」を持つ。値の参照そのものが印で、走行中の選択は `run` に渡される `isCurrent()` でフォームへ書く前に自分が現行かを確かめ、違えば結果を捨てる。

- **競合単位はスロット**（`slotKey(tempId, kind)`）。本体とサムネイルで 1 つのキーを共有すると、本体の加工中にサムネイルを設定しただけで本体の差し替えが捨てられる
- **追加は 1 件ごとに別のキー**（`add:<seq>`）。追加は誰とも競合しないので、現行を降りるのは unmount のときだけ
- **フレームキャプチャとファイルからのサムネイル設定は同じスロットを共有する。** 相互に交代する

現行を降ろす経路は 5 つ。`handleDelete`（両スロット）、`handleRemoveThumbnail`（thumbnail）、既存動画の差し替え（thumbnail）、`pruneOrphans`（フォームから消えた tempId の両スロット）、unmount（全キー）。

降ろすことは待ち側にも効く。`uploads.wait()` は現行の選択が settle するまで待つので、降ろさないと捨てた選択が永久に解決せず保存が返らなくなる。転送の中断（`discardSlot`）とは別の関心事で、両方を呼ぶ箇所がある。

## アダプタ

### RHF (`useVideoFieldAdapter`)
- `{ form, name, deletedName }` を受け取り、内部で `useFieldArray` / `useWatch` / `useFormState` を呼ぶ。
- `setVideos` は `useFieldArray.replace` に委譲。
- `getVideos` / `getDeletedVideoIds` は `form.getValues()` で同期取得。
- errors は `useFormState` から自己取得し `normalizeRhfErrors` で中立化。

### TanStack Form (`useVideoFieldAdapter`)
- `{ form, name, deletedName, validateCause? }` を受け取る。read / write はすべてフォームストア経由なので
  `<form.Field mode="array">` の内側である必要がない（フォームレベルで呼べる）。
- Reactive subscription:
  - `useStore(form.store, s => s.values[name])` → `videos`
  - `useStore(form.store, s => s.fieldMeta[name].errors)` → root meta errors
  - `useStore(form.store, s => s.errorMap)` → item path errors
- `setVideos` は `form.setFieldValue(name, next)` に委譲。
  field インスタンスが未登録でも `setFieldValue` が `fieldMeta[name]` を生成するので
  touched / dirty / フィールド単位のエラーは追える。
- `getVideos` / `getDeletedVideoIds` は `form.store.state.values` から同期取得。
  ネストパス解決ではなく素のキーアクセスなので、`name` / `deletedName` はトップレベルキーであること
  （ネストパスは実行時に throw する）。
- `validate()` は `form.validateField(name, validateCause ?? "change")`。
  field インスタンスが未登録なら TanStack 側がフォームレベルの検証へフォールバックする。
- `normalizeTanstackErrors` が `videos[i].<key>` / `videos.i.<key>` の path key を解析。
  nested (`videos[0].thumbnail.file`) は最初のセグメントのみ拾い、残りパスは `source` に保持する。

## コントローラ層

`useMultiVideoController`（RHF / TanStack 各 subpath）は
内部でアダプタを生成し `useMultiVideoCore` に渡す薄いラッパー。

Render Props コンポーネント `MultiVideoController`（両 subpath 同名）は
対応する hook を内部で呼び、`render` prop に `MultiVideoRenderProps` を渡す。
`deletedName` はデフォルト `${name}DeletedIds` で省略可能。
submit ハンドラから `uploads` を触る場合は、render の内側に閉じ込めない hook 側を使う。

## バンドル隔離

- `tsdown` で `react-hook-form/index` と `tanstack-form/index` を別エントリ → 別チャンクに出力。
- `react-hook-form` / `@tanstack/react-form` は `deps.neverBundle` かつ optional peer dep。
- ルート `.` は RHF / TanStack のいずれも re-export しない。
- `scripts/check-bundle-isolation.mjs` が build 後の `dist` を走査し、`dist/tanstack-form/*` から
  `react-hook-form` への、`dist/react-hook-form/*` から `@tanstack/react-form` への transitively な
  import が発生しないことを検証する。

## ディレクトリ構成

```
packages/react-multiple-video-form-manager/src/
├─ index.ts                       # ".": 中立 root
├─ core/
│  ├─ useMultiVideoCore.ts        # フォーム非依存コア hook
│  ├─ usePreviewUrl.ts            # File/URL プレビュー用 hook
│  ├─ videoListOps.ts             # 配列変換の純関数群
│  ├─ submitPayload.ts            # 送信素材を組む純関数
│  ├─ uploadSlots.ts              # スロットのキーと転送元・書き戻しの純関数
│  ├─ fileInputHelpers.ts         # <input type="file"> change イベントからの File 取り出し
│  ├─ VideoFieldAdapter.ts        # ポート型
│  ├─ normalizeErrorLeaf.ts        # エラー leaf 正規化（RHF/TanStack 共用）
│  ├─ types/                       # Video / Thumbnail / Status / Error / Schema types
│  └─ __tests__/                   # FakeVideoFieldAdapter / videoListOps テスト
├─ react-hook-form/
│  ├─ useVideoFieldAdapter.ts
│  ├─ useMultiVideoController.ts
│  ├─ MultiVideoController.tsx     # Render Props
│  ├─ normalizeRhfErrors.ts
│  ├─ types.ts
│  └─ __tests__/
├─ tanstack-form/
│  ├─ useVideoFieldAdapter.ts
│  ├─ useMultiVideoController.ts
│  ├─ MultiVideoController.tsx
│  ├─ normalizeTanstackErrors.ts
│  └─ __tests__/
└─ schemas/                        # zod / valibot
```
