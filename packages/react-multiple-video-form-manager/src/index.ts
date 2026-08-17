// 中立 (form-agnostic) コア。RHF / TanStack 型は一切含まれない。

export {
	getFileFromChangeEvent,
	getFilesFromChangeEvent,
} from "./core/fileInputHelpers";
export type {
	MultiVideoError,
	MultiVideoErrorType,
} from "./core/types/MultiVideoError";
export type {
	LocalSubmitThumbnail,
	LocalSubmitVideo,
	SubmitThumbnail,
	SubmitVideo,
	UploadedSubmitThumbnail,
	UploadedSubmitVideo,
} from "./core/types/Submit";
export type {
	AnyThumbnail,
	Thumbnail,
	ThumbnailExisting,
	ThumbnailForSubmit,
	ThumbnailForSubmitNew,
	ThumbnailForSubmitRemoved,
	ThumbnailForSubmitReplaced,
	ThumbnailForSubmitUnchanged,
	ThumbnailFromFrame,
	ThumbnailFromUpload,
} from "./core/types/Thumbnail";
export {
	ThumbnailSource,
	ThumbnailSubmitStatus,
	ThumbnailUtils,
} from "./core/types/Thumbnail";
export type {
	UploadFileContext,
	UploadFileFn,
	UploadFileResult,
} from "./core/types/Upload";
export { UPLOAD_KINDS, UploadKind } from "./core/types/Upload";
export type { UploadState, VideoUploadState } from "./core/types/UploadState";
export type {
	ProcessFileFn,
	Video,
	VideoExisting,
	VideoNew,
} from "./core/types/Video";
export { generateTempId, VideoUtils } from "./core/types/Video";
export type {
	CoreMessages,
	FormWithVideoField,
	ItemHandlers,
	SingleVideoError,
	VideoErrorFieldKey,
	VideoFieldError,
	VideoItem,
	VideoSchemaOptions,
	VideosError,
} from "./core/types/VideoSchemaTypes";
export {
	collectErrorMessages,
	defaultCoreMessages,
	VIDEO_ERROR_FIELD_KEYS,
} from "./core/types/VideoSchemaTypes";
export { VideoFormStatus } from "./core/types/VideoStatus";
export {
	type MultiVideoCoreOptions,
	type MultiVideoRenderProps,
	type ReadyUploadedVideos,
	type ReadyVideos,
	type UploadsApi,
	type UploadsUploadedApi,
	type UploadWaitResult,
	type UploadWaitUploadedResult,
	type UseMultiVideoCoreParams,
	type UseMultiVideoCoreReturn,
	type UseMultiVideoCoreUploadedReturn,
	useMultiVideoCore,
} from "./core/useMultiVideoCore";
export { usePreviewUrl, useThumbnailPreviewUrl } from "./core/usePreviewUrl";
export type { VideoFieldAdapter } from "./core/VideoFieldAdapter";
