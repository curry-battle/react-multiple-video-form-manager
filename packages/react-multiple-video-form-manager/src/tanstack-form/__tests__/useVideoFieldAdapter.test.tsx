import { useForm } from "@tanstack/react-form";
import React, { act, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { z } from "zod";
import type { MultiVideoError } from "../../core/types/MultiVideoError";
import { ThumbnailSource } from "../../core/types/Thumbnail";
import type { Video, VideoExisting, VideoNew } from "../../core/types/Video";
import type { CoreMessages } from "../../core/types/VideoSchemaTypes";
import { VideoFormStatus } from "../../core/types/VideoStatus";
import { createVideosSchema } from "../../schemas/zod";
import { MultiVideoController } from "../MultiVideoController";

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

type TestForm = { videos: Video[]; videosDeletedIds: string[] };

type Handle = {
	items: Array<{
		video: Video;
		errors: unknown;
		handlers: {
			delete: () => Promise<boolean>;
			removeThumbnail: () => Promise<boolean>;
		};
	}>;
	rootErrors: Array<unknown>;
	addVideo: (file: File) => Promise<boolean>;
};

function HarnessHost(props: {
	initialVideos?: Video[];
	withSchema?: boolean;
	maxVideos?: number;
	coreMaxVideos?: number;
	onError?: (error: MultiVideoError) => void;
	messages?: CoreMessages;
	validateCause?: "change" | "blur" | "submit";
	renderCount: { current: number };
	handleRef: { current: Handle | null };
	isDirtyRef: { current: boolean };
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

	props.isDirtyRef.current = form.state.isDirty;

	return (
		<MultiVideoController
			form={form}
			name="videos"
			deletedName="videosDeletedIds"
			maxVideos={props.coreMaxVideos}
			onError={props.onError}
			messages={props.messages}
			validateCause={props.validateCause}
			render={(p) => {
				props.renderCount.current += 1;
				props.handleRef.current = {
					items: p.items.map((item) => ({
						video: item.video,
						errors: item.errors,
						handlers: {
							delete: item.handlers.delete,
							removeThumbnail: item.handlers.removeThumbnail,
						},
					})),
					rootErrors: p.rootErrors,
					addVideo: p.addVideo,
				};
				return <div data-testid="harness">items:{p.items.length}</div>;
			}}
		/>
	);
}

describe("useTanstackVideoFieldAdapter 基本操作", () => {
	it("handleAdd で動画が追加される", async () => {
		const renderCount = { current: 0 };
		const handleRef: { current: Handle | null } = { current: null };
		const isDirtyRef = { current: false };

		await render(
			<HarnessHost
				renderCount={renderCount}
				handleRef={handleRef}
				isDirtyRef={isDirtyRef}
			/>,
		);

		expect(isDirtyRef.current).toBe(false);

		await act(async () => {
			await handleRef.current?.addVideo(
				new File(["v"], "a.mp4", { type: "video/mp4" }),
			);
		});

		expect(handleRef.current?.items).toHaveLength(1);
	});

	it("handleDelete（既存動画）で動画が除去される", async () => {
		const existing = makeExistingVideo({ tempId: "temp_ex" });
		const renderCount = { current: 0 };
		const handleRef: { current: Handle | null } = { current: null };
		const isDirtyRef = { current: false };

		await render(
			<HarnessHost
				initialVideos={[existing]}
				renderCount={renderCount}
				handleRef={handleRef}
				isDirtyRef={isDirtyRef}
			/>,
		);

		expect(handleRef.current?.items).toHaveLength(1);

		await act(async () => {
			await handleRef.current?.items[0]?.handlers.delete();
		});

		expect(handleRef.current?.items).toHaveLength(0);
	});

	it("handleRemoveThumbnail で thumbnail が null になる", async () => {
		const thumbnail = {
			source: ThumbnailSource.Upload,
			file: new File(["t"], "t.jpg", { type: "image/jpeg" }),
		};
		const v = makeNewVideo({ tempId: "temp_rt", thumbnail });
		const renderCount = { current: 0 };
		const handleRef: { current: Handle | null } = { current: null };
		const isDirtyRef = { current: false };

		await render(
			<HarnessHost
				initialVideos={[v]}
				renderCount={renderCount}
				handleRef={handleRef}
				isDirtyRef={isDirtyRef}
			/>,
		);

		expect(handleRef.current?.items[0]?.video.thumbnail).not.toBeNull();

		await act(async () => {
			await handleRef.current?.items[0]?.handlers.removeThumbnail();
		});

		expect(handleRef.current?.items[0]?.video.thumbnail).toBeNull();
	});
});

describe("ネストパス制約", () => {
	class ErrorBoundary extends React.Component<
		{ children: ReactNode; onError: (e: Error) => void },
		{ error: Error | null }
	> {
		state = { error: null as Error | null };
		static getDerivedStateFromError(error: Error) {
			return { error };
		}
		componentDidCatch(error: Error) {
			this.props.onError(error);
		}
		render() {
			if (this.state.error) return null;
			return this.props.children;
		}
	}

	function NestedHost(props: { name: string; deletedName: string }) {
		const form = useForm({
			defaultValues: {
				videos: [] as Video[],
				videosDeletedIds: [] as string[],
				media: { deletedIds: [] as string[] },
			},
		});
		return (
			<MultiVideoController
				form={form as any}
				name={props.name as "videos"}
				deletedName={props.deletedName as "videosDeletedIds"}
				render={() => <div>ok</div>}
			/>
		);
	}

	it.each([
		["deletedName", "videos", "media.deletedIds"],
		["deletedName", "videos", "media[0]"],
		["name", "media.videos", "videosDeletedIds"],
		["name", "videos[0]", "videosDeletedIds"],
	])(
		"%s に %s / %s のネストパスを渡すと throw する",
		async (label, name, deletedName) => {
			const errorSpy = vi.fn();
			// React ErrorBoundary でキャッチされるため、console.error を抑制
			const consoleSpy = vi
				.spyOn(console, "error")
				.mockImplementation(() => {});

			await render(
				<ErrorBoundary onError={errorSpy}>
					<NestedHost name={name} deletedName={deletedName} />
				</ErrorBoundary>,
			);

			const offending = label === "name" ? name : deletedName;
			expect(errorSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					message: expect.stringContaining(
						`${label} must be a top-level key (got "${offending}")`,
					),
				}),
			);

			consoleSpy.mockRestore();
		},
	);
});

