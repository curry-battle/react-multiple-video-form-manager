import { describe, expect, it } from "vitest";
import type { Video } from "../../core/types/Video";
import { normalizeRhfErrors } from "../normalizeRhfErrors";
import type { RhfVideosError } from "../types";

function makeVideo(tempId: string): Video {
	return {
		tempId,
		status: "new",
		id: undefined,
		file: new File(["x"], "v.mp4", { type: "video/mp4" }),
		uploadRef: undefined,
		thumbnail: null,
	};
}

describe("normalizeRhfErrors", () => {
	it("undefined → 空構造", () => {
		expect(normalizeRhfErrors(undefined, [])).toEqual({
			items: {},
			root: [],
		});
	});

	it("空配列 → items 空, root 空", () => {
		const empty = [] as unknown as RhfVideosError;
		expect(normalizeRhfErrors(empty, [])).toEqual({ items: {}, root: [] });
	});

	it("per-item の file.message を items[tempId].file.message に転送する", () => {
		const videos = [makeVideo("t1")];
		const input = [
			{ file: { message: "invalid type", type: "custom" } },
		] as unknown as RhfVideosError;
		const result = normalizeRhfErrors(input, videos);
		expect(result.items.t1?.file?.message).toBe("invalid type");
		expect(result.items.t1?.file?.type).toBe("custom");
		expect(result.items.t1?.file?.source).toEqual({
			message: "invalid type",
			type: "custom",
		});
	});

	it("空文字 message は流さず undefined にする", () => {
		const videos = [makeVideo("t1")];
		const input = [
			{ file: { message: "", type: "x" } },
		] as unknown as RhfVideosError;
		const result = normalizeRhfErrors(input, videos);
		expect(result.items.t1?.file?.message).toBeUndefined();
		expect(result.items.t1?.file?.type).toBe("x");
	});

	it("複数 key を持つ item を全て normalize する", () => {
		const videos = [makeVideo("t1")];
		const input = [
			{
				file: { message: "f" },
				thumbnail: { message: "t" },
				id: { message: "i" },
			},
		] as unknown as RhfVideosError;
		const result = normalizeRhfErrors(input, videos);
		expect(result.items.t1?.file?.message).toBe("f");
		expect(result.items.t1?.thumbnail?.message).toBe("t");
		expect(result.items.t1?.id?.message).toBe("i");
	});

	it("未知の非オブジェクト葉は source に保持し message に String(value)", () => {
		const videos = [makeVideo("t1")];
		const input = [
			{ file: "raw-string-error" as unknown as { message?: string } },
		] as unknown as RhfVideosError;
		const result = normalizeRhfErrors(input, videos);
		expect(result.items.t1?.file?.source).toBe("raw-string-error");
		expect(result.items.t1?.file?.message).toBe("raw-string-error");
	});

	it("root プロパティを root[] に抽出する", () => {
		const arr = [] as unknown as RhfVideosError & Record<string, unknown>;
		Object.assign(arr as object, {
			root: { message: "max 5 videos", type: "max_videos" },
		});
		const result = normalizeRhfErrors(arr as RhfVideosError, []);
		expect(result.root).toHaveLength(1);
		expect(result.root[0]?.message).toBe("max 5 videos");
		expect(result.root[0]?.type).toBe("max_videos");
	});

	it("配列レベル FieldError 形 ({message,type}) を root[] に拾う", () => {
		const input = {
			message: "最大5件までです",
			type: "too_big",
		} as unknown as RhfVideosError;
		const result = normalizeRhfErrors(input, []);
		expect(result.items).toEqual({});
		expect(result.root).toHaveLength(1);
		expect(result.root[0]?.message).toBe("最大5件までです");
		expect(result.root[0]?.type).toBe("too_big");
	});

	it("間に undefined が混じっても tempId を保つ", () => {
		const videos = [makeVideo("t1"), makeVideo("t2"), makeVideo("t3")];
		const input: any = [];
		input[0] = { file: { message: "a" } };
		input[2] = { file: { message: "c" } };
		const result = normalizeRhfErrors(input as RhfVideosError, videos);
		expect(result.items.t1?.file?.message).toBe("a");
		expect(result.items.t2).toBeUndefined();
		expect(result.items.t3?.file?.message).toBe("c");
	});

	it("入れ子 shape でも message が昇格して VideoFieldError.message に現れる", () => {
		const videos = [makeVideo("t1")];
		const input = [
			{
				thumbnail: { file: { message: "bad thumb file", type: "custom" } },
			},
		] as unknown as RhfVideosError;
		const result = normalizeRhfErrors(input, videos);
		expect(result.items.t1?.thumbnail?.message).toBe("bad thumb file");
	});
});
