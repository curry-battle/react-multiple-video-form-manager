import { describe, expect, it } from "vitest";
import { buildSubmitPayload } from "../submitPayload";
import { ThumbnailSource } from "../types/Thumbnail";
import type { VideoExisting, VideoNew } from "../types/Video";
import { VideoFormStatus } from "../types/VideoStatus";

const makeNewVideo = (overrides?: Partial<VideoNew>): VideoNew => ({
	tempId: "temp_new",
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
	tempId: "temp_existing",
	status: VideoFormStatus.Existing,
	id: "id-1",
	uploadedUrl: "https://s3.example.com/video.mp4",
	file: undefined,
	thumbnail: null,
	thumbnailRemoved: false,
	...overrides,
});

describe("buildSubmitPayload", () => {
	it("新規項目は転送参照を持てばそれを、無ければ File を運ぶ", () => {
		const uploaded = makeNewVideo({
			tempId: "temp_uploaded",
			uploadRef: "ref-1",
		});
		const local = makeNewVideo({ tempId: "temp_local" });

		const { videos } = buildSubmitPayload([uploaded, local], []);

		expect(videos).toEqual([
			{ status: VideoFormStatus.New, uploadRef: "ref-1", thumbnail: null },
			{
				status: VideoFormStatus.New,
				file: local.file,
				tempId: "temp_local",
				thumbnail: null,
			},
		]);
	});

	it("既存項目は id とサムネイル変更だけを運ぶ", () => {
		const existing = makeExistingVideo({
			thumbnail: {
				source: ThumbnailSource.Existing,
				uploadedUrl: "https://s3.example.com/thumb.jpg",
			},
		});

		const { videos } = buildSubmitPayload([existing], []);

		expect(videos).toEqual([
			{
				status: VideoFormStatus.Existing,
				id: "id-1",
				thumbnail: {
					status: "unchanged",
					uploadedUrl: "https://s3.example.com/thumb.jpg",
				},
			},
		]);
	});

	it("フレームキャプチャのサムネイルは blob から File を導出して運ぶ", () => {
		const blob = new Blob(["thumb"], { type: "image/jpeg" });
		const video = makeNewVideo({
			uploadRef: "ref-1",
			thumbnail: { source: ThumbnailSource.Frame, blob, timestamp: 1.5 },
		});

		const { videos } = buildSubmitPayload([video], []);

		const thumbnail = videos[0].thumbnail;
		expect(thumbnail?.status).toBe("new");
		if (thumbnail !== null && "file" in thumbnail) {
			expect(thumbnail.file.name).toBe("thumbnail.jpg");
			expect(thumbnail.file.type).toBe("image/jpeg");
		} else {
			expect.unreachable("フレームキャプチャは File を運ぶ");
		}
	});

	it("サムネイル明示削除は removed で運ぶ", () => {
		const existing = makeExistingVideo({
			thumbnail: null,
			thumbnailRemoved: true,
		});

		const { videos } = buildSubmitPayload([existing], []);

		expect(videos[0].thumbnail).toEqual({ status: "removed" });
	});

	it("表示順は配列の順序で表し order は持たない", () => {
		const a = makeNewVideo({ tempId: "temp_a", uploadRef: "ref-a" });
		const b = makeNewVideo({ tempId: "temp_b", uploadRef: "ref-b" });

		const { videos } = buildSubmitPayload([a, b], []);

		expect(videos.map((v) => ("uploadRef" in v ? v.uploadRef : null))).toEqual([
			"ref-a",
			"ref-b",
		]);
		expect(videos[0]).not.toHaveProperty("order");
		expect(videos[0]).not.toHaveProperty("tempId");
	});

	it("deletedVideoIds をコピーして返す", () => {
		const source = ["id-a", "id-b"];
		const { deletedIds } = buildSubmitPayload([], source);

		expect(deletedIds).toEqual(["id-a", "id-b"]);
		expect(deletedIds).not.toBe(source);
	});

	it("excluded に入れた tempId は素材から外す", () => {
		const a = makeNewVideo({ tempId: "temp_a", uploadRef: "ref-a" });
		const b = makeNewVideo({ tempId: "temp_b" });

		const { videos } = buildSubmitPayload([a, b], [], new Set(["temp_b"]));

		expect(videos).toHaveLength(1);
		expect(videos[0]).toEqual({
			status: VideoFormStatus.New,
			uploadRef: "ref-a",
			thumbnail: null,
		});
	});
});
