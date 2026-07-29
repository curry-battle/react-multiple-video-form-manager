import { isPlainObject, normalizeErrorLeaf } from "../core/normalizeErrorLeaf";
import type { Video } from "../core/types/Video";
import type {
	SingleVideoError,
	VideoFieldError,
	VideosError,
} from "../core/types/VideoSchemaTypes";

const VIDEO_FIELD_KEYS = [
	"file",
	"thumbnail",
	"id",
	"uploadedUrl",
	"status",
] as const;

type VideoFieldKey = (typeof VIDEO_FIELD_KEYS)[number];

const VIDEO_FIELD_KEY_SET: ReadonlySet<string> = new Set(VIDEO_FIELD_KEYS);

const isVideoFieldKey = (s: string): s is VideoFieldKey =>
	VIDEO_FIELD_KEY_SET.has(s);

export type NormalizeTanstackErrorsInput = {
	/**
	 * `useStore(form.store, s => s.errorMap)` の値。
	 * Standard Schema 経由なら `{ onChange: Record<path, Issue[]>, ... }` 形。
	 */
	errorMap: unknown;
	/**
	 * `useStore(field.store, s => s.meta.errors)` の値。
	 * path: [index, fieldKey] を持つエントリは items に振り分け、それ以外は root に積む。
	 */
	metaErrors: unknown;
	/**
	 * `useForm` に渡したフィールド名（例: "videos"）。
	 */
	fieldName: string;
	/**
	 * 正規化時点の videos 配列。index → tempId 変換に使う。
	 */
	videos: readonly Video[];
};

/**
 * TanStack Form の errorMap / metaErrors を中立 VideosError に正規化する。
 *
 * 各バケット(onChange/onBlur等)内の全キーを走査し、`${fieldName}[i]` または
 * `${fieldName}.i` 形式を認識する。`${fieldName}[` または `${fieldName}.` で
 * 始まるが上記に一致しないキーは source 付きで root に保全する。
 * 1キーに複数 issue がある場合、最後の issue が items に残る（last-wins）。
 *
 * metaErrors と errorMap に同一エラーが重複する場合は message + type で dedup する。
 */
export function normalizeTanstackErrors(
	input: NormalizeTanstackErrorsInput,
): VideosError {
	const indexItems: Array<SingleVideoError | undefined> = new Array(
		input.videos.length,
	).fill(undefined);
	const root: VideoFieldError[] = [];

	const setItem = (
		index: number,
		key: VideoFieldKey,
		leaf: VideoFieldError,
	) => {
		while (indexItems.length <= index) indexItems.push(undefined);
		const current = indexItems[index] ?? {};
		current[key] = leaf;
		indexItems[index] = current;
	};

	if (Array.isArray(input.metaErrors)) {
		for (const e of input.metaErrors) {
			if (e === undefined || e === null) continue;
			if (isPlainObject(e) && Array.isArray(e.path) && e.path.length >= 2) {
				const [idx, fieldKey] = e.path;
				if (
					Number.isInteger(idx) &&
					(idx as number) >= 0 &&
					typeof fieldKey === "string" &&
					isVideoFieldKey(fieldKey)
				) {
					setItem(idx as number, fieldKey, normalizeErrorLeaf(e));
					continue;
				}
			}
			root.push(normalizeErrorLeaf(e));
		}
	}

	if (isPlainObject(input.errorMap)) {
		const { fieldName } = input;
		const escaped = escapeRegExp(fieldName);
		const pattern = new RegExp(
			`^${escaped}(?:\\[(\\d+)\\]|\\.(\\d+))(?:\\.(.+))?$`,
		);

		for (const bucketKey of Object.keys(input.errorMap)) {
			const bucket = (input.errorMap as Record<string, unknown>)[bucketKey];
			if (bucket === undefined || bucket === null) continue;

			if (isPlainObject(bucket)) {
				const record = bucket as Record<string, unknown>;

				for (const pathKey of Object.keys(record)) {
					const value = record[pathKey];

					if (pathKey === fieldName) {
						const arr = Array.isArray(value) ? value : [value];
						for (const v of arr) root.push(normalizeErrorLeaf(v));
						continue;
					}

					const m = pathKey.match(pattern);
					if (!m) {
						if (
							pathKey.startsWith(`${fieldName}[`) ||
							pathKey.startsWith(`${fieldName}.`)
						) {
							const arr = Array.isArray(value) ? value : [value];
							for (const v of arr) {
								const leaf = normalizeErrorLeaf(v);
								leaf.source = { path: pathKey, value: v };
								root.push(leaf);
							}
						}
						continue;
					}

					const index = Number(m[1] ?? m[2]);
					const rest = m[3] ?? "";

					if (rest === "") {
						const arr = Array.isArray(value) ? value : [value];
						for (const v of arr) {
							const leaf = normalizeErrorLeaf(v);
							leaf.source = {
								path: `${fieldName}[${index}]`,
								value: v,
							};
							root.push(leaf);
						}
						continue;
					}

					const dotIdx = rest.indexOf(".");
					const firstSegment = dotIdx >= 0 ? rest.substring(0, dotIdx) : rest;

					if (!isVideoFieldKey(firstSegment)) {
						const arr = Array.isArray(value) ? value : [value];
						for (const v of arr) {
							const leaf = normalizeErrorLeaf(v);
							leaf.source = { path: pathKey, value: v };
							root.push(leaf);
						}
						continue;
					}

					const arr = Array.isArray(value) ? value : [value];
					for (const v of arr) {
						const leaf = normalizeErrorLeaf(v);
						if (dotIdx >= 0) {
							leaf.source = { path: rest, value: v };
						}
						setItem(index, firstSegment, leaf);
					}
				}
			} else if (typeof bucket === "string") {
				root.push(normalizeErrorLeaf(bucket));
			}
		}
	}

	// metaErrors と errorMap に同一エラーが重複する場合を dedup（message + type で同定）。
	// message も type もない場合は identity dedup できないため全て保持する。
	const seen = new Set<string>();
	const dedupedRoot = root.filter((e) => {
		if (e.message === undefined && e.type === undefined) return true;
		const key = `${e.message ?? ""}\0${e.type ?? ""}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});

	const items: Record<string, SingleVideoError> = {};
	for (let i = 0; i < indexItems.length; i++) {
		const err = indexItems[i];
		if (err && input.videos[i]) {
			items[input.videos[i].tempId] = err;
		}
	}

	return { items, root: dedupedRoot };
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
