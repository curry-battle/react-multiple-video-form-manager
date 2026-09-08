# @curry-battle/react-multiple-video-form-manager

[English](./README.md)

React Hook Form と TanStack Form の両方に対応した複数動画管理ライブラリ。
Discriminated Union と State Machine パターンで複数動画の追加・削除・並べ替え・差し替えを宣言的に管理し、サムネイル（フレームキャプチャ / ファイルアップロード）を統合します。
状態遷移・`blob:` URL ライフサイクル・サムネイル管理はフォーム非依存のコアに閉じ込め、各フォームライブラリは薄いアダプタで接続する **Ports & Adapters** 構成です。

## インストール

```bash
npm install @curry-battle/react-multiple-video-form-manager
```

GitHub Packages の `.npmrc`:

```
@curry-battle:registry=https://npm.pkg.github.com
```

フォームライブラリのいずれかをインストール:

```bash
# React Hook Form
npm install react-hook-form

# TanStack Form
npm install @tanstack/react-form
```

### スキーマサポート (optional)

```bash
# Zod
npm install zod

# Valibot
npm install valibot
```

## 使い方 (React Hook Form)

### MultiVideoController

動画は配列フィールドで管理し、削除された動画のIDは別フィールドで追跡します。デフォルトでは `${name}DeletedIds`（例: `name="videos"` なら `videosDeletedIds`）が使われます。異なる場合は `deletedName` で指定してください。

```tsx
import { type Video } from "@curry-battle/react-multiple-video-form-manager";
import { MultiVideoController } from "@curry-battle/react-multiple-video-form-manager/react-hook-form";
import { useForm } from "react-hook-form";

type MyForm = {
  videos: Video[];
  videosDeletedIds: string[];
};

function MyForm() {
  const form = useForm<MyForm>();

  return (
    <MultiVideoController
      form={form}
      name="videos"
      maxVideos={5}
      onError={(error) => console.error(error.message)}
      render={({
        items,
        rootErrors,
        addVideo,
        isBusy,
        pendingOperations,
        isAdding,
        uploads,
        raw,
      }) => (
        <>
          {items.map((item) => (
            <div key={item.video.tempId}>
              {/* per-item 操作は item.handlers 経由 */}
              <button onClick={() => item.handlers.delete()}>削除</button>
              <button onClick={() => item.handlers.moveUp()}>上へ</button>
              <button onClick={() => item.handlers.moveDown()}>下へ</button>
              {item.isPending && <span>処理中...</span>}
              {item.errorMessages[0] && <span>{item.errorMessages[0]}</span>}
            </div>
          ))}
          <button onClick={() => void uploads.wait()}>保存</button>
        </>
      )}
    />
  );
}
```

### useMultiVideoController

Controller コンポーネントを使わず hook を直接利用することもできます。

```tsx
import { useMultiVideoController } from "@curry-battle/react-multiple-video-form-manager/react-hook-form";
import { useForm } from "react-hook-form";

const form = useForm<MyForm>();
const { items, rootErrors, handlers, pendingOperations, isAdding, isBusy, uploads, raw } = useMultiVideoController({
  form,
  name: "videos",
  deletedName: "videosDeletedIds",
  maxVideos: 5,
});
```

## 使い方 (TanStack Form)

`createVideosSchema` は配列スキーマを返すので、validator として渡す前に `z.object({ <fieldName>: createVideosSchema(...) })` で wrap してください（valibot の場合は `v.object`）。

```tsx
import { createVideosSchema } from "@curry-battle/react-multiple-video-form-manager/schemas/zod";
import { MultiVideoController } from "@curry-battle/react-multiple-video-form-manager/tanstack-form";
import { useForm } from "@tanstack/react-form";
import { z } from "zod";

const formSchema = z.object({
  videos: createVideosSchema({
    acceptedVideoTypes: ["video/mp4", "video/webm"],
    maxVideos: 5,
  }),
});

function MyForm() {
  const form = useForm({
    defaultValues: { videos: [], videosDeletedIds: [] },
    validators: { onChange: formSchema },
  });

  return (
    <MultiVideoController
      form={form}
      name="videos"
      maxVideos={5}
      validateCause="change"
      render={({
        items,
        rootErrors,
        addVideo,
        isBusy,
        pendingOperations,
        isAdding,
        uploads,
        raw,
      }) => (
        // UI 実装
      )}
    />
  );
}
```

TanStack アダプタは read / write をすべてフォームストア経由で行うため（`useStore(form.store, ...)` で reactive subscription を組み、validate 直後に `items` / `rootErrors` が同期して更新されます）、`useMultiVideoController` はフォームレベルで呼べます。`<form.Field mode="array">` は不要です — field インスタンスが未登録なら `validateField` はフォームレベルの検証へフォールバックし、`setFieldValue` が `fieldMeta` を自前で生成します。submit ハンドラから `uploads` を使いたい場合はフックを直接呼んでください（render props コンポーネントは render の内側に閉じ込めます）。`name` / `deletedName` はフォームデータのトップレベルキーである必要があります。

