import type { Video } from "./types/Video";
import type { VideosError } from "./types/VideoSchemaTypes";

/**
 * フォーム非依存の中立 Port。
 * RHF / TanStack Form 双方のアダプタがこの形に揃えて返す。
 */
export interface VideoFieldAdapter {
	/** 描画用 reactive 値（再レンダー経由で更新） */
	readonly videos: readonly Video[];
	/** 配列全体を 1 回で置き換える */
	setVideos(next: Video[]): void;
	/** mutation 用の同期 read。フォームストアの現在値を返す */
	getVideos(): Video[];
	/** 描画用 reactive 値（再レンダー経由で更新） */
	readonly deletedVideoIds: readonly string[];
	/** 削除済みID配列を置き換える */
	setDeletedVideoIds(next: string[]): void;
	/** mutation 用の同期 read。フォームストアの現在値を返す */
	getDeletedVideoIds(): string[];
	/**
	 * 検証を再発火する（結果の真偽は core では使わない）。
	 * deletedVideoIds の変更では呼ばない — 削除 ID の正当性はフォームスキーマの
	 * 責務外であり、videos の変更で validate() を呼ぶだけで十分なため。
	 */
	validate(): Promise<void>;
	/** 中立形式に正規化済みのエラー */
	errors: VideosError;
}
