import { ThumbnailSource } from "./types/Thumbnail";
import { UploadKind } from "./types/Upload";
import type { Video } from "./types/Video";
import { VideoFormStatus } from "./types/VideoStatus";

/**
 * 台帳・進捗・自己破棄カウントを引く複合キー。
 *
 * 1 項目が本体とサムネイルの 2 転送を持つため、tempId 単一キーでは 1 レコードしか
 * 持てない。ネストした `Map<tempId, { video?, thumbnail? }>` にすると、外側の値を
 * 差し替えるたびに内側レコードの参照比較の対象がずれる。
 *
 * tempId は `temp_` + UUID でコロンを含まないため、区切りは曖昧にならない。
 */
export const slotKey = (tempId: string, kind: UploadKind): string =>
	`${tempId}:${kind}`;

/**
 * 転送 1 本の入力。`file` は `uploadFile` へ渡す実体、`token` は書き戻しの可否を
 * 決める同一性比較の対象。
 *
 * フレームキャプチャのサムネイルは `blob` から `File` を作り直すので 2 つが別物に
 * なる。派生 `File` を `token` にすると比較が常に不成立になり、書き戻しが一度も
 * 反映されない。`token` は必ずフォーム state に格納されているオブジェクトにする。
 */
export type UploadSource = {
	token: Blob | File;
	file: File;
};

/**
 * そのスロットに転送すべきものがあれば返す。無ければ undefined
 * （既存動画の本体、サムネイル未設定、サーバ由来のサムネイル）。
 */
export function readUploadSource(
	video: Video,
	kind: UploadKind,
): UploadSource | undefined {
	if (kind === UploadKind.Video) {
		if (video.status !== VideoFormStatus.New) return undefined;
		return { token: video.file, file: video.file };
	}

	const thumbnail = video.thumbnail;
	if (thumbnail === null || thumbnail.source === ThumbnailSource.Existing) {
		return undefined;
	}
	if (thumbnail.source === ThumbnailSource.Frame) {
		return {
			token: thumbnail.blob,
			file: new File([thumbnail.blob], "thumbnail.jpg", { type: "image/jpeg" }),
		};
	}
	return { token: thumbnail.file, file: thumbnail.file };
}

/**
 * そのスロットが持つ転送参照。転送を要さないスロット（`readUploadSource` が
 * undefined を返すもの）では常に undefined を返す。
 *
 * 既存項目のサーバ由来 URL はここでは返さない。転送参照とサーバ URL は別概念で、
 * 混ぜると「転送が済んでいるか」の判定に既存項目が紛れ込む。
 */
export function readUploadRef(
	video: Video,
	kind: UploadKind,
): string | undefined {
	if (kind === UploadKind.Video) {
		return video.status === VideoFormStatus.New ? video.uploadRef : undefined;
	}
	const thumbnail = video.thumbnail;
	if (thumbnail === null || thumbnail.source === ThumbnailSource.Existing) {
		return undefined;
	}
	return thumbnail.uploadRef;
}

/** 転送すべきものがあり、まだ参照を持たないスロットの入力 */
export function readUnresolvedSource(
	video: Video,
	kind: UploadKind,
): UploadSource | undefined {
	if (readUploadRef(video, kind) !== undefined) return undefined;
	return readUploadSource(video, kind);
}

/**
 * 転送参照を書き戻した `Video` を返す。スロットの中身が `token` と別物になって
 * いれば undefined（書き戻す先が無い）。
 *
 * 判定を 1 箇所に畳んでいるのは、「対象を探す」と「書き込む」を分けると
 * 探した結果と書き込む先がずれる余地が生まれるため。
 */
export function applyUploadRef(
	video: Video,
	kind: UploadKind,
	token: Blob | File,
	uploadRef: string,
): Video | undefined {
	if (kind === UploadKind.Video) {
		if (video.status !== VideoFormStatus.New || video.file !== token) {
			return undefined;
		}
		return { ...video, uploadRef };
	}

	const thumbnail = video.thumbnail;
	if (thumbnail === null || thumbnail.source === ThumbnailSource.Existing) {
		return undefined;
	}
	const current =
		thumbnail.source === ThumbnailSource.Frame
			? thumbnail.blob
			: thumbnail.file;
	if (current !== token) return undefined;

	return { ...video, thumbnail: { ...thumbnail, uploadRef } };
}