両 subpath から同名 `MultiVideoController` を export しています。同一ファイルで両方を使う場合は import alias で区別してください:

```tsx
import { MultiVideoController as RhfController } from ".../react-hook-form";
import { MultiVideoController as TanstackController } from ".../tanstack-form";
```

## 既存データからの初期化

サーバーデータから `VideoExisting` を組み立てるには `VideoUtils.createExisting` を使います:

```tsx
import { VideoUtils } from "@curry-battle/react-multiple-video-form-manager";

const initialVideos = serverVideos.map((sv) =>
  VideoUtils.createExisting({
    id: sv.id,
    uploadedUrl: sv.url,
    thumbnailUrl: sv.thumbnailUrl, // 省略可
  })
);
```

## プレビュー表示

新規追加された動画 (`status: "new"`) はフォームステートに previewUrl を保持しません。
`usePreviewUrl` を各アイテムコンポーネント内で使い、`file` からプレビューを導出してください。

```tsx
import { usePreviewUrl, type Video } from "@curry-battle/react-multiple-video-form-manager";

function VideoItem({ video }: { video: Video }) {
  const previewUrl = usePreviewUrl(video);
  return <video src={previewUrl} controls />;
}
```

サムネイルのプレビューには `useThumbnailPreviewUrl` を使います:

```tsx
import { useThumbnailPreviewUrl } from "@curry-battle/react-multiple-video-form-manager";

function ThumbnailPreview({ video }: { video: Video }) {
  const thumbnailUrl = useThumbnailPreviewUrl(video.thumbnail ?? null);
  if (!thumbnailUrl) return null;
  return <img src={thumbnailUrl} alt="" />;
}
```

これらは hook のため、`items.map()` のコールバック内では呼び出せません。上記のように各アイテム用のコンポーネントに抽出してください。

## File Input ヘルパー

`getFileFromChangeEvent`（単一）/ `getFilesFromChangeEvent`（複数）は `<input type="file">` の change イベントから `File` を取り出します。ファイル未選択時は throw します。`input.value` のリセットは呼び出し側の責務です。

```tsx
import { getFileFromChangeEvent } from "@curry-battle/react-multiple-video-form-manager";

<input
  type="file"
  onChange={(e) => {
    const file = getFileFromChangeEvent(e);
    e.target.value = "";
    void addVideo(file);
  }}
/>
```

## オプション Props

| Prop | Type | 説明 |
|------|------|------|
| `processFile` | `(file: File) => Promise<File>` | 動画ファイル追加・差し替え時の前処理 |
| `processThumbnailFile` | `(file: File) => Promise<File>` | サムネイルファイルアップロード時の前処理 |
| `uploadFile` | `UploadFileFn` | ファイル選択時に転送を開始する。本体とサムネイルで 1 本を共有し、どちらの転送かは `ctx.kind` で渡る |
| `onError` | `(error: MultiVideoError) => void` | `processFile` / `processThumbnailFile` / `uploadFile` の失敗、`maxVideos` 超過、バリデーション reject 時に呼ばれる |
| `maxVideos` | `number` | UI レベルの最大動画数。超過時は `addVideo` が即 `false` |
| `messages` | `CoreMessages` | i18n 用のカスタムエラーメッセージ |
| `deletedName` | `string` | 削除IDフィールド名。デフォルトは `${name}DeletedIds` |

**`processFile` / `processThumbnailFile` が返す promise は必ず settle させてください。** どちらも 1 つの型（`ProcessFileFn`）を共有し、この要求は両方に掛かります。ファイルを選んでからフォームに載るまでの間は `uploads.wait()` がその完了を待つため、settle しないと保存が返りません（`uploadFile` 未設定でも同じです）。転送と違い中断の口が無いので、止まりうる処理はタイムアウトで棄却してください。

**`VideoFieldAdapter.validate()` にも同じ要求が掛かります。** 各ハンドラはフォームへ書き込んだあと最後に `validate()` を await するため、これが返らないと素材が揃っていても保存が返りません。同梱のアダプタは条件を満たしています。自前のアダプタを書く場合だけ注意してください。

## Render Props

