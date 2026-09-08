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
        uploads,
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
          <button onClick={() => void uploads.wait()}>Submit</button>
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
const { items, rootErrors, handlers, pendingOperations, isAdding, isBusy, uploads, raw } = useMultiVideoController({
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
        uploads,
        raw,
      }) => (
        // UI implementation
      )}
    />
  );
}
```

The TanStack adapter reads and writes through the form store only (`useStore(form.store, ...)` for reactive subscriptions, keeping `items` / `rootErrors` synchronized after validation), so `useMultiVideoController` can be called at form level. `<form.Field mode="array">` is not required: `validateField` falls back to form-level validators when no field instance is registered, and `setFieldValue` populates `fieldMeta` itself. Call the hook directly when the submit handler needs `uploads` — the render-props component keeps it inside the render callback. `name` and `deletedName` must be top-level keys of the form data.

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

## Optional Props

| Prop | Type | Description |
|------|------|-------------|
| `processFile` | `(file: File) => Promise<File>` | Preprocessor for video file add/replace (transcode, compress, etc.) |
| `processThumbnailFile` | `(file: File) => Promise<File>` | Preprocessor for thumbnail file upload |
| `uploadFile` | `UploadFileFn` | Starts a transfer when a file is selected. One function serves both the video and the thumbnail; `ctx.kind` says which |
| `onError` | `(error: MultiVideoError) => void` | Error handler for `processFile` / `processThumbnailFile` / `uploadFile` failures, `maxVideos` exceeded, or validation rejection |
| `maxVideos` | `number` | UI-level maximum video count; `addVideo` returns `false` immediately when exceeded |
| `messages` | `CoreMessages` | Custom error messages for i18n |
| `deletedName` | `string` | Deleted IDs field name. Defaults to `${name}DeletedIds` |

**The promise returned by `processFile` / `processThumbnailFile` must settle.** Both share one type (`ProcessFileFn`), so this requirement applies to both. While a file is being processed it is not yet an item, and `uploads.wait()` waits for that processing to finish — a promise that never settles means submit never returns (the same holds with no `uploadFile` configured). Unlike a transfer there is no way to abort, so reject on a timeout for anything that can stall.

**`VideoFieldAdapter.validate()` carries the same requirement.** Every handler awaits `validate()` after writing to the form, so a promise that never settles blocks submit even when the payload is complete. The bundled adapters satisfy this; only a hand-written adapter needs care.

## Render Props

| Prop | Type | Description |
|------|------|-------------|
| `items` | `VideoItem[]` | Per-item data with `video`, `errors`, `canMoveUp`, `canMoveDown`, `errorMessages`, `isPending`, and bound `handlers` |
| `rootErrors` | `VideoFieldError[]` | Array-level errors (maxVideos etc.) |
| `addVideo` | `(file: File) => Promise<boolean>` | Add a new video |
| `isBusy` | `boolean` | `true` when any add or per-item async operation is in progress. Gate the submit button on this in a `uploads.getReady()` setup (see below) |
| `isAdding` | `boolean` | `true` while `addVideo` is in progress |
| `pendingOperations` | `ReadonlySet<string>` | tempIds of items whose per-item handler is running. Covers processing, the form write and validation; the transfer time is not included |
| `uploads` | `UploadsApi` | Transfer state plus `wait` / `getReady` / `retry` for building the submit payload |
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
type SingleVideoError = Partial<Record<VideoErrorFieldKey, VideoFieldError>>;  // keys: VIDEO_ERROR_FIELD_KEYS
type VideosError = {
  items: Record<string, SingleVideoError>;  // tempId-keyed per-item errors
  root: VideoFieldError[];                      // array-level errors (maxVideos etc.)
};
```

## Submit Flow

Configuring `uploadFile` starts a transfer the moment a file is selected. The item enters the form without waiting for that transfer, which runs in the background. `uploads` offers two ways to build the submit payload, and **the choice determines how you gate the submit button.**

### `uploads.wait()` — wait, then send

```tsx
const { uploads } = useMultiVideoController({ form, name: "videos", uploadFile });

const onSubmit = async () => {
  const result = await uploads.wait();
  if (!result.ok) {
    // result.failedTempIds holds the tempIds that failed
    return;
  }
  await api.save({ videos: result.videos, deletedIds: result.deletedIds });
};
```

**Transfers are not the only thing it waits for.** `addVideo`, `changeFile`, `setThumbnailFromFrame` and `setThumbnailFromFile` all await file processing or frame capture *before* writing to the form. While that runs the selection is not yet an item, so without waiting the chosen video would silently drop out of the payload. `wait()` waits for those in-flight selections too — **including when no `uploadFile` is configured**, since the handlers still run even when no transfer does.

That is why **a `wait()` setup does not need to disable the submit button on `isBusy`.** Both bundled examples are built this way.

Three more things about `wait()`:

- **Processing failures are reported only through `onError`.** A failed selection never becomes an item, so it appears in neither `failedTempIds` nor `uploads.failed`. Transfer failures travel a different path
- The payload is built from the form values as of the moment it resolves, not a snapshot from when it was called
- **A selection started right before it returns may not be included.** The set to wait on is fixed at the start of each round. Close the window where saving and selecting overlap in your UI

### `uploads.getReady()` — send what is ready, without waiting

```tsx
const onSubmit = async () => {
  const { videos, deletedIds, excludedTempIds } = uploads.getReady();
  if (excludedTempIds.length > 0) {
    // tell the user these videos were left out of this save
  }
  await api.save({ videos, deletedIds });
};
```

Any item with an unfinished transfer is excluded whole and reported in `excludedTempIds`. The item stays in the form, so surface it to the user.

**In a `getReady()` setup, disable the submit button on `isBusy`.** `getReady()` cannot see in-flight selections: they do not appear in `excludedTempIds` either, they simply drop out of the payload. `pendingOperations` and `items[].isPending` are not enough — both are keyed by tempId, and `addVideo` has no tempId yet at the point it starts. Note that `isBusy` goes through state, so it lags by one render.

**Removing the gate opens a window where items the form has not validated end up in the payload.** Every handler awaits `validate()` *after* writing to the form, so an item that has been written but not yet validated is picked up by `getReady()`.

### `uploads.retry()` — retry a failed transfer

```tsx
<button onClick={() => uploads.retry(item.video.tempId)}>Retry</button>
```

**A failed transfer is not reissued by pressing save again.** Call `retry(tempId)` explicitly. Retrying automatically would re-fire a consistently failing transfer on every save. Failed items are available through `uploads.failed` and `items[].uploadState`.

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
| `@curry-battle/react-multiple-video-form-manager` | Core (types, VideoUtils, ThumbnailUtils, useMultiVideoCore, usePreviewUrl, useThumbnailPreviewUrl, getFileFromChangeEvent / getFilesFromChangeEvent, VideoFieldAdapter) |
| `@curry-battle/react-multiple-video-form-manager/react-hook-form` | RHF adapter (MultiVideoController, useMultiVideoController, useVideoFieldAdapter) |
| `@curry-battle/react-multiple-video-form-manager/tanstack-form` | TanStack Form adapter (MultiVideoController, useMultiVideoController, useVideoFieldAdapter) |
| `@curry-battle/react-multiple-video-form-manager/schemas/zod` | Zod schema factory |
| `@curry-battle/react-multiple-video-form-manager/schemas/valibot` | Valibot schema factory |

## Architecture

See the repository-root [ARCHITECTURE.md](../../ARCHITECTURE.md) for the Ports & Adapters design.

## License

[MIT](./LICENSE)
