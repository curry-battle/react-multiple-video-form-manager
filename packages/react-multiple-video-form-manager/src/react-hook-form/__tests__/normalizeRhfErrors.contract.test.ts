import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { describe, expect, it } from "vitest";
import z from "zod";
import type { Video } from "../../core/types/Video";
import { createVideosSchema } from "../../schemas/zod";
import { normalizeRhfErrors } from "../normalizeRhfErrors";
import type { RhfVideosError } from "../types";

/**
 * Contract test: 実 standardSchemaResolver の validate → RHF FieldErrors → normalizeRhfErrors → VideosError
 * を通しで検証し、RHF resolver の出力形状変更を CI で検知する。
 */

const videosSchema = createVideosSchema({
	acceptedVideoTypes: ["video/mp4"],
	maxVideos: 2,
});

const formSchema = z.object({
	videos: videosSchema,
	videosDeletedIds: z.array(z.string()),
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

function makeExistingVideo(
	tempId: string,
	overrides?: Partial<Record<string, unknown>>,
): Video {
	return {
		tempId,
		status: "existing",
		id: "vid-1",
		file: undefined,
		uploadedUrl: "https://s3.example.com/video.mp4",
		thumbnail: null,
		thumbnailRemoved: false,
		...overrides,
	} as Video;
}

async function resolveAndNormalize(videos: Video[]) {
	const resolver = standardSchemaResolver(formSchema);
	const values = { videos, videosDeletedIds: [] };
	const result = await resolver(values, undefined as any, {
		fields: {},
		shouldUseNativeValidation: false,
	});

	const rhfErrors = result.errors.videos as RhfVideosError;
	return normalizeRhfErrors(rhfErrors, videos);
}

describe("normalizeRhfErrors contract test", () => {
	it("valid な入力ではエラーなし", async () => {
		const videos = [
			makeVideo("t1", new File(["x"], "v.mp4", { type: "video/mp4" })),
		];
		const r = await resolveAndNormalize(videos);
		expect(Object.keys(r.items)).toHaveLength(0);
		expect(r.root).toHaveLength(0);
	});

	it("per-item file エラーが items[tempId].file に配置される", async () => {
		const videos = [
			makeVideo("t1", new File(["x"], "v.txt", { type: "text/plain" })),
		];
		const r = await resolveAndNormalize(videos);

		expect(r.items.t1?.file?.message).toBeDefined();
		expect(r.root).toHaveLength(0);
	});

	it("maxVideos 超過エラーが root に現れる", async () => {
		const mk = (i: number) =>
			makeVideo(`t${i}`, new File(["x"], `v${i}.mp4`, { type: "video/mp4" }));
		const videos = [mk(1), mk(2), mk(3)];
		const r = await resolveAndNormalize(videos);

		expect(r.root.length).toBeGreaterThan(0);
	});

	it("thumbnailRemoved のスキーマエラーが items[tempId].thumbnailRemoved に届く", async () => {
		const videos = [makeExistingVideo("t1", { thumbnailRemoved: "yes" })];
		const r = await resolveAndNormalize(videos);

		expect(r.items.t1?.thumbnailRemoved?.message).toBeDefined();
		expect(r.root).toHaveLength(0);
	});

	it("replacesId のスキーマエラーが items[tempId].replacesId に届く", async () => {
		const videos = [
			{
				...makeVideo("t1", new File(["x"], "v.mp4", { type: "video/mp4" })),
				replacesId: 42,
			} as unknown as Video,
		];
		const r = await resolveAndNormalize(videos);

		expect(r.items.t1?.replacesId?.message).toBeDefined();
		expect(r.root).toHaveLength(0);
	});

	it("uploadRef のスキーマエラーが items[tempId].uploadRef に届く", async () => {
		const videos = [
			{
				...makeVideo("t1", new File(["x"], "v.mp4", { type: "video/mp4" })),
				uploadRef: 42,
			} as unknown as Video,
		];
		const r = await resolveAndNormalize(videos);

		expect(r.items.t1?.uploadRef?.message).toBeDefined();
		expect(r.root).toHaveLength(0);
	});

	it("複数 item のうちエラーありのみ items に入り、正常な item は含まれない", async () => {
		const videos = [
			makeVideo("t1", new File(["x"], "v.mp4", { type: "video/mp4" })),
			makeVideo("t2", new File(["x"], "v.txt", { type: "text/plain" })),
		];
		const r = await resolveAndNormalize(videos);

		expect(r.items.t1).toBeUndefined();
		expect(r.items.t2?.file?.message).toBeDefined();
	});
});
