import { useForm } from "@tanstack/react-form";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, renderHook } from "vitest-browser-react";
import { z } from "zod";
import type { MultiVideoError } from "../../core/types/MultiVideoError";
import type { Video, VideoExisting, VideoNew } from "../../core/types/Video";
import type { CoreMessages } from "../../core/types/VideoSchemaTypes";
import { VideoFormStatus } from "../../core/types/VideoStatus";
import type { MultiVideoCoreOptions } from "../../core/useMultiVideoCore";
import { createVideosSchema } from "../../schemas/zod";
import { MultiVideoController } from "../MultiVideoController";
import { useMultiVideoController } from "../useMultiVideoController";

const makeNewVideo = (overrides?: Partial<VideoNew>): VideoNew => ({
	tempId: `temp_new-${crypto.randomUUID().slice(0, 8)}`,
	status: VideoFormStatus.New,
	id: undefined,
	file: new File(["data"], "test.mp4", { type: "video/mp4" }),
	uploadRef: undefined,
	thumbnail: null,
	...overrides,
});

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

/**
 * 待ち合わせの検証にフックを直に呼ぶ形が要る理由は 2 つ。`renderHook` の戻り値から
 * `act` と `unmount` を取れること（unmount を跨ぐ検証に要る）と、同ファイルの
 * `HarnessHost` が render props の一部だけを `handleRef` へ写していて `raw` を
 * 読めないこと
 */
async function renderControllerHook(
	initialVideos: Video[] = [],
	coreOptions: MultiVideoCoreOptions = {},
) {
	// TanStack の useForm 戻り値は型引数が多く、テストからは state だけ読めれば足りる
	const formRef: { current: any } = { current: null };

	const rendered = await renderHook(() => {
		const form = useForm({
			defaultValues: {
				videos: initialVideos,
				videosDeletedIds: [],
			} as TestForm,
		});
		formRef.current = form;
		return useMultiVideoController({
			form,
			name: "videos",
			deletedName: "videosDeletedIds",
			...coreOptions,
		});
	});

	return { ...rendered, formRef };
}

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

type TestForm = { videos: Video[]; videosDeletedIds: string[] };

type Handle = {
	items: Array<{ video: Video; errors: unknown }>;
	rootErrors: Array<unknown>;
	addVideo: (file: File) => Promise<boolean>;
	handleDelete: (tempId: string) => Promise<boolean>;
	handleMoveDown: (tempId: string) => Promise<boolean>;
};

function HarnessHost(props: {
	initialVideos?: Video[];
	withSchema?: boolean;
	/** schema 側の maxVideos（バリデーションを発火させたいケース用） */
	maxVideos?: number;
	/** core ガード側の maxVideos（追加自体をブロックさせたいケース用） */
	coreMaxVideos?: number;
	onError?: (error: MultiVideoError) => void;
	messages?: CoreMessages;
	renderCount: { current: number };
	handleRef: { current: Handle | null };
}): ReactNode {
	const form = useForm({
		defaultValues: {
			videos: props.initialVideos ?? [],
			videosDeletedIds: [],
		} as TestForm,
		validators: props.withSchema
			? {
					onChange: z.object({
						videos: createVideosSchema({
							acceptedVideoTypes: ["video/mp4"],
							maxVideos: props.maxVideos,
						}),
						videosDeletedIds: z.array(z.string()),
					}),
				}
			: undefined,
	});

	return (
		<MultiVideoController
			form={form}
			name="videos"
			deletedName="videosDeletedIds"
			maxVideos={props.coreMaxVideos}
			onError={props.onError}
			messages={props.messages}
			render={(p) => {
				props.renderCount.current += 1;
				props.handleRef.current = {
					items: p.items,
					rootErrors: p.rootErrors,
					addVideo: p.addVideo,
					handleDelete: (tempId: string) => {
						const item = p.items.find((i) => i.video.tempId === tempId);
						return item ? item.handlers.delete() : Promise.resolve(false);
					},
					handleMoveDown: (tempId: string) => {
						const item = p.items.find((i) => i.video.tempId === tempId);
						return item ? item.handlers.moveDown() : Promise.resolve(false);
					},
				};
				return <div data-testid="harness">items:{p.items.length}</div>;
			}}
		/>
	);
}

