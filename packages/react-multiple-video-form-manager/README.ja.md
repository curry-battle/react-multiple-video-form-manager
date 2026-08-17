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
        prepareForSubmit,
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
          <button disabled={isBusy}>保存</button>
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
const { items, rootErrors, handlers, pendingOperations, isAdding, isBusy, prepareForSubmit, raw } = useMultiVideoController({
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
        prepareForSubmit,
        raw,
      }) => (
        // UI 実装
      )}
    />
  );
}
```

TanStack アダプタは read / write をすべてフォームストア経由で行うため（`useStore(form.store, ...)` で reactive subscription を組み、validate 直後に `items` / `rootErrors` が同期して更新されます）、`useMultiVideoController` はフォームレベルで呼べます。`<form.Field mode="array">` は不要です — field インスタンスが未登録なら `validateField` はフォームレベルの検証へフォールバックし、`setFieldValue` が `fieldMeta` を自前で生成します。submit ハンドラから `prepareForSubmit` を使いたい場合はフックを直接呼んでください（render props コンポーネントは render の内側に閉じ込めます）。`name` / `deletedName` はフォームデータのトップレベルキーである必要があります。

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

## アップロード戦略

| 戦略 | 渡す場所 | 動作 |
|------|---------|------|
| upload-on-submit（デフォルト） | `prepareForSubmit({ uploadFile, uploadThumbnailFile })` | submit 時にまとめてアップロード |
| upload-on-select（opt-in） | Controller prop `uploadOnSelect={{ uploadFile, uploadThumbnailFile }}` | ファイル選択時に即アップロード |

**デフォルトは upload-on-submit** — 初見のユーザは `prepareForSubmit(options)` だけ覚えれば OK です。

**upload-on-select** は大容量ファイル向けの最適化です。submit を軽くできます。両方を併用しても安全です: `prepareForSubmit` は `uploadRef` を持つ項目をスキップするため、`uploadOnSelect` 使用中に `options` を渡しても二重アップロードにはなりません。

## オプション Props

| Prop | Type | 説明 |
|------|------|------|
| `processFile` | `(file: File) => Promise<File>` | 動画ファイル追加・差し替え時の前処理 |
| `processThumbnailFile` | `(file: File) => Promise<File>` | サムネイルファイルアップロード時の前処理 |
| `uploadOnSelect` | `UploadOnSelectOptions` | ファイル選択時に即アップロード。`uploadFile?`、`uploadThumbnailFile?`、`onOrphanedUpload?` を含む |
| `onError` | `(error: MultiVideoError) => void` | `processFile` / `processThumbnailFile` / `uploadFile` / `uploadThumbnailFile` の失敗、`maxVideos` 超過、バリデーション reject 時に呼ばれる |
| `maxVideos` | `number` | UI レベルの最大動画数。超過時は `addVideo` が即 `false` |
| `messages` | `CoreMessages` | i18n 用のカスタムエラーメッセージ |
| `deletedName` | `string` | 削除IDフィールド名。デフォルトは `${name}DeletedIds` |

## Render Props

| Prop | Type | 説明 |
|------|------|------|
| `items` | `VideoItem[]` | 動画ごとの `video`, `errors`, `canMoveUp`, `canMoveDown`, `errorMessages`, `isPending`, バインド済み `handlers` |
| `rootErrors` | `VideoFieldError[]` | 配列レベルエラー（maxVideos 等） |
| `addVideo` | `(file: File) => Promise<boolean>` | 動画を追加 |
| `isBusy` | `boolean` | 追加中または per-item 非同期操作中 |
| `isAdding` | `boolean` | `addVideo` 実行中 |
| `pendingOperations` | `ReadonlySet<string>` | 非同期操作中アイテムの tempId 集合 |
| `prepareForSubmit` | `(options?) => Promise<PrepareForSubmitResult>` | submit 用に状態を解決 |
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

`prepareForSubmit` は動画・サムネイルの状態をサーバー送信可能な payload に解決します。`options` に `uploadFile` / `uploadThumbnailFile` を渡すと、**このメソッド内で未アップロードのファイルがアップロードされ**、すべての `uploadedUrl` が埋まった状態で返ります（新規は項目の `uploadRef`、既存は保存済み URL が入ります）。

### upload-on-submit（デフォルト）

呼び出し時に `uploadFile` / `uploadThumbnailFile` を渡します:

```tsx
const { prepareForSubmit } = useMultiVideoController({
  form,
  name: "videos",
});

const onSubmit = async () => {
  const { videos, deletedIds } = await prepareForSubmit({ uploadFile, uploadThumbnailFile });
  await api.save({ videos: videos.map(toMyApiShape), deletedIds });
};
```

### upload-on-select（opt-in）

`uploadOnSelect` として Controller に渡します。ファイル選択時に即アップロードされるため、`prepareForSubmit()` は引数不要です:

```tsx
<MultiVideoController
  uploadOnSelect={{ uploadFile, uploadThumbnailFile, onOrphanedUpload }}
  render={({ prepareForSubmit }) => {
    const onSubmit = async () => {
      const { videos, deletedIds } = await prepareForSubmit();
      await api.save({ videos: videos.map(toMyApiShape), deletedIds });
    };
  }}
/>
```

両方を併用できます: `prepareForSubmit` は `uploadRef` を持つ項目をスキップするため、`uploadOnSelect` 使用中に `options` を渡しても二重アップロードにはなりません。`uploadOnSelect` が一部の種類だけ設定されている場合（例: `uploadFile` のみ）、未設定の種類（サムネイル）は `options` を渡した submit 時にアップロードされます。

アップロードが 1 件でも失敗すると `PrepareForSubmitError` で reject します。`successfulUploadRefs` に失敗前にアップロードが成功した転送参照が入っているため、孤立ファイルの後始末に使えます。純粋関数版 `prepareForSubmit(videos, deletedIds, { uploadFile?, uploadThumbnailFile? })` もコアエントリから export されています。

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
| `@curry-battle/react-multiple-video-form-manager` | コア（型、VideoUtils、ThumbnailUtils、useMultiVideoCore、usePreviewUrl、useThumbnailPreviewUrl、prepareForSubmit、getFileFromChangeEvent / getFilesFromChangeEvent、VideoFieldAdapter） |
| `@curry-battle/react-multiple-video-form-manager/react-hook-form` | RHF アダプタ（MultiVideoController、useMultiVideoController、useVideoFieldAdapter） |
| `@curry-battle/react-multiple-video-form-manager/tanstack-form` | TanStack Form アダプタ（MultiVideoController、useMultiVideoController、useVideoFieldAdapter） |
| `@curry-battle/react-multiple-video-form-manager/schemas/zod` | Zod スキーマファクトリ |
| `@curry-battle/react-multiple-video-form-manager/schemas/valibot` | Valibot スキーマファクトリ |

## アーキテクチャ

Ports & Adapters 構成の詳細はリポジトリルートの [ARCHITECTURE.md](../../ARCHITECTURE.md) を参照してください。

## ライセンス

[MIT](./LICENSE)
