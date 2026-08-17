import type { AnyThumbnail, Thumbnail } from "./types/Thumbnail";
import { ThumbnailSource } from "./types/Thumbnail";
import type { Video } from "./types/Video";
import { generateTempId, VideoUtils } from "./types/Video";
import { VideoFormStatus } from "./types/VideoStatus";

export function addVideo(
	videos: readonly Video[],
	processedFile: File,
	maxVideos?: number,
	uploadRef?: string,
): { videos: Video[]; added: boolean } {
	if (maxVideos !== undefined && videos.length >= maxVideos) {
		return { videos: [...videos], added: false };
	}

	const newVideo = VideoUtils.createNew(
		generateTempId(),
		processedFile,
		uploadRef,
	);
	return { videos: [...videos, newVideo], added: true };
}

export function changeFile(
	videos: readonly Video[],
	tempId: string,
	processedFile: File,
	uploadRef?: string,
): { videos: Video[]; changed: boolean; deletedId: string | null } {
	const index = videos.findIndex((vid) => vid.tempId === tempId);
	if (index === -1)
		return { videos: [...videos], changed: false, deletedId: null };
	const target = videos[index];

	switch (target.status) {
		case VideoFormStatus.Existing: {
			// Existing のファイル差し替えは元動画を削除扱いにし New で置換する。
			// サムネイルは VideoUtils.replaceExisting 内で破棄される。
			const { deletedId, newVideo } = VideoUtils.replaceExisting(
				target,
				processedFile,
			);
			if (uploadRef !== undefined) {
				newVideo.uploadRef = uploadRef;
			}
			const next = [...videos];
			next[index] = newVideo;
			return { videos: next, changed: true, deletedId };
		}
		case VideoFormStatus.New: {
			const updated = VideoUtils.updateNewVideoFile(target, processedFile);
			if (uploadRef !== undefined) {
				updated.uploadRef = uploadRef;
			}
			const next = [...videos];
			next[index] = updated;
			return { videos: next, changed: true, deletedId: null };
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

export function setThumbnail(
	videos: readonly Video[],
	tempId: string,
	thumbnail: Thumbnail | null,
): { videos: Video[]; updated: boolean } {
	const index = videos.findIndex((vid) => vid.tempId === tempId);
	if (index === -1) return { videos: [...videos], updated: false };
	const video = videos[index];

	switch (video.status) {
		case VideoFormStatus.New: {
			const next = [...videos];
			if (thumbnail) {
				next[index] = VideoUtils.setThumbnail(video, thumbnail);
			} else {
				next[index] = { ...video, thumbnail: null };
			}
			return { videos: next, updated: true };
		}
		case VideoFormStatus.Existing: {
			const next = [...videos];
			next[index] = {
				...video,
				thumbnail: thumbnail as AnyThumbnail | null,
				thumbnailRemoved:
					video.thumbnailRemoved ||
					video.thumbnail?.source === ThumbnailSource.Existing,
			};
			return { videos: next, updated: true };
		}
		default:
			return video satisfies never;
	}
}
