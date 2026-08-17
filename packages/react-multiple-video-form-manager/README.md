# @curry-battle/react-multiple-video-form-manager

[Japanese / 日本語](./README.ja.md)

Headless React library for managing multiple videos.
Uses Discriminated Union and State Machine patterns to declaratively manage adding, deleting, reordering, and replacing videos with integrated thumbnail management (frame capture / file upload).

Supports both react-hook-form and TanStack Form via Hexagonal Architecture (Ports & Adapters).

## Installation

```bash
npm install @curry-battle/react-multiple-video-form-manager
```

GitHub Packages `.npmrc`:

```
@curry-battle:registry=https://npm.pkg.github.com
```

Install one of the supported form libraries:

```bash
# React Hook Form
npm install react-hook-form

# TanStack Form
npm install @tanstack/react-form
```

### Schema support (optional)

```bash
# Zod
npm install zod

# Valibot
npm install valibot
```

## Usage (React Hook Form)

### MultiVideoController

Videos are managed as an array field, with deleted video IDs tracked in a separate field. By default, the deleted IDs field name is `${name}DeletedIds` (e.g., `videosDeletedIds` for `name="videos"`). Override with the `deletedName` prop if needed.

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
              {/* Per-item operations via item.handlers */}
              <button onClick={() => item.handlers.delete()}>Delete</button>
              <button onClick={() => item.handlers.moveUp()}>Up</button>
              <button onClick={() => item.handlers.moveDown()}>Down</button>
              {item.isPending && <span>Processing...</span>}
              {item.errorMessages[0] && <span>{item.errorMessages[0]}</span>}
            </div>
          ))}
          <button disabled={isBusy}>Submit</button>
        </>
      )}
    />
  );
}
```

### useMultiVideoController

You can also use the hook directly without the Controller component.

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

## Usage (TanStack Form)

`createVideosSchema` returns an array schema, so wrap it in `z.object({ <fieldName>: createVideosSchema(...) })` before passing as a validator (use `v.object` for Valibot).

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
        // UI implementation
      )}
    />
  );
}
```

The TanStack adapter reads and writes through the form store only (`useStore(form.store, ...)` for reactive subscriptions, keeping `items` / `rootErrors` synchronized after validation), so `useMultiVideoController` can be called at form level. `<form.Field mode="array">` is not required: `validateField` falls back to form-level validators when no field instance is registered, and `setFieldValue` populates `fieldMeta` itself. Call the hook directly when the submit handler needs `prepareForSubmit` — the render-props component keeps it inside the render callback. `name` and `deletedName` must be top-level keys of the form data.

Both subpaths export the same component name `MultiVideoController`. When using both in the same file, use import aliases:

```tsx
import { MultiVideoController as RhfController } from ".../react-hook-form";
import { MultiVideoController as TanstackController } from ".../tanstack-form";
```

## Initializing from Server Data

Use `VideoUtils.createExisting` to build `VideoExisting` items from server data:

```tsx
import { VideoUtils } from "@curry-battle/react-multiple-video-form-manager";

const initialVideos = serverVideos.map((sv) =>
  VideoUtils.createExisting({
    id: sv.id,
    uploadedUrl: sv.url,
    thumbnailUrl: sv.thumbnailUrl, // optional
  })
);
```

## Preview Display

Newly added videos (`status: "new"`) do not hold a previewUrl in form state.
Use `usePreviewUrl` inside a per-item component to derive the preview from `file`.

```tsx
import { usePreviewUrl, type Video } from "@curry-battle/react-multiple-video-form-manager";

function VideoItem({ video }: { video: Video }) {
  const previewUrl = usePreviewUrl(video);
  return <video src={previewUrl} controls />;
}
```

For thumbnail previews, use `useThumbnailPreviewUrl`:

```tsx
import { useThumbnailPreviewUrl } from "@curry-battle/react-multiple-video-form-manager";

function ThumbnailPreview({ video }: { video: Video }) {
  const thumbnailUrl = useThumbnailPreviewUrl(video.thumbnail ?? null);
  if (!thumbnailUrl) return null;
  return <img src={thumbnailUrl} alt="" />;
}
```

Since these are hooks, they cannot be called inside an `items.map()` callback. Extract them into per-item components as shown above.

