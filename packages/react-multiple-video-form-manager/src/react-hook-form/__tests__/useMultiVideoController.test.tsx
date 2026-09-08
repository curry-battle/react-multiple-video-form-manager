import type { ReactNode } from "react";
import { type UseFormReturn, useForm } from "react-hook-form";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, renderHook } from "vitest-browser-react";
import type { Video, VideoExisting } from "../../core/types/Video";
import { VideoFormStatus } from "../../core/types/VideoStatus";
import { MultiVideoController } from "../MultiVideoController";
import { useMultiVideoController } from "../useMultiVideoController";

type TestForm = { videos: Video[]; videosDeletedIds: string[] };

type HookParams = Parameters<
	typeof useMultiVideoController<"videos", "videosDeletedIds", TestForm>
>[0];

function createDeferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

/** 保留中の promise が「まだ settle していない」ことを見るための待ち */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const videoFile = (name = "a.mp4") =>
	new File(["v"], name, { type: "video/mp4" });

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

async function renderControllerHook(
	initialVideos: Video[] = [],
	hookOverrides?: Partial<HookParams>,
) {
	const formRef: { current: UseFormReturn<TestForm> | null } = {
		current: null,
	};

	const wrapper = ({ children }: { children: ReactNode }) => {
		const form = useForm<TestForm>({
			defaultValues: { videos: initialVideos, videosDeletedIds: [] },
		});
		formRef.current = form;
		return <>{children}</>;
	};

	const result = await renderHook(
		(props?: Partial<HookParams>) => {
			const form = formRef.current;
			if (!form) throw new Error("formRef not initialized");
			return useMultiVideoController<"videos", "videosDeletedIds", TestForm>({
				form,
				name: "videos",
				deletedName: "videosDeletedIds",
				...props,
			});
		},
		{
			wrapper,
			initialProps: (hookOverrides ?? {}) as Partial<HookParams>,
		},
	);

	return { ...result, formRef };
}

