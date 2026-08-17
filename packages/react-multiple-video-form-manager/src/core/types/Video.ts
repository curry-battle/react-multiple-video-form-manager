import type { AnyThumbnail, Thumbnail, ThumbnailForSubmit } from "./Thumbnail";
import { ThumbnailSource, ThumbnailSubmitStatus } from "./Thumbnail";
import { VideoFormStatus } from "./VideoStatus";

// types

export type VideoBase = {
	// Form用の一時的なID. Reactでのkey用途などに使用
	tempId: string;
};

export type VideoNew = VideoBase & {
	status: typeof VideoFormStatus.New;
	id?: undefined;
	file: File;
	uploadRef?: string;
	// サムネイル（フレームキャプチャ or アップロード、未設定は null）
	thumbnail: Thumbnail | null;
};

export type VideoExisting = VideoBase & {
	status: typeof VideoFormStatus.Existing;
	id: string;
	file?: undefined;
	uploadedUrl: string;
	// サムネイル（全種類対応、未設定は null）
	thumbnail: AnyThumbnail | null;
	// 既存サムネイルが削除されたかどうか
	thumbnailRemoved: boolean;
};

export type Video = VideoNew | VideoExisting;

export type VideoForSubmitNew = VideoNew & { order: number };
export type VideoForSubmitExisting = VideoExisting & { order: number };
export type VideoForSubmit = VideoForSubmitNew | VideoForSubmitExisting;

export type ProcessFileFn = (file: File) => Promise<File>;

// functions

/**
 * Generate a unique temporary ID using crypto.randomUUID()
 * This ensures uniqueness even when multiple files are uploaded simultaneously
 */
export const generateTempId = (): string => {
	return `temp_${crypto.randomUUID()}`;
};

export const VideoUtils = {
	createNew: (tempId: string, file: File, uploadRef?: string): VideoNew => {
		return {
			tempId,
			id: undefined,
			status: VideoFormStatus.New,
			file,
			...(uploadRef !== undefined && { uploadRef }),
			thumbnail: null,
		};
	},

	/** 編集フォームの初期値生成用。サーバーデータから VideoExisting を組み立てる。 */
	createExisting: (params: {
		id: string;
		uploadedUrl: string;
		thumbnailUrl?: string;
		tempId?: string;
	}): VideoExisting => ({
		tempId: params.tempId ?? generateTempId(),
		status: VideoFormStatus.Existing,
		id: params.id,
		file: undefined,
		uploadedUrl: params.uploadedUrl,
		thumbnail: params.thumbnailUrl
			? { source: ThumbnailSource.Existing, uploadedUrl: params.thumbnailUrl }
			: null,
		thumbnailRemoved: false,
	}),

	updateNewVideoFile: (video: VideoNew, newFile: File): VideoNew => {
		return {
			tempId: video.tempId,
			id: undefined,
			status: VideoFormStatus.New,
			file: newFile,
			uploadRef: undefined,
			thumbnail: video.thumbnail,
		};
	},

	/**
	 * 既存動画を新しいファイルで差し替え（削除する id を返す）。
	 *
	 * tempId は引き継ぐ。項目を先に入れて転送を裏で走らせる構成では、tempId が
	 * 変わると台帳のキーと React の key が差し替えの瞬間に別物になり、行が一度消えて
	 * 別の行として現れる。tempId を保てば差し替えは stale 判定（index 再解決 →
	 * 参照比較）という主経路で処理され、旧レコードを孤児回収に頼らずに済む。
	 *
	 * 引き継げるのは、元項目が配列から消えて id が `deletedVideoIds` に入るため
	 * 元の tempId を誰も使わないから。
	 */
	replaceExisting: (
		existingVideo: VideoExisting,
		newFile: File,
	): { deletedId: string; newVideo: VideoNew } => {
		const newVideo = VideoUtils.createNew(existingVideo.tempId, newFile);
		return { deletedId: existingVideo.id, newVideo };
	},

	// 送信用にorder値を付与（配列indexがそのままorder）
	computeVideosForSubmit: (videos: readonly Video[]): VideoForSubmit[] => {
		return videos.map((vid, index) => ({ ...vid, order: index }));
	},

	// サムネイルの送信用ステータスを解決
	resolveThumbnailForSubmit: (video: Video): ThumbnailForSubmit | null => {
		if (video.status === VideoFormStatus.New) {
			if (video.thumbnail) {
				return {
					status: ThumbnailSubmitStatus.New,
					thumbnail: video.thumbnail,
				};
			}
			return null;
		}

		// VideoExisting
		if (video.thumbnail) {
			if (video.thumbnail.source === ThumbnailSource.Existing) {
				return {
					status: ThumbnailSubmitStatus.Unchanged,
					uploadedUrl: video.thumbnail.uploadedUrl,
				};
			}
			if (video.thumbnailRemoved) {
				return {
					status: ThumbnailSubmitStatus.Replaced,
					thumbnail: video.thumbnail as Thumbnail,
				};
			}
			return {
				status: ThumbnailSubmitStatus.New,
				thumbnail: video.thumbnail as Thumbnail,
			};
		}

		// thumbnail is null
		if (video.thumbnailRemoved) {
			return { status: ThumbnailSubmitStatus.Removed };
		}
		return null;
	},

	// 動画にサムネイルを設定（VideoNew用）
	setThumbnail: (video: VideoNew, thumbnail: Thumbnail): VideoNew => {
		return {
			...video,
			thumbnail,
		};
	},
};

