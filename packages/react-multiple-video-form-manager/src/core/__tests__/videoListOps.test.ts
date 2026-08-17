import { describe, expect, it } from "vitest";
import { ThumbnailSource } from "../types/Thumbnail";
import type { VideoExisting, VideoNew } from "../types/Video";
import { VideoFormStatus } from "../types/VideoStatus";
import * as ops from "../videoListOps";

// --- Helpers ---

const makeNewVideo = (overrides?: Partial<VideoNew>): VideoNew => ({
	tempId: `temp_new-${Math.random().toString(36).slice(2, 8)}`,
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
	tempId: `temp_existing-${Math.random().toString(36).slice(2, 8)}`,
	status: VideoFormStatus.Existing,
	id: `id-${Math.random().toString(36).slice(2, 8)}`,
	uploadedUrl: "https://s3.example.com/video.mp4",
	file: undefined,
	thumbnail: null,
	thumbnailRemoved: false,
	...overrides,
});

// --- Tests ---

describe("videoListOps", () => {
	describe("addVideo", () => {
		it("空配列に追加", () => {
			const file = new File(["v"], "a.mp4", { type: "video/mp4" });
			const result = ops.addVideo([], file);
			expect(result.added).toBe(true);
			expect(result.videos).toHaveLength(1);
			expect(result.videos[0].status).toBe(VideoFormStatus.New);
		});

		it("既存配列の末尾に追加", () => {
			const existing = makeNewVideo({ tempId: "v1" });
			const file = new File(["v"], "b.mp4", { type: "video/mp4" });
			const result = ops.addVideo([existing], file);
			expect(result.added).toBe(true);
			expect(result.videos).toHaveLength(2);
			expect(result.videos[0].tempId).toBe("v1");
			expect(result.videos[1].status).toBe(VideoFormStatus.New);
		});

		it("uploadRef 付きで追加できること", () => {
			const file = new File(["v"], "a.mp4", { type: "video/mp4" });
			const result = ops.addVideo(
				[],
				file,
				undefined,
				"https://s3.example.com/a.mp4",
			);
			expect(result.added).toBe(true);
			expect((result.videos[0] as VideoNew).uploadRef).toBe(
				"https://s3.example.com/a.mp4",
			);
		});

		it("uploadRef 未指定時は uploadRef が設定されないこと", () => {
			const file = new File(["v"], "a.mp4", { type: "video/mp4" });
			const result = ops.addVideo([], file);
			expect((result.videos[0] as VideoNew).uploadRef).toBeUndefined();
		});

		it("maxVideos 超過で不変 + added:false", () => {
			const file = new File(["v"], "c.mp4", { type: "video/mp4" });
			const existing = [makeNewVideo()];
			const result = ops.addVideo(existing, file, 1);
			expect(result.added).toBe(false);
			expect(result.videos).toStrictEqual(existing);
		});

		it("入力配列を変更しない", () => {
			const original = [makeNewVideo()];
			const snapshot = [...original];
			ops.addVideo(original, new File(["v"], "e.mp4", { type: "video/mp4" }));
			expect(original).toEqual(snapshot);
		});
	});

	describe("changeFile", () => {
		it("Existing → 元位置に New、deletedId を返す", () => {
			const ex = makeExistingVideo({ tempId: "temp_ex" });
			const file = new File(["v"], "new.mp4", { type: "video/mp4" });
			const result = ops.changeFile([ex], "temp_ex", file);
			expect(result.changed).toBe(true);
			expect(result.deletedId).toBe(ex.id);
			expect(result.videos).toHaveLength(1);
			expect(result.videos[0].status).toBe(VideoFormStatus.New);
		});

		it("New → 同位置差し替え", () => {
			const nv = makeNewVideo({ tempId: "temp_n" });
			const file = new File(["v"], "n2.mp4", { type: "video/mp4" });
			const result = ops.changeFile([nv], "temp_n", file);
			expect(result.changed).toBe(true);
			expect(result.deletedId).toBeNull();
			expect(result.videos).toHaveLength(1);
			expect((result.videos[0] as VideoNew).file.name).toBe("n2.mp4");
		});

		it("不明 tempId は no-op", () => {
			const nv = makeNewVideo();
			const file = new File(["v"], "x.mp4", { type: "video/mp4" });
			const result = ops.changeFile([nv], "unknown", file);
			expect(result.changed).toBe(false);
			expect(result.deletedId).toBeNull();
		});

		it("Existing → New 差し替え時に uploadRef が保持されること", () => {
			const ex = makeExistingVideo({ tempId: "temp_ex" });
			const file = new File(["v"], "new.mp4", { type: "video/mp4" });
			const result = ops.changeFile(
				[ex],
				"temp_ex",
				file,
				"https://s3.example.com/new.mp4",
			);
			expect(result.changed).toBe(true);
			expect((result.videos[0] as VideoNew).uploadRef).toBe(
				"https://s3.example.com/new.mp4",
			);
		});

		it("New → New 差し替え時に uploadRef が保持されること", () => {
			const nv = makeNewVideo({ tempId: "temp_n" });
			const file = new File(["v"], "n2.mp4", { type: "video/mp4" });
			const result = ops.changeFile(
				[nv],
				"temp_n",
				file,
				"https://s3.example.com/n2.mp4",
			);
			expect(result.changed).toBe(true);
			expect((result.videos[0] as VideoNew).uploadRef).toBe(
				"https://s3.example.com/n2.mp4",
			);
		});
	});

	describe("deleteVideo", () => {
		it("Existing → 配列から除去、deletedId を返す", () => {
			const nv = makeNewVideo({ tempId: "n1" });
			const ex = makeExistingVideo({ tempId: "temp_ex" });
			const result = ops.deleteVideo([ex, nv], "temp_ex");
			expect(result.deleted).toBe(true);
			expect(result.deletedId).toBe(ex.id);
			expect(result.videos).toHaveLength(1);
			expect(result.videos[0].tempId).toBe("n1");
		});

		it("New → 配列から除去", () => {
			const nv = makeNewVideo({ tempId: "temp_n" });
			const result = ops.deleteVideo([nv], "temp_n");
			expect(result.deleted).toBe(true);
			expect(result.deletedId).toBeNull();
			expect(result.videos).toHaveLength(0);
		});

		it("不明 tempId は no-op", () => {
			const nv = makeNewVideo();
			const result = ops.deleteVideo([nv], "unknown");
			expect(result.deleted).toBe(false);
			expect(result.deletedId).toBeNull();
		});
	});

	describe("moveUp", () => {
		it("先頭要素は moved:false", () => {
			const a = makeNewVideo({ tempId: "a" });
			const b = makeNewVideo({ tempId: "b" });
			const result = ops.moveUp([a, b], "a");
			expect(result.moved).toBe(false);
		});

		it("正常に上へ移動", () => {
			const a = makeNewVideo({ tempId: "a" });
			const b = makeNewVideo({ tempId: "b" });
			const result = ops.moveUp([a, b], "b");
			expect(result.moved).toBe(true);
			expect(result.videos[0].tempId).toBe("b");
			expect(result.videos[1].tempId).toBe("a");
		});

		it("不明 tempId では moved:false", () => {
			const a = makeNewVideo({ tempId: "a" });
			const result = ops.moveUp([a], "unknown");
			expect(result.moved).toBe(false);
		});
	});

	describe("moveDown", () => {
		it("末尾要素は moved:false", () => {
			const a = makeNewVideo({ tempId: "a" });
			const b = makeNewVideo({ tempId: "b" });
			const result = ops.moveDown([a, b], "b");
			expect(result.moved).toBe(false);
		});

		it("正常に下へ移動", () => {
			const a = makeNewVideo({ tempId: "a" });
			const b = makeNewVideo({ tempId: "b" });
			const result = ops.moveDown([a, b], "a");
			expect(result.moved).toBe(true);
			expect(result.videos[0].tempId).toBe("b");
			expect(result.videos[1].tempId).toBe("a");
		});

		it("不明 tempId では moved:false", () => {
			const a = makeNewVideo({ tempId: "a" });
			const result = ops.moveDown([a], "unknown");
			expect(result.moved).toBe(false);
		});
	});

	describe("moveTo", () => {
		it("任意位置へ移動", () => {
			const a = makeNewVideo({ tempId: "a" });
			const b = makeNewVideo({ tempId: "b" });
			const c = makeNewVideo({ tempId: "c" });
			const result = ops.moveTo([a, b, c], "c", 0);
			expect(result.moved).toBe(true);
			expect(result.videos.map((v) => v.tempId)).toEqual(["c", "a", "b"]);
		});

		it("同一位置は moved:false", () => {
			const a = makeNewVideo({ tempId: "a" });
			const b = makeNewVideo({ tempId: "b" });
			const result = ops.moveTo([a, b], "a", 0);
			expect(result.moved).toBe(false);
		});

		it("toIndex が範囲外なら clamp される", () => {
			const a = makeNewVideo({ tempId: "a" });
			const b = makeNewVideo({ tempId: "b" });
			const c = makeNewVideo({ tempId: "c" });
			const result = ops.moveTo([a, b, c], "a", 100);
			expect(result.moved).toBe(true);
			expect(result.videos.map((v) => v.tempId)).toEqual(["b", "c", "a"]);
		});

		it("負の toIndex は 0 に clamp", () => {
			const a = makeNewVideo({ tempId: "a" });
			const b = makeNewVideo({ tempId: "b" });
			const result = ops.moveTo([a, b], "b", -5);
			expect(result.moved).toBe(true);
			expect(result.videos.map((v) => v.tempId)).toEqual(["b", "a"]);
		});

		it("不明 tempId は moved:false", () => {
			const a = makeNewVideo({ tempId: "a" });
			const result = ops.moveTo([a], "unknown", 0);
			expect(result.moved).toBe(false);
		});
	});

	describe("setThumbnail", () => {
		it("New 動画にサムネイルを設定", () => {
			const nv = makeNewVideo({ tempId: "temp_n" });
			const thumb = {
				source: ThumbnailSource.Upload,
				file: new File(["t"], "t.jpg", { type: "image/jpeg" }),
			};
			const result = ops.setThumbnail([nv], "temp_n", thumb);
			expect(result.updated).toBe(true);
			expect((result.videos[0] as VideoNew).thumbnail).toBe(thumb);
		});

		it("New 動画のサムネイルを null に", () => {
			const thumb = {
				source: ThumbnailSource.Upload,
				file: new File(["t"], "t.jpg", { type: "image/jpeg" }),
			};
			const nv = makeNewVideo({ tempId: "temp_n", thumbnail: thumb });
			const result = ops.setThumbnail([nv], "temp_n", null);
			expect(result.updated).toBe(true);
			expect((result.videos[0] as VideoNew).thumbnail).toBeNull();
		});

		it("Existing 動画にサムネイルを設定", () => {
			const ex = makeExistingVideo({ tempId: "temp_ex" });
			const thumb = {
				source: ThumbnailSource.Upload,
				file: new File(["t"], "t.jpg", { type: "image/jpeg" }),
			};
			const result = ops.setThumbnail([ex], "temp_ex", thumb);
			expect(result.updated).toBe(true);
			expect((result.videos[0] as VideoExisting).thumbnail).toBe(thumb);
		});

		it("不明 tempId は updated:false", () => {
			const nv = makeNewVideo();
			const result = ops.setThumbnail([nv], "unknown", null);
			expect(result.updated).toBe(false);
		});
	});
});
