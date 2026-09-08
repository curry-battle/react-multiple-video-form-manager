import type { Video } from "./types/Video";
import type { VideosError } from "./types/VideoSchemaTypes";

/**
 * フォーム非依存の中立 Port。RHF / TanStack Form 双方のアダプタがこの形に揃えて返す。
 * 実装は次の不変条件を満たすこと。
 *
 * **File / Blob の参照を保持すること。** `setVideos` に渡された `Video` が持つ
 * `file`、および `thumbnail` の `file` / `blob` を、clone や再構築で別の参照に
 * 置き換えてはならない。選択時アップロードは転送結果の新旧をこれらの参照同一性で
 * 判定するため、参照が失われると書き戻しが常に破棄され、転送が繰り返し再発行される。
 * `usePreviewUrl` / `useThumbnailPreviewUrl` も同じ参照を effect の依存に取るので、
 * 毎レンダー変わると object URL の生成と revoke が繰り返される。
 *
 * **`getVideos()` / `getDeletedVideoIds()` は read 間で参照安定であること。**
 * read のたびに新しい配列や新しい `File` を作って返してはならない
 * （参照が変わることの影響は File / Blob の参照保持と同じ）。
 *
 * **`setVideos` / `setDeletedVideoIds` の結果は、次に `getVideos()` /
 * `getDeletedVideoIds()` を読む時点で見えていること**（read-your-writes）。
 * 各 handler は「現在値を同期 read → 次の配列を計算 → set を 1 回」で動くため、
 * 直前の書き込みが見えない実装では連続操作が lost update になる。
 * 描画用の `videos` / `deletedVideoIds` は再レンダー経由なのでこの限りではない。
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
	 *
	 * **返す promise は必ず settle すること。** `uploads.wait` が待つのは handler の
	 * 完了で、handler は書き込みを終えたあと最後に validate() を await する。
	 * したがって settle しないと、素材が揃っていても保存が返らない
	 */
	validate(): Promise<void>;
	/** 中立形式に正規化済みのエラー */
	errors: VideosError;
}
