import type { UploadKind } from "./Upload";

export type MultiVideoErrorType =
	| "max_videos"
	| "process_file"
	| "process_thumbnail_file"
	| "upload"
	| "unknown";

/**
 * ハンドラ実行時のエラー通知。
 *
 * 転送の失敗は本体・サムネイルで語彙を分けず、`kind` で区別する。ハンドラ・台帳・
 * `items[].uploadState` が kind 軸なのに、エラー通知だけ別軸を持つ非対称を作らない。
 * `kind` を必須にできるのは `type: "upload"` のときだけなので union で表す。
 */
export type MultiVideoError =
	| {
			type: "upload";
			kind: UploadKind;
			message: string;
			cause?: unknown;
	  }
	| {
			type: Exclude<MultiVideoErrorType, "upload">;
			kind?: undefined;
			message: string;
			cause?: unknown;
	  };
