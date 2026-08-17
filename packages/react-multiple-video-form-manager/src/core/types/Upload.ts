/**
 * 転送スロットの種別。
 *
 * 1 項目が本体とサムネイルの 2 つの転送を持つため、ハンドラの `ctx`・台帳のキー・
 * `items[].uploadState` の 3 箇所で同じ語彙を使う。概念を 2 つに割らない。
 */
export const UploadKind = {
	Video: "video",
	Thumbnail: "thumbnail",
} as const;

export type UploadKind = (typeof UploadKind)[keyof typeof UploadKind];

export const UPLOAD_KINDS = [UploadKind.Video, UploadKind.Thumbnail] as const;

/**
 * 転送先が返す参照。URL とは限らない（一時領域のトークンなど）ので
 * `VideoExisting.uploadedUrl` / `ThumbnailExisting.uploadedUrl` とは別概念として扱い、
 * スキーマでも URL 検証をかけない。表示用の URL は `usePreviewUrl` /
 * `useThumbnailPreviewUrl` が File と既存 URL から導出する。
 */
export type UploadFileResult = {
	uploadRef: string;
};

/**
 * 転送の種別・中断要求・進捗の報告口。
 *
 * `signal` はライブラリ→消費側、`onProgress` は消費側→ライブラリで、どちらも
 * チャネルであって項目の identity ではない。転送がどの項目のものかは消費側に
 * 知らせず、相関はライブラリ内部に閉じる。`kind` は項目 identity ではなく
 * ペイロードの属性なので、この線の内側にある。
 *
 * `signal` は unmount 時と、同じスロットのファイル差し替え時に abort される。
 * 無視しても結果は破棄されるため、実害は無駄な転送に留まる。
 */
export type UploadFileContext = {
	/** 本体の転送かサムネイルの転送か。バケットや検証を分けたい場合はここで分岐する */
	kind: UploadKind;
	signal: AbortSignal;
	/**
	 * 転送の進捗を 0..1 で報告する。非有限値は無視され、範囲外の値は 0..1 に丸められる。
	 *
	 * 呼ぶ頻度に制限は無い。整数パーセントが変わらない報告は再レンダーを
	 * 起こさないため、チャンクごとに呼んで構わない。
	 * 残り時間の推定はライブラリでは行わない（進捗と経過時間から消費側が出す）
	 */
	onProgress: (fraction: number) => void;
};

/**
 * 選択されたファイルをストレージへ転送する。本体とサムネイルで 1 本を共有し、
 * どちらの転送かは `ctx.kind` で渡す。
 *
 * 種別ごとに関数を分けないのは、送信素材の型が「ハンドラ設定の有無」×「種別」で
 * 4 通りに割れるため。「本体は転送参照・サムネイルは生の `File`」という混在した
 * 素材が型に現れる。1 本なら 2 通りに収まる。
 *
 * **返す promise は必ず settle すること。** `uploads.wait` は走行中の転送が
 * settle するまで待つため、`ctx.signal` を無視した上で解決も棄却もしない実装だと
 * 保存が返らなくなる。中断できないなら、せめてタイムアウトで棄却すること。
 *
 * **置ける副作用は「捨てても回収できるもの」に限る。** 結果が破棄される経路
 * （stale な書き戻し、unmount）があるため、転送先のオブジェクトはストレージの
 * lifecycle rule で回収できる形にしておくこと。DB レコードの作成のような
 * 回収手段の無い副作用は置かない。
 *
 * `ctx` は optional にしない。ライブラリは常に渡すため、optional は `signal` を
 * 使う実装に無意味な `ctx?.signal` ガードを強いるだけになる。引数を使わない実装は
 * `(file) => ...` と書けばよく、少ない引数の関数は代入可能。
 */
export type UploadFileFn = (
	file: File,
	ctx: UploadFileContext,
) => Promise<UploadFileResult>;