describe("MultiVideoController (integration)", () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it("handleAdd で動画を追加でき items に反映される", async () => {
		const renderCount = { current: 0 };
		const handleRef: { current: Handle | null } = { current: null };

		await render(
			<HarnessHost renderCount={renderCount} handleRef={handleRef} />,
		);

		expect(handleRef.current?.items).toHaveLength(0);

		await handleRef.current?.addVideo(
			new File(["v"], "a.mp4", { type: "video/mp4" }),
		);

		await vi.waitFor(() => {
			expect(handleRef.current?.items).toHaveLength(1);
			expect(handleRef.current?.items[0]?.video.status).toBe(
				VideoFormStatus.New,
			);
		});
	});

	it("handleDelete で New 動画は除去される", async () => {
		const renderCount = { current: 0 };
		const handleRef: { current: Handle | null } = { current: null };
		const v = makeNewVideo({ tempId: "temp_n" });
		await render(
			<HarnessHost
				initialVideos={[v]}
				renderCount={renderCount}
				handleRef={handleRef}
			/>,
		);
		expect(handleRef.current?.items).toHaveLength(1);
		await handleRef.current?.handleDelete("temp_n");
		await vi.waitFor(() => expect(handleRef.current?.items).toHaveLength(0));
	});

	it("Standard Schema 経由で invalid を追加 → adapter.validate 後に items[i].errors.file が反映される (reactive subscription)", async () => {
		const renderCount = { current: 0 };
		const handleRef: { current: Handle | null } = { current: null };

		await render(
			<HarnessHost
				withSchema
				renderCount={renderCount}
				handleRef={handleRef}
			/>,
		);

		// video/webm is not in acceptedVideoTypes → schema rejects
		await handleRef.current?.addVideo(
			new File(["v"], "bad.webm", { type: "video/webm" }),
		);

		await vi.waitFor(() => {
			const item = handleRef.current?.items[0];
			expect(item).toBeDefined();
			expect(item?.errors).toBeDefined();
			expect(
				(item?.errors as Record<string, unknown> | undefined)?.file,
			).toBeDefined();
		});
	});

	it("Standard Schema 経由で maxVideos 超過 → rootErrors に実メッセージが反映される", async () => {
		const renderCount = { current: 0 };
		const handleRef: { current: Handle | null } = { current: null };
		await render(
			<HarnessHost
				withSchema
				maxVideos={1}
				initialVideos={[makeNewVideo()]}
				renderCount={renderCount}
				handleRef={handleRef}
			/>,
		);
		const ok =
			(await handleRef.current?.addVideo(
				new File(["v"], "second.mp4", { type: "video/mp4" }),
			)) ?? false;
		expect(ok).toBe(true);
		await vi.waitFor(() => {
			const rootErrors = handleRef.current?.rootErrors ?? [];
			expect(rootErrors.length).toBeGreaterThan(0);
			const messages = rootErrors.map(
				(e) => (e as { message?: string }).message,
			);
			expect(messages.some((m) => typeof m === "string" && m.length > 0)).toBe(
				true,
			);
		});
	});

	it("maxVideos で root レベル制御は core 側のガードで効く", async () => {
		const renderCount = { current: 0 };
		const handleRef: { current: Handle | null } = { current: null };
		await render(
			<HarnessHost
				coreMaxVideos={1}
				initialVideos={[makeNewVideo()]}
				renderCount={renderCount}
				handleRef={handleRef}
			/>,
		);
		const ok =
			(await handleRef.current?.addVideo(
				new File(["v"], "b.mp4", { type: "video/mp4" }),
			)) ?? true;
		expect(ok).toBe(false);
	});

	it("messages.maxVideos のカスタム文言がラッパー経由で onError に載ること", async () => {
		const onError = vi.fn();
		const renderCount = { current: 0 };
		const handleRef: { current: Handle | null } = { current: null };

		await render(
			<HarnessHost
				coreMaxVideos={1}
				initialVideos={[makeNewVideo()]}
				onError={onError}
				messages={{ maxVideos: (max: number) => `最大${max}本まで（custom）` }}
				renderCount={renderCount}
				handleRef={handleRef}
			/>,
		);

		await handleRef.current?.addVideo(
			new File(["v"], "b.mp4", { type: "video/mp4" }),
		);

		expect(onError).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "max_videos",
				message: "最大1本まで（custom）",
			}),
		);
	});

	describe("フォームレベル呼び出し", () => {
		it("<form.Field> の外で呼んでも追加・検証・dirty 追跡が成立する", async () => {
			const formRef: { current: any } = { current: null };
			const handleRef: {
				current: {
					items: Array<{ video: Video; errors: unknown }>;
					addVideo: (file: File) => Promise<boolean>;
				} | null;
			} = { current: null };

			function FormLevelHost() {
				const form = useForm({
					defaultValues: {
						videos: [],
						videosDeletedIds: [],
					} as TestForm,
					validators: {
						onChange: z.object({
							videos: createVideosSchema({
								acceptedVideoTypes: ["video/mp4"],
							}),
							videosDeletedIds: z.array(z.string()),
						}),
					},
				});
				formRef.current = form;

				const result = useMultiVideoController({
					form,
					name: "videos",
					deletedName: "videosDeletedIds",
				});
				handleRef.current = {
					items: result.items,
					addVideo: result.handlers.add,
				};

				return <div data-testid="harness">items:{result.items.length}</div>;
			}

			await render(<FormLevelHost />);

			await handleRef.current?.addVideo(
				new File(["v"], "bad.webm", { type: "video/webm" }),
			);

			await vi.waitFor(() => {
				expect(handleRef.current?.items).toHaveLength(1);
				expect(
					(handleRef.current?.items[0]?.errors as Record<string, unknown>)
						?.file,
				).toBeDefined();
			});

			const values = formRef.current?.state.values as TestForm | undefined;
			expect(values?.videos).toHaveLength(1);
			// field インスタンス未登録でも setFieldValue が fieldMeta を生成する
			expect(formRef.current?.state.isDirty).toBe(true);
		});
	});

	describe("deletedName デフォルト (DX-6)", () => {
		it("deletedName 省略時に既存動画を削除すると videosDeletedIds に id が書かれる", async () => {
			const existing = makeExistingVideo({ tempId: "temp_dx6" });
			const formRef: { current: any } = { current: null };
			const deleteRef: { current: (() => Promise<boolean>) | null } = {
				current: null,
			};

			function DefaultHost() {
				const form = useForm({
					defaultValues: {
						videos: [existing],
						videosDeletedIds: [],
					} as TestForm,
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
							return <div data-testid="harness">items:{p.items.length}</div>;
						}}
					/>
				);
			}

			await render(<DefaultHost />);
			expect(deleteRef.current).not.toBeNull();

			await deleteRef.current!();

			await vi.waitFor(() => {
				const values = formRef.current?.state.values as TestForm | undefined;
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

			const values = formRef.current?.state.values as TestForm | undefined;
			expect(values?.videos).toHaveLength(0);
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
