# Architecture — `@curry-battle/react-multiple-video-manager`

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
- `pendingOperations: ReadonlySet<string>` — process / upload 実行中アイテムの tempId 集合
- `isAdding: boolean` — `handlers.add` 実行中フラグ
- `isBusy: boolean` — `isAdding || pendingOperations.size > 0` の集約フラグ
- `prepareForSubmit: (options?: PrepareForSubmitOptions) => Promise<PrepareForSubmitResult>` — 現在のフォーム値を `options` の uploadFile / uploadThumbnailFile で解決する submit 用関数。設定済み値への暗黙バインドはなく、呼び出しごとに渡された `options` のみを使う
- `raw: { videos, deletedVideoIds }` — debug 用途

全 handler は `tempId` で動画を特定する。`handlers.move(tempId, toIndex)` は任意位置への移動をサポートし、
D&D などの操作に対応する。

## Render Props (`MultiVideoRenderProps`)

Controller の `render` prop に渡される型。hook の戻り値からリスト操作の `addVideo` だけを直接公開し、per-item 操作は `item.handlers` 経由に閉じ込めることで API 面を縮小している。

- `items` / `rootErrors` / `addVideo` / `isBusy` / `isAdding` / `pendingOperations` / `prepareForSubmit` / `raw`

## 純関数レイヤー: `videoListOps`

`src/core/videoListOps.ts` はフォーム非依存・React 非依存の純関数群。
各 handler は「`videoListOps` で次の配列を計算 → `adapter.setVideos(next)` を 1 回呼ぶ」パターンで動作する。

- `addVideo` / `changeFile` / `deleteVideo` / `moveUp` / `moveDown` / `moveTo` / `setThumbnail`
- 入力配列は不変（新配列を返す）
- 戻り値に操作成否を含む（例: `{ videos: Video[]; added: boolean }`）

## 非同期安全性

- **lost update 防止**: handler は `adapterRef.current.getVideos()` でストアの最新値を取得してから mutation する。reactive な `videos` は再レンダーまで stale なため、直接参照しない。
- **完了順逆転防止**: epoch カウンタにより、同一 tempId への連続操作で先行 upload の結果が後勝ちしない。

## アダプタ

### RHF (`useVideoFieldAdapter`)
- `{ form, name, deletedName }` を受け取り、内部で `useFieldArray` / `useWatch` / `useFormState` を呼ぶ。
- `setVideos` は `useFieldArray.replace` に委譲。
- `getVideos` / `getDeletedVideoIds` は `form.getValues()` で同期取得。
- errors は `useFormState` から自己取得し `normalizeRhfErrors` で中立化。

### TanStack Form (`useVideoFieldAdapter`)
- 必ず `<form.Field name mode="array">` の **内部 React コンポーネント** 内で呼ぶ（rules-of-hooks）。
- Reactive subscription:
  - `useStore(field.store, s => s.value)` → `videos`
  - `useStore(field.store, s => s.meta.errors)` → root meta errors
  - `useStore(form.store, s => s.errorMap)` → item path errors
- `setVideos` は `form.setFieldValue(name, next)` に委譲。
- `getVideos` / `getDeletedVideoIds` は `form.getFieldValue()` で同期取得。
- `validate()` は `form.validateField(name, validateCause ?? "change")`。
- `normalizeTanstackErrors` が `videos[i].<key>` / `videos.i.<key>` の path key を解析。
  nested (`videos[0].thumbnail.file`) は最初のセグメントのみ拾い、残りパスは `source` に保持する。

## コントローラ層

`useMultiVideoController`（RHF / TanStack 各 subpath）は
内部でアダプタを生成し `useMultiVideoCore` に渡す薄いラッパー。

Render Props コンポーネント `MultiVideoController`（両 subpath 同名）は
対応する hook を内部で呼び、`render` prop に `MultiVideoRenderProps` を渡す。
`deletedName` はデフォルト `${name}DeletedIds` で省略可能。

## バンドル隔離

- `tsdown` で `react-hook-form/index` と `tanstack-form/index` を別エントリ → 別チャンクに出力。
- `react-hook-form` / `@tanstack/react-form` は `deps.neverBundle` かつ optional peer dep。
- ルート `.` は RHF / TanStack のいずれも re-export しない。
- `scripts/check-bundle-isolation.mjs` が build 後の `dist` を走査し、`dist/tanstack-form/*` から
  `react-hook-form` への、`dist/react-hook-form/*` から `@tanstack/react-form` への transitively な
  import が発生しないことを検証する。

## ディレクトリ構成

```
packages/react-multiple-video-manager/src/
├─ index.ts                       # ".": 中立 root
├─ core/
│  ├─ useMultiVideoCore.ts        # フォーム非依存コア hook
│  ├─ usePreviewUrl.ts            # File/URL プレビュー用 hook
│  ├─ videoListOps.ts             # 配列変換の純関数群
│  ├─ prepareForSubmit.ts         # submit 用アップロード解決の純関数 + PrepareForSubmitError
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