## File Input Helpers

`getFileFromChangeEvent` (single) and `getFilesFromChangeEvent` (multiple) extract `File`(s) from an `<input type="file">` change event, throwing when no file is selected. Resetting `input.value` remains the caller's responsibility.

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

## Upload Strategies

| Strategy | Where to pass | Behavior |
|----------|--------------|----------|
| upload-on-submit (default) | `prepareForSubmit({ uploadFile, uploadThumbnailFile })` | Upload all pending files at submit time |
| upload-on-select (opt-in) | Controller prop `uploadOnSelect={{ uploadFile, uploadThumbnailFile }}` | Upload immediately on file select |

**Default: upload-on-submit** — first-time users only need to learn `prepareForSubmit(options)`.

**upload-on-select** is an optimization for large files: uploading early makes submit lighter. Both strategies can coexist safely: `prepareForSubmit` skips items that already have an `uploadedUrl`, so passing `options` while using `uploadOnSelect` never double-uploads.

## Optional Props

| Prop | Type | Description |
|------|------|-------------|
| `processFile` | `(file: File) => Promise<File>` | Preprocessor for video file add/replace (transcode, compress, etc.) |
| `processThumbnailFile` | `(file: File) => Promise<File>` | Preprocessor for thumbnail file upload |
| `uploadOnSelect` | `UploadOnSelectOptions` | Upload files immediately on select. Contains `uploadFile?`, `uploadThumbnailFile?`, and `onOrphanedUpload?` |
| `onError` | `(error: MultiVideoError) => void` | Error handler for `processFile` / `processThumbnailFile` / `uploadFile` / `uploadThumbnailFile` failures, `maxVideos` exceeded, or validation rejection |
| `maxVideos` | `number` | UI-level maximum video count; `addVideo` returns `false` immediately when exceeded |
| `messages` | `CoreMessages` | Custom error messages for i18n |
| `deletedName` | `string` | Deleted IDs field name. Defaults to `${name}DeletedIds` |

## Render Props

| Prop | Type | Description |
|------|------|-------------|
| `items` | `VideoItem[]` | Per-item data with `video`, `errors`, `canMoveUp`, `canMoveDown`, `errorMessages`, `isPending`, and bound `handlers` |
| `rootErrors` | `VideoFieldError[]` | Array-level errors (maxVideos etc.) |
| `addVideo` | `(file: File) => Promise<boolean>` | Add a new video |
| `isBusy` | `boolean` | `true` when any add or per-item async operation is in progress |
| `isAdding` | `boolean` | `true` while `addVideo` is in progress |
| `pendingOperations` | `ReadonlySet<string>` | tempIds of items with in-flight operations |
| `prepareForSubmit` | `(options?) => Promise<PrepareForSubmitResult>` | Resolve all state for submission |
| `raw` | `{ videos, deletedVideoIds }` | Raw form values for debugging |

Per-item operations are accessed via `item.handlers`:

| Handler | Signature | Description |
|---------|-----------|-------------|
| `changeFile` | `(file: File) => Promise<boolean>` | Replace the item's file |
| `delete` | `() => Promise<boolean>` | Delete the item |
| `moveUp` | `() => Promise<boolean>` | Move up one position |
| `moveDown` | `() => Promise<boolean>` | Move down one position |
| `move` | `(toIndex: number) => Promise<boolean>` | Move to arbitrary position |
| `setThumbnailFromFrame` | `(videoElement: HTMLVideoElement) => Promise<boolean>` | Capture frame as thumbnail |
| `setThumbnailFromFile` | `(file: File) => Promise<boolean>` | Set thumbnail from file |
| `removeThumbnail` | `() => Promise<boolean>` | Remove thumbnail |

## Error Model

The library uses a **neutral error model** shared across form adapters.

```ts
type VideoFieldError = { message?: string; type?: string; source?: unknown };
type SingleVideoError = Partial<Record<"file" | "thumbnail" | "id" | "uploadedUrl" | "status", VideoFieldError>>;
type VideosError = {
  items: Record<string, SingleVideoError>;  // tempId-keyed per-item errors
  root: VideoFieldError[];                      // array-level errors (maxVideos etc.)
};
```

