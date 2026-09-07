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
	/**
	 * この項目が差し替えた既存動画の id（差し替えで生まれた項目のみ）。
	 *
	 * 既存動画の差し替えは「元動画の id を deletedVideoIds へ入れる + 新規項目で
	 * 置き換える」の 2 つに分かれるため、対応関係が配列から復元できない。転送の完了を
	 * 待たずに送信素材を作る `uploads.getReady` は、この項目を除外するときに元動画の
	 * 削除も取り消す必要があり、そのためにリンクを永続させる。フック内に持つと
	 * remount で失われ、「元動画が消えて差し替え後も入らない」状態が復活する
	 */
	replacesId?: string;
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

/** 転送が完了し転送参照が確定した新規動画 */
export type VideoUploaded = VideoNew & { uploadRef: string };

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
			// 差し替えで生まれた項目のファイルをさらに選び直しても、元動画との
			// 対応は維持する
			...(video.replacesId !== undefined && { replacesId: video.replacesId }),
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
		const newVideo: VideoNew = {
			...VideoUtils.createNew(existingVideo.tempId, newFile),
			replacesId: existingVideo.id,
		};
		return { deletedId: existingVideo.id, newVideo };
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

	/**
	 * 登録が確定した新規動画を既存動画へ昇格させる。
	 *
	 * 引数の型が「転送完了済みでなければ昇格できない」という前提を表現する。
	 * `uploadedUrl` を必須にしているのは、転送参照が不透明トークンの場合に URL を
	 * 導出できないため。省略を許すと、表示できない値を持つ `VideoExisting`
	 * （動画が壊れて見える状態）を作れてしまう。`uploadRef` も同じ理由で引き継がない。
	 *
	 * `thumbnailUrl` を省略すると「サムネイル無しの既存動画」になる。サムネイルも
	 * 保存したなら渡すこと。`thumbnailRemoved` は false に戻す（保存後の項目は
	 * サーバ側の状態そのものなので、未反映の削除要求は残っていない）
	 */
	markSaved: (
		video: VideoUploaded,
		params: { id: string; uploadedUrl: string; thumbnailUrl?: string },
	): VideoExisting => ({
		tempId: video.tempId,
		status: VideoFormStatus.Existing,
		id: params.id,
		file: undefined,
		uploadedUrl: params.uploadedUrl,
		thumbnail:
			params.thumbnailUrl !== undefined
				? {
						source: ThumbnailSource.Existing,
						uploadedUrl: params.thumbnailUrl,
					}
				: null,
		thumbnailRemoved: false,
	}),

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

			it("replacesId が保持されること（選び直しでリンクが切れない）", () => {
				const original = makeNew({ replacesId: "id-original" });
				const newFile = new File(["new"], "new.mp4", { type: "video/mp4" });

				const result = VideoUtils.updateNewVideoFile(original, newFile);
				expect(result.replacesId).toBe("id-original");
			});

			it("replacesId が無ければキーも生えないこと", () => {
				const original = makeNew();
				const newFile = new File(["new"], "new.mp4", { type: "video/mp4" });

				const result = VideoUtils.updateNewVideoFile(original, newFile);
				expect("replacesId" in result).toBe(false);
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

			it("差し替え元の id を replacesId に持つこと", () => {
				const existing = makeExisting({ id: "id-original" });
				const newFile = new File(["data"], "replace.mp4", {
					type: "video/mp4",
				});

				const result = VideoUtils.replaceExisting(existing, newFile);

				expect(result.newVideo.replacesId).toBe("id-original");
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

		describe("markSaved", () => {
			const makeUploaded = () => ({
				...makeNew({ tempId: "temp_up" }),
				uploadRef: "upload-token-1",
			});

			it("VideoNew → VideoExisting に昇格すること", () => {
				const result = VideoUtils.markSaved(makeUploaded(), {
					id: "id-1",
					uploadedUrl: "https://s3.example.com/up.mp4",
				});

				expect(result.status).toBe(VideoFormStatus.Existing);
				expect(result.id).toBe("id-1");
				expect(result.tempId).toBe("temp_up");
				expect(result.file).toBeUndefined();
				expect(result.uploadedUrl).toBe("https://s3.example.com/up.mp4");
			});

			it("thumbnailUrl を渡すと既存サムネイルになること", () => {
				const result = VideoUtils.markSaved(makeUploaded(), {
					id: "id-1",
					uploadedUrl: "https://s3.example.com/up.mp4",
					thumbnailUrl: "https://s3.example.com/up-thumb.jpg",
				});

				expect(result.thumbnail).toEqual({
					source: ThumbnailSource.Existing,
					uploadedUrl: "https://s3.example.com/up-thumb.jpg",
				});
			});

			it("thumbnailUrl 省略時は thumbnail: null", () => {
				const result = VideoUtils.markSaved(makeUploaded(), {
					id: "id-1",
					uploadedUrl: "https://s3.example.com/up.mp4",
				});

				expect(result.thumbnail).toBeNull();
			});

			it("thumbnailRemoved は false に戻ること", () => {
				const result = VideoUtils.markSaved(
					{
						...makeUploaded(),
						thumbnail: {
							source: ThumbnailSource.Upload,
							file: new File(["t"], "t.jpg", { type: "image/jpeg" }),
						},
					},
					{
						id: "id-1",
						uploadedUrl: "https://s3.example.com/up.mp4",
						thumbnailUrl: "https://s3.example.com/up-thumb.jpg",
					},
				);

				expect(result.thumbnailRemoved).toBe(false);
			});

			it("uploadRef は引き継がないこと（表示に使える保証が無い）", () => {
				const result = VideoUtils.markSaved(makeUploaded(), {
					id: "id-1",
					uploadedUrl: "https://s3.example.com/up.mp4",
				});

				expect("uploadRef" in result).toBe(false);
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