if (import.meta.vitest) {
	const { describe, it, expect } = import.meta.vitest;

	// --- Test Helpers ---
	const makeNew = (overrides?: Partial<VideoNew>): VideoNew => ({
		tempId: "temp_test-new",
		status: VideoFormStatus.New,
		id: undefined,
		file: new File(["data"], "test.mp4", { type: "video/mp4" }),
		uploadRef: undefined,
		thumbnail: null,
		...overrides,
	});

	const makeExisting = (overrides?: Partial<VideoExisting>): VideoExisting => ({
		tempId: "temp_test-existing",
		status: VideoFormStatus.Existing,
		id: "00000000-0000-7000-8000-000000000001",
		uploadedUrl: "https://s3.example.com/video.mp4",
		file: undefined,
		thumbnail: null,
		thumbnailRemoved: false,
		...overrides,
	});

	// --- Tests ---

	describe("generateTempId", () => {
		it("temp_ プレフィックスで始まること", () => {
			expect(generateTempId()).toMatch(/^temp_/);
		});

		it("呼び出すたびに異なるIDを返すこと", () => {
			const id1 = generateTempId();
			const id2 = generateTempId();
			expect(id1).not.toBe(id2);
		});
	});

	describe("VideoUtils", () => {
		describe("computeVideosForSubmit", () => {
			it("空配列 → 空配列", () => {
				expect(VideoUtils.computeVideosForSubmit([])).toEqual([]);
			});

			it("New/Existing のみ → 0, 1, 2... と連番order", () => {
				const videos: Video[] = [makeNew(), makeExisting()];
				const result = VideoUtils.computeVideosForSubmit(videos);
				expect(result.map((r) => r.order)).toEqual([0, 1]);
			});

			it("元配列を変更しないこと", () => {
				const videos: Video[] = [makeNew(), makeExisting()];
				const original = [...videos];
				VideoUtils.computeVideosForSubmit(videos);
				expect(videos).toEqual(original);
			});
		});

		describe("createExisting", () => {
			it("thumbnailUrl あり → ThumbnailExisting が組まれる", () => {
				const result = VideoUtils.createExisting({
					id: "vid-1",
					uploadedUrl: "https://s3.example.com/video.mp4",
					thumbnailUrl: "https://s3.example.com/thumb.jpg",
				});

				expect(result.status).toBe(VideoFormStatus.Existing);
				expect(result.id).toBe("vid-1");
				expect(result.uploadedUrl).toBe("https://s3.example.com/video.mp4");
				expect(result.thumbnail).toEqual({
					source: ThumbnailSource.Existing,
					uploadedUrl: "https://s3.example.com/thumb.jpg",
				});
				expect(result.thumbnailRemoved).toBe(false);
			});

			it("thumbnailUrl なし → thumbnail: null", () => {
				const result = VideoUtils.createExisting({
					id: "vid-2",
					uploadedUrl: "https://s3.example.com/video.mp4",
				});

				expect(result.thumbnail).toBeNull();
			});

			it("tempId が temp_ プレフィックスで一意生成される", () => {
				const a = VideoUtils.createExisting({
					id: "vid-1",
					uploadedUrl: "https://s3.example.com/a.mp4",
				});
				const b = VideoUtils.createExisting({
					id: "vid-2",
					uploadedUrl: "https://s3.example.com/b.mp4",
				});

				expect(a.tempId).toMatch(/^temp_/);
				expect(b.tempId).toMatch(/^temp_/);
				expect(a.tempId).not.toBe(b.tempId);
			});

			it("file は undefined である", () => {
				const result = VideoUtils.createExisting({
					id: "vid-1",
					uploadedUrl: "https://s3.example.com/video.mp4",
				});
				expect(result.file).toBeUndefined();
			});
		});

		describe("createNew", () => {
			it("正しいVideoNew構造を返すこと", () => {
				const file = new File(["data"], "video.mp4", { type: "video/mp4" });
				const result = VideoUtils.createNew("temp_abc", file);

				expect(result.status).toBe(VideoFormStatus.New);
				expect(result.tempId).toBe("temp_abc");
				expect(result.file).toBe(file);
				expect(result.id).toBeUndefined();
				expect(result.thumbnail).toBeNull();
			});
		});

		describe("updateNewVideoFile", () => {
			it("新しいFileで更新されたVideoNewを返すこと（サムネイル維持）", () => {
				const thumbnail = {
					source: ThumbnailSource.Frame,
					blob: new Blob(["thumb"]),
					timestamp: 1.0,
				};
				const original = makeNew({ thumbnail });
				const newFile = new File(["new"], "new.mp4", { type: "video/mp4" });

				const result = VideoUtils.updateNewVideoFile(original, newFile);

				expect(result.file).toBe(newFile);
				expect(result.status).toBe(VideoFormStatus.New);
				expect(result.thumbnail).toBe(thumbnail);
			});

			it("tempIdが保持されること", () => {
				const original = makeNew({ tempId: "temp_keep-me" });
				const newFile = new File(["new"], "new.mp4", { type: "video/mp4" });

				const result = VideoUtils.updateNewVideoFile(original, newFile);
				expect(result.tempId).toBe("temp_keep-me");
			});
		});

		describe("replaceExisting", () => {
			it("{deletedId, newVideo} を返すこと", () => {
				const existing = makeExisting();
				const newFile = new File(["data"], "replace.mp4", {
					type: "video/mp4",
				});

				const result = VideoUtils.replaceExisting(existing, newFile);

				expect(result.deletedId).toBe(existing.id);
				expect(result.newVideo.status).toBe(VideoFormStatus.New);
				expect(result.newVideo.file).toBe(newFile);
				expect(result.newVideo.thumbnail).toBeNull();
			});

			it("tempId を引き継ぐこと", () => {
				const existing = makeExisting({ tempId: "temp_keep-me" });
				const newFile = new File(["data"], "replace.mp4", {
					type: "video/mp4",
				});

				const result = VideoUtils.replaceExisting(existing, newFile);

				expect(result.newVideo.tempId).toBe("temp_keep-me");
			});
		});

		describe("resolveThumbnailForSubmit", () => {
			it("VideoNew + thumbnail → New", () => {
				const thumbnail = {
					source: ThumbnailSource.Upload,
					file: new File(["t"], "t.jpg", { type: "image/jpeg" }),
				};
				const video = makeNew({ thumbnail });
				const result = VideoUtils.resolveThumbnailForSubmit(video);
				expect(result).toEqual({
					status: "new",
					thumbnail,
				});
			});

			it("VideoNew + null → null", () => {
				const video = makeNew({ thumbnail: null });
				expect(VideoUtils.resolveThumbnailForSubmit(video)).toBeNull();
			});

			it("VideoExisting + source:existing → Unchanged", () => {
				const video = makeExisting({
					thumbnail: {
						source: ThumbnailSource.Existing,
						uploadedUrl: "https://s3.example.com/thumb.jpg",
					},
				});
				const result = VideoUtils.resolveThumbnailForSubmit(video);
				expect(result).toEqual({
					status: "unchanged",
					uploadedUrl: "https://s3.example.com/thumb.jpg",
				});
			});

			it("VideoExisting + source:frame + thumbnailRemoved → Replaced", () => {
				const thumbnail = {
					source: ThumbnailSource.Frame,
					blob: new Blob(["thumb"]),
					timestamp: 1.0,
				};
				const video = makeExisting({
					thumbnail,
					thumbnailRemoved: true,
				});
				const result = VideoUtils.resolveThumbnailForSubmit(video);
				expect(result).toEqual({
					status: "replaced",
					thumbnail,
				});
			});

			it("VideoExisting + source:upload + !thumbnailRemoved → New", () => {
				const thumbnail = {
					source: ThumbnailSource.Upload,
					file: new File(["t"], "t.jpg", { type: "image/jpeg" }),
				};
				const video = makeExisting({
					thumbnail,
					thumbnailRemoved: false,
				});
				const result = VideoUtils.resolveThumbnailForSubmit(video);
				expect(result).toEqual({
					status: "new",
					thumbnail,
				});
			});

			it("VideoExisting + null + thumbnailRemoved → Removed", () => {
				const video = makeExisting({
					thumbnail: null,
					thumbnailRemoved: true,
				});
				const result = VideoUtils.resolveThumbnailForSubmit(video);
				expect(result).toEqual({ status: "removed" });
			});

			it("VideoExisting + null + !thumbnailRemoved → null", () => {
				const video = makeExisting({
					thumbnail: null,
					thumbnailRemoved: false,
				});
				expect(VideoUtils.resolveThumbnailForSubmit(video)).toBeNull();
			});
		});

		describe("setThumbnail", () => {
			it("サムネイルが設定されたVideoNewを返すこと", () => {
				const video = makeNew();
				const thumbnail = {
					source: ThumbnailSource.Frame,
					blob: new Blob(["thumb"]),
					timestamp: 3.0,
				};

				const result = VideoUtils.setThumbnail(video, thumbnail);

				expect(result.thumbnail).toBe(thumbnail);
				expect(result.tempId).toBe(video.tempId);
				expect(result.file).toBe(video.file);
			});
		});
	});
}
