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
			const newVideo = makeNewVideo({ tempId: "temp_added" });
			const result = ops.addVideo([], newVideo);
			expect(result.videos).toStrictEqual([newVideo]);
		});

		it("既存配列の末尾に追加", () => {
			const existing = makeNewVideo({ tempId: "v1" });
			const newVideo = makeNewVideo({ tempId: "v2" });
			const result = ops.addVideo([existing], newVideo);
			expect(result.videos).toHaveLength(2);
			expect(result.videos[0].tempId).toBe("v1");
			expect(result.videos[1]).toBe(newVideo);
		});

		it("入力配列を変更しない", () => {
			const original = [makeNewVideo()];
			const snapshot = [...original];
			ops.addVideo(original, makeNewVideo());
			expect(original).toEqual(snapshot);
		});
	});

	describe("changeFile", () => {
		it("Existing → 元位置に New、deletedId を返す", () => {
			const ex = makeExistingVideo({ tempId: "temp_ex" });
			const file = new File(["v"], "new.mp4", { type: "video/mp4" });
			const result = ops.changeFile([ex], "temp_ex", file);
			expect(result.deletedId).toBe(ex.id);
			expect(result.videos).toHaveLength(1);
			expect(result.videos[0].status).toBe(VideoFormStatus.New);
			expect(result.video).toBe(result.videos[0]);
		});

		it("Existing → New で tempId が引き継がれる", () => {
			const ex = makeExistingVideo({ tempId: "temp_ex" });
			const file = new File(["v"], "new.mp4", { type: "video/mp4" });
			const result = ops.changeFile([ex], "temp_ex", file);
			expect(result.videos[0].tempId).toBe("temp_ex");
		});

		it("New → 同位置差し替え", () => {
			const nv = makeNewVideo({ tempId: "temp_n" });
			const file = new File(["v"], "n2.mp4", { type: "video/mp4" });
			const result = ops.changeFile([nv], "temp_n", file);
			expect(result.deletedId).toBeNull();
			expect(result.videos).toHaveLength(1);
			expect((result.videos[0] as VideoNew).file.name).toBe("n2.mp4");
			expect(result.video).toBe(result.videos[0]);
		});

		it("差し替え後の項目は転送参照を持たない", () => {
			const nv = makeNewVideo({
				tempId: "temp_n",
				uploadRef: "ref-before",
			});
			const file = new File(["v"], "n2.mp4", { type: "video/mp4" });
			const result = ops.changeFile([nv], "temp_n", file);
			expect(result.video?.uploadRef).toBeUndefined();
		});

		it("不明 tempId は no-op", () => {
			const nv = makeNewVideo();
			const file = new File(["v"], "x.mp4", { type: "video/mp4" });
			const result = ops.changeFile([nv], "unknown", file);
			expect(result.video).toBeNull();
			expect(result.deletedId).toBeNull();
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
			expect(result.video).toBe(result.videos[0]);
			expect((result.videos[0] as VideoNew).thumbnail).toBe(thumb);
		});

		it("New 動画のサムネイルを null に", () => {
			const thumb = {
				source: ThumbnailSource.Upload,
				file: new File(["t"], "t.jpg", { type: "image/jpeg" }),
			};
			const nv = makeNewVideo({ tempId: "temp_n", thumbnail: thumb });
			const result = ops.setThumbnail([nv], "temp_n", null);
			expect(result.video).toBe(result.videos[0]);
			expect((result.videos[0] as VideoNew).thumbnail).toBeNull();
		});

		it("Existing 動画にサムネイルを設定", () => {
			const ex = makeExistingVideo({ tempId: "temp_ex" });
			const thumb = {
				source: ThumbnailSource.Upload,
				file: new File(["t"], "t.jpg", { type: "image/jpeg" }),
			};
			const result = ops.setThumbnail([ex], "temp_ex", thumb);
			expect(result.video).toBe(result.videos[0]);
			expect((result.videos[0] as VideoExisting).thumbnail).toBe(thumb);
		});

		it("不明 tempId は video:null", () => {
			const nv = makeNewVideo();
			const result = ops.setThumbnail([nv], "unknown", null);
			expect(result.video).toBeNull();
		});
	});
});
