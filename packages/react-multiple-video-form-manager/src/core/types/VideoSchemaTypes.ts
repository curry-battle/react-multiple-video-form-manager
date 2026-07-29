import type { Video } from "./Video";

export type VideoSchemaOptions = {
	/** 受け入れる動画MIMEタイプ（必須）。processFile後の形式を指定 */
	acceptedVideoTypes: string[];
	/** 最大動画ファイルサイズ（bytes）。undefinedならチェックなし */
	maxVideoFileSize?: number;
	/** 最大動画数。undefinedなら無制限 */
	maxVideos?: number;
	/** 受け入れるサムネイルMIMEタイプ。undefinedならチェックなし */
	acceptedThumbnailTypes?: string[];
	/** 最大サムネイルファイルサイズ（bytes）。undefinedならチェックなし */
	maxThumbnailFileSize?: number;
	/** ID フィールドのカスタムバリデーション関数。未指定時はstring型チェックのみ */
	idValidation?: (id: string) => boolean;
	/** idValidation失敗時のエラーメッセージ */
	idMessage?: string;
	/** カスタムエラーメッセージ（関数形式） */
	messages?: {
		invalidVideoType?: (types: string[]) => string;
		maxVideoSize?: (bytes: number) => string;
		maxVideos?: (max: number) => string;
		invalidThumbnailType?: (types: string[]) => string;
		maxThumbnailSize?: (bytes: number) => string;
	};
};

export const defaultMessages = {
	invalidVideoType: (types: string[]) =>
		`ファイル形式は ${types.join(", ")} のいずれかのみ可能です。`,
	maxVideoSize: (bytes: number) =>
		`ファイルサイズは ${bytes / 1024 / 1024}MB以下にしてください。`,
	maxVideos: (max: number) => `動画は最大${max}件までです。`,
	invalidThumbnailType: (types: string[]) =>
		`サムネイル形式は ${types.join(", ")} のいずれかのみ可能です。`,
	maxThumbnailSize: (bytes: number) =>
		`サムネイルサイズは ${bytes / 1024 / 1024}MB以下にしてください。`,
};

/**
 * core (useMultiVideoCore) が出すエラー文言のカスタマイズ型。
 * 語彙はバリデーション用 (VideoSchemaOptions["messages"]) と異なり、
 * ハンドラ実行時のエラー (max_videos / process_file 系) をカバーする。
 */
export type CoreMessages = {
	maxVideos?: (max: number) => string;
	processFile?: () => string;
	processThumbnailFile?: () => string;
	uploadFile?: () => string;
	uploadThumbnailFile?: () => string;
	frameCapture?: () => string;
	validationFailed?: () => string;
};

/**
 * core が出すエラー文言の既定。maxVideos のみスキーマ (defaultMessages) と
 * 共有し、「動画は最大 N 件」の定義が core とスキーマで二重化するのを避ける。
 */
export const defaultCoreMessages = {
	maxVideos: defaultMessages.maxVideos,
	processFile: () => "ファイルの処理に失敗しました。",
	processThumbnailFile: () => "サムネイルファイルの処理に失敗しました。",
	uploadFile: () => "ファイルのアップロードに失敗しました。",
	uploadThumbnailFile: () => "サムネイルのアップロードに失敗しました。",
	frameCapture: () => "フレームキャプチャに失敗しました。",
	validationFailed: () => "validation failed",
} as const satisfies Required<CoreMessages>;

/**
 * Video[] フィールドと deletedVideoIds フィールドを持つフォーム型ヘルパー。
 * TDeletedFieldName を省略すると `${TFieldName}DeletedIds` が使われる。
 */
export type FormWithVideoField<
	TFieldName extends string,
	TDeletedFieldName extends string = `${TFieldName}DeletedIds`,
> = {
	[K in TFieldName]: Video[];
} & {
	[K in TDeletedFieldName]: string[];
};

/**
 * 中立エラーモデル: 単一フィールドのエラー
 */
export type VideoFieldError = {
	message?: string;
	type?: string;
	source?: unknown;
};

/**
 * 中立エラーモデル: 1動画分のフィールド別エラー
 */
export type SingleVideoError = Partial<
	Record<
		"file" | "thumbnail" | "id" | "uploadedUrl" | "status",
		VideoFieldError
	>
>;

/**
 * 中立エラーモデル: 配列全体のエラー
 * - items: tempId をキーとした per-item エラー
 * - root: 配列レベルエラー（maxVideos 等）
 */
export type VideosError = {
	items: Record<string, SingleVideoError>;
	root: VideoFieldError[];
};

export type ItemHandlers = {
	changeFile: (file: File) => Promise<boolean>;
	delete: () => Promise<boolean>;
	moveUp: () => Promise<boolean>;
	moveDown: () => Promise<boolean>;
	move: (toIndex: number) => Promise<boolean>;
	setThumbnailFromFrame: (videoElement: HTMLVideoElement) => Promise<boolean>;
	setThumbnailFromFile: (file: File) => Promise<boolean>;
	removeThumbnail: () => Promise<boolean>;
};

export type VideoItem = {
	video: Video;
	errors: SingleVideoError | undefined;
	canMoveUp: boolean;
	canMoveDown: boolean;
	errorMessages: string[];
	isPending: boolean;
	handlers: ItemHandlers;
};

const ERROR_FIELDS: ReadonlyArray<keyof SingleVideoError> = [
	"file",
	"thumbnail",
	"id",
	"uploadedUrl",
	"status",
];

export function collectErrorMessages(
	errors: SingleVideoError | undefined,
): string[] {
	if (!errors) return [];
	const messages: string[] = [];
	for (const field of ERROR_FIELDS) {
		const msg = errors[field]?.message;
		if (msg) messages.push(msg);
	}
	return messages;
}
