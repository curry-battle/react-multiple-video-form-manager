// 中立 (form-agnostic) コア。RHF / TanStack 型は一切含まれない。

export {
	getFileFromChangeEvent,
	getFilesFromChangeEvent,
} from "./core/fileInputHelpers";
export type {
	PrepareForSubmitFn,
	PrepareForSubmitOptions,
	PrepareForSubmitResult,
	ResolvedThumbnailForSubmit,
	ResolvedVideoForSubmit,
} from "./core/prepareForSubmit";
export {
	PrepareForSubmitError,
	prepareForSubmit,
} from "./core/prepareForSubmit";
export type {
	MultiVideoError,
	MultiVideoErrorType,
} from "./core/types/MultiVideoError";
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
	ProcessFileFn,
	UploadFileFn,
	UploadFileResult,
	UploadHandlers,
	UploadOnSelectOptions,
	Video,
	VideoExisting,
	VideoForSubmit,
	VideoForSubmitExisting,
	VideoForSubmitNew,
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
	type UseMultiVideoCoreParams,
	type UseMultiVideoCoreReturn,
	useMultiVideoCore,
} from "./core/useMultiVideoCore";
export { usePreviewUrl, useThumbnailPreviewUrl } from "./core/usePreviewUrl";
export type { VideoFieldAdapter } from "./core/VideoFieldAdapter";
