import type { Video } from "../core/types/Video";

/**
 * RHF native の per-item フィールドエラー shape。
 * `formState.errors.<fieldName>` を cast するための型。
 */
export type RhfSingleVideoError = {
	[K in keyof Video]?: { message?: string; type?: string };
};

/**
 * RHF native の配列状フィールドエラー shape。
 * - 配列 + 任意の root プロパティ（per-item エラー）。
 * - 配列レベルのバリデーション（例: maxVideos）では RHF/resolver が
 *   `errors.videos = { message, type }` のトップレベル `FieldError` 形を返すことがある。
 */
export type RhfVideosError =
	| (RhfSingleVideoError[] & {
			root?: { message?: string; type?: string };
	  })
	| { message?: string; type?: string }
	| undefined;
