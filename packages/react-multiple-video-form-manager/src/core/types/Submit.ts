import type { ThumbnailSubmitStatus } from "./Thumbnail";
import type { VideoFormStatus } from "./VideoStatus";

/**
 * サムネイルの送信素材。
 *
 * 既存項目のサムネイルは「据え置き / 差し替え / 削除」を区別しないとサーバ側で
 * 何をすべきか決まらないため、動画本体と違って status を持つ。
 */
export type UploadedSubmitThumbnail =
	| { status: typeof ThumbnailSubmitStatus.New; uploadRef: string }
	| { status: typeof ThumbnailSubmitStatus.Replaced; uploadRef: string }
	| { status: typeof ThumbnailSubmitStatus.Unchanged; uploadedUrl: string }
	| { status: typeof ThumbnailSubmitStatus.Removed };

/** `uploadFile` を設定しない場合。転送は消費側が行うので File を渡す */
export type LocalSubmitThumbnail =
	| { status: typeof ThumbnailSubmitStatus.New; file: File }
	| { status: typeof ThumbnailSubmitStatus.Replaced; file: File }
	| { status: typeof ThumbnailSubmitStatus.Unchanged; uploadedUrl: string }
	| { status: typeof ThumbnailSubmitStatus.Removed };

export type SubmitThumbnail = UploadedSubmitThumbnail | LocalSubmitThumbnail;

/**
 * 送信素材。`uploads.wait` / `uploads.getReady` が可視順の配列で返す。
 *
 * フォーム state の union をそのまま持ち上げず、送信に要る値だけを残す。表示順は
 * 配列の順序で表し、order フィールドは持たない（フィールドと二重管理になる）。
 * 削除対象は配列に含めず `deletedIds` へ分ける。
 *
 * 既存項目はサムネイル変更を同じオブジェクトで運ぶ。別配列に出すと消費側で id を
 * キーに結合する手間が増え、結合漏れが静かなバグになる。
 */
export type UploadedSubmitVideo =
	| {
			status: typeof VideoFormStatus.Existing;
			id: string;
			thumbnail: UploadedSubmitThumbnail | null;
	  }
	| {
			status: typeof VideoFormStatus.New;
			uploadRef: string;
			thumbnail: UploadedSubmitThumbnail | null;
	  };

/**
 * `uploadFile` を設定しない場合の送信素材。転送は消費側が行うので File を渡す。
 *
 * File 側にだけ tempId を載せる。`id` や `uploadRef` はそのままサーバへ送る値なので
 * 相関キーを混ぜないが、`file` は消費側が必ず自分で転送するため、失敗した項目を
 * ユーザーへ指し示すキーが要る。
 */
export type LocalSubmitVideo =
	| {
			status: typeof VideoFormStatus.Existing;
			id: string;
			thumbnail: LocalSubmitThumbnail | null;
	  }
	| {
			status: typeof VideoFormStatus.New;
			file: File;
			tempId: string;
			thumbnail: LocalSubmitThumbnail | null;
	  };

/**
 * `uploadFile` の有無が型で確定しない経路（render props など）で出る送信素材。
 *
 * 実行時には `UploadedSubmitVideo` か `LocalSubmitVideo` のどちらか一方の形しか
 * 現れないが、両者の union ではなく上位集合として定義する。union にすると
 * 「本体は転送参照・サムネイルは File」のような実行時に現れない組み合わせを
 * 型が禁じてしまい、素材を組む側が `uploadFile` の有無を知らないと書けなくなる。
 *
 * 確定した型が要る場合はフックを直接使うこと。
 */
export type SubmitVideo =
	| {
			status: typeof VideoFormStatus.Existing;
			id: string;
			thumbnail: SubmitThumbnail | null;
	  }
	| {
			status: typeof VideoFormStatus.New;
			uploadRef: string;
			thumbnail: SubmitThumbnail | null;
	  }
	| {
			status: typeof VideoFormStatus.New;
			file: File;
			tempId: string;
			thumbnail: SubmitThumbnail | null;
	  };
