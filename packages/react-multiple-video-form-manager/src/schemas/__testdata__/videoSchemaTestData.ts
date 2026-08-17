import { ThumbnailSource } from "../../core/types/Thumbnail";

export const validUUID = "019415a9-7c6c-7bf0-9c0f-1a2b3c4d5e6f";
export const validHttpsUrl = "https://s3.example.com/video.mp4";
export const validThumbHttpsUrl = "https://s3.example.com/thumb.jpg";

// --- 動画ファイルヘルパー ---

export const makeMp4File = (name = "video.mp4") =>
	new File(["data"], name, { type: "video/mp4" });

export const makeWebmFile = (name = "video.webm") =>
	new File(["data"], name, { type: "video/webm" });

export const makeLargeVideoFile = (size: number, name = "large.mp4") =>
	new File(["x".repeat(size)], name, { type: "video/mp4" });

// --- サムネイルファイルヘルパー ---

export const makeThumbnailJpegFile = (name = "thumb.jpg") =>
	new File(["data"], name, { type: "image/jpeg" });

export const makeThumbnailPngFile = (name = "thumb.png") =>
	new File(["data"], name, { type: "image/png" });

export const makeLargeThumbnailFile = (
	size: number,
	name = "large-thumb.jpg",
) => new File(["x".repeat(size)], name, { type: "image/jpeg" });

// --- サムネイルオブジェクト ---

export const validThumbnailFromFrame = {
	source: ThumbnailSource.Frame,
	blob: new Blob(["frame-data"], { type: "image/jpeg" }),
	timestamp: 5.0,
};

export const validThumbnailFromUpload = {
	source: ThumbnailSource.Upload,
	file: makeThumbnailJpegFile(),
};

export const validThumbnailExisting = {
	source: ThumbnailSource.Existing,
	uploadedUrl: validThumbHttpsUrl,
};

// --- 正常系データ ---

export const validNewVideo = {
	tempId: "temp_1",
	status: "new" as const,
	id: undefined,
	file: makeMp4File(),
	uploadRef: undefined,
	thumbnail: null,
};

export const validNewVideoWithThumbnail = {
	tempId: "temp_1t",
	status: "new" as const,
	id: undefined,
	file: makeMp4File(),
	uploadRef: undefined,
	thumbnail: validThumbnailFromFrame,
};

export const validExistingVideo = {
	tempId: "temp_2",
	status: "existing" as const,
	id: validUUID,
	file: undefined,
	uploadedUrl: validHttpsUrl,
	thumbnail: validThumbnailExisting,
	thumbnailRemoved: false,
};

export const validExistingVideoNoThumbnail = {
	tempId: "temp_2n",
	status: "existing" as const,
	id: validUUID,
	file: undefined,
	uploadedUrl: validHttpsUrl,
	thumbnail: null,
	thumbnailRemoved: false,
};

export const validNewVideoWithUploadRef = {
	tempId: "temp_uploaded",
	status: "new" as const,
	id: undefined,
	file: makeMp4File(),
	uploadRef: "https://s3.example.com/uploaded.mp4",
	thumbnail: null,
};

// 転送先はキーやトークンを返すこともあるため、uploadRef は URL 形式を要求しない
export const validNewVideoWithOpaqueUploadRef = {
	tempId: "temp_opaque_ref",
	status: "new" as const,
	id: undefined,
	file: makeMp4File(),
	uploadRef: "uploads/2026/08/17/abcd1234",
	thumbnail: null,
};

// --- 異常系データ ---

export const invalidNewVideoWithWrongType = {
	tempId: "temp_avi",
	status: "new" as const,
	id: undefined,
	file: new File(["data"], "video.avi", { type: "video/x-msvideo" }),
	uploadRef: undefined,
	thumbnail: null,
};

export const invalidNewVideoWithoutFile = {
	tempId: "temp_nofile",
	status: "new" as const,
	id: undefined,
	uploadRef: undefined,
	thumbnail: null,
};

export const invalidExistingWithBadId = {
	tempId: "temp_bad_id",
	status: "existing" as const,
	id: "not-a-uuid",
	file: undefined,
	uploadedUrl: validHttpsUrl,
	thumbnail: null,
	thumbnailRemoved: false,
};

export const invalidExistingWithoutUploadedUrl = {
	tempId: "temp_no_url",
	status: "existing" as const,
	id: validUUID,
	file: undefined,
	thumbnail: null,
	thumbnailRemoved: false,
};

export const invalidVideoWithBadStatus = {
	tempId: "temp_bad_status",
	status: "invalid",
	id: validUUID,
	file: undefined,
	uploadedUrl: validHttpsUrl,
};

export const invalidNewVideoWithBadThumbnailType = {
	tempId: "temp_bad_thumb",
	status: "new" as const,
	id: undefined,
	file: makeMp4File(),
	uploadRef: undefined,
	thumbnail: {
		source: ThumbnailSource.Upload,
		file: new File(["data"], "thumb.gif", { type: "image/gif" }),
	},
};
