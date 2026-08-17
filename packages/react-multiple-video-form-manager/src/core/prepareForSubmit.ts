import type { Thumbnail, ThumbnailForSubmit } from "./types/Thumbnail";
import { ThumbnailSource, ThumbnailSubmitStatus } from "./types/Thumbnail";
import type { UploadFileContext, UploadFileFn } from "./types/Upload";
import { UploadKind } from "./types/Upload";
import type { Video, VideoForSubmitNew } from "./types/Video";
import { VideoUtils } from "./types/Video";
import type { VideoFormStatus } from "./types/VideoStatus";
import { VideoFormStatus as VideoFormStatusValue } from "./types/VideoStatus";

// --- Resolved types ---

// 解決済み payload の `uploadedUrl` は、新規なら転送参照・既存ならサーバ由来の URL と
// 供給源が分かれる。消費側はサーバへ渡すだけで URL 意味論に依存しないため 1 フィールドに畳む。
export type ResolvedThumbnailForSubmit =
	| {
			status: typeof ThumbnailSubmitStatus.New;
			source: string;
			uploadedUrl: string;
	  }
	| { status: typeof ThumbnailSubmitStatus.Unchanged; uploadedUrl: string }
	| {
			status: typeof ThumbnailSubmitStatus.Replaced;
			source: string;
			uploadedUrl: string;
	  }
	| { status: typeof ThumbnailSubmitStatus.Removed };

export type ResolvedVideoForSubmit = {
	tempId: string;
	id: string | undefined;
	status: VideoFormStatus;
	order: number;
	uploadedUrl: string;
	thumbnail: ResolvedThumbnailForSubmit | null;
};

export type PrepareForSubmitOptions = {
	uploadFile?: UploadFileFn;
};

export type PrepareForSubmitResult = {
	videos: ResolvedVideoForSubmit[];
	deletedIds: readonly string[];
};

/**
 * Resolve all video/thumbnail state into a server-ready payload. Call in your submit handler.
 *
 * When `uploadFile` is provided in `options`, pending files (videos and
 * thumbnails alike, told apart by `ctx.kind`) are uploaded inside this call
 * before the result is returned. Calling with no arguments assumes every new item
 * already carries `uploadRef`; missing ones reject with
 * {@link PrepareForSubmitError}.
 */
export type PrepareForSubmitFn = (
	options?: PrepareForSubmitOptions,
) => Promise<PrepareForSubmitResult>;

export class PrepareForSubmitError extends Error {
	readonly successfulUploadRefs: string[];
	constructor(message: string, successfulUploadRefs: string[]) {
		super(message);
		this.name = "PrepareForSubmitError";
		this.successfulUploadRefs = successfulUploadRefs;
	}
}

// --- Implementation ---

function resolveVideoRef(video: Video): string | undefined {
	return video.status === VideoFormStatusValue.New
		? video.uploadRef
		: video.uploadedUrl;
}

function extractThumbnailFile(thumbnail: Thumbnail): File {
	if (thumbnail.source === ThumbnailSource.Frame) {
		return new File([thumbnail.blob], "thumbnail.jpg", { type: "image/jpeg" });
	}
	return thumbnail.file;
}

type UploadResult = { tempId: string; uploadRef: string };

// allSettled で待つのは、途中で失敗しても成功済みの転送参照を回収して呼び出し側の後始末に渡すため
async function settledUpload<T>(
	items: T[],
	fn: (item: T) => Promise<UploadResult>,
): Promise<{ results: UploadResult[]; successfulRefs: string[] }> {
	const settled = await Promise.allSettled(items.map(fn));
	const results: UploadResult[] = [];
	const successfulRefs: string[] = [];
	const errors: unknown[] = [];
	for (const s of settled) {
		if (s.status === "fulfilled") {
			results.push(s.value);
			successfulRefs.push(s.value.uploadRef);
		} else {
			errors.push(s.reason);
		}
	}
	if (errors.length > 0) {
		const msg =
			errors[0] instanceof Error ? errors[0].message : String(errors[0]);
		throw new PrepareForSubmitError(msg, successfulRefs);
	}
	return { results, successfulRefs };
}

/**
 * Resolve all video/thumbnail state into a server-ready payload.
 *
 * When `uploadFile` is provided in `options`, this method uploads all pending
 * files internally before returning. Items that already carry an upload reference
 * are skipped, so mixing both strategies is safe.
 *
 * On failure the thrown {@link PrepareForSubmitError} carries
 * `successfulUploadRefs` for caller-side cleanup.
 */
