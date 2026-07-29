import { act, useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "vitest-browser-react";
import { ThumbnailSource } from "../types/Thumbnail";
import type {
	UploadFileFn,
	UploadOnSelectOptions,
	Video,
	VideoExisting,
	VideoNew,
} from "../types/Video";
import type {
	CoreMessages,
	VideoFieldError,
	VideosError,
} from "../types/VideoSchemaTypes";
import { VideoFormStatus } from "../types/VideoStatus";
import { useMultiVideoCore } from "../useMultiVideoCore";
import type { VideoFieldAdapter } from "../VideoFieldAdapter";

// --- Helpers ---

function createDeferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

const makeNewVideo = (overrides?: Partial<VideoNew>): VideoNew => ({
	tempId: `temp_new-${crypto.randomUUID().slice(0, 8)}`,
	status: VideoFormStatus.New,
	id: undefined,
	file: new File(["data"], "test.mp4", { type: "video/mp4" }),
	uploadedUrl: undefined,
	thumbnail: null,
	...overrides,
});

const makeExistingVideo = (
	overrides?: Partial<VideoExisting>,
): VideoExisting => ({
	tempId: `temp_existing-${crypto.randomUUID().slice(0, 8)}`,
	status: VideoFormStatus.Existing,
	id: `id-${crypto.randomUUID().slice(0, 8)}`,
	uploadedUrl: "https://s3.example.com/video.mp4",
	file: undefined,
	thumbnail: null,
	thumbnailRemoved: false,
	...overrides,
});

/**
 * FakeVideoFieldAdapter。setVideos で配列全体を置き換える。
 *
 * 実アダプタ (useWatch / useStore) のセマンティクスを模倣する:
 * - ストア (ref) は setVideos で同期更新される
 * - videos プロパティはレンダー時点のスナップショット (再レンダーまで stale)
 * - getVideos() はストアの同期 read (常に最新)
 */
function useFakeAdapter(initial: Video[], errors?: VideosError) {
	const [, force] = useState(0);
	const videosRef = useRef<Video[]>(initial);
	const deletedIdsRef = useRef<string[]>([]);
	const [errorsState] = useState<VideosError>(
		errors ?? { items: {}, root: [] },
	);
	const validateRef = useRef<ReturnType<
		typeof vi.fn<() => Promise<void>>
	> | null>(null);
	if (validateRef.current === null) {
		validateRef.current = vi.fn<() => Promise<void>>(async () => {});
	}
	const validate = validateRef.current;

	const videosSnapshot = videosRef.current;
	const deletedIdsSnapshot = deletedIdsRef.current;

	const adapter: VideoFieldAdapter = {
		videos: videosSnapshot,
		setVideos: (next) => {
			videosRef.current = next;
			force((n) => n + 1);
		},
		getVideos: () => videosRef.current,
		deletedVideoIds: deletedIdsSnapshot,
		setDeletedVideoIds: (next) => {
			deletedIdsRef.current = next;
			force((n) => n + 1);
		},
		getDeletedVideoIds: () => deletedIdsRef.current,
		validate: validate as () => Promise<void>,
		errors: errorsState,
	};
	return {
		adapter,
		validate,
		getVideos: () => videosRef.current,
		getDeletedIds: () => deletedIdsRef.current,
	};
}

async function renderCore(
	initial: Video[] = [],
	options: {
		errors?: VideosError;
		maxVideos?: number;
		processFile?: (file: File) => Promise<File>;
		processThumbnailFile?: (file: File) => Promise<File>;
		uploadFile?: UploadFileFn;
		uploadThumbnailFile?: UploadFileFn;
		onError?: (error: unknown) => void;
		onOrphanedUpload?: (uploadedUrl: string) => void;
		messages?: CoreMessages;
	} = {},
) {
	const ref: {
		adapter?: VideoFieldAdapter;
		validate?: ReturnType<typeof vi.fn>;
	} = {};
	const { result } = await renderHook(() => {
		const { adapter, validate } = useFakeAdapter(initial, options.errors);
		ref.adapter = adapter;
		ref.validate = validate;
		return useMultiVideoCore({
			adapter,
			maxVideos: options.maxVideos,
			processFile: options.processFile,
			processThumbnailFile: options.processThumbnailFile,
			uploadOnSelect: {
				uploadFile: options.uploadFile,
				uploadThumbnailFile: options.uploadThumbnailFile,
				onOrphanedUpload: options.onOrphanedUpload,
			},
			onError: options.onError,
			messages: options.messages,
		});
	});
	return { result, ref };
}

// --- Tests ---

describe("useMultiVideoCore (FakeVideoFieldAdapter)", () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	describe("handleAdd", () => {
		it("空配列に追加できること", async () => {
			const { result } = await renderCore();
			const file = new File(["v"], "a.mp4", { type: "video/mp4" });
			let ok = false;
			await act(async () => {
				ok = await result.current.handlers.add(file);
			});
			expect(ok).toBe(true);
			expect(result.current.raw.videos).toHaveLength(1);
			expect(result.current.raw.videos[0].status).toBe(VideoFormStatus.New);
		});

		it("maxVideos に達すると false を返し onError を呼ぶこと", async () => {
			const onError = vi.fn();
			const { result } = await renderCore([makeNewVideo()], {
				maxVideos: 1,
				onError,
			});
			let ok = true;
			await act(async () => {
				ok = await result.current.handlers.add(
					new File(["v"], "b.mp4", { type: "video/mp4" }),
				);
			});
			expect(ok).toBe(false);
			expect(onError).toHaveBeenCalledWith(
				expect.objectContaining({ type: "max_videos" }),
			);
		});

		it("既存配列の末尾に追加されること", async () => {
			const visible = makeNewVideo();
			const { result } = await renderCore([visible]);
			await act(async () => {
				await result.current.handlers.add(
					new File(["v"], "c.mp4", { type: "video/mp4" }),
				);
			});
			const videos = result.current.raw.videos;
			expect(videos).toHaveLength(2);
			expect(videos[0]).toBe(visible);
			expect(videos[1].status).toBe(VideoFormStatus.New);
		});

		it("processFile が呼ばれること、失敗時は onError + false", async () => {
			const onError = vi.fn();
			const processFile = vi.fn(async (f: File) => f);
			const { result } = await renderCore([], { processFile, onError });
			await act(async () => {
				await result.current.handlers.add(
					new File(["v"], "p.mp4", { type: "video/mp4" }),
				);
			});
			expect(processFile).toHaveBeenCalled();

			const failingProcess = vi.fn(async () => {
				throw new Error("boom");
			});
			const { result: r2 } = await renderCore([], {
				processFile: failingProcess,
				onError,
			});
			let ok = true;
			await act(async () => {
				ok = await r2.current.handlers.add(
					new File(["v"], "p2.mp4", { type: "video/mp4" }),
				);
			});
			expect(ok).toBe(false);
			expect(onError).toHaveBeenCalledWith(
				expect.objectContaining({ type: "process_file" }),
			);
		});

		it("追加後に adapter.validate が呼ばれること", async () => {
			const { result, ref } = await renderCore();
			await act(async () => {
				await result.current.handlers.add(
					new File(["v"], "x.mp4", { type: "video/mp4" }),
				);
			});
			expect(ref.validate).toHaveBeenCalled();
		});

		it("maxVideos到達 → 削除 → 追加成功（枠解放）", async () => {
			const ex = makeExistingVideo({ tempId: "temp_ex" });
			const { result } = await renderCore([ex], { maxVideos: 1 });

			let ok = true;
			await act(async () => {
				ok = await result.current.handlers.add(
					new File(["v"], "over.mp4", { type: "video/mp4" }),
				);
			});
			expect(ok).toBe(false);

			await act(async () => {
				await result.current.handlers.delete("temp_ex");
			});
			expect(result.current.raw.videos).toHaveLength(0);

			await act(async () => {
				ok = await result.current.handlers.add(
					new File(["v"], "new.mp4", { type: "video/mp4" }),
				);
			});
			expect(ok).toBe(true);
			expect(result.current.raw.videos).toHaveLength(1);
		});
	});

	describe("handleFileChange", () => {
		it("Existing → 元位置に New、deletedVideoIds に旧 id が追加", async () => {
			const ex = makeExistingVideo({ tempId: "temp_ex" });
			const { result } = await renderCore([ex]);
			await act(async () => {
				await result.current.handlers.changeFile(
					"temp_ex",
					new File(["v"], "new.mp4", { type: "video/mp4" }),
				);
			});
			const videos = result.current.raw.videos;
			expect(videos).toHaveLength(1);
			expect(videos[0].status).toBe(VideoFormStatus.New);
			expect(result.current.raw.deletedVideoIds).toContain(ex.id);
		});

		it("New → file 差し替え、配列長は不変", async () => {
			const nv = makeNewVideo({ tempId: "temp_n" });
			const { result } = await renderCore([nv]);
			await act(async () => {
				await result.current.handlers.changeFile(
					"temp_n",
					new File(["v"], "n2.mp4", { type: "video/mp4" }),
				);
			});
			const videos = result.current.raw.videos;
			expect(videos).toHaveLength(1);
			expect(videos[0].status).toBe(VideoFormStatus.New);
			expect((videos[0] as VideoNew).file.name).toBe("n2.mp4");
		});
	});

	describe("handleDelete", () => {
		it("Existing → 配列から除去、deletedVideoIds に id が追加", async () => {
			const ex = makeExistingVideo({ tempId: "temp_ex" });
			const visible = makeNewVideo({ tempId: "temp_n" });
			const { result } = await renderCore([ex, visible]);
			await act(async () => {
				await result.current.handlers.delete("temp_ex");
			});
			const videos = result.current.raw.videos;
			expect(videos).toHaveLength(1);
			expect(videos[0]).toBe(visible);
			expect(result.current.raw.deletedVideoIds).toContain(ex.id);
		});

		it("New → 配列から除去", async () => {
			const nv = makeNewVideo({ tempId: "temp_n" });
			const { result } = await renderCore([nv]);
			await act(async () => {
				await result.current.handlers.delete("temp_n");
			});
			expect(result.current.raw.videos).toHaveLength(0);
		});
	});

	describe("handleMoveUp / handleMoveDown / handleMove", () => {
		it("先頭から上には移動できない", async () => {
			const a = makeNewVideo({ tempId: "a" });
			const b = makeNewVideo({ tempId: "b" });
			const { result } = await renderCore([a, b]);
			let ok = true;
			await act(async () => {
				ok = await result.current.handlers.moveUp("a");
			});
			expect(ok).toBe(false);
		});

		it("末尾から下には移動できない", async () => {
			const a = makeNewVideo({ tempId: "a" });
			const b = makeNewVideo({ tempId: "b" });
			const { result } = await renderCore([a, b]);
			let ok = true;
			await act(async () => {
				ok = await result.current.handlers.moveDown("b");
			});
			expect(ok).toBe(false);
		});

		it("中間要素を移動できる", async () => {
			const a = makeNewVideo({ tempId: "a" });
			const b = makeNewVideo({ tempId: "b" });
			const { result } = await renderCore([a, b]);
			await act(async () => {
				await result.current.handlers.moveDown("a");
			});
			const videos = result.current.raw.videos;
			expect(videos[0].tempId).toBe("b");
			expect(videos[1].tempId).toBe("a");
		});

		it("handleMove で任意位置に移動できる", async () => {
			const a = makeNewVideo({ tempId: "a" });
			const b = makeNewVideo({ tempId: "b" });
			const c = makeNewVideo({ tempId: "c" });
			const { result } = await renderCore([a, b, c]);
			await act(async () => {
				await result.current.handlers.move("c", 0);
			});
			const videos = result.current.raw.videos;
			expect(videos[0].tempId).toBe("c");
			expect(videos[1].tempId).toBe("a");
			expect(videos[2].tempId).toBe("b");
		});

		it("handleMove で不明 tempId は false", async () => {
			const a = makeNewVideo({ tempId: "a" });
			const { result } = await renderCore([a]);
			let ok = true;
			await act(async () => {
				ok = await result.current.handlers.move("unknown", 0);
			});
			expect(ok).toBe(false);
		});
	});

	describe("Thumbnail handlers", () => {
		it("handleSetThumbnailFromFile が New 動画にサムネを設定", async () => {
			const nv = makeNewVideo({ tempId: "temp_n" });
			const { result } = await renderCore([nv]);
			await act(async () => {
				await result.current.handlers.setThumbnailFromFile(
					"temp_n",
					new File(["t"], "t.jpg", { type: "image/jpeg" }),
				);
			});
			const updated = result.current.raw.videos[0] as VideoNew;
			expect(updated.thumbnail).not.toBeNull();
			expect(updated.thumbnail?.source).toBe(ThumbnailSource.Upload);
		});

		it("handleRemoveThumbnail が New 動画のサムネを null に", async () => {
			const nv = makeNewVideo({
				tempId: "temp_n",
				thumbnail: {
					source: ThumbnailSource.Upload,
					file: new File(["t"], "t.jpg", { type: "image/jpeg" }),
				},
			});
			const { result } = await renderCore([nv]);
			await act(async () => {
				await result.current.handlers.removeThumbnail("temp_n");
			});
			expect((result.current.raw.videos[0] as VideoNew).thumbnail).toBeNull();
		});

		it("handleSetThumbnailFromFile: tempId 不一致で false を返す", async () => {
			const nv = makeNewVideo({ tempId: "temp_n" });
			const { result } = await renderCore([nv]);
			let ok = true;
			await act(async () => {
				ok = await result.current.handlers.setThumbnailFromFile(
					"does-not-exist",
					new File(["t"], "t.jpg", { type: "image/jpeg" }),
				);
			});
			expect(ok).toBe(false);
		});
	});

	describe("items / rootErrors 公開経路", () => {
		it("adapter.errors.items[tempId] を per-item に乗せる", async () => {
			const a = makeNewVideo({ tempId: "a" });
			const b = makeNewVideo({ tempId: "b" });
			const errors: VideosError = {
				items: {
					a: { file: { message: "err-a" } },
					b: { file: { message: "err-b" } },
				},
				root: [{ message: "root!" }],
			};
			const { result } = await renderCore([a, b], { errors });
			expect(result.current.items).toHaveLength(2);
			expect(result.current.items[0].errors?.file?.message).toBe("err-a");
			expect(result.current.items[1].errors?.file?.message).toBe("err-b");
			expect(result.current.rootErrors).toEqual<VideoFieldError[]>([
				{ message: "root!" },
			]);
		});
	});

	describe("stale スナップショット競合", () => {
		it("[stale] maxVideos:1 で handleAdd を解決前に2回発火しても1件に収まる", async () => {
			const d1 = createDeferred<File>();
			const d2 = createDeferred<File>();
			const deferreds = [d1, d2];
			let call = 0;
			const processFile = vi.fn(async (_f: File) => deferreds[call++].promise);

			const { result } = await renderCore([], { maxVideos: 1, processFile });

			const fileA = new File(["a"], "a.mp4", { type: "video/mp4" });
			const fileB = new File(["b"], "b.mp4", { type: "video/mp4" });

			await act(async () => {
				const p1 = result.current.handlers.add(fileA);
				const p2 = result.current.handlers.add(fileB);
				d1.resolve(fileA);
				d2.resolve(fileB);
				await Promise.all([p1, p2]);
			});

			expect(result.current.raw.videos).toHaveLength(1);
		});

		it("[stale] handleFileChange の解決前に別項目を削除しても対象動画のみ差し替わる", async () => {
			const d = createDeferred<File>();
			const processFile = vi.fn(async (_f: File) => d.promise);

			const a = makeExistingVideo({ tempId: "temp_A" });
			const b = makeExistingVideo({ tempId: "temp_B" });
			const { result } = await renderCore([a, b], { processFile });

			const newFile = new File(["x"], "x.mp4", { type: "video/mp4" });

			await act(async () => {
				const changing = result.current.handlers.changeFile("temp_B", newFile);
				await result.current.handlers.delete("temp_A");
				d.resolve(newFile);
				await changing;
			});

			const videos = result.current.raw.videos;
			expect(videos.some((v) => v.status === VideoFormStatus.New)).toBe(true);
			expect(videos.find((v) => v.tempId === "temp_A")).toBeUndefined();
			expect(result.current.raw.deletedVideoIds).toContain(a.id);
		});

		it("[stale] 既存動画を同期的に2件連続削除しても両方のIDが deletedVideoIds に残る", async () => {
			const a = makeExistingVideo({ tempId: "temp_A" });
			const b = makeExistingVideo({ tempId: "temp_B" });
			const { result } = await renderCore([a, b]);

			await act(async () => {
				await result.current.handlers.delete("temp_A");
				await result.current.handlers.delete("temp_B");
			});

			expect(result.current.raw.videos).toHaveLength(0);
			expect(result.current.raw.deletedVideoIds).toContain(a.id);
			expect(result.current.raw.deletedVideoIds).toContain(b.id);
			expect(result.current.raw.deletedVideoIds).toHaveLength(2);
		});

		it("[stale] handleAdd の解決前に既存動画が削除されても新規は追加される", async () => {
			const d = createDeferred<File>();
			const processFile = vi.fn(async (_f: File) => d.promise);

			const a = makeExistingVideo({ tempId: "temp_A" });
			const { result } = await renderCore([a], { processFile });

			const file = new File(["n"], "n.mp4", { type: "video/mp4" });

			await act(async () => {
				const adding = result.current.handlers.add(file);
				await result.current.handlers.delete("temp_A");
				d.resolve(file);
				await adding;
			});

			const videos = result.current.raw.videos;
			expect(videos.some((v) => v.status === VideoFormStatus.New)).toBe(true);
			expect(videos.find((v) => v.tempId === "temp_A")).toBeUndefined();
			expect(result.current.raw.deletedVideoIds).toContain(a.id);
		});

		it("[stale] deferred processFile で handleAdd を2回発火 → 両方 commit される", async () => {
			const d1 = createDeferred<File>();
			const d2 = createDeferred<File>();
			const deferreds = [d1, d2];
			let call = 0;
			const processFile = vi.fn(async (_f: File) => deferreds[call++].promise);

			const { result } = await renderCore([], { processFile });

			const fileA = new File(["a"], "a.mp4", { type: "video/mp4" });
			const fileB = new File(["b"], "b.mp4", { type: "video/mp4" });

			await act(async () => {
				const p1 = result.current.handlers.add(fileA);
				const p2 = result.current.handlers.add(fileB);
				d1.resolve(fileA);
				d2.resolve(fileB);
				await Promise.all([p1, p2]);
			});

			expect(result.current.raw.videos).toHaveLength(2);
		});

		it("[stale] 連続 handleDelete で両方消える（videos 側も lost update しない）", async () => {
			const a = makeNewVideo({ tempId: "temp_A" });
			const b = makeNewVideo({ tempId: "temp_B" });
			const c = makeNewVideo({ tempId: "temp_C" });
			const { result } = await renderCore([a, b, c]);

			await act(async () => {
				await result.current.handlers.delete("temp_A");
				await result.current.handlers.delete("temp_C");
			});

			expect(result.current.raw.videos).toHaveLength(1);
			expect(result.current.raw.videos[0].tempId).toBe("temp_B");
		});
	});

	describe("epoch — 完了順逆転の防止", () => {
		it("handleFileChange: 後発 resolve → 先発 resolve で最終状態が後発のファイルになる", async () => {
			const dSlow = createDeferred<File>();
			const dFast = createDeferred<File>();
			const deferreds = [dSlow, dFast];
			let call = 0;
			const processFile = vi.fn(async (_f: File) => deferreds[call++].promise);

			const nv = makeNewVideo({ tempId: "temp_target" });
			const { result } = await renderCore([nv], { processFile });

			const fileSlow = new File(["slow"], "slow.mp4", { type: "video/mp4" });
			const fileFast = new File(["fast"], "fast.mp4", { type: "video/mp4" });

			await act(async () => {
				const p1 = result.current.handlers.changeFile("temp_target", fileSlow);
				const p2 = result.current.handlers.changeFile("temp_target", fileFast);
				dFast.resolve(fileFast);
				dSlow.resolve(fileSlow);
				await Promise.all([p1, p2]);
			});

			const videos = result.current.raw.videos;
			expect(videos).toHaveLength(1);
			expect((videos[0] as VideoNew).file.name).toBe("fast.mp4");
		});

		it("handleFileChange 発火後に handleDelete → resolve しても動画が復活しない", async () => {
			const d = createDeferred<File>();
			const processFile = vi.fn(async (_f: File) => d.promise);

			const nv = makeNewVideo({ tempId: "temp_target" });
			const { result } = await renderCore([nv], { processFile });

			const file = new File(["x"], "x.mp4", { type: "video/mp4" });

			await act(async () => {
				const changing = result.current.handlers.changeFile(
					"temp_target",
					file,
				);
				await result.current.handlers.delete("temp_target");
				d.resolve(file);
				await changing;
			});

			expect(result.current.raw.videos).toHaveLength(0);
		});

		it("epoch 破棄時に onError は発火しない（成功ケース）", async () => {
			const dSlow = createDeferred<File>();
			const dFast = createDeferred<File>();
			const deferreds = [dSlow, dFast];
			let call = 0;
			const processFile = vi.fn(async (_f: File) => deferreds[call++].promise);
			const onError = vi.fn();

			const nv = makeNewVideo({ tempId: "temp_target" });
			const { result } = await renderCore([nv], { processFile, onError });

			const fileSlow = new File(["slow"], "slow.mp4", { type: "video/mp4" });
			const fileFast = new File(["fast"], "fast.mp4", { type: "video/mp4" });

			await act(async () => {
				const p1 = result.current.handlers.changeFile("temp_target", fileSlow);
				const p2 = result.current.handlers.changeFile("temp_target", fileFast);
				dFast.resolve(fileFast);
				dSlow.resolve(fileSlow);
				await Promise.all([p1, p2]);
			});

			expect(onError).not.toHaveBeenCalled();
		});

		it("epoch stale な操作は processFile 完了後に uploadFile へ到達しない", async () => {
			const dSlow = createDeferred<File>();
			const dFast = createDeferred<File>();
			let processCall = 0;
			const processFile = vi.fn(
				async (_f: File) => [dSlow, dFast][processCall++].promise,
			);
			const uploadFile = vi.fn(async () => ({
				uploadedUrl: "https://example.com/v.mp4",
			}));
			const onError = vi.fn();

			const nv = makeNewVideo({ tempId: "temp_target" });
			const { result } = await renderCore([nv], {
				processFile,
				uploadFile,
				onError,
			});

			const fileSlow = new File(["slow"], "slow.mp4", { type: "video/mp4" });
			const fileFast = new File(["fast"], "fast.mp4", { type: "video/mp4" });

			await act(async () => {
				const p1 = result.current.handlers.changeFile("temp_target", fileSlow);
				const p2 = result.current.handlers.changeFile("temp_target", fileFast);
				// 後発の processFile を先に解決
				dFast.resolve(fileFast);
				// 先発の processFile も解決 — しかし epoch stale なので uploadFile には到達しない
				dSlow.resolve(fileSlow);
				await Promise.all([p1, p2]);
			});

			// uploadFile は後発の1回だけ呼ばれる（先発は epoch stale で到達しない）
			expect(uploadFile).toHaveBeenCalledTimes(1);
			expect(onError).not.toHaveBeenCalled();
			expect((result.current.raw.videos[0] as VideoNew).file.name).toBe(
				"fast.mp4",
			);
		});

		it("handleSetThumbnailFromFile: 同一 tempId への連続呼び出しで後発が勝つ", async () => {
			const dSlow = createDeferred<File>();
			const dFast = createDeferred<File>();
			let call = 0;
			const processThumbnailFile = vi.fn(
				async (_f: File) => [dSlow, dFast][call++].promise,
			);

			const nv = makeNewVideo({ tempId: "temp_target" });
			const { result } = await renderCore([nv], { processThumbnailFile });

			const thumbSlow = new File(["slow"], "slow.jpg", { type: "image/jpeg" });
			const thumbFast = new File(["fast"], "fast.jpg", { type: "image/jpeg" });

			await act(async () => {
				const p1 = result.current.handlers.setThumbnailFromFile(
					"temp_target",
					thumbSlow,
				);
				const p2 = result.current.handlers.setThumbnailFromFile(
					"temp_target",
					thumbFast,
				);
				dFast.resolve(thumbFast);
				dSlow.resolve(thumbSlow);
				await Promise.all([p1, p2]);
			});

			const video = result.current.raw.videos[0] as VideoNew;
			expect(video.thumbnail).not.toBeNull();
			expect(video.thumbnail!.source).toBe(ThumbnailSource.Upload);
			if (video.thumbnail!.source === ThumbnailSource.Upload) {
				expect(video.thumbnail!.file.name).toBe("fast.jpg");
			}
		});
	});

	describe("uploadFile", () => {
		it("uploadFile 成功時に VideoNew.uploadedUrl が設定されること", async () => {
			const uploadFile = vi.fn(async () => ({
				uploadedUrl: "https://s3.example.com/uploaded.mp4",
			}));
			const { result } = await renderCore([], { uploadFile });
			await act(async () => {
				await result.current.handlers.add(
					new File(["v"], "a.mp4", { type: "video/mp4" }),
				);
			});
			const video = result.current.raw.videos[0] as VideoNew;
			expect(video.uploadedUrl).toBe("https://s3.example.com/uploaded.mp4");
		});

		it("uploadFile 未指定時は uploadedUrl が設定されないこと", async () => {
			const { result } = await renderCore([]);
			await act(async () => {
				await result.current.handlers.add(
					new File(["v"], "a.mp4", { type: "video/mp4" }),
				);
			});
			const video = result.current.raw.videos[0] as VideoNew;
			expect(video.uploadedUrl).toBeUndefined();
		});

		it("uploadFile 失敗時は onError(upload_file) + false を返し動画は追加されないこと", async () => {
			const onError = vi.fn();
			const uploadFile = vi.fn(async () => {
				throw new Error("upload boom");
			});
			const { result } = await renderCore([], { uploadFile, onError });
			let ok = true;
			await act(async () => {
				ok = await result.current.handlers.add(
					new File(["v"], "a.mp4", { type: "video/mp4" }),
				);
			});
			expect(ok).toBe(false);
			expect(result.current.raw.videos).toHaveLength(0);
			expect(onError).toHaveBeenCalledWith(
				expect.objectContaining({ type: "upload_file" }),
			);
		});

		it("processFile → uploadFile の順で実行されること", async () => {
			const callOrder: string[] = [];
			const processFile = vi.fn(async (f: File) => {
				callOrder.push("process");
				return f;
			});
			const uploadFile = vi.fn(async () => {
				callOrder.push("upload");
				return { uploadedUrl: "https://example.com/v.mp4" };
			});
			const { result } = await renderCore([], { processFile, uploadFile });
			await act(async () => {
				await result.current.handlers.add(
					new File(["v"], "a.mp4", { type: "video/mp4" }),
				);
			});
			expect(callOrder).toEqual(["process", "upload"]);
		});

		it("handleFileChange でも uploadFile が実行されること", async () => {
			const uploadFile = vi.fn(async () => ({
				uploadedUrl: "https://s3.example.com/changed.mp4",
			}));
			const nv = makeNewVideo({ tempId: "temp_n" });
			const { result } = await renderCore([nv], { uploadFile });
			await act(async () => {
				await result.current.handlers.changeFile(
					"temp_n",
					new File(["v"], "b.mp4", { type: "video/mp4" }),
				);
			});
			const video = result.current.raw.videos[0] as VideoNew;
			expect(video.uploadedUrl).toBe("https://s3.example.com/changed.mp4");
			expect(uploadFile).toHaveBeenCalled();
		});

		it("カスタム uploadFile メッセージが onError に載ること", async () => {
			const onError = vi.fn();
			const uploadFile = vi.fn(async () => {
				throw new Error("fail");
			});
			const { result } = await renderCore([], {
				uploadFile,
				onError,
				messages: { uploadFile: () => "アップロード失敗（custom）" },
			});
			await act(async () => {
				await result.current.handlers.add(
					new File(["v"], "a.mp4", { type: "video/mp4" }),
				);
			});
			expect(onError).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "upload_file",
					message: "アップロード失敗（custom）",
				}),
			);
		});
	});

	describe("uploadThumbnailFile", () => {
		it("handleSetThumbnailFromFile で uploadThumbnailFile が実行され uploadedUrl が設定されること", async () => {
			const uploadThumbnailFile = vi.fn(async () => ({
				uploadedUrl: "https://s3.example.com/thumb.jpg",
			}));
			const nv = makeNewVideo({ tempId: "temp_t1" });
			const { result } = await renderCore([nv], { uploadThumbnailFile });
			await act(async () => {
				await result.current.handlers.setThumbnailFromFile(
					"temp_t1",
					new File(["img"], "thumb.jpg", { type: "image/jpeg" }),
				);
			});
			const video = result.current.raw.videos[0] as VideoNew;
			expect(video.thumbnail).not.toBeNull();
			expect(video.thumbnail!.source).toBe(ThumbnailSource.Upload);
			if (video.thumbnail!.source === ThumbnailSource.Upload) {
				expect(video.thumbnail!.uploadedUrl).toBe(
					"https://s3.example.com/thumb.jpg",
				);
			}
		});

		it("uploadThumbnailFile 未指定時は uploadedUrl なしでサムネイル設定されること", async () => {
			const nv = makeNewVideo({ tempId: "temp_t2" });
			const { result } = await renderCore([nv]);
			await act(async () => {
				await result.current.handlers.setThumbnailFromFile(
					"temp_t2",
					new File(["img"], "thumb.jpg", { type: "image/jpeg" }),
				);
			});
			const video = result.current.raw.videos[0] as VideoNew;
			expect(video.thumbnail).not.toBeNull();
			if (video.thumbnail!.source === ThumbnailSource.Upload) {
				expect(video.thumbnail!.uploadedUrl).toBeUndefined();
			}
		});

		it("uploadThumbnailFile 失敗時は onError(upload_thumbnail_file) + false を返すこと", async () => {
			const onError = vi.fn();
			const uploadThumbnailFile = vi.fn(async () => {
				throw new Error("thumb upload boom");
			});
			const nv = makeNewVideo({ tempId: "temp_t3" });
			const { result } = await renderCore([nv], {
				uploadThumbnailFile,
				onError,
			});
			let ok = true;
			await act(async () => {
				ok = await result.current.handlers.setThumbnailFromFile(
					"temp_t3",
					new File(["img"], "thumb.jpg", { type: "image/jpeg" }),
				);
			});
			expect(ok).toBe(false);
			expect(result.current.raw.videos[0].thumbnail).toBeNull();
			expect(onError).toHaveBeenCalledWith(
				expect.objectContaining({ type: "upload_thumbnail_file" }),
			);
		});

		it("uploadThumbnailFile 失敗 + onError なしでクラッシュしないこと", async () => {
			const uploadThumbnailFile = vi.fn(async () => {
				throw new Error("fail");
			});
			const nv = makeNewVideo({ tempId: "temp_t4" });
			const { result } = await renderCore([nv], { uploadThumbnailFile });
			let ok = true;
			await act(async () => {
				ok = await result.current.handlers.setThumbnailFromFile(
					"temp_t4",
					new File(["img"], "thumb.jpg", { type: "image/jpeg" }),
				);
			});
			expect(ok).toBe(false);
		});
	});

	describe("epoch — orphan cleanup (handleFileChange / handleSetThumbnail)", () => {
		it("handleFileChange: upload await 中に epoch が stale → orphan 通知される", async () => {
			const dProcess = createDeferred<File>();
			const dUpload = createDeferred<{ uploadedUrl: string }>();
			const processFile = vi.fn(async (_f: File) => dProcess.promise);
			const uploadFile = vi.fn(async () => dUpload.promise);
			const onOrphanedUpload = vi.fn();

			const nv = makeNewVideo({ tempId: "temp_target" });
			const { result } = await renderCore([nv], {
				processFile,
				uploadFile,
				onOrphanedUpload,
			});

			const file = new File(["v"], "a.mp4", { type: "video/mp4" });

			await act(async () => {
				const changing = result.current.handlers.changeFile(
					"temp_target",
					file,
				);
				dProcess.resolve(file);
				await new Promise((r) => setTimeout(r, 0));

				// upload 完了前に動画を削除 → upload 済み URL は orphan になる
				await result.current.handlers.delete("temp_target");

				dUpload.resolve({
					uploadedUrl: "https://s3.example.com/orphan.mp4",
				});
				await changing;
			});

			expect(onOrphanedUpload).toHaveBeenCalledWith(
				"https://s3.example.com/orphan.mp4",
			);
		});

		it("handleFileChange: changeFile が changed:false → uploadedUrl が orphan 通知される", async () => {
			// adapter.setVideos で直接除去すると epoch は stale にならない（bumpEpoch を経由しない）ため
			// ops.changeFile が changed:false を返すパスに到達する
			const dProcess = createDeferred<File>();
			const uploadFile = vi.fn(async () => ({
				uploadedUrl: "https://s3.example.com/orphan2.mp4",
			}));
			const onOrphanedUpload = vi.fn();

			const nv = makeNewVideo({ tempId: "temp_cf" });
			const ref: { adapter?: VideoFieldAdapter } = {};
			const { result } = await renderHook(() => {
				const { adapter } = useFakeAdapter([nv]);
				ref.adapter = adapter;
				return useMultiVideoCore({
					adapter,
					processFile: async (_f: File) => dProcess.promise,
					uploadOnSelect: { uploadFile, onOrphanedUpload },
				});
			});

			await act(async () => {
				const changing = result.current.handlers.changeFile(
					"temp_cf",
					new File(["v"], "b.mp4", { type: "video/mp4" }),
				);
				ref.adapter!.setVideos([]);
				dProcess.resolve(new File(["v"], "b.mp4", { type: "video/mp4" }));
				await changing;
			});

			expect(onOrphanedUpload).toHaveBeenCalledWith(
				"https://s3.example.com/orphan2.mp4",
			);
		});

		it("handleSetThumbnailFromFrame: upload await 中に epoch が stale → orphan 通知される", async () => {
			const dUpload = createDeferred<{ uploadedUrl: string }>();
			const uploadThumbnailFile = vi.fn(async () => dUpload.promise);
			const onOrphanedUpload = vi.fn();

			const nv = makeNewVideo({ tempId: "temp_target" });
			const { result } = await renderCore([nv], {
				uploadThumbnailFile,
				onOrphanedUpload,
			});

			const { ThumbnailUtils } = await import("../types/Thumbnail");
			const captureFrameSpy = vi.spyOn(ThumbnailUtils, "captureFrame");
			try {
				captureFrameSpy.mockResolvedValue({
					source: ThumbnailSource.Frame,
					blob: new Blob(["img"], { type: "image/jpeg" }),
					timestamp: 0,
				});

				const videoEl = document.createElement("video");

				await act(async () => {
					const setting = result.current.handlers.setThumbnailFromFrame(
						"temp_target",
						videoEl,
					);
					await new Promise((r) => setTimeout(r, 0));
					await result.current.handlers.delete("temp_target");

					dUpload.resolve({
						uploadedUrl: "https://s3.example.com/orphan-thumb.jpg",
					});
					await setting;
				});

				expect(onOrphanedUpload).toHaveBeenCalledWith(
					"https://s3.example.com/orphan-thumb.jpg",
				);
			} finally {
				captureFrameSpy.mockRestore();
			}
		});

		it("handleSetThumbnailFromFrame: updateThumbnail 失敗 → uploadedUrl が orphan 通知される", async () => {
			const uploadThumbnailFile = vi.fn(async () => ({
				uploadedUrl: "https://s3.example.com/orphan-thumb2.jpg",
			}));
			const onOrphanedUpload = vi.fn();

			const nv = makeNewVideo({ tempId: "temp_target" });

			const ref: { adapter?: VideoFieldAdapter } = {};
			const { result } = await renderHook(() => {
				const { adapter } = useFakeAdapter([nv]);
				ref.adapter = adapter;
				return useMultiVideoCore({
					adapter,
					uploadOnSelect: { uploadThumbnailFile, onOrphanedUpload },
				});
			});

			const { ThumbnailUtils } = await import("../types/Thumbnail");
			const captureFrameSpy = vi.spyOn(ThumbnailUtils, "captureFrame");
			try {
				captureFrameSpy.mockResolvedValue({
					source: ThumbnailSource.Frame,
					blob: new Blob(["img"], { type: "image/jpeg" }),
					timestamp: 0,
				});

				const videoEl = document.createElement("video");

				await act(async () => {
					const setting = result.current.handlers.setThumbnailFromFrame(
						"temp_target",
						videoEl,
					);
					ref.adapter!.setVideos([]);
					await setting;
				});

				expect(onOrphanedUpload).toHaveBeenCalledWith(
					"https://s3.example.com/orphan-thumb2.jpg",
				);
			} finally {
				captureFrameSpy.mockRestore();
			}
		});

		it("handleSetThumbnailFromFile: upload await 中に epoch が stale → orphan 通知される", async () => {
			const dProcess = createDeferred<File>();
			const dUpload = createDeferred<{ uploadedUrl: string }>();
			const processThumbnailFile = vi.fn(async (_f: File) => dProcess.promise);
			const uploadThumbnailFile = vi.fn(async () => dUpload.promise);
			const onOrphanedUpload = vi.fn();

			const nv = makeNewVideo({ tempId: "temp_target" });
			const { result } = await renderCore([nv], {
				processThumbnailFile,
				uploadThumbnailFile,
				onOrphanedUpload,
			});

			const thumb = new File(["t"], "t.jpg", { type: "image/jpeg" });

			await act(async () => {
				const setting = result.current.handlers.setThumbnailFromFile(
					"temp_target",
					thumb,
				);
				// processThumbnailFile を resolve → epoch check 通過 → upload 開始
				dProcess.resolve(thumb);
				await new Promise((r) => setTimeout(r, 0));

				// upload await 中に epoch を bump
				await result.current.handlers.delete("temp_target");

				dUpload.resolve({
					uploadedUrl: "https://s3.example.com/orphan-thumb3.jpg",
				});
				await setting;
			});

			expect(onOrphanedUpload).toHaveBeenCalledWith(
				"https://s3.example.com/orphan-thumb3.jpg",
			);
		});

		it("handleSetThumbnailFromFile: updateThumbnail 失敗 → uploadedUrl が orphan 通知される", async () => {
			const uploadThumbnailFile = vi.fn(async () => ({
				uploadedUrl: "https://s3.example.com/orphan-thumb4.jpg",
			}));
			const onOrphanedUpload = vi.fn();

			const nv = makeNewVideo({ tempId: "temp_target" });

			const ref: { adapter?: VideoFieldAdapter } = {};
			const { result } = await renderHook(() => {
				const { adapter } = useFakeAdapter([nv]);
				ref.adapter = adapter;
				return useMultiVideoCore({
					adapter,
					uploadOnSelect: { uploadThumbnailFile, onOrphanedUpload },
				});
			});

			await act(async () => {
				const setting = result.current.handlers.setThumbnailFromFile(
					"temp_target",
					new File(["t"], "t.jpg", { type: "image/jpeg" }),
				);
				ref.adapter!.setVideos([]);
				await setting;
			});

			expect(onOrphanedUpload).toHaveBeenCalledWith(
				"https://s3.example.com/orphan-thumb4.jpg",
			);
		});
	});

	describe("safeValidate — adapter.validate() が throw するケース", () => {
		it("validate() が throw → onError(unknown, validationFailed) が呼ばれる", async () => {
			const onError = vi.fn();
			const ref: {
				adapter?: VideoFieldAdapter;
				validate?: ReturnType<typeof vi.fn>;
			} = {};
			const { result } = await renderHook(() => {
				const { adapter, validate } = useFakeAdapter([]);
				ref.adapter = adapter;
				ref.validate = validate;
				return useMultiVideoCore({
					adapter,
					onError,
				});
			});

			// validate を throw するように変更
			ref.validate!.mockRejectedValueOnce(new Error("schema explosion"));

			await act(async () => {
				await result.current.handlers.add(
					new File(["v"], "a.mp4", { type: "video/mp4" }),
				);
			});

			expect(onError).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "unknown",
					message: "validation failed",
				}),
			);
		});
	});

	describe("tempId 不存在時の early return", () => {
		it("handleFileChange: 存在しない tempId で false が返り副作用がない", async () => {
			const uploadFile = vi.fn(async () => ({
				uploadedUrl: "https://example.com/v.mp4",
			}));
			const nv = makeNewVideo({ tempId: "temp_n" });
			const { result } = await renderCore([nv], { uploadFile });
			let ok = true;
			await act(async () => {
				ok = await result.current.handlers.changeFile(
					"does-not-exist",
					new File(["v"], "x.mp4", { type: "video/mp4" }),
				);
			});
			expect(ok).toBe(false);
			expect(uploadFile).not.toHaveBeenCalled();
			expect(result.current.raw.videos).toHaveLength(1);
		});

		it("handleSetThumbnailFromFrame: 存在しない tempId で false が返る", async () => {
			const nv = makeNewVideo({ tempId: "temp_n" });
			const { result } = await renderCore([nv]);
			let ok = true;
			await act(async () => {
				ok = await result.current.handlers.setThumbnailFromFrame(
					"does-not-exist",
					document.createElement("video"),
				);
			});
			expect(ok).toBe(false);
		});

		it("handleDelete: 存在しない tempId で false が返る", async () => {
			const nv = makeNewVideo({ tempId: "temp_n" });
			const { result } = await renderCore([nv]);
			let ok = true;
			await act(async () => {
				ok = await result.current.handlers.delete("does-not-exist");
			});
			expect(ok).toBe(false);
			expect(result.current.raw.videos).toHaveLength(1);
		});
	});

	describe("onOrphanedUpload", () => {
		it("handleAdd: 同時 add で maxVideos 競合 → 後発の uploadedUrl が orphan 通知される", async () => {
			const d1 = createDeferred<File>();
			const d2 = createDeferred<File>();
			let call = 0;
			const processFile = vi.fn(async (_f: File) => [d1, d2][call++].promise);
			const uploadFile = vi.fn(async () => ({
				uploadedUrl: "https://s3.example.com/orphan.mp4",
			}));
			const onOrphanedUpload = vi.fn();

			const { result } = await renderCore([], {
				maxVideos: 1,
				processFile,
				uploadFile,
				onOrphanedUpload,
			});

			const fileA = new File(["a"], "a.mp4", { type: "video/mp4" });
			const fileB = new File(["b"], "b.mp4", { type: "video/mp4" });

			await act(async () => {
				const p1 = result.current.handlers.add(fileA);
				const p2 = result.current.handlers.add(fileB);
				d1.resolve(fileA);
				d2.resolve(fileB);
				await Promise.all([p1, p2]);
			});

			expect(result.current.raw.videos).toHaveLength(1);
			expect(onOrphanedUpload).toHaveBeenCalledWith(
				"https://s3.example.com/orphan.mp4",
			);
		});

		it("onOrphanedUpload 未設定でも orphan 時にクラッシュしない", async () => {
			const d1 = createDeferred<File>();
			const d2 = createDeferred<File>();
			let call = 0;
			const processFile = vi.fn(async (_f: File) => [d1, d2][call++].promise);
			const uploadFile = vi.fn(async () => ({
				uploadedUrl: "https://s3.example.com/orphan.mp4",
			}));

			const { result } = await renderCore([], {
				maxVideos: 1,
				processFile,
				uploadFile,
			});

			const fileA = new File(["a"], "a.mp4", { type: "video/mp4" });
			const fileB = new File(["b"], "b.mp4", { type: "video/mp4" });

			await act(async () => {
				const p1 = result.current.handlers.add(fileA);
				const p2 = result.current.handlers.add(fileB);
				d1.resolve(fileA);
				d2.resolve(fileB);
				await Promise.all([p1, p2]);
			});

			expect(result.current.raw.videos).toHaveLength(1);
		});

		it("uploadFile 未指定なら orphan 通知は飛ばない", async () => {
			const d1 = createDeferred<File>();
			const d2 = createDeferred<File>();
			let call = 0;
			const processFile = vi.fn(async (_f: File) => [d1, d2][call++].promise);
			const onOrphanedUpload = vi.fn();

			const { result } = await renderCore([], {
				maxVideos: 1,
				processFile,
				onOrphanedUpload,
			});

			const fileA = new File(["a"], "a.mp4", { type: "video/mp4" });
			const fileB = new File(["b"], "b.mp4", { type: "video/mp4" });

			await act(async () => {
				const p1 = result.current.handlers.add(fileA);
				const p2 = result.current.handlers.add(fileB);
				d1.resolve(fileA);
				d2.resolve(fileB);
				await Promise.all([p1, p2]);
			});

			expect(onOrphanedUpload).not.toHaveBeenCalled();
		});
	});

	describe("onError 未設定時の安全性", () => {
		it("uploadFile 失敗 + onError なしでクラッシュしないこと", async () => {
			const uploadFile = vi.fn(async () => {
				throw new Error("fail");
			});
			const { result } = await renderCore([], { uploadFile });
			let ok = true;
			await act(async () => {
				ok = await result.current.handlers.add(
					new File(["v"], "a.mp4", { type: "video/mp4" }),
				);
			});
			expect(ok).toBe(false);
		});

		it("processFile 失敗 + onError なしでクラッシュしないこと", async () => {
			const processFile = vi.fn(async () => {
				throw new Error("fail");
			});
			const { result } = await renderCore([], { processFile });
			let ok = true;
			await act(async () => {
				ok = await result.current.handlers.add(
					new File(["v"], "a.mp4", { type: "video/mp4" }),
				);
			});
			expect(ok).toBe(false);
		});

		it("maxVideos 超過 + onError なしでクラッシュしないこと", async () => {
			const { result } = await renderCore([makeNewVideo()], { maxVideos: 1 });
			let ok = true;
			await act(async () => {
				ok = await result.current.handlers.add(
					new File(["v"], "a.mp4", { type: "video/mp4" }),
				);
			});
			expect(ok).toBe(false);
		});
	});

	describe("メッセージのカスタマイズ", () => {
		it("[messages] maxVideos 到達時に messages.maxVideos のカスタム文言が onError に載る", async () => {
			const onError = vi.fn();
			const { result } = await renderCore([makeNewVideo()], {
				maxVideos: 1,
				onError,
				messages: { maxVideos: (max: number) => `最大${max}本まで（custom）` },
			});
			await act(async () => {
				await result.current.handlers.add(
					new File(["v"], "b.mp4", { type: "video/mp4" }),
				);
			});
			expect(onError).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "max_videos",
					message: "最大1本まで（custom）",
				}),
			);
		});

		it("[messages] process_file 失敗時に messages.processFile のカスタム文言が onError に載る", async () => {
			const onError = vi.fn();
			const processFile = vi.fn(async () => {
				throw new Error("boom");
			});
			const { result } = await renderCore([], {
				processFile,
				onError,
				messages: { processFile: () => "処理失敗（custom）" },
			});
			await act(async () => {
				await result.current.handlers.add(
					new File(["v"], "b.mp4", { type: "video/mp4" }),
				);
			});
			expect(onError).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "process_file",
					message: "処理失敗（custom）",
				}),
			);
		});

		it("[messages] 未指定時は既定の日本語文言が onError に載る", async () => {
			const onError = vi.fn();
			const { result } = await renderCore([makeNewVideo()], {
				maxVideos: 1,
				onError,
			});
			await act(async () => {
				await result.current.handlers.add(
					new File(["v"], "b.mp4", { type: "video/mp4" }),
				);
			});
			expect(onError).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "max_videos",
					message: "動画は最大1件までです。",
				}),
			);
		});

		it("[messages] キーが undefined でも既定文言にフォールバックし throw しない", async () => {
			const onError = vi.fn();
			const { result } = await renderCore([makeNewVideo()], {
				maxVideos: 1,
				onError,
				messages: { maxVideos: undefined },
			});
			await act(async () => {
				await result.current.handlers.add(
					new File(["v"], "b.mp4", { type: "video/mp4" }),
				);
			});
			expect(onError).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "max_videos",
					message: "動画は最大1件までです。",
				}),
			);
		});
	});

	describe("callback identity 安定化", () => {
		it("onError をインラインで渡しても handlers の identity が変わらない", async () => {
			let renderCount = 0;
			const ref: { result?: ReturnType<typeof useMultiVideoCore> } = {};

			type Props = { onError: (e: unknown) => void };
			const { rerender } = await renderHook(
				(props?: Props) => {
					renderCount++;
					const { adapter } = useFakeAdapter([]);
					const core = useMultiVideoCore({
						adapter,
						onError: props?.onError,
					});
					ref.result = core;
					return core;
				},
				{ initialProps: { onError: (_e: unknown) => {} } as Props },
			);

			const handlersAfterFirst = ref.result!.handlers;

			await rerender({ onError: (_e: unknown) => {} } as Props);

			expect(renderCount).toBeGreaterThanOrEqual(2);
			expect(ref.result!.handlers.add).toBe(handlersAfterFirst.add);
			expect(ref.result!.handlers.delete).toBe(handlersAfterFirst.delete);
		});

		it("uploadOnSelect をインラインオブジェクトで渡しても handlers の identity が変わらない", async () => {
			let renderCount = 0;
			const ref: { result?: ReturnType<typeof useMultiVideoCore> } = {};
			const uploadFile = vi.fn(async () => ({
				uploadedUrl: "https://example.com/v.mp4",
			}));

			type Props = {
				uploadOnSelect: UploadOnSelectOptions;
			};
			const { rerender } = await renderHook(
				(props?: Props) => {
					renderCount++;
					const { adapter } = useFakeAdapter([]);
					const core = useMultiVideoCore({
						adapter,
						uploadOnSelect: props?.uploadOnSelect,
					});
					ref.result = core;
					return core;
				},
				{
					initialProps: { uploadOnSelect: { uploadFile } } as Props,
				},
			);

			const handlersAfterFirst = ref.result!.handlers;

			await rerender({ uploadOnSelect: { uploadFile } } as Props);

			expect(renderCount).toBeGreaterThanOrEqual(2);
			expect(ref.result!.handlers.add).toBe(handlersAfterFirst.add);
			expect(ref.result!.handlers.changeFile).toBe(
				handlersAfterFirst.changeFile,
			);
		});
	});

	describe("prepareForSubmit(options) pass-through", () => {
		it("render prop の prepareForSubmit(options) が options を core に素通しすること", async () => {
			const nv = makeNewVideo({
				tempId: "temp_submit",
				uploadedUrl: undefined,
			});
			const { result } = await renderCore([nv]);

			const uploadFile = vi.fn(async () => ({
				uploadedUrl: "https://s3.example.com/on-submit.mp4",
			}));

			let resolved: Awaited<ReturnType<typeof result.current.prepareForSubmit>>;
			await act(async () => {
				resolved = await result.current.prepareForSubmit({ uploadFile });
			});

			expect(uploadFile).toHaveBeenCalledOnce();
			expect(resolved!.videos[0].uploadedUrl).toBe(
				"https://s3.example.com/on-submit.mp4",
			);
		});

		it("混在時: on-select 済み項目は prepareForSubmit(options) で二重アップロードされない", async () => {
			const alreadyUploaded = makeNewVideo({
				tempId: "temp_already",
				uploadedUrl: "https://s3.example.com/already.mp4",
			});
			const pending = makeNewVideo({
				tempId: "temp_pending",
				uploadedUrl: undefined,
			});
			const { result } = await renderCore([alreadyUploaded, pending]);

			const uploadFile = vi.fn(async () => ({
				uploadedUrl: "https://s3.example.com/submitted.mp4",
			}));

			let resolved: Awaited<ReturnType<typeof result.current.prepareForSubmit>>;
			await act(async () => {
				resolved = await result.current.prepareForSubmit({ uploadFile });
			});

			expect(uploadFile).toHaveBeenCalledOnce();
			const urls = resolved!.videos.map((v) => v.uploadedUrl);
			expect(urls).toContain("https://s3.example.com/already.mp4");
			expect(urls).toContain("https://s3.example.com/submitted.mp4");
		});
	});

	describe("isBusy / isPending (DX-4)", () => {
		it("handleAdd 中に isBusy が true になり、完了後 false に戻る", async () => {
			const d = createDeferred<File>();
			const processFile = vi.fn(async (_f: File) => d.promise);
			const { result } = await renderCore([], { processFile });

			expect(result.current.isBusy).toBe(false);

			let addPromise: Promise<boolean>;
			await act(async () => {
				addPromise = result.current.handlers.add(
					new File(["v"], "a.mp4", { type: "video/mp4" }),
				);
			});

			expect(result.current.isBusy).toBe(true);

			await act(async () => {
				d.resolve(new File(["v"], "a.mp4", { type: "video/mp4" }));
				await addPromise!;
			});

			expect(result.current.isBusy).toBe(false);
		});

		it("handleFileChange 中に対象 item の isPending が true になり、完了後 false に戻る", async () => {
			const d = createDeferred<File>();
			const processFile = vi.fn(async (_f: File) => d.promise);
			const nv = makeNewVideo({ tempId: "temp_pending_test" });
			const { result } = await renderCore([nv], { processFile });

			expect(result.current.items[0].isPending).toBe(false);

			let changePromise: Promise<boolean>;
			await act(async () => {
				changePromise = result.current.handlers.changeFile(
					"temp_pending_test",
					new File(["v"], "b.mp4", { type: "video/mp4" }),
				);
			});

			expect(result.current.items[0].isPending).toBe(true);
			expect(result.current.isBusy).toBe(true);

			await act(async () => {
				d.resolve(new File(["v"], "b.mp4", { type: "video/mp4" }));
				await changePromise!;
			});

			expect(result.current.items[0].isPending).toBe(false);
			expect(result.current.isBusy).toBe(false);
		});

		it("isBusy は isAdding と pendingOperations のいずれかで true になる", async () => {
			const { result } = await renderCore([]);
			expect(result.current.isBusy).toBe(false);
			expect(result.current.isAdding).toBe(false);
		});
	});
});
