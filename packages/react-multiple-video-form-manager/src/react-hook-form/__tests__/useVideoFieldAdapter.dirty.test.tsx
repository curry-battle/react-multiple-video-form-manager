import type { ReactNode } from "react";
import { act } from "react";
import { type UseFormReturn, useForm } from "react-hook-form";
import { describe, expect, it } from "vitest";
import { renderHook } from "vitest-browser-react";
import { ThumbnailSource } from "../../core/types/Thumbnail";
import type { Video, VideoExisting, VideoNew } from "../../core/types/Video";
import { VideoFormStatus } from "../../core/types/VideoStatus";
import { useMultiVideoController } from "../useMultiVideoController";

type TestForm = { videos: Video[]; videosDeletedIds: string[] };
type EmptyForm = Record<string, never>;

describe("useRhfVideoFieldAdapter dirty 伝播", () => {
	it("handleRemoveThumbnail（replace 経由）で isDirty が true になる", async () => {
		const thumbnail = {
			source: ThumbnailSource.Upload,
			file: new File(["t"], "t.jpg", { type: "image/jpeg" }),
		};
		const initial: VideoNew = {
			tempId: "temp_dirty",
			status: VideoFormStatus.New,
			id: undefined,
			file: new File(["v"], "v.mp4", { type: "video/mp4" }),
			uploadRef: undefined,
			thumbnail,
		};

		const formRef: { current: UseFormReturn<TestForm> | null } = {
			current: null,
		};
		let isDirty = false;

		const wrapper = ({ children }: { children: ReactNode }) => {
			const form = useForm<TestForm>({
				defaultValues: { videos: [initial], videosDeletedIds: [] },
			});
			formRef.current = form;
			isDirty = form.formState.isDirty;
			return <>{children}</>;
		};

		const { result } = await renderHook(
			() => {
				const form = formRef.current;
				if (!form) throw new Error("form not initialized");
				return useMultiVideoController<"videos", "videosDeletedIds", TestForm>({
					form,
					name: "videos",
					deletedName: "videosDeletedIds",
				});
			},
			{ wrapper },
		);

		expect(isDirty).toBe(false);

		await act(async () => {
			await result.current.handlers.removeThumbnail("temp_dirty");
		});

		expect(isDirty).toBe(true);
	});

	it("handleDelete（既存動画削除）で isDirty が true になる", async () => {
		const existing: VideoExisting = {
			tempId: "temp_ex",
			status: VideoFormStatus.Existing,
			id: "id-existing",
			uploadedUrl: "https://s3.example.com/video.mp4",
			file: undefined,
			thumbnail: null,
			thumbnailRemoved: false,
		};

		const formRef: { current: UseFormReturn<TestForm> | null } = {
			current: null,
		};
		let isDirty = false;

		const wrapper = ({ children }: { children: ReactNode }) => {
			const form = useForm<TestForm>({
				defaultValues: { videos: [existing], videosDeletedIds: [] },
			});
			formRef.current = form;
			isDirty = form.formState.isDirty;
			return <>{children}</>;
		};

		const { result } = await renderHook(
			() => {
				const form = formRef.current;
				if (!form) throw new Error("form not initialized");
				return useMultiVideoController<"videos", "videosDeletedIds", TestForm>({
					form,
					name: "videos",
					deletedName: "videosDeletedIds",
				});
			},
			{ wrapper },
		);

		expect(isDirty).toBe(false);

		await act(async () => {
			await result.current.handlers.delete("temp_ex");
		});

		expect(isDirty).toBe(true);
		expect(result.current.raw.deletedVideoIds).toContain("id-existing");
	});
});

describe("useRhfVideoFieldAdapter || [] フォールバック", () => {
	it("defaultValues に videos / deletedIds を入れていないフォームで raw.videos が空配列になる", async () => {
		const formRef: { current: UseFormReturn<EmptyForm> | null } = {
			current: null,
		};

		const wrapper = ({ children }: { children: ReactNode }) => {
			const form = useForm<EmptyForm>({
				defaultValues: {},
			});
			formRef.current = form;
			return <>{children}</>;
		};

		const { result } = await renderHook(
			() => {
				const form = formRef.current;
				if (!form) throw new Error("form not initialized");
				return useMultiVideoController<"videos", "videosDeletedIds", TestForm>({
					// useWatch が undefined を返すケースを再現するため、
					// defaultValues に videos/videosDeletedIds を入れていない form を渡す
					form: form as unknown as UseFormReturn<TestForm>,
					name: "videos",
					deletedName: "videosDeletedIds",
				});
			},
			{ wrapper },
		);

		expect(result.current.raw.videos).toEqual([]);
		expect(result.current.raw.deletedVideoIds).toEqual([]);
	});
});