| Prop | Type | 説明 |
|------|------|------|
| `items` | `VideoItem[]` | 動画ごとの `video`, `errors`, `canMoveUp`, `canMoveDown`, `errorMessages`, `isPending`, バインド済み `handlers` |
| `rootErrors` | `VideoFieldError[]` | 配列レベルエラー（maxVideos 等） |
| `addVideo` | `(file: File) => Promise<boolean>` | 動画を追加 |
| `isBusy` | `boolean` | 追加中または per-item 非同期操作中。`uploads.getReady()` 構成では保存の gate に使う（下記） |
| `isAdding` | `boolean` | `addVideo` 実行中 |
| `pendingOperations` | `ReadonlySet<string>` | 項目ごとの handler が走行中の tempId 集合。加工・書き込み・検証までを覆い、転送の時間は含まない |
| `uploads` | `UploadsApi` | 転送の状態と、送信素材を組む `wait` / `getReady` / `retry` |
| `raw` | `{ videos, deletedVideoIds }` | デバッグ用の生フォーム値 |

per-item 操作は `item.handlers` 経由:

| Handler | Signature | 説明 |
|---------|-----------|------|
| `changeFile` | `(file: File) => Promise<boolean>` | ファイル差し替え |
| `delete` | `() => Promise<boolean>` | 削除 |
| `moveUp` | `() => Promise<boolean>` | 上に移動 |
| `moveDown` | `() => Promise<boolean>` | 下に移動 |
| `move` | `(toIndex: number) => Promise<boolean>` | 任意位置に移動 |
| `setThumbnailFromFrame` | `(videoElement: HTMLVideoElement) => Promise<boolean>` | フレームキャプチャ |
| `setThumbnailFromFile` | `(file: File) => Promise<boolean>` | ファイルからサムネイル設定 |
| `removeThumbnail` | `() => Promise<boolean>` | サムネイル削除 |

## エラーモデル

フォームアダプタ間で共有される**中立エラーモデル**を採用しています。

```ts
type VideoFieldError = { message?: string; type?: string; source?: unknown };
type SingleVideoError = Partial<Record<VideoErrorFieldKey, VideoFieldError>>;  // キーは VIDEO_ERROR_FIELD_KEYS
type VideosError = {
  items: Record<string, SingleVideoError>;  // tempId をキーとした per-item エラー
  root: VideoFieldError[];                      // 配列レベル（maxVideos 等）
};
```

## サブミットフロー

`uploadFile` を設定すると、ファイルを選んだ時点で転送が始まります。項目は転送の完了を待たずにフォームへ入り、転送は裏で走ります。保存時に送信素材を組む口が `uploads` の 2 つで、**どちらを使うかで保存ボタンの gate の書き方が変わります。**

### `uploads.wait()` — 待ってから送る

```tsx
const { uploads } = useMultiVideoController({ form, name: "videos", uploadFile });

const onSubmit = async () => {
  const result = await uploads.wait();
  if (!result.ok) {
    // result.failedTempIds に失敗した項目の tempId が入る
    return;
  }
  await api.save({ videos: result.videos, deletedIds: result.deletedIds });
};
```

**待つのは転送だけではありません。** `addVideo` / `changeFile` / `setThumbnailFromFrame` / `setThumbnailFromFile` の 4 つは、ファイルの加工やフレームキャプチャを await してからフォームへ書き込みます。走行中はまだ項目になっていないので、待たなければ選んだ動画が黙って送信素材から落ちます。`wait()` はこの走行中の選択も待ちます。**`uploadFile` を設定していなくても待ちます** — 転送は起きなくてもハンドラは走るためです。

そのため **`wait()` を使う構成では保存ボタンを `isBusy` で無効化する必要がありません。** 同梱の examples はどちらもこの形です。

`wait()` について、あと 3 点。

- **加工の失敗は `onError` だけが伝えます。** 失敗した選択は項目にならないので、`failedTempIds` にも `uploads.failed` にも現れません。転送の失敗とは経路が違います
- 送信素材は解決した時点のフォーム値から組みます。呼んだ時点のスナップショットではありません
- **返る直前に始まった選択は含まれないことがあります。** 待つ対象は各周回の入口で確定するためです。保存操作と選択操作が同時に起きる窓は UI 側で閉じてください

### `uploads.getReady()` — 待たずに送れるものだけ送る

```tsx
const onSubmit = async () => {
  const { videos, deletedIds, excludedTempIds } = uploads.getReady();
  if (excludedTempIds.length > 0) {
    // 「この動画は今回の保存に含まれませんでした」と提示する
  }
  await api.save({ videos, deletedIds });
};
```

未完了の転送を持つ項目は丸ごと除外され、`excludedTempIds` で返ります。項目自体はフォームに残るので、消費側で提示してください。

**`getReady()` を使う構成では、保存ボタンを `isBusy` で無効化してください。** `getReady()` には走行中の選択が見えず、`excludedTempIds` にも出ないまま素材から落ちるためです。`pendingOperations` や `items[].isPending` では足りません — どちらも tempId をキーにした集合で、入口の時点で tempId を持たない `addVideo` は載る先がありません。`isBusy` は state 経由なので 1 レンダー遅れる点に注意してください。

