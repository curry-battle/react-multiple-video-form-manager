import { isPlainObject, normalizeErrorLeaf } from "../core/normalizeErrorLeaf";
import type { Video } from "../core/types/Video";
import type {
	SingleVideoError,
	VideoFieldError,
	VideosError,
} from "../core/types/VideoSchemaTypes";
import { VIDEO_ERROR_FIELD_KEYS } from "../core/types/VideoSchemaTypes";
import type { RhfSingleVideoError, RhfVideosError } from "./types";

const normalizeItem = (
	rawItem: RhfSingleVideoError | undefined,
): SingleVideoError | undefined => {
	if (rawItem === undefined || rawItem === null) return undefined;
	const out: SingleVideoError = {};
	let hasAny = false;
	for (const key of VIDEO_ERROR_FIELD_KEYS) {
		const leaf = (rawItem as Record<string, unknown>)[key];
		if (leaf === undefined) continue;
		out[key] = normalizeErrorLeaf(leaf);
		hasAny = true;
	}
	return hasAny ? out : undefined;
};

/**
 * RHF native の errors (`RhfVideosError`) を中立 VideosError (`{items, root}`) に変換する。
 */
export function normalizeRhfErrors(
	input: RhfVideosError,
	videos: readonly Video[],
): VideosError {
	if (input === undefined || input === null) {
		return { items: {}, root: [] };
	}

	const items: Record<string, SingleVideoError> = {};
	const root: VideoFieldError[] = [];

	if (Array.isArray(input)) {
		for (let i = 0; i < input.length; i++) {
			const normalized = normalizeItem(input[i]);
			if (normalized && videos[i]) {
				items[videos[i].tempId] = normalized;
			}
		}
	} else if (isPlainObject(input)) {
		if (input.message !== undefined || input.type !== undefined) {
			root.push(normalizeErrorLeaf(input));
		}
	}

	const rootMaybe = (input as unknown as Record<string, unknown>).root;
	if (rootMaybe !== undefined) {
		root.push(normalizeErrorLeaf(rootMaybe));
	}

	return { items, root };
}
