export type MultiVideoErrorType =
	| "max_videos"
	| "process_file"
	| "process_thumbnail_file"
	| "upload_file"
	| "upload_thumbnail_file"
	| "unknown";

export type MultiVideoError = {
	type: MultiVideoErrorType;
	message: string;
	cause?: unknown;
};