describe("validateCause", () => {
	it("validateCause='change' (デフォルト) でバリデーションが onChange で発火する", async () => {
		const renderCount = { current: 0 };
		const handleRef: { current: Handle | null } = { current: null };
		const isDirtyRef = { current: false };

		await render(
			<HarnessHost
				withSchema
				renderCount={renderCount}
				handleRef={handleRef}
				isDirtyRef={isDirtyRef}
			/>,
		);

		await act(async () => {
			await handleRef.current?.addVideo(
				new File(["v"], "bad.webm", { type: "video/webm" }),
			);
		});

		const item = handleRef.current?.items[0];
		expect(item?.errors).toBeDefined();
	});

	it("validateCause prop がコントローラに受け渡される", async () => {
		const renderCount = { current: 0 };
		const handleRef: { current: Handle | null } = { current: null };
		const isDirtyRef = { current: false };

		await render(
			<HarnessHost
				withSchema
				validateCause="submit"
				renderCount={renderCount}
				handleRef={handleRef}
				isDirtyRef={isDirtyRef}
			/>,
		);

		await act(async () => {
			await handleRef.current?.addVideo(
				new File(["v"], "good.mp4", { type: "video/mp4" }),
			);
		});

		expect(handleRef.current?.items).toHaveLength(1);
	});
});