## Submit Flow

`prepareForSubmit` resolves all video/thumbnail state into a server-ready payload where every `uploadedUrl` is filled in. When `uploadFile` / `uploadThumbnailFile` are passed in `options`, **pending files are uploaded inside this call** before the result is returned.

### upload-on-submit (default)

Pass `uploadFile` / `uploadThumbnailFile` at call time — **`prepareForSubmit` uploads all pending files internally** before returning the resolved payload:

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

### upload-on-select (opt-in)

Pass the callbacks via the `uploadOnSelect` controller prop — files are uploaded immediately on selection, so `prepareForSubmit()` needs no arguments:

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

Both strategies can coexist: `prepareForSubmit` skips items that already have an `uploadedUrl`, so passing `options` while using `uploadOnSelect` never double-uploads. If `uploadOnSelect` only configures part of the upload set (e.g. only `uploadFile`), the unconfigured kind (thumbnails) is still uploaded at submit time when `options` are passed to `prepareForSubmit`.

If any upload fails, it rejects with `PrepareForSubmitError`; its `successfulUploadUrls` lists the URLs uploaded before the failure, so you can clean up orphaned files. A standalone pure version `prepareForSubmit(videos, deletedIds, { uploadFile?, uploadThumbnailFile? })` is also exported from the core entry.

### Manual thumbnail resolution (escape hatch)

The lower-level primitives remain available if you need full control:

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
    case ThumbnailSubmitStatus.New:       /* upload thumb.thumbnail */    break;
    case ThumbnailSubmitStatus.Unchanged: /* keep thumb.uploadedUrl */    break;
    case ThumbnailSubmitStatus.Replaced:  /* replace with thumb.thumbnail */ break;
    case ThumbnailSubmitStatus.Removed:   /* explicitly removed */       break;
  }
}
```

## Frame Capture CORS Configuration

When using `item.handlers.setThumbnailFromFrame` with cross-origin videos (S3/CloudFront etc.), both client and server configuration is required.

**1. Add `crossOrigin` to the `<video>` element:**

```tsx
<video ref={videoRef} src={videoUrl} crossOrigin="anonymous" />
```

**2. Configure CORS headers on the server:**

```json
{
  "AllowedHeaders": ["*"],
  "AllowedMethods": ["GET"],
  "AllowedOrigins": ["https://your-app-domain.com"],
  "MaxAgeSeconds": 3600
}
```

When using CloudFront, forward the `Origin` header in the origin request policy and return `Access-Control-Allow-Origin` in the response headers policy. Same-origin URLs (`blob:` URLs etc.) do not require this configuration.

## Schema (Zod / Valibot)

```ts
import { createVideosSchema } from "@curry-battle/react-multiple-video-form-manager/schemas/zod";
// or:
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

For the `deletedVideoIds` field, use `createDeletedVideoIdsSchema`:

```ts
import { createDeletedVideoIdsSchema } from "@curry-battle/react-multiple-video-form-manager/schemas/zod";

const deletedIdsSchema = createDeletedVideoIdsSchema({
  idValidation: (id) => isValidId(id),
});
```

## Exports

| Path | Contents |
|------|----------|
| `@curry-battle/react-multiple-video-form-manager` | Core (types, VideoUtils, ThumbnailUtils, useMultiVideoCore, usePreviewUrl, useThumbnailPreviewUrl, prepareForSubmit, getFileFromChangeEvent / getFilesFromChangeEvent, VideoFieldAdapter) |
| `@curry-battle/react-multiple-video-form-manager/react-hook-form` | RHF adapter (MultiVideoController, useMultiVideoController, useVideoFieldAdapter) |
| `@curry-battle/react-multiple-video-form-manager/tanstack-form` | TanStack Form adapter (MultiVideoController, useMultiVideoController, useVideoFieldAdapter) |
| `@curry-battle/react-multiple-video-form-manager/schemas/zod` | Zod schema factory |
| `@curry-battle/react-multiple-video-form-manager/schemas/valibot` | Valibot schema factory |

## Architecture

See the repository-root [ARCHITECTURE.md](../../ARCHITECTURE.md) for the Ports & Adapters design.

## License

[MIT](./LICENSE)
