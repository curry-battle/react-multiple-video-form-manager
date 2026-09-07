import { FormApi } from "@tanstack/form-core";
import { describe, expect, it } from "vitest";
import z from "zod";
import { ThumbnailSource } from "../../core/types/Thumbnail";
import type { Video } from "../../core/types/Video";
import { createVideosSchema } from "../../schemas/zod";
import { normalizeTanstackErrors } from "../normalizeTanstackErrors";

/**
 * Contract test: TanStack Form の実 validate → errorMap → normalizeTanstackErrors → VideosError
 * を通しで検証し、TanStack 側の形式変更を CI で検知する。
 */

const videosSchema = createVideosSchema({
	acceptedVideoTypes: ["video/mp4"],
	maxVideos: 2,
});

const formSchema = z.object({
	videos: videosSchema,
});

function makeVideo(tempId: string, file: File): Video {
	return {
		tempId,
		status: "new",
		id: undefined,
		file,
		uploadRef: undefined,
		thumbnail: null,
	};
}

function createForm(videos: unknown[]) {
	const form = new FormApi({ defaultValues: { videos } }) as any;
	form.mount();
	return form;
}

function parseAndNormalize(videos: Video[]) {
	const form = createForm(videos);
	const result = form.parseValuesWithSchema(formSchema);
	if (!result) {
		return normalizeTanstackErrors({
			errorMap: null,
			metaErrors: [],
			fieldName: "videos",
			videos,
		});
	}

	const errorMap = { onChange: result.fields };
	return normalizeTanstackErrors({
		errorMap,
		metaErrors: [],
		fieldName: "videos",
		videos,
	});
}

describe("normalizeTanstackErrors contract test", () => {
	it("valid な入力ではエラーなし", () => {
		const videos = [
			makeVideo("t1", new File(["x"], "v.mp4", { type: "video/mp4" })),
		];
		const r = parseAndNormalize(videos);
		expect(Object.keys(r.items)).toHaveLength(0);
		expect(r.root).toHaveLength(0);
	});

	it("per-item file エラーが items[tempId].file に配置される（root には落ちない）", () => {
		const videos = [
			makeVideo("t1", new File(["x"], "v.txt", { type: "text/plain" })),
		];
		const r = parseAndNormalize(videos);

		expect(r.items.t1?.file?.message).toBeDefined();
		expect(r.root).toHaveLength(0);
	});

	it("thumbnailRemoved のスキーマエラーが items[tempId].thumbnailRemoved に届く", () => {
		const videos = [
			{
				tempId: "t1",
				status: "existing",
				id: "vid-1",
				file: undefined,
				uploadedUrl: "https://s3.example.com/video.mp4",
				thumbnail: null,
				thumbnailRemoved: "yes",
			} as unknown as Video,
		];
		const r = parseAndNormalize(videos);

		expect(r.items.t1?.thumbnailRemoved?.message).toBeDefined();
		expect(r.root).toHaveLength(0);
	});

	it("replacesId のスキーマエラーが items[tempId].replacesId に届く", () => {
		const videos = [
			{
				...makeVideo("t1", new File(["x"], "v.mp4", { type: "video/mp4" })),
				replacesId: 42,
			} as unknown as Video,
		];
		const r = parseAndNormalize(videos);

		expect(r.items.t1?.replacesId?.message).toBeDefined();
		expect(r.root).toHaveLength(0);
	});

	it("uploadRef のスキーマエラーが items[tempId].uploadRef に届く", () => {
		const videos = [
			{
				...makeVideo("t1", new File(["x"], "v.mp4", { type: "video/mp4" })),
				uploadRef: 42,
			} as unknown as Video,
		];
		const r = parseAndNormalize(videos);

		expect(r.items.t1?.uploadRef?.message).toBeDefined();
		expect(r.root).toHaveLength(0);
	});

	it("maxVideos 超過エラーが root に現れ items は空", () => {
		const mk = (i: number) =>
			makeVideo(`t${i}`, new File(["x"], `v${i}.mp4`, { type: "video/mp4" }));
		const videos = [mk(1), mk(2), mk(3)];
		const r = parseAndNormalize(videos);

		expect(r.root.length).toBeGreaterThan(0);
		expect(Object.keys(r.items)).toHaveLength(0);
	});

	it("thumbnail の入れ子エラーは items[tempId].thumbnail に届き、残りのパスは source に残る", () => {
		const videos: Video[] = [
			{
				tempId: "t1",
				status: "new",
				id: undefined,
				file: new File(["x"], "v.mp4", { type: "video/mp4" }),
				uploadRef: undefined,
				thumbnail: {
					source: ThumbnailSource.Upload,
					file: "not-a-file",
				} as any,
			},
		];
		const r = parseAndNormalize(videos);

		expect(r.items.t1?.thumbnail?.message).toBeDefined();
		expect(r.items.t1?.thumbnail?.source).toBeDefined();
		expect(r.root).toHaveLength(0);
	});

	it("errorMap の field キーが bracket 記法であること（最低1キー存在を保証）", () => {
		const videos = [
			makeVideo("t1", new File(["x"], "v.txt", { type: "text/plain" })),
		];
		const form = createForm(videos);
		const result = form.parseValuesWithSchema(formSchema);
		expect(result).toBeDefined();

		const fieldKeys = Object.keys(result.fields as Record<string, unknown>);
		const videoKeys = fieldKeys.filter(
			(k: string) => k.startsWith("videos") && k !== "videos",
		);

		expect(videoKeys.length).toBeGreaterThan(0);

		for (const key of videoKeys) {
			expect(key).not.toMatch(/^videos\.\d+/);
			expect(key).toMatch(/^videos\[\d+\]/);
		}
	});

	it("metaErrors と errorMap に同一 maxVideos エラーが重複する場合 dedup される", async () => {
		const { FieldApi } = await import("@tanstack/form-core");
		const mk = (i: number) =>
			makeVideo(`t${i}`, new File(["x"], `v${i}.mp4`, { type: "video/mp4" }));
		const videos = [mk(1), mk(2), mk(3)];

		const form: any = new FormApi({
			defaultValues: { videos },
			validators: { onChange: formSchema },
		} as any);
		form.mount();

		const field: any = new FieldApi({ form, name: "videos" } as any);
		field.mount();

		await form.validate("change");

		const metaErrors = field.state.meta.errors ?? [];
		const errorMap = form.state.errorMap;

		const r = normalizeTanstackErrors({
			errorMap,
			metaErrors,
			fieldName: "videos",
			videos,
		});

		const maxVidMessages = r.root.filter(
			(e) => e.message === "動画は最大2件までです。",
		);
		expect(maxVidMessages).toHaveLength(1);
	});
});
