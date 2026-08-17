import type { SubmitThumbnail, SubmitVideo } from "./types/Submit";
import { ThumbnailSubmitStatus } from "./types/Thumbnail";
import { UploadKind } from "./types/Upload";
import type { Video } from "./types/Video";
import { VideoUtils } from "./types/Video";
import { VideoFormStatus } from "./types/VideoStatus";
import { readUploadRef, readUploadSource } from "./uploadSlots";

/**
 * 転送していないサムネイルを消費側へ渡すための File。
 * フレームキャプチャの blob からも File を導出する（`readUploadSource`）。
 */
function readThumbnailFile(video: Video): File | undefined {
	return readUploadSource(video, UploadKind.Thumbnail)?.file;
}

function toSubmitThumbnail(video: Video): SubmitThumbnail | null {
	const resolved = VideoUtils.resolveThumbnailForSubmit(video);
	if (resolved === null) return null;

	switch (resolved.status) {
		case ThumbnailSubmitStatus.Unchanged:
			return {
				status: ThumbnailSubmitStatus.Unchanged,
				uploadedUrl: resolved.uploadedUrl,
			};
		case ThumbnailSubmitStatus.Removed:
			return { status: ThumbnailSubmitStatus.Removed };
		// New と Replaced を 1 つに畳まないのは、status を `New | Replaced` に広げると
		// 素材の型がキー（uploadRef / file）で判別できなくなるため
		case ThumbnailSubmitStatus.New: {
			const uploadRef = readUploadRef(video, UploadKind.Thumbnail);
			if (uploadRef !== undefined) {
				return { status: ThumbnailSubmitStatus.New, uploadRef };
			}
			const file = readThumbnailFile(video);
			return file === undefined
				? null
				: { status: ThumbnailSubmitStatus.New, file };
		}
		case ThumbnailSubmitStatus.Replaced: {
			const uploadRef = readUploadRef(video, UploadKind.Thumbnail);
			if (uploadRef !== undefined) {
				return { status: ThumbnailSubmitStatus.Replaced, uploadRef };
			}
			const file = readThumbnailFile(video);
			return file === undefined
				? null
				: { status: ThumbnailSubmitStatus.Replaced, file };
		}
	}
}

function toSubmitVideo(video: Video): SubmitVideo {
	const thumbnail = toSubmitThumbnail(video);

	if (video.status === VideoFormStatus.Existing) {
		return { status: VideoFormStatus.Existing, id: video.id, thumbnail };
	}

	const uploadRef = video.uploadRef;
	// 転送ハンドラを設定しない構成では参照が無いのが正常なので、転送そのものを
	// 消費側に委ねる形（File を渡す）になる
	return uploadRef === undefined
		? {
				status: VideoFormStatus.New,
				file: video.file,
				tempId: video.tempId,
				thumbnail,
			}
		: { status: VideoFormStatus.New, uploadRef, thumbnail };
}

/**
 * 送信素材を組む。
 *
 * `excluded` に入れた tempId は素材から外す。転送の完了を待たない
 * `uploads.getReady` が、まだ送れない項目を落とすために使う。
 */
export function buildSubmitPayload(
	videos: readonly Video[],
	deletedVideoIds: readonly string[],
	excluded?: ReadonlySet<string>,
): { videos: SubmitVideo[]; deletedIds: string[] } {
	const submitVideos: SubmitVideo[] = [];
	for (const video of videos) {
		if (excluded?.has(video.tempId)) continue;
		submitVideos.push(toSubmitVideo(video));
	}
	return { videos: submitVideos, deletedIds: [...deletedVideoIds] };
}
