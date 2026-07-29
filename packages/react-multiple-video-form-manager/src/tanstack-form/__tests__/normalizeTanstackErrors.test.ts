import { describe, expect, it } from "vitest";
import type { Video } from "../../core/types/Video";
import { normalizeTanstackErrors } from "../normalizeTanstackErrors";

function makeVideo(tempId: string): Video {
	return {
		tempId,
		status: "new",
		id: undefined,
		file: new File(["x"], "v.mp4", { type: "video/mp4" }),
		uploadedUrl: undefined,
		thumbnail: null,
	};
}

describe("normalizeTanstackErrors", () => {
	it("空入力 → 空構造", () => {
		const r = normalizeTanstackErrors({
			errorMap: null,
			metaErrors: [],
			fieldName: "videos",
			videos: [],
		});
		expect(r).toEqual({ items: {}, root: [] });
	});

	it("Standard Schema 経由 videos[0].file → items[tempId].file", () => {
		const videos = [makeVideo("t1")];
		const r = normalizeTanstackErrors({
			errorMap: {
				onChange: {
					"videos[0].file": [{ message: "invalid type" }],
				},
			},
			metaErrors: [],
			fieldName: "videos",
			videos,
		});
		expect(r.items.t1?.file?.message).toBe("invalid type");
	});

	it("nested videos[0].thumbnail.file → items[tempId].thumbnail + source に残りパス保持", () => {
		const videos = [makeVideo("t1")];
		const r = normalizeTanstackErrors({
			errorMap: {
				onChange: {
					"videos[0].thumbnail.file": [{ message: "bad thumb" }],
				},
			},
			metaErrors: [],
			fieldName: "videos",
			videos,
		});
		expect(r.items.t1?.thumbnail?.message).toBe("bad thumb");
		expect(r.items.t1?.thumbnail?.source).toMatchObject({
			path: "thumbnail.file",
		});
	});

	it("素関数 validator スタイル Record<string,string>", () => {
		const videos = [makeVideo("t1"), makeVideo("t2")];
		const r = normalizeTanstackErrors({
			errorMap: {
				onChange: {
					"videos[1].file": "raw string",
				},
			},
			metaErrors: [],
			fieldName: "videos",
			videos,
		});
		expect(r.items.t2?.file?.message).toBe("raw string");
	});

	it("複数 index / 複数 key を扱える", () => {
		const videos = [makeVideo("t1"), makeVideo("t2"), makeVideo("t3")];
		const r = normalizeTanstackErrors({
			errorMap: {
				onChange: {
					"videos[0].file": [{ message: "a" }],
					"videos[1].thumbnail": [{ message: "b" }],
					"videos[2].file": [{ message: "c" }],
				},
			},
			metaErrors: [],
			fieldName: "videos",
			videos,
		});
		expect(Object.keys(r.items)).toHaveLength(3);
		expect(r.items.t1?.file?.message).toBe("a");
		expect(r.items.t2?.thumbnail?.message).toBe("b");
		expect(r.items.t3?.file?.message).toBe("c");
	});

	it("未知の first segment は root に source 付きで保全する", () => {
		const videos = [makeVideo("t1")];
		const r = normalizeTanstackErrors({
			errorMap: {
				onChange: {
					"videos[0].unknownField": [{ message: "x" }],
				},
			},
			metaErrors: [],
			fieldName: "videos",
			videos,
		});
		expect(r.items.t1).toBeUndefined();
		expect(r.root).toHaveLength(1);
		expect(r.root[0]?.message).toBe("x");
		expect(r.root[0]?.source).toMatchObject({
			path: "videos[0].unknownField",
		});
	});

	it("metaErrors を root[] に変換する", () => {
		const r = normalizeTanstackErrors({
			errorMap: null,
			metaErrors: ["max 5 videos", { message: "another" }],
			fieldName: "videos",
			videos: [],
		});
		expect(r.root).toHaveLength(2);
		expect(r.root[0]?.message).toBe("max 5 videos");
		expect(r.root[1]?.message).toBe("another");
	});

	it("空文字 message は流さない", () => {
		const videos = [makeVideo("t1")];
		const r = normalizeTanstackErrors({
			errorMap: {
				onChange: {
					"videos[0].file": [{ message: "" }],
				},
			},
			metaErrors: [],
			fieldName: "videos",
			videos,
		});
		expect(r.items.t1?.file?.message).toBeUndefined();
	});

	it("form-level 名前一致は root に積む（例: videos: 'general'）", () => {
		const r = normalizeTanstackErrors({
			errorMap: {
				onSubmit: { videos: "general failure" },
			},
			metaErrors: [],
			fieldName: "videos",
			videos: [],
		});
		expect(r.root).toHaveLength(1);
		expect(r.root[0]?.message).toBe("general failure");
	});

	it("エラーなしの videos は空 items を返す", () => {
		const videos = [makeVideo("t1"), makeVideo("t2"), makeVideo("t3")];
		const r = normalizeTanstackErrors({
			errorMap: null,
			metaErrors: [],
			fieldName: "videos",
			videos,
		});
		expect(Object.keys(r.items)).toHaveLength(0);
	});

	it("videos 範囲外のインデックスのエラーは items に含まれない", () => {
		const videos = [makeVideo("t1"), makeVideo("t2"), makeVideo("t3")];
		const r = normalizeTanstackErrors({
			errorMap: {
				onChange: {
					"videos[5].file": [{ message: "out of range" }],
				},
			},
			metaErrors: [],
			fieldName: "videos",
			videos,
		});
		expect(Object.keys(r.items)).toHaveLength(0);
	});

	it("配列要素レベル videos[i] 自体のエラーは root に source 付きで積む（in-range）", () => {
		const videos = [makeVideo("t1"), makeVideo("t2")];
		const r = normalizeTanstackErrors({
			errorMap: {
				onChange: {
					"videos[0]": [{ message: "element error" }],
				},
			},
			metaErrors: [],
			fieldName: "videos",
			videos,
		});
		expect(r.root).toHaveLength(1);
		expect(r.root[0]?.message).toBe("element error");
		expect(r.root[0]?.source).toMatchObject({ path: "videos[0]" });
	});

	it("配列要素レベル videos[i] 自体のエラーは root に source 付きで積む（out-of-range）", () => {
		const videos = [makeVideo("t1"), makeVideo("t2")];
		const r = normalizeTanstackErrors({
			errorMap: {
				onChange: {
					"videos[9]": [{ message: "oob element" }],
				},
			},
			metaErrors: [],
			fieldName: "videos",
			videos,
		});
		expect(r.root).toHaveLength(1);
		expect(r.root[0]?.message).toBe("oob element");
		expect(r.root[0]?.source).toMatchObject({ path: "videos[9]" });
	});

	it("dot 記法 videos.0.file → items[tempId].file（bracket と同様に振り分け）", () => {
		const videos = [makeVideo("t1")];
		const r = normalizeTanstackErrors({
			errorMap: {
				onChange: {
					"videos.0.file": [{ message: "dot style" }],
				},
			},
			metaErrors: [],
			fieldName: "videos",
			videos,
		});
		expect(r.items.t1?.file?.message).toBe("dot style");
	});

	it("exact key と nested key が両方ある場合、各々独立に処理される（last-wins）", () => {
		const videos = [makeVideo("t1")];
		const r = normalizeTanstackErrors({
			errorMap: {
				onChange: {
					"videos[0].thumbnail": [{ message: "exact" }],
					"videos[0].thumbnail.file": [{ message: "nested" }],
				},
			},
			metaErrors: [],
			fieldName: "videos",
			videos,
		});
		expect(r.items.t1?.thumbnail).toBeDefined();
	});

	it("1 キーに複数 issue がある場合、最後の issue が items に残る（last-wins）", () => {
		const videos = [makeVideo("t1")];
		const r = normalizeTanstackErrors({
			errorMap: {
				onChange: {
					"videos[0].file": [{ message: "first" }, { message: "second" }],
				},
			},
			metaErrors: [],
			fieldName: "videos",
			videos,
		});
		expect(r.items.t1?.file?.message).toBe("second");
	});

	it("兄弟フィールド（videosCount 等）のキーは拾わない", () => {
		const videos = [makeVideo("t1")];
		const r = normalizeTanstackErrors({
			errorMap: {
				onChange: {
					videosCount: [{ message: "sibling" }],
					"videos[0].file": [{ message: "mine" }],
				},
			},
			metaErrors: [],
			fieldName: "videos",
			videos,
		});
		expect(r.items.t1?.file?.message).toBe("mine");
		expect(r.root).toHaveLength(0);
	});

	it("metaErrors と errorMap に同一メッセージが重複する場合 dedup される", () => {
		const videos = [makeVideo("t1"), makeVideo("t2"), makeVideo("t3")];
		const r = normalizeTanstackErrors({
			errorMap: {
				onChange: {
					videos: [{ message: "最大2件" }],
				},
			},
			metaErrors: [{ message: "最大2件" }],
			fieldName: "videos",
			videos,
		});
		expect(r.root).toHaveLength(1);
		expect(r.root[0]?.message).toBe("最大2件");
	});

	it("異なるメッセージの root エラーは dedup されない", () => {
		const r = normalizeTanstackErrors({
			errorMap: {
				onChange: {
					videos: [{ message: "error A" }],
				},
			},
			metaErrors: [{ message: "error B" }],
			fieldName: "videos",
			videos: [],
		});
		expect(r.root).toHaveLength(2);
	});

	it("metaErrors with path: [index, fieldKey] → items に振り分けられる", () => {
		const videos = [makeVideo("t1")];
		const r = normalizeTanstackErrors({
			errorMap: null,
			metaErrors: [{ message: "bad file", path: [0, "file"] }],
			fieldName: "videos",
			videos,
		});
		expect(r.items.t1?.file?.message).toBe("bad file");
		expect(r.root).toHaveLength(0);
	});

	it("metaErrors path: 複数 index × 複数 key の混在", () => {
		const videos = [makeVideo("t1"), makeVideo("t2")];
		const r = normalizeTanstackErrors({
			errorMap: null,
			metaErrors: [
				{ message: "bad file", path: [0, "file"] },
				{ message: "bad thumb", path: [1, "thumbnail"] },
				{ message: "bad status", path: [0, "status"] },
			],
			fieldName: "videos",
			videos,
		});
		expect(r.items.t1?.file?.message).toBe("bad file");
		expect(r.items.t1?.status?.message).toBe("bad status");
		expect(r.items.t2?.thumbnail?.message).toBe("bad thumb");
		expect(r.root).toHaveLength(0);
	});

	it("metaErrors path: index が videos 範囲外 → items にも root にも含まれない", () => {
		const videos = [makeVideo("t1")];
		const r = normalizeTanstackErrors({
			errorMap: null,
			metaErrors: [{ message: "oob", path: [5, "file"] }],
			fieldName: "videos",
			videos,
		});
		expect(Object.keys(r.items)).toHaveLength(0);
		expect(r.root).toHaveLength(0);
	});

	it("metaErrors path: path.length >= 3 でも先頭2要素で振り分け", () => {
		const videos = [makeVideo("t1")];
		const r = normalizeTanstackErrors({
			errorMap: null,
			metaErrors: [{ message: "deep", path: [0, "thumbnail", "nested"] }],
			fieldName: "videos",
			videos,
		});
		expect(r.items.t1?.thumbnail?.message).toBe("deep");
		expect(r.root).toHaveLength(0);
	});

	it("metaErrors 内の null / undefined はスキップされる", () => {
		const videos = [makeVideo("t1")];
		const r = normalizeTanstackErrors({
			errorMap: null,
			metaErrors: [null, undefined, { message: "valid", path: [0, "file"] }],
			fieldName: "videos",
			videos,
		});
		expect(r.items.t1?.file?.message).toBe("valid");
		expect(r.root).toHaveLength(0);
	});

	it("metaErrors が配列でない場合は無視される", () => {
		const videos = [makeVideo("t1")];
		const r = normalizeTanstackErrors({
			errorMap: null,
			metaErrors: "not an array",
			fieldName: "videos",
			videos,
		});
		expect(Object.keys(r.items)).toHaveLength(0);
		expect(r.root).toHaveLength(0);
	});

	it("metaErrors path but unknown field key → root に落ちる", () => {
		const videos = [makeVideo("t1")];
		const r = normalizeTanstackErrors({
			errorMap: null,
			metaErrors: [{ message: "unknown", path: [0, "foo"] }],
			fieldName: "videos",
			videos,
		});
		expect(r.items.t1).toBeUndefined();
		expect(r.root).toHaveLength(1);
		expect(r.root[0]?.message).toBe("unknown");
	});

	it("metaErrors with path length < 2 → root に落ちる", () => {
		const videos = [makeVideo("t1")];
		const r = normalizeTanstackErrors({
			errorMap: null,
			metaErrors: [{ message: "short", path: [0] }],
			fieldName: "videos",
			videos,
		});
		expect(r.items.t1).toBeUndefined();
		expect(r.root).toHaveLength(1);
	});

	it("metaErrors with non-number index → root に落ちる", () => {
		const videos = [makeVideo("t1")];
		const r = normalizeTanstackErrors({
			errorMap: null,
			metaErrors: [{ message: "nan", path: ["not-a-number", "file"] }],
			fieldName: "videos",
			videos,
		});
		expect(r.items.t1).toBeUndefined();
		expect(r.root).toHaveLength(1);
	});

	it("metaErrors with negative or fractional index → root に落ちる", () => {
		const videos = [makeVideo("t1"), makeVideo("t2")];
		const r = normalizeTanstackErrors({
			errorMap: null,
			metaErrors: [
				{ message: "neg", path: [-1, "file"] },
				{ message: "frac", path: [1.5, "file"] },
			],
			fieldName: "videos",
			videos,
		});
		expect(Object.keys(r.items)).toHaveLength(0);
		expect(r.root).toHaveLength(2);
	});

	it("errorMap bucket が string の場合 → root に積む", () => {
		const r = normalizeTanstackErrors({
			errorMap: {
				onChange: "general validation error",
			},
			metaErrors: [],
			fieldName: "videos",
			videos: [],
		});
		expect(r.root).toHaveLength(1);
		expect(r.root[0]?.message).toBe("general validation error");
	});

	it("dedupe: message/type 両方ない root error は全て保持される", () => {
		const r = normalizeTanstackErrors({
			errorMap: null,
			metaErrors: [{ source: { path: "a" } }, { source: { path: "b" } }],
			fieldName: "videos",
			videos: [],
		});
		expect(r.root).toHaveLength(2);
	});

	// revalidation が resolve するまでの間、stale error は現在の index 位置の
	// video に紐づく。削除された video の tempId はもう存在しないので消える。
	// この一時的なズレはプランで許容済み（errors 一括クリアはストア所有権を侵すため行わない）。
	it("削除後、stale error は現在の index 位置の video に紐づく（削除された tempId は消える）", () => {
		const videos = [makeVideo("t2")];
		const r = normalizeTanstackErrors({
			errorMap: {
				onChange: {
					"videos[0].file": [{ message: "stale error for t1" }],
				},
			},
			metaErrors: [],
			fieldName: "videos",
			videos,
		});
		expect(r.items.t2?.file?.message).toBe("stale error for t1");
		expect(r.items.t1).toBeUndefined();
	});
});