describe("useMultiVideoController — RHF 配線固有", () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	describe("messages パススルー", () => {
		it("messages.maxVideos のカスタム文言がラッパー経由で onError に載ること", async () => {
			const onError = vi.fn();
			const existing = makeExistingVideo();
			const { result, act } = await renderControllerHook([existing], {
				maxVideos: 1,
				onError,
				messages: { maxVideos: (max: number) => `最大${max}本まで（custom）` },
			});

			const file = new File(["video"], "extra.mp4", { type: "video/mp4" });
			await act(async () => {
				await result.current.handlers.add(file);
			});

			expect(onError).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "max_videos",
					message: "最大1本まで（custom）",
				}),
			);
		});

		it("messages 未指定時は既定の日本語文言が onError に載ること", async () => {
			const onError = vi.fn();
			const existing = makeExistingVideo();
			const { result, act } = await renderControllerHook([existing], {
				maxVideos: 1,
				onError,
			});

			const file = new File(["video"], "extra.mp4", { type: "video/mp4" });
			await act(async () => {
				await result.current.handlers.add(file);
			});

			expect(onError).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "max_videos",
					message: "動画は最大1件までです。",
				}),
			);
		});
	});

	describe("RHF replace 経由の dirty 伝播", () => {
		it("handleAdd で form.getValues に即時反映される", async () => {
			const { result, act, formRef } = await renderControllerHook();
			const file = new File(["video"], "new.mp4", { type: "video/mp4" });

			await act(async () => {
				await result.current.handlers.add(file);
			});

			const values = formRef.current?.getValues();
			expect(values?.videos).toHaveLength(1);
			expect(values?.videos[0]?.status).toBe(VideoFormStatus.New);
		});

		it("handleDelete（既存動画）で deletedVideoIds に即時反映される", async () => {
			const existing = makeExistingVideo({ tempId: "temp_del" });
			const { result, act, formRef } = await renderControllerHook([existing]);

			await act(async () => {
				await result.current.handlers.delete("temp_del");
			});

			const values = formRef.current?.getValues();
			expect(values?.videos).toHaveLength(0);
			expect(values?.videosDeletedIds).toContain(existing.id);
		});
	});

	describe("deletedName デフォルト (DX-6)", () => {
		it("deletedName 省略時に nameDeletedIds フィールドが読み書きされる", async () => {
			const existing = makeExistingVideo({ tempId: "temp_default" });
			const formRef: { current: UseFormReturn<TestForm> | null } = {
				current: null,
			};
			const deleteRef: { current: (() => Promise<boolean>) | null } = {
				current: null,
			};

			function Host() {
				const form = useForm<TestForm>({
					defaultValues: {
						videos: [existing],
						videosDeletedIds: [],
					},
				});
				formRef.current = form;
				return (
					<MultiVideoController
						form={form}
						name="videos"
						render={(p) => {
							if (p.items[0]) {
								deleteRef.current = p.items[0].handlers.delete;
							}
							return <div data-testid="count">{p.items.length}</div>;
						}}
					/>
				);
			}

			await render(<Host />);
			expect(deleteRef.current).not.toBeNull();

			await deleteRef.current!();

			await vi.waitFor(() => {
				const values = formRef.current?.getValues();
				expect(values?.videos).toHaveLength(0);
				expect(values?.videosDeletedIds).toContain(existing.id);
			});
		});
	});

	describe("[red] uploads.wait と走行中の選択", () => {
		it("[red] T1: 変換を保留させたまま wait() を呼ぶと、解決後に当該動画を含む ok を返す", async () => {
			const converted = createDeferred<File>();
			const { result, act } = await renderControllerHook([], {
				processFile: () => converted.promise,
				uploadFile: async () => ({ uploadRef: "ref-a" }),
			});

			let waited: unknown = null;
			await act(async () => {
				void result.current.handlers.add(videoFile("a.mp4"));
				const waiting = result.current.uploads.wait().then((r) => {
					waited = r;
				});
				converted.resolve(videoFile("a.mp4"));
				await waiting;
			});

			expect(waited).toMatchObject({
				ok: true,
				videos: [{ uploadRef: "ref-a" }],
			});
		});

		it("[red] T4: uploadFile 未設定の構成でも変換を待つ", async () => {
			const converted = createDeferred<File>();
			const { result, act } = await renderControllerHook([], {
				processFile: () => converted.promise,
			});

			let waited: unknown = null;
			await act(async () => {
				void result.current.handlers.add(videoFile("a.mp4"));
				const waiting = result.current.uploads.wait().then((r) => {
					waited = r;
				});
				await flush();
				expect(waited).toBeNull();

				converted.resolve(videoFile("a.mp4"));
				await waiting;
			});

			expect(waited).toMatchObject({
				ok: true,
				videos: [{ status: VideoFormStatus.New }],
			});
		});

		it("[red] T10: unmount 後に解決した選択はフォームへ書き戻さない", async () => {
			const converted = createDeferred<File>();
			const { result, act, unmount, formRef } = await renderControllerHook([], {
				processFile: () => converted.promise,
			});

			let adding: Promise<boolean> | undefined;
			await act(async () => {
				adding = result.current.handlers.add(videoFile("a.mp4"));
				await flush();
			});

			await unmount();

			converted.resolve(videoFile("a.mp4"));
			await adding;

			expect(formRef.current?.getValues().videos).toHaveLength(0);
		});
	});

	describe("[regression] 走行中の選択の交代", () => {
		it("[regression] T11: 変換を保留させた並行 add で 2 件とも残る", async () => {
			const conversions = [createDeferred<File>(), createDeferred<File>()];
			let call = 0;
			const { result, act } = await renderControllerHook([], {
				processFile: () => conversions[call++].promise,
			});

			await act(async () => {
				const first = result.current.handlers.add(videoFile("a.mp4"));
				const second = result.current.handlers.add(videoFile("b.mp4"));
				conversions[0].resolve(videoFile("a.mp4"));
				conversions[1].resolve(videoFile("b.mp4"));
				expect(await first).toBe(true);
				expect(await second).toBe(true);
			});

			expect(result.current.raw.videos).toHaveLength(2);
		});
	});
});