export async function prepareForSubmit(
	videos: readonly Video[],
	deletedIds: readonly string[],
	options: PrepareForSubmitOptions = {},
): Promise<PrepareForSubmitResult> {
	const { uploadFile } = options;
	// この経路には中断要求の出し手も進捗の受け手も居ないため、ctx は形だけ満たす
	const uploadContext = (kind: UploadKind): UploadFileContext => ({
		kind,
		signal: new AbortController().signal,
		onProgress: () => {},
	});

	const videosForSubmit = VideoUtils.computeVideosForSubmit(videos);
	const thumbnailStatuses = videosForSubmit.map((vid) => ({
		tempId: vid.tempId,
		thumbnailForSubmit: VideoUtils.resolveThumbnailForSubmit(vid),
	}));

	const allSuccessfulRefs: string[] = [];

	try {
		// --- 動画アップロード ---
		const videoUploadMap = new Map<string, string>();

		for (const vid of videosForSubmit) {
			const ref = resolveVideoRef(vid);
			if (ref) {
				videoUploadMap.set(vid.tempId, ref);
			}
		}

		if (uploadFile) {
			const toUpload = videosForSubmit.filter(
				(vid): vid is VideoForSubmitNew =>
					vid.status === VideoFormStatusValue.New &&
					!videoUploadMap.has(vid.tempId),
			);
			const { results, successfulRefs } = await settledUpload(
				toUpload,
				async (vid) => {
					const result = await uploadFile(
						vid.file,
						uploadContext(UploadKind.Video),
					);
					return { tempId: vid.tempId, uploadRef: result.uploadRef };
				},
			);
			allSuccessfulRefs.push(...successfulRefs);
			for (const r of results) {
				videoUploadMap.set(r.tempId, r.uploadRef);
			}
		}

		// --- サムネイルアップロード ---
		const thumbnailUploadMap = new Map<string, string>();

		for (const { tempId, thumbnailForSubmit: t } of thumbnailStatuses) {
			if (
				t &&
				(t.status === ThumbnailSubmitStatus.New ||
					t.status === ThumbnailSubmitStatus.Replaced) &&
				t.thumbnail.uploadRef
			) {
				thumbnailUploadMap.set(tempId, t.thumbnail.uploadRef);
			}
		}

		if (uploadFile) {
			const toUpload = thumbnailStatuses.filter(
				({ tempId, thumbnailForSubmit: t }) =>
					t !== null &&
					(t.status === ThumbnailSubmitStatus.New ||
						t.status === ThumbnailSubmitStatus.Replaced) &&
					!thumbnailUploadMap.has(tempId),
			);
			const { results, successfulRefs } = await settledUpload(
				toUpload,
				async ({ tempId, thumbnailForSubmit: t }) => {
					const file = extractThumbnailFile(
						(t as { thumbnail: Thumbnail }).thumbnail,
					);
					const result = await uploadFile(
						file,
						uploadContext(UploadKind.Thumbnail),
					);
					return { tempId, uploadRef: result.uploadRef };
				},
			);
			allSuccessfulRefs.push(...successfulRefs);
			for (const r of results) {
				thumbnailUploadMap.set(r.tempId, r.uploadRef);
			}
		}

		// --- 解決済み payload 組み立て ---
		const resolved: ResolvedVideoForSubmit[] = videosForSubmit.map((vid) => {
			const uploadedUrl =
				videoUploadMap.get(vid.tempId) ?? resolveVideoRef(vid);
			if (!uploadedUrl) {
				throw new PrepareForSubmitError(
					`Missing uploadRef for video ${vid.tempId}. Pass uploadFile to prepareForSubmit or to the controller.`,
					allSuccessfulRefs,
				);
			}

			const entry = thumbnailStatuses.find((t) => t.tempId === vid.tempId);
			const thumbnail = resolveThumbnail(
				entry?.thumbnailForSubmit ?? null,
				thumbnailUploadMap.get(vid.tempId),
				vid.tempId,
				allSuccessfulRefs,
			);

			return {
				tempId: vid.tempId,
				id: vid.id,
				status: vid.status,
				order: vid.order,
				uploadedUrl,
				thumbnail,
			};
		});

		return { videos: resolved, deletedIds };
	} catch (err) {
		if (err instanceof PrepareForSubmitError) throw err;
		throw new PrepareForSubmitError(
			err instanceof Error ? err.message : String(err),
			allSuccessfulRefs,
		);
	}
}

function resolveThumbnail(
	t: ThumbnailForSubmit | null,
	resolvedUploadedUrl: string | undefined,
	tempId: string,
	allSuccessfulRefs: string[],
): ResolvedThumbnailForSubmit | null {
	if (!t) return null;

	switch (t.status) {
		case ThumbnailSubmitStatus.Unchanged:
			return { status: t.status, uploadedUrl: t.uploadedUrl };
		case ThumbnailSubmitStatus.Removed:
			return { status: t.status };
		case ThumbnailSubmitStatus.New:
		case ThumbnailSubmitStatus.Replaced: {
			const uploadedUrl = resolvedUploadedUrl ?? t.thumbnail.uploadRef;
			if (!uploadedUrl) {
				throw new PrepareForSubmitError(
					`Missing uploadRef for thumbnail of video ${tempId}. Pass uploadFile to prepareForSubmit or to the controller.`,
					allSuccessfulRefs,
				);
			}
			return {
				status: t.status,
				source: t.thumbnail.source,
				uploadedUrl,
			};
		}
	}
}
