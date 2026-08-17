import type { AnyThumbnail, Thumbnail } from "./types/Thumbnail";
import { ThumbnailSource } from "./types/Thumbnail";
import type { Video, VideoNew } from "./types/Video";
import { VideoUtils } from "./types/Video";
import { VideoFormStatus } from "./types/VideoStatus";

/**
 * 末尾に追加する。項目は転送の完了を待たずに配列へ入るので、呼び出し側が
 * tempId を決めて `VideoNew` を組み、返った配列を反映してから転送を起動する。
 *
 * 上限の判定は持たない。「同期 read → 判定 → set」を 1 tick で閉じる呼び出し側が
 * 担うほうが、判定と挿入のあいだに別の操作が割り込む余地が無い。
 */
export function addVideo(
	videos: readonly Video[],
	newVideo: VideoNew,
): { videos: Video[] } {
	return { videos: [...videos, newVideo] };
}

/**
 * 対象のファイルを差し替える。差し替え後の `VideoNew` を返すのは、呼び出し側が
 * その項目の転送を起動するのに要るため（Existing / New で作り方が違う）。
 */
export function changeFile(
	videos: readonly Video[],
	tempId: string,
	processedFile: File,
): {
	videos: Video[];
	video: VideoNew | null;
	deletedId: string | null;
} {
	const index = videos.findIndex((vid) => vid.tempId === tempId);
	if (index === -1)
		return { videos: [...videos], video: null, deletedId: null };
	const target = videos[index];

	switch (target.status) {
		case VideoFormStatus.Existing: {
			// Existing のファイル差し替えは元動画を削除扱いにし New で置換する。
			// サムネイルは VideoUtils.replaceExisting 内で破棄される。
			const { deletedId, newVideo } = VideoUtils.replaceExisting(
				target,
				processedFile,
			);
			const next = [...videos];
			next[index] = newVideo;
			return { videos: next, video: newVideo, deletedId };
		}
		case VideoFormStatus.New: {
			const updated = VideoUtils.updateNewVideoFile(target, processedFile);
			const next = [...videos];
			next[index] = updated;
			return { videos: next, video: updated, deletedId: null };
		}
		default:
			return target satisfies never;
	}
}

export function deleteVideo(
	videos: readonly Video[],
	tempId: string,
): { videos: Video[]; deleted: boolean; deletedId: string | null } {
	const index = videos.findIndex((vid) => vid.tempId === tempId);
	if (index === -1)
		return { videos: [...videos], deleted: false, deletedId: null };
	const video = videos[index];

	switch (video.status) {
		case VideoFormStatus.Existing:
			return {
				videos: videos.filter((_, i) => i !== index),
				deleted: true,
				deletedId: video.id,
			};
		case VideoFormStatus.New:
			return {
				videos: videos.filter((_, i) => i !== index),
				deleted: true,
				deletedId: null,
			};
		default:
			return video satisfies never;
	}
}

export function moveUp(
	videos: readonly Video[],
	tempId: string,
): { videos: Video[]; moved: boolean } {
	const index = videos.findIndex((vid) => vid.tempId === tempId);
	if (index <= 0) return { videos: [...videos], moved: false };
	const next = [...videos];
	const temp = next[index - 1];
	next[index - 1] = next[index];
	next[index] = temp;
	return { videos: next, moved: true };
}

export function moveDown(
	videos: readonly Video[],
	tempId: string,
): { videos: Video[]; moved: boolean } {
	const index = videos.findIndex((vid) => vid.tempId === tempId);
	if (index === -1 || index >= videos.length - 1)
		return { videos: [...videos], moved: false };
	const next = [...videos];
	const temp = next[index + 1];
	next[index + 1] = next[index];
	next[index] = temp;
	return { videos: next, moved: true };
}

export function moveTo(
	videos: readonly Video[],
	tempId: string,
	toIndex: number,
): { videos: Video[]; moved: boolean } {
	const fromIndex = videos.findIndex((vid) => vid.tempId === tempId);
	if (fromIndex === -1) return { videos: [...videos], moved: false };
	const clamped = Math.max(0, Math.min(videos.length - 1, toIndex));
	if (fromIndex === clamped) return { videos: [...videos], moved: false };
	const next = [...videos];
	const [item] = next.splice(fromIndex, 1);
	next.splice(clamped, 0, item);
	return { videos: next, moved: true };
}

/**
 * サムネイルを差し替える。差し替え後の項目を返すのは、呼び出し側がその項目の
 * サムネイル転送を起動するのに要るため。
 */
export function setThumbnail(
	videos: readonly Video[],
	tempId: string,
	thumbnail: Thumbnail | null,
): { videos: Video[]; video: Video | null } {
	const index = videos.findIndex((vid) => vid.tempId === tempId);
	if (index === -1) return { videos: [...videos], video: null };
	const video = videos[index];

	switch (video.status) {
		case VideoFormStatus.New: {
			const next = [...videos];
			const updated = thumbnail
				? VideoUtils.setThumbnail(video, thumbnail)
				: { ...video, thumbnail: null };
			next[index] = updated;
			return { videos: next, video: updated };
		}
		case VideoFormStatus.Existing: {
			const next = [...videos];
			const updated = {
				...video,
				thumbnail: thumbnail as AnyThumbnail | null,
				thumbnailRemoved:
					video.thumbnailRemoved ||
					video.thumbnail?.source === ThumbnailSource.Existing,
			};
			next[index] = updated;
			return { videos: next, video: updated };
		}
		default:
			return video satisfies never;
	}
}
