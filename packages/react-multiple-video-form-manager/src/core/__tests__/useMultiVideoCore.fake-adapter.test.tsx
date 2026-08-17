import { act, useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "vitest-browser-react";
import { ThumbnailSource } from "../types/Thumbnail";
import type {
	UploadFileContext,
	UploadFileFn,
	UploadFileResult,
	UploadKind,
} from "../types/Upload";
import type { Video, VideoExisting, VideoNew } from "../types/Video";
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

type UploadCall = {
	file: File;
	kind: UploadKind;
	ctx: UploadFileContext;
	resolve: (result: UploadFileResult) => void;
	reject: (error: unknown) => void;
};

/** 転送の解決タイミングをテスト側で握るための uploadFile */
function createUploadSpy() {
	const calls: UploadCall[] = [];
	const uploadFile: UploadFileFn = (file, ctx) =>
		new Promise<UploadFileResult>((resolve, reject) => {
			calls.push({ file, kind: ctx.kind, ctx, resolve, reject });
		});
	const callsOf = (kind: UploadKind) => calls.filter((c) => c.kind === kind);
	return { uploadFile, calls, callsOf };
}

const makeNewVideo = (overrides?: Partial<VideoNew>): VideoNew => ({
	tempId: `temp_new-${crypto.randomUUID().slice(0, 8)}`,
	status: VideoFormStatus.New,
	id: undefined,
	file: new File(["data"], "test.mp4", { type: "video/mp4" }),
	uploadRef: undefined,
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

const videoFile = (name = "a.mp4") =>
	new File(["v"], name, { type: "video/mp4" });
const thumbFile = (name = "t.jpg") =>
	new File(["t"], name, { type: "image/jpeg" });

/** 書き込まれた転送参照を捨てる契約違反の adapter を再現する */
const stripUploadRef = (video: Video): Video =>
	video.status === VideoFormStatus.New
		? { ...video, uploadRef: undefined }
		: video;

/** read のたびに File を作り直す契約違反の adapter を再現する */
const rebuildFile = (video: Video): Video =>
	video.status === VideoFormStatus.New
		? {
				...video,
				file: new File([video.file], video.file.name, {
					type: video.file.type,
				}),
			}
		: video;

/**
 * FakeVideoFieldAdapter。setVideos で配列全体を置き換える。
 *
 * 実アダプタ (useWatch / useStore) のセマンティクスを模倣する:
 * - ストア (ref) は setVideos で同期更新される
 * - videos プロパティはレンダー時点のスナップショット (再レンダーまで stale)
 * - getVideos() はストアの同期 read (常に最新)
 */
function useFakeAdapter(
	initial: Video[],
	errors?: VideosError,
	dropUploadRefs = false,
	unstableReads = false,
) {
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
			videosRef.current = dropUploadRefs ? next.map(stripUploadRef) : next;
			force((n) => n + 1);
		},
		getVideos: () =>
			unstableReads ? videosRef.current.map(rebuildFile) : videosRef.current,
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
		onError?: (error: unknown) => void;
		messages?: CoreMessages;
		dropUploadRefs?: boolean;
		unstableReads?: boolean;
	} = {},
) {
	const ref: {
		adapter?: VideoFieldAdapter;
		validate?: ReturnType<typeof vi.fn>;
	} = {};
	const rendered = await renderHook(() => {
		const { adapter, validate } = useFakeAdapter(
			initial,
			options.errors,
			options.dropUploadRefs,
			options.unstableReads,
		);
		ref.adapter = adapter;
		ref.validate = validate;
		return useMultiVideoCore({
			adapter,
			maxVideos: options.maxVideos,
			processFile: options.processFile,
			processThumbnailFile: options.processThumbnailFile,
			uploadFile: options.uploadFile,
			onError: options.onError,
			messages: options.messages,
		});
	});
	return { result: rendered.result, unmount: rendered.unmount, ref };
}

const firstVideo = (result: {
	current: { raw: { videos: readonly Video[] } };
}) => result.current.raw.videos[0] as VideoNew;

// --- Tests ---

describe("useMultiVideoCore (FakeVideoFieldAdapter)", () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	describe("handleAdd", () => {
		it("空配列に追加できること", async () => {
			const { result } = await renderCore();
			let ok = false;
			await act(async () => {
				ok = await result.current.handlers.add(videoFile());
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
				ok = await result.current.handlers.add(videoFile("b.mp4"));
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
				await result.current.handlers.add(videoFile("c.mp4"));
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
				await result.current.handlers.add(videoFile("p.mp4"));
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
				ok = await r2.current.handlers.add(videoFile("p2.mp4"));
			});
			expect(ok).toBe(false);
			expect(onError).toHaveBeenCalledWith(
				expect.objectContaining({ type: "process_file" }),
			);
		});

		it("追加後に adapter.validate が呼ばれること", async () => {
			const { result, ref } = await renderCore();
			await act(async () => {
				await result.current.handlers.add(videoFile("x.mp4"));
			});
			expect(ref.validate).toHaveBeenCalled();
		});

		it("maxVideos到達 → 削除 → 追加成功（枠解放）", async () => {
			const ex = makeExistingVideo({ tempId: "temp_ex" });
			const { result } = await renderCore([ex], { maxVideos: 1 });

			let ok = true;
			await act(async () => {
				ok = await result.current.handlers.add(videoFile("over.mp4"));
			});
			expect(ok).toBe(false);

			await act(async () => {
				await result.current.handlers.delete("temp_ex");
			});
			expect(result.current.raw.videos).toHaveLength(0);

			await act(async () => {
				ok = await result.current.handlers.add(videoFile("new.mp4"));
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
				await result.current.handlers.changeFile("temp_ex", videoFile("n.mp4"));
			});
			const videos = result.current.raw.videos;
			expect(videos).toHaveLength(1);
			expect(videos[0].status).toBe(VideoFormStatus.New);
			expect(result.current.raw.deletedVideoIds).toContain(ex.id);
		});

		it("Existing の差し替えで tempId が維持されること", async () => {
			const ex = makeExistingVideo({ tempId: "temp_ex" });
			const { result } = await renderCore([ex]);
			await act(async () => {
				await result.current.handlers.changeFile("temp_ex", videoFile("n.mp4"));
			});
			expect(result.current.raw.videos[0].tempId).toBe("temp_ex");
		});

		it("New → file 差し替え、配列長は不変", async () => {
			const nv = makeNewVideo({ tempId: "temp_n" });
			const { result } = await renderCore([nv]);
			await act(async () => {
				await result.current.handlers.changeFile("temp_n", videoFile("n2.mp4"));
			});
			const videos = result.current.raw.videos;
			expect(videos).toHaveLength(1);
			expect(videos[0].status).toBe(VideoFormStatus.New);
			expect(firstVideo(result).file.name).toBe("n2.mp4");
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
					thumbFile(),
				);
			});
			const updated = firstVideo(result);
			expect(updated.thumbnail).not.toBeNull();
			expect(updated.thumbnail?.source).toBe(ThumbnailSource.Upload);
		});

		it("handleRemoveThumbnail が New 動画のサムネを null に", async () => {
			const nv = makeNewVideo({
				tempId: "temp_n",
				thumbnail: { source: ThumbnailSource.Upload, file: thumbFile() },
			});
			const { result } = await renderCore([nv]);
			await act(async () => {
				await result.current.handlers.removeThumbnail("temp_n");
			});
			expect(firstVideo(result).thumbnail).toBeNull();
		});

		it("handleSetThumbnailFromFile: tempId 不一致で false を返す", async () => {
			const nv = makeNewVideo({ tempId: "temp_n" });
			const { result } = await renderCore([nv]);
			let ok = true;
			await act(async () => {
				ok = await result.current.handlers.setThumbnailFromFile(
					"does-not-exist",
					thumbFile(),
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

		it("転送していない項目の uploadState は空", async () => {
			const { result } = await renderCore([makeNewVideo({ tempId: "a" })]);
			expect(result.current.items[0].uploadState).toEqual({});
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

			const fileA = videoFile("a.mp4");
			const fileB = videoFile("b.mp4");

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

			const newFile = videoFile("x.mp4");

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

			const file = videoFile("n.mp4");

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

			const fileA = videoFile("a.mp4");
			const fileB = videoFile("b.mp4");

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

		it("[stale] 同一 tempId への連続 setThumbnailFromFile は後発が勝つ", async () => {
			const dSlow = createDeferred<File>();
			const dFast = createDeferred<File>();
			let call = 0;
			const processThumbnailFile = vi.fn(
				async (_f: File) => [dSlow, dFast][call++].promise,
			);

			const nv = makeNewVideo({ tempId: "temp_target" });
			const { result } = await renderCore([nv], { processThumbnailFile });

			const thumbSlow = thumbFile("slow.jpg");
			const thumbFast = thumbFile("fast.jpg");

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

			const thumbnail = firstVideo(result).thumbnail;
			expect(thumbnail?.source).toBe(ThumbnailSource.Upload);
			if (thumbnail?.source === ThumbnailSource.Upload) {
				expect(thumbnail.file.name).toBe("fast.jpg");
			}
		});
	});

	describe("ノンブロッキング化", () => {
		it("転送の完了を待たずに項目が入り、uploadState が pending になる", async () => {
			const { uploadFile, calls } = createUploadSpy();
			const { result } = await renderCore([], { uploadFile });

			let ok = false;
			await act(async () => {
				ok = await result.current.handlers.add(videoFile());
			});

			expect(ok).toBe(true);
			expect(result.current.raw.videos).toHaveLength(1);
			expect(firstVideo(result).uploadRef).toBeUndefined();
			expect(result.current.items[0].uploadState.video).toEqual({
				status: "pending",
				progress: undefined,
			});
			expect(result.current.uploads.pending).toEqual([
				result.current.raw.videos[0].tempId,
			]);
			expect(calls).toHaveLength(1);
		});

		it("転送が解決すると uploadRef が書き戻され pending から落ちる", async () => {
			const { uploadFile, calls } = createUploadSpy();
			const { result } = await renderCore([], { uploadFile });

			await act(async () => {
				await result.current.handlers.add(videoFile());
			});
			await act(async () => {
				calls[0].resolve({ uploadRef: "ref-video" });
			});

			expect(firstVideo(result).uploadRef).toBe("ref-video");
			expect(result.current.uploads.pending).toEqual([]);
			expect(result.current.items[0].uploadState).toEqual({});
		});

		it("uploadFile 未設定なら転送は起きず項目だけ入る", async () => {
			const { result } = await renderCore([]);
			await act(async () => {
				await result.current.handlers.add(videoFile());
			});
			expect(result.current.raw.videos).toHaveLength(1);
			expect(firstVideo(result).uploadRef).toBeUndefined();
			expect(result.current.uploads.pending).toEqual([]);
		});

		it("転送が失敗しても項目は残り、failed と onError で伝わる", async () => {
			const onError = vi.fn();
			const { uploadFile, calls } = createUploadSpy();
			const { result } = await renderCore([], { uploadFile, onError });

			await act(async () => {
				await result.current.handlers.add(videoFile());
			});
			const error = new Error("upload boom");
			await act(async () => {
				calls[0].reject(error);
			});

			const tempId = result.current.raw.videos[0].tempId;
			expect(result.current.raw.videos).toHaveLength(1);
			expect(result.current.uploads.failed).toEqual([tempId]);
			expect(result.current.items[0].uploadState.video).toEqual({
				status: "failed",
				error,
			});
			expect(onError).toHaveBeenCalledWith({
				type: "upload",
				kind: "video",
				message: "ファイルのアップロードに失敗しました。",
				cause: error,
			});
		});

		it("転送参照を返さない実装は失敗に倒す", async () => {
			const uploadFile = vi.fn(
				async () => ({ uploadRef: "" }) as UploadFileResult,
			);
			const { result } = await renderCore([], { uploadFile });

			await act(async () => {
				await result.current.handlers.add(videoFile());
			});

			expect(result.current.uploads.failed).toHaveLength(1);
		});

		it("processFile の出力が転送に渡される", async () => {
			const { uploadFile, calls } = createUploadSpy();
			const processFile = vi.fn(
				async (f: File) => new File([f], `resized_${f.name}`, { type: f.type }),
			);
			const { result } = await renderCore([], { uploadFile, processFile });

			await act(async () => {
				await result.current.handlers.add(videoFile("v.mp4"));
			});

			expect(calls[0].file.name).toBe("resized_v.mp4");
			await act(async () => {
				calls[0].resolve({ uploadRef: "ref-1" });
			});
			expect(firstVideo(result).uploadRef).toBe("ref-1");
		});

		it("差し替えでも転送が起動し、書き戻しが成立する", async () => {
			const { uploadFile, calls } = createUploadSpy();
			const { result } = await renderCore([], { uploadFile });

			await act(async () => {
				await result.current.handlers.add(videoFile("a.mp4"));
			});
			const tempId = result.current.raw.videos[0].tempId;
			await act(async () => {
				await result.current.handlers.changeFile(tempId, videoFile("b.mp4"));
			});
			await act(async () => {
				calls[1].resolve({ uploadRef: "ref-changed" });
			});

			expect(firstVideo(result).uploadRef).toBe("ref-changed");
			expect(calls[0].ctx.signal.aborted).toBe(true);
		});

		it("カスタム upload メッセージが kind つきで onError に載る", async () => {
			const onError = vi.fn();
			const { uploadFile, calls } = createUploadSpy();
			const { result } = await renderCore([], {
				uploadFile,
				onError,
				messages: { upload: (kind) => `${kind} の転送に失敗（custom）` },
			});

			await act(async () => {
				await result.current.handlers.add(videoFile());
			});
			await act(async () => {
				calls[0].reject(new Error("fail"));
			});

			expect(onError).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "upload",
					kind: "video",
					message: "video の転送に失敗（custom）",
				}),
			);
		});

		it("onError 未設定でも転送失敗でクラッシュしない", async () => {
			const { uploadFile, calls } = createUploadSpy();
			const { result } = await renderCore([], { uploadFile });

			await act(async () => {
				await result.current.handlers.add(videoFile());
			});
			await act(async () => {
				calls[0].reject(new Error("fail"));
			});

			expect(result.current.uploads.failed).toHaveLength(1);
		});
	});

	describe("転送スロット", () => {
		it("サムネイルの転送は kind: thumbnail で発行され、そのスロットへ書き戻す", async () => {
			const { uploadFile, callsOf } = createUploadSpy();
			const nv = makeNewVideo({ tempId: "temp_n" });
			const { result } = await renderCore([nv], { uploadFile });

			await act(async () => {
				await result.current.handlers.setThumbnailFromFile(
					"temp_n",
					thumbFile(),
				);
			});

			expect(callsOf("thumbnail")).toHaveLength(1);

			await act(async () => {
				callsOf("thumbnail")[0].resolve({ uploadRef: "ref-thumb" });
			});

			const thumbnail = firstVideo(result).thumbnail;
			expect(thumbnail?.uploadRef).toBe("ref-thumb");
			// 本体スロットは別の転送なのでサムネイルの解決では埋まらない
			expect(firstVideo(result).uploadRef).toBeUndefined();
		});

		it("フレームキャプチャは blob を世代トークンにして書き戻す", async () => {
			const { uploadFile, callsOf } = createUploadSpy();
			const nv = makeNewVideo({ tempId: "temp_n" });
			const { result } = await renderCore([nv], { uploadFile });

			const { ThumbnailUtils } = await import("../types/Thumbnail");
			const captureFrameSpy = vi.spyOn(ThumbnailUtils, "captureFrame");
			try {
				captureFrameSpy.mockResolvedValue({
					source: ThumbnailSource.Frame,
					blob: new Blob(["img"], { type: "image/jpeg" }),
					timestamp: 0,
				});

				await act(async () => {
					await result.current.handlers.setThumbnailFromFrame(
						"temp_n",
						document.createElement("video"),
					);
				});

				// 転送には blob から作った File が渡る
				expect(callsOf("thumbnail")[0].file.name).toBe("thumbnail.jpg");

				await act(async () => {
					callsOf("thumbnail")[0].resolve({ uploadRef: "ref-frame" });
				});

				expect(firstVideo(result).thumbnail?.uploadRef).toBe("ref-frame");
			} finally {
				captureFrameSpy.mockRestore();
			}
		});

		it("本体の転送中にサムネイルを設定しても本体の転送が破棄されない", async () => {
			const { uploadFile, calls, callsOf } = createUploadSpy();
			const { result } = await renderCore([], { uploadFile });

			await act(async () => {
				await result.current.handlers.add(videoFile());
			});
			const tempId = result.current.raw.videos[0].tempId;

			await act(async () => {
				await result.current.handlers.setThumbnailFromFile(tempId, thumbFile());
			});

			expect(callsOf("video")).toHaveLength(1);
			expect(callsOf("thumbnail")).toHaveLength(1);
			expect(calls[0].ctx.signal.aborted).toBe(false);

			await act(async () => {
				callsOf("video")[0].resolve({ uploadRef: "ref-video" });
				callsOf("thumbnail")[0].resolve({ uploadRef: "ref-thumb" });
			});

			expect(firstVideo(result).uploadRef).toBe("ref-video");
			expect(firstVideo(result).thumbnail?.uploadRef).toBe("ref-thumb");
		});

		it("同じスロットの再発行は先行の転送を中断し、その結果を捨てる", async () => {
			const { uploadFile, calls } = createUploadSpy();
			const { result } = await renderCore([], { uploadFile });

			await act(async () => {
				await result.current.handlers.add(videoFile("1.mp4"));
			});
			const tempId = result.current.raw.videos[0].tempId;
			await act(async () => {
				await result.current.handlers.changeFile(tempId, videoFile("2.mp4"));
			});

			expect(calls).toHaveLength(2);
			expect(calls[0].ctx.signal.aborted).toBe(true);

			await act(async () => {
				calls[0].resolve({ uploadRef: "ref-stale" });
				calls[1].resolve({ uploadRef: "ref-current" });
			});

			expect(firstVideo(result).uploadRef).toBe("ref-current");
		});

		it("handlers を介さない差し替えで転送結果が破棄される", async () => {
			const { uploadFile, calls } = createUploadSpy();
			const { result, ref } = await renderCore([], { uploadFile });

			await act(async () => {
				await result.current.handlers.add(videoFile());
			});
			const current = firstVideo(result);

			// adapter へ直接書き込むと台帳のレコードは自分のままなので、
			// 破棄の判定は転送したオブジェクトとの同一性だけが担う
			await act(async () => {
				ref.adapter?.setVideos([
					{ ...current, file: videoFile("other.mp4") } satisfies VideoNew,
				]);
			});
			await act(async () => {
				calls[0].resolve({ uploadRef: "ref-discarded" });
			});

			expect(firstVideo(result).uploadRef).toBeUndefined();
		});

		it("既存動画の差し替えでサムネイルの転送が中断される", async () => {
			const { uploadFile, calls, callsOf } = createUploadSpy();
			const ex = makeExistingVideo({ tempId: "temp_ex" });
			const { result } = await renderCore([ex], { uploadFile });

			await act(async () => {
				await result.current.handlers.setThumbnailFromFile(
					"temp_ex",
					thumbFile(),
				);
			});
			expect(callsOf("thumbnail")).toHaveLength(1);

			await act(async () => {
				await result.current.handlers.changeFile("temp_ex", videoFile("n.mp4"));
			});

			expect(calls[0].ctx.signal.aborted).toBe(true);
			expect(result.current.raw.videos[0].thumbnail).toBeNull();
			expect(result.current.uploads.pending).toEqual(["temp_ex"]);
		});

		it("削除で両スロットの転送が中断され failed も落ちる", async () => {
			const { uploadFile, calls } = createUploadSpy();
			const { result } = await renderCore([], { uploadFile });

			await act(async () => {
				await result.current.handlers.add(videoFile());
			});
			const tempId = result.current.raw.videos[0].tempId;
			await act(async () => {
				await result.current.handlers.setThumbnailFromFile(tempId, thumbFile());
			});
			await act(async () => {
				calls[1].reject(new Error("thumb boom"));
			});
			expect(result.current.uploads.failed).toEqual([tempId]);

			await act(async () => {
				await result.current.handlers.delete(tempId);
			});

			expect(calls[0].ctx.signal.aborted).toBe(true);
			expect(result.current.uploads.pending).toEqual([]);
			expect(result.current.uploads.failed).toEqual([]);
		});

		it("サムネイル削除でそのスロットの転送が中断される", async () => {
			const { uploadFile, callsOf } = createUploadSpy();
			const ex = makeExistingVideo({ tempId: "temp_ex" });
			const { result } = await renderCore([ex], { uploadFile });

			await act(async () => {
				await result.current.handlers.setThumbnailFromFile(
					"temp_ex",
					thumbFile(),
				);
			});
			await act(async () => {
				await result.current.handlers.removeThumbnail("temp_ex");
			});

			expect(callsOf("thumbnail")[0].ctx.signal.aborted).toBe(true);
			expect(result.current.uploads.pending).toEqual([]);
		});

		it("unmount で走行中の転送が中断される", async () => {
			const { uploadFile, calls } = createUploadSpy();
			const { result, unmount } = await renderCore([], { uploadFile });

			await act(async () => {
				await result.current.handlers.add(videoFile());
			});
			unmount();

			expect(calls[0].ctx.signal.aborted).toBe(true);
		});
	});

	describe("進捗", () => {
		it("onProgress の報告が uploadState に載る", async () => {
			const { uploadFile, calls } = createUploadSpy();
			const { result } = await renderCore([], { uploadFile });

			await act(async () => {
				await result.current.handlers.add(videoFile());
			});
			await act(async () => {
				calls[0].ctx.onProgress(0.42);
			});

			expect(result.current.items[0].uploadState.video).toEqual({
				status: "pending",
				progress: 0.42,
			});
		});

		it("範囲外と非有限値は丸める / 無視する", async () => {
			const { uploadFile, calls } = createUploadSpy();
			const { result } = await renderCore([], { uploadFile });

			await act(async () => {
				await result.current.handlers.add(videoFile());
			});
			await act(async () => {
				calls[0].ctx.onProgress(1.5);
			});
			expect(result.current.items[0].uploadState.video).toEqual({
				status: "pending",
				progress: 1,
			});

			await act(async () => {
				calls[0].ctx.onProgress(Number.NaN);
			});
			expect(result.current.items[0].uploadState.video).toEqual({
				status: "pending",
				progress: 1,
			});
		});

		it("本体とサムネイルの進捗は別々に出る", async () => {
			const { uploadFile, callsOf } = createUploadSpy();
			const { result } = await renderCore([], { uploadFile });

			await act(async () => {
				await result.current.handlers.add(videoFile());
			});
			const tempId = result.current.raw.videos[0].tempId;
			await act(async () => {
				await result.current.handlers.setThumbnailFromFile(tempId, thumbFile());
			});
			await act(async () => {
				callsOf("video")[0].ctx.onProgress(0.2);
				callsOf("thumbnail")[0].ctx.onProgress(0.8);
			});

			expect(result.current.items[0].uploadState).toEqual({
				video: { status: "pending", progress: 0.2 },
				thumbnail: { status: "pending", progress: 0.8 },
			});
		});
	});

	describe("self-heal と孤児回収", () => {
		it("転送参照を持たない初期値の項目に転送を発行する", async () => {
			const uploadFile = vi.fn(async () => ({ uploadRef: "ref-healed" }));
			const nv = makeNewVideo({ tempId: "temp_initial" });
			const { result } = await renderCore([nv], { uploadFile });

			// mount 時点で発行される。unmount で台帳が失われてもフォーム state には
			// 項目が残るため、remount 後に「転送されないまま」にならない
			await vi.waitFor(() => {
				expect(firstVideo(result).uploadRef).toBe("ref-healed");
			});
			expect(uploadFile).toHaveBeenCalledOnce();
		});

		it("走行中のスロットへは再発行しない", async () => {
			const { uploadFile, calls } = createUploadSpy();
			const nv = makeNewVideo({ tempId: "temp_pending" });
			const { result } = await renderCore([nv], { uploadFile });

			expect(calls).toHaveLength(1);

			// 台帳が動くと再照合が走るが、走行中のスロットは触らない
			await act(async () => {
				calls[0].ctx.onProgress(0.5);
			});

			expect(calls).toHaveLength(1);
			expect(result.current.uploads.pending).toEqual(["temp_pending"]);
		});

		it("失敗したスロットへは再発行しない", async () => {
			const { uploadFile, calls } = createUploadSpy();
			const nv = makeNewVideo({ tempId: "temp_failed" });
			const { result } = await renderCore([nv], { uploadFile });

			await act(async () => {
				calls[0].reject(new Error("boom"));
			});

			expect(calls).toHaveLength(1);
			expect(result.current.uploads.failed).toEqual(["temp_failed"]);
		});

		it("ファイルを選び直すと失敗済みのスロットにも再発行される", async () => {
			const { uploadFile, calls } = createUploadSpy();
			const nv = makeNewVideo({ tempId: "temp_retry_by_change" });
			const { result } = await renderCore([nv], { uploadFile });

			await act(async () => {
				calls[0].reject(new Error("boom"));
			});
			await act(async () => {
				await result.current.handlers.changeFile(
					"temp_retry_by_change",
					videoFile("b.mp4"),
				);
			});

			expect(calls).toHaveLength(2);
			expect(result.current.uploads.failed).toEqual([]);
		});

		it("フォームから消えた項目の failed は uploads.failed から落ちる", async () => {
			const { uploadFile, calls } = createUploadSpy();
			const { result, ref } = await renderCore([], { uploadFile });

			await act(async () => {
				await result.current.handlers.add(videoFile());
			});
			const tempId = result.current.raw.videos[0].tempId;
			await act(async () => {
				calls[0].reject(new Error("boom"));
			});
			expect(result.current.uploads.failed).toEqual([tempId]);

			// handlers を介さずに項目を落とす（form.reset 相当）
			await act(async () => {
				ref.adapter?.setVideos([]);
			});

			expect(result.current.uploads.failed).toEqual([]);
		});

		it("反映待ちの追加直後の転送は孤児回収で中断されない", async () => {
			const { uploadFile, calls } = createUploadSpy();
			const { result } = await renderCore([], { uploadFile });

			await act(async () => {
				await result.current.handlers.add(videoFile());
			});

			expect(calls[0].ctx.signal.aborted).toBe(false);
			expect(result.current.uploads.pending).toHaveLength(1);
		});

		it("read のたびに参照が変わる adapter は上限まで試して失敗に倒す", async () => {
			const uploadFile = vi.fn(async () => ({ uploadRef: "ref" }));
			const nv = makeNewVideo({ tempId: "temp_unstable" });
			const { result } = await renderCore([nv], {
				uploadFile,
				unstableReads: true,
			});

			await vi.waitFor(() => {
				expect(result.current.uploads.failed).toEqual(["temp_unstable"]);
			});
			// 上限（自己破棄 2 回）で止まる。無制限に撃ち続けない
			expect(uploadFile.mock.calls.length).toBeLessThanOrEqual(2);
			expect(firstVideo(result).uploadRef).toBeUndefined();
		});
	});

	describe("uploads.retry", () => {
		it("failed スロットだけを再送して true を返す", async () => {
			const { uploadFile, calls, callsOf } = createUploadSpy();
			const { result } = await renderCore([], { uploadFile });

			await act(async () => {
				await result.current.handlers.add(videoFile());
			});
			const tempId = result.current.raw.videos[0].tempId;
			await act(async () => {
				await result.current.handlers.setThumbnailFromFile(tempId, thumbFile());
			});
			await act(async () => {
				callsOf("thumbnail")[0].reject(new Error("thumb boom"));
			});

			let retried = false;
			await act(async () => {
				retried = result.current.uploads.retry(tempId);
			});

			expect(retried).toBe(true);
			expect(callsOf("thumbnail")).toHaveLength(2);
			expect(callsOf("video")).toHaveLength(1);
			expect(calls[0].ctx.signal.aborted).toBe(false);

			await act(async () => {
				callsOf("thumbnail")[1].resolve({ uploadRef: "ref-retried" });
			});
			expect(firstVideo(result).thumbnail?.uploadRef).toBe("ref-retried");
		});

		it("failed スロットが無ければ false を返し何も発行しない", async () => {
			const { uploadFile, calls } = createUploadSpy();
			const { result } = await renderCore([], { uploadFile });

			await act(async () => {
				await result.current.handlers.add(videoFile());
			});
			const tempId = result.current.raw.videos[0].tempId;

			let retried = true;
			await act(async () => {
				retried = result.current.uploads.retry(tempId);
			});

			expect(retried).toBe(false);
			expect(calls).toHaveLength(1);
		});

		it("不明な tempId は false", async () => {
			const { uploadFile } = createUploadSpy();
			const { result } = await renderCore([makeNewVideo({ tempId: "a" })], {
				uploadFile,
			});
			expect(result.current.uploads.retry("unknown")).toBe(false);
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
				return useMultiVideoCore({ adapter, onError });
			});

			ref.validate!.mockRejectedValueOnce(new Error("schema explosion"));

			await act(async () => {
				await result.current.handlers.add(videoFile());
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
			const { uploadFile, calls } = createUploadSpy();
			const nv = makeNewVideo({ tempId: "temp_n" });
			const { result } = await renderCore([nv], { uploadFile });
			const callsBefore = calls.length;
			let ok = true;
			await act(async () => {
				ok = await result.current.handlers.changeFile(
					"does-not-exist",
					videoFile("x.mp4"),
				);
			});
			expect(ok).toBe(false);
			expect(calls).toHaveLength(callsBefore);
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

	describe("onError 未設定時の安全性", () => {
		it("processFile 失敗 + onError なしでクラッシュしないこと", async () => {
			const processFile = vi.fn(async () => {
				throw new Error("fail");
			});
			const { result } = await renderCore([], { processFile });
			let ok = true;
			await act(async () => {
				ok = await result.current.handlers.add(videoFile());
			});
			expect(ok).toBe(false);
		});

		it("maxVideos 超過 + onError なしでクラッシュしないこと", async () => {
			const { result } = await renderCore([makeNewVideo()], { maxVideos: 1 });
			let ok = true;
			await act(async () => {
				ok = await result.current.handlers.add(videoFile());
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
				await result.current.handlers.add(videoFile("b.mp4"));
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
				await result.current.handlers.add(videoFile("b.mp4"));
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
				await result.current.handlers.add(videoFile("b.mp4"));
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
				await result.current.handlers.add(videoFile("b.mp4"));
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

		it("uploadFile をインラインで渡しても handlers の identity が変わらない", async () => {
			let renderCount = 0;
			const ref: { result?: ReturnType<typeof useMultiVideoCore> } = {};

			type Props = { uploadFile: UploadFileFn };
			const makeUploadFile = (): UploadFileFn => async () => ({
				uploadRef: "ref",
			});
			const { rerender } = await renderHook(
				(props?: Props) => {
					renderCount++;
					const { adapter } = useFakeAdapter([]);
					const core = useMultiVideoCore({
						adapter,
						uploadFile: props?.uploadFile,
					});
					ref.result = core;
					return core;
				},
				{ initialProps: { uploadFile: makeUploadFile() } as Props },
			);

			const handlersAfterFirst = ref.result!.handlers;

			await rerender({ uploadFile: makeUploadFile() } as Props);

			expect(renderCount).toBeGreaterThanOrEqual(2);
			expect(ref.result!.handlers.add).toBe(handlersAfterFirst.add);
			expect(ref.result!.handlers.changeFile).toBe(
				handlersAfterFirst.changeFile,
			);
		});
	});

	describe("uploads.wait", () => {
		it("uploadFile 未設定なら待たずに素材を返す", async () => {
			const nv = makeNewVideo({ tempId: "temp_local" });
			const ex = makeExistingVideo({ tempId: "temp_ex", id: "id-ex" });
			const { result } = await renderCore([nv, ex]);

			let waited: Awaited<ReturnType<typeof result.current.uploads.wait>>;
			await act(async () => {
				waited = await result.current.uploads.wait();
			});

			expect(waited!.ok).toBe(true);
			if (!waited!.ok) return;
			expect(waited!.videos).toEqual([
				{
					status: VideoFormStatus.New,
					file: nv.file,
					tempId: "temp_local",
					thumbnail: null,
				},
				{ status: VideoFormStatus.Existing, id: "id-ex", thumbnail: null },
			]);
		});

		it("走行中の転送を待ってから素材を返す", async () => {
			const { uploadFile, calls } = createUploadSpy();
			const { result } = await renderCore([], { uploadFile });

			await act(async () => {
				await result.current.handlers.add(videoFile());
			});

			let waited: Awaited<ReturnType<typeof result.current.uploads.wait>>;
			await act(async () => {
				const waiting = result.current.uploads.wait();
				calls[0].resolve({ uploadRef: "ref-video" });
				waited = await waiting;
			});

			expect(waited!.ok).toBe(true);
			if (!waited!.ok) return;
			expect(waited!.videos).toEqual([
				{
					status: VideoFormStatus.New,
					uploadRef: "ref-video",
					thumbnail: null,
				},
			]);
		});

		it("未着手のスロットは wait が転送を発行して待つ", async () => {
			const uploadFile = vi.fn(async () => ({ uploadRef: "ref-reissued" }));
			// 転送ハンドラを設定しても、初期値の項目には転送が走っていない
			const nv = makeNewVideo({ tempId: "temp_initial" });
			const { result } = await renderCore([nv], { uploadFile });

			let waited: Awaited<ReturnType<typeof result.current.uploads.wait>>;
			await act(async () => {
				waited = await result.current.uploads.wait();
			});

			expect(uploadFile).toHaveBeenCalledOnce();
			expect(waited!.ok).toBe(true);
			expect(firstVideo(result).uploadRef).toBe("ref-reissued");
		});

		it("本体が完了しサムネイルが走行中なら両方を待つ", async () => {
			const { uploadFile, callsOf } = createUploadSpy();
			const { result } = await renderCore([], { uploadFile });

			await act(async () => {
				await result.current.handlers.add(videoFile());
			});
			const tempId = result.current.raw.videos[0].tempId;
			await act(async () => {
				await result.current.handlers.setThumbnailFromFile(tempId, thumbFile());
			});
			await act(async () => {
				callsOf("video")[0].resolve({ uploadRef: "ref-video" });
			});

			let settled = false;
			let waited: Awaited<ReturnType<typeof result.current.uploads.wait>>;
			await act(async () => {
				const waiting = result.current.uploads.wait().then((r) => {
					settled = true;
					return r;
				});
				await Promise.resolve();
				expect(settled).toBe(false);
				callsOf("thumbnail")[0].resolve({ uploadRef: "ref-thumb" });
				waited = await waiting;
			});

			expect(waited!.ok).toBe(true);
			if (!waited!.ok) return;
			expect(waited!.videos[0]).toEqual({
				status: VideoFormStatus.New,
				uploadRef: "ref-video",
				thumbnail: { status: "new", uploadRef: "ref-thumb" },
			});
		});

		it("失敗したスロットがあれば ok:false + failedTempIds", async () => {
			const { uploadFile, calls } = createUploadSpy();
			const { result } = await renderCore([], { uploadFile });

			await act(async () => {
				await result.current.handlers.add(videoFile());
			});
			const tempId = result.current.raw.videos[0].tempId;
			await act(async () => {
				calls[0].reject(new Error("boom"));
			});

			let waited: Awaited<ReturnType<typeof result.current.uploads.wait>>;
			await act(async () => {
				waited = await result.current.uploads.wait();
			});

			expect(waited!).toEqual({ ok: false, failedTempIds: [tempId] });
			// 失敗済みは自動再試行しないので、転送は 1 回で止まる
			expect(calls).toHaveLength(1);
		});

		it("フォームから消えた項目の転送が settle しなくても返る", async () => {
			const { uploadFile, calls } = createUploadSpy();
			const { result, ref } = await renderCore([], { uploadFile });

			await act(async () => {
				await result.current.handlers.add(videoFile());
			});

			// handlers を介さずに項目を落とす（form.reset 相当）
			await act(async () => {
				ref.adapter?.setVideos([]);
			});

			let waited: Awaited<ReturnType<typeof result.current.uploads.wait>>;
			await act(async () => {
				waited = await result.current.uploads.wait();
			});

			expect(waited!).toEqual({ ok: true, videos: [], deletedIds: [] });
			// 孤児回収が台帳から落とすので、走行中だった転送は中断される
			expect(calls[0].ctx.signal.aborted).toBe(true);
		});

		it("既存動画のサムネイル差し替えは replaced で運ばれる", async () => {
			const { uploadFile, calls } = createUploadSpy();
			const ex = makeExistingVideo({
				tempId: "temp_ex",
				id: "id-ex",
				thumbnail: {
					source: ThumbnailSource.Existing,
					uploadedUrl: "https://s3.example.com/old-thumb.jpg",
				},
			});
			const { result } = await renderCore([ex], { uploadFile });

			await act(async () => {
				await result.current.handlers.setThumbnailFromFile(
					"temp_ex",
					thumbFile(),
				);
			});

			let waited: Awaited<ReturnType<typeof result.current.uploads.wait>>;
			await act(async () => {
				const waiting = result.current.uploads.wait();
				calls[0].resolve({ uploadRef: "ref-new-thumb" });
				waited = await waiting;
			});

			expect(waited!.ok).toBe(true);
			if (!waited!.ok) return;
			expect(waited!.videos[0]).toEqual({
				status: VideoFormStatus.Existing,
				id: "id-ex",
				thumbnail: { status: "replaced", uploadRef: "ref-new-thumb" },
			});
		});

		it("サムネイル削除は removed で運ばれる", async () => {
			const ex = makeExistingVideo({
				tempId: "temp_ex",
				id: "id-ex",
				thumbnail: {
					source: ThumbnailSource.Existing,
					uploadedUrl: "https://s3.example.com/old-thumb.jpg",
				},
			});
			const { result } = await renderCore([ex]);

			await act(async () => {
				await result.current.handlers.removeThumbnail("temp_ex");
			});

			let waited: Awaited<ReturnType<typeof result.current.uploads.wait>>;
			await act(async () => {
				waited = await result.current.uploads.wait();
			});

			expect(waited!.ok).toBe(true);
			if (!waited!.ok) return;
			expect(waited!.videos[0]).toEqual({
				status: VideoFormStatus.Existing,
				id: "id-ex",
				thumbnail: { status: "removed" },
			});
		});

		it("書き込みを捨てる adapter では再発行を打ち切って失敗に倒す", async () => {
			const uploadFile = vi.fn(async () => ({ uploadRef: "ref" }));
			const nv = makeNewVideo({ tempId: "temp_stuck" });
			const { result } = await renderCore([nv], {
				uploadFile,
				dropUploadRefs: true,
			});

			let waited: Awaited<ReturnType<typeof result.current.uploads.wait>>;
			await act(async () => {
				waited = await result.current.uploads.wait();
			});

			expect(waited!).toEqual({ ok: false, failedTempIds: ["temp_stuck"] });
			// 台帳にも失敗として残す。返るだけだと消費側が retry できない
			expect(result.current.uploads.failed).toEqual(["temp_stuck"]);
			// 上限（自己破棄 2 回）まで試して止まる。無制限に撃ち続けない
			expect(uploadFile.mock.calls.length).toBeLessThanOrEqual(2);
		});

		it("削除した既存動画の id は deletedIds に載る", async () => {
			const ex = makeExistingVideo({ tempId: "temp_ex", id: "id-ex" });
			const { result } = await renderCore([ex]);

			await act(async () => {
				await result.current.handlers.delete("temp_ex");
			});

			let waited: Awaited<ReturnType<typeof result.current.uploads.wait>>;
			await act(async () => {
				waited = await result.current.uploads.wait();
			});

			expect(waited!).toEqual({
				ok: true,
				videos: [],
				deletedIds: ["id-ex"],
			});
		});
	});

	describe("uploads.getReady", () => {
		it("未完了のスロットを持つ項目を除外して excludedTempIds で返す", async () => {
			const { uploadFile, calls } = createUploadSpy();
			const ex = makeExistingVideo({ tempId: "temp_ex", id: "id-ex" });
			const { result } = await renderCore([ex], { uploadFile });

			await act(async () => {
				await result.current.handlers.add(videoFile());
			});
			const pendingTempId = result.current.raw.videos[1].tempId;

			const ready = result.current.uploads.getReady();

			expect(ready.excludedTempIds).toEqual([pendingTempId]);
			expect(ready.videos).toEqual([
				{ status: VideoFormStatus.Existing, id: "id-ex", thumbnail: null },
			]);

			await act(async () => {
				calls[0].resolve({ uploadRef: "ref-video" });
			});

			expect(result.current.uploads.getReady().excludedTempIds).toEqual([]);
		});

		it("サムネイルだけ転送中の項目も丸ごと除外される", async () => {
			const { uploadFile, callsOf } = createUploadSpy();
			const { result } = await renderCore([], { uploadFile });

			await act(async () => {
				await result.current.handlers.add(videoFile());
			});
			const tempId = result.current.raw.videos[0].tempId;
			await act(async () => {
				await result.current.handlers.setThumbnailFromFile(tempId, thumbFile());
			});
			await act(async () => {
				callsOf("video")[0].resolve({ uploadRef: "ref-video" });
			});

			const ready = result.current.uploads.getReady();

			expect(ready.excludedTempIds).toEqual([tempId]);
			expect(ready.videos).toEqual([]);
		});

		it("uploadFile 未設定なら新規項目を除外しない", async () => {
			const { result } = await renderCore();

			await act(async () => {
				await result.current.handlers.add(videoFile());
			});

			const ready = result.current.uploads.getReady();

			expect(ready.excludedTempIds).toEqual([]);
			expect(ready.videos).toHaveLength(1);
		});
	});

	describe("isBusy / isPending", () => {
		it("handleAdd 中に isBusy が true になり、完了後 false に戻る", async () => {
			const d = createDeferred<File>();
			const processFile = vi.fn(async (_f: File) => d.promise);
			const { result } = await renderCore([], { processFile });

			expect(result.current.isBusy).toBe(false);

			let addPromise: Promise<boolean>;
			await act(async () => {
				addPromise = result.current.handlers.add(videoFile());
			});

			expect(result.current.isBusy).toBe(true);

			await act(async () => {
				d.resolve(videoFile());
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
					videoFile("b.mp4"),
				);
			});

			expect(result.current.items[0].isPending).toBe(true);
			expect(result.current.isBusy).toBe(true);

			await act(async () => {
				d.resolve(videoFile("b.mp4"));
				await changePromise!;
			});

			expect(result.current.items[0].isPending).toBe(false);
			expect(result.current.isBusy).toBe(false);
		});

		it("転送中は isPending / isBusy に出ない（転送は uploadState が持つ）", async () => {
			const { uploadFile } = createUploadSpy();
			const { result } = await renderCore([], { uploadFile });

			await act(async () => {
				await result.current.handlers.add(videoFile());
			});

			expect(result.current.items[0].uploadState.video?.status).toBe("pending");
			expect(result.current.items[0].isPending).toBe(false);
			expect(result.current.isBusy).toBe(false);
		});
	});
});
