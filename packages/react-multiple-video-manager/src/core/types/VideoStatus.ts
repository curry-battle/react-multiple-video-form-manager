/**
 * 動画の状態
 * new:      動画追加ボタンを押してファイル選択済みの状態。DB/S3には未登録
 * existing: DB/S3に登録済みの状態
 *
 * 遷移ルール:
 * (file選択) --> new --(DB登録)--> existing
 *
 * 削除済み既存動画の ID は別途 deletedVideoIds で管理する。
 */

// Status
export const VideoFormStatus = {
	New: "new",
	Existing: "existing",
} as const;

export type VideoFormStatus =
	(typeof VideoFormStatus)[keyof typeof VideoFormStatus];