**gate を外すと、フォームが検証していない項目が送信素材に入る窓ができます。** 各ハンドラはフォームへ書き込んだあとに `validate()` を await するので、書き込みは済んだが検証がまだ終わっていない項目が `getReady()` の素材に入ります。

### `uploads.retry()` — 失敗した転送をやり直す

```tsx
<button onClick={() => uploads.retry(item.video.tempId)}>再試行</button>
```

**失敗した転送は保存を押し直しても再発行されません。** `retry(tempId)` を明示的に呼んでください。自動で再送すると、失敗し続ける転送を保存のたびに撃ち直すことになります。失敗した項目は `uploads.failed` と `items[].uploadState` で引けます。

### サムネイルの手動解決（escape hatch）

細かく制御したい場合は低レベルプリミティブも引き続き利用できます:

```ts
import {
  VideoUtils,
  ThumbnailSubmitStatus,
  type ThumbnailForSubmit,
} from "@curry-battle/react-multiple-video-form-manager";

const videosForSubmit = VideoUtils.computeVideosForSubmit(videos);

for (const vid of videosForSubmit) {
  const thumb: ThumbnailForSubmit | null = VideoUtils.resolveThumbnailForSubmit(vid);
  if (!thumb) continue;
  switch (thumb.status) {
    case ThumbnailSubmitStatus.New:       /* thumb.thumbnail をアップロード */ break;
    case ThumbnailSubmitStatus.Unchanged: /* thumb.uploadedUrl をそのまま */    break;
    case ThumbnailSubmitStatus.Replaced:  /* thumb.thumbnail で置換 */          break;
    case ThumbnailSubmitStatus.Removed:   /* サムネイル明示削除 */              break;
  }
}
```

## フレームキャプチャの CORS 設定

外部オリジンの動画（S3/CloudFront等）で `item.handlers.setThumbnailFromFrame` を使う場合は、クライアント・サーバー双方の設定が必要です。

**1. `<video>` 要素に `crossOrigin` を追加:**

```tsx
<video ref={videoRef} src={videoUrl} crossOrigin="anonymous" />
```

**2. サーバー側で CORS ヘッダーを返す:**

```json
{
  "AllowedHeaders": ["*"],
  "AllowedMethods": ["GET"],
  "AllowedOrigins": ["https://your-app-domain.com"],
  "MaxAgeSeconds": 3600
}
```

CloudFront を併用する場合は、オリジンリクエストポリシーで `Origin` を転送し、レスポンスヘッダーポリシーで `Access-Control-Allow-Origin` を返します。同一オリジン（`blob:` URL 等）ではこの設定は不要です。

## スキーマ (Zod / Valibot)

```ts
import { createVideosSchema } from "@curry-battle/react-multiple-video-form-manager/schemas/zod";
// または:
// import { createVideosSchema } from "@curry-battle/react-multiple-video-form-manager/schemas/valibot";

const videosSchema = createVideosSchema({
  acceptedVideoTypes: ["video/mp4"],
  maxVideoFileSize: 100 * 1024 * 1024,
  maxVideos: 5,
  acceptedThumbnailTypes: ["image/jpeg", "image/png"],
  maxThumbnailFileSize: 5 * 1024 * 1024,
  idValidation: (id) => isValidId(id),
  idMessage: "Invalid ID format",
});
```

`deletedVideoIds` フィールドには `createDeletedVideoIdsSchema` を使います:

```ts
import { createDeletedVideoIdsSchema } from "@curry-battle/react-multiple-video-form-manager/schemas/zod";

const deletedIdsSchema = createDeletedVideoIdsSchema({
  idValidation: (id) => isValidId(id),
});
```

## エクスポートマップ

| パス | 内容 |
|------|------|
| `@curry-battle/react-multiple-video-form-manager` | コア（型、VideoUtils、ThumbnailUtils、useMultiVideoCore、usePreviewUrl、useThumbnailPreviewUrl、getFileFromChangeEvent / getFilesFromChangeEvent、VideoFieldAdapter） |
| `@curry-battle/react-multiple-video-form-manager/react-hook-form` | RHF アダプタ（MultiVideoController、useMultiVideoController、useVideoFieldAdapter） |
| `@curry-battle/react-multiple-video-form-manager/tanstack-form` | TanStack Form アダプタ（MultiVideoController、useMultiVideoController、useVideoFieldAdapter） |
| `@curry-battle/react-multiple-video-form-manager/schemas/zod` | Zod スキーマファクトリ |
| `@curry-battle/react-multiple-video-form-manager/schemas/valibot` | Valibot スキーマファクトリ |

## アーキテクチャ

Ports & Adapters 構成の詳細はリポジトリルートの [ARCHITECTURE.md](../../ARCHITECTURE.md) を参照してください。

## ライセンス

[MIT](./LICENSE)
