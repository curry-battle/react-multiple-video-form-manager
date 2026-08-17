/**
 * 転送 1 本の進行状態。
 *
 * フォーム state には保存しない。in-flight promise の状態は remount した瞬間に
 * 実体を失うため、永続化された state に混ぜると嘘になる（blob URL を state に
 * 置かない `usePreviewUrl` の判断と同じ原則）。永続化される事実は
 * `VideoNew.uploadRef` / `Thumbnail.uploadRef` の有無だけ。
 *
 * 同じ理由で「完了」を表す状態は公開しない。台帳由来の done を公開すると、
 * それに紐づけた「アップロード済み」表示が remount のたびに消える。
 * 完了の判定は転送参照の有無から導出すること。
 *
 * `undefined` は「報告することが無い」を意味する。転送を開始していない場合と、
 * 完了して報告し終えた場合の両方を含む。
 */
export type UploadState =
	| {
			status: "pending";
			/**
			 * 0..1。`uploadFile` が `ctx.onProgress` を呼ばない間は undefined。
			 * 「進捗不明の転送中」と「進捗 0 の転送中」を区別するため 0 で埋めない
			 */
			progress?: number;
	  }
	| { status: "failed"; error: unknown };

/**
 * 項目単位の転送状態。台帳の複合キーから導出する。
 *
 * 本体とサムネイルを合算しない。合算にはバイト数の重みが要るが、ライブラリは
 * ファイルサイズを知らない（`UploadFileContext.onProgress` の doc を参照）。
 * キーはハンドラの `ctx.kind` と同じ語彙を使う。
 */
export type VideoUploadState = {
	video?: UploadState;
	thumbnail?: UploadState;
};
