import z from "zod";
import { ThumbnailSource } from "../core/types/Thumbnail";
import {
	defaultMessages,
	type VideoSchemaOptions,
} from "../core/types/VideoSchemaTypes";
import { VideoFormStatus } from "../core/types/VideoStatus";

export function createVideosSchema(options: VideoSchemaOptions) {
	const {
		acceptedVideoTypes,
		maxVideoFileSize,
		maxVideos,
		acceptedThumbnailTypes,
		maxThumbnailFileSize,
		messages,
		idValidation,
		idMessage,
	} = options;

	const invalidVideoTypeMsg =
		messages?.invalidVideoType ?? defaultMessages.invalidVideoType;
	const maxVideoSizeMsg =
		messages?.maxVideoSize ?? defaultMessages.maxVideoSize;
	const maxVideosMsg = messages?.maxVideos ?? defaultMessages.maxVideos;
	const invalidThumbnailTypeMsg =
		messages?.invalidThumbnailType ?? defaultMessages.invalidThumbnailType;
	const maxThumbnailSizeMsg =
		messages?.maxThumbnailSize ?? defaultMessages.maxThumbnailSize;

	const idSchema = idValidation
		? z.string().refine(idValidation, { message: idMessage ?? "Invalid ID" })
		: z.string();

	const baseVideoSchema = {
		tempId: z.string(),
	};

	// --- 動画ファイルスキーマ ---
	let videoFileSchema = z
		.instanceof(File)
		.refine((file) => acceptedVideoTypes.includes(file.type), {
			message: invalidVideoTypeMsg(acceptedVideoTypes),
		});

	if (maxVideoFileSize !== undefined) {
		videoFileSchema = videoFileSchema.refine(
			(file) => file.size <= maxVideoFileSize,
			{
				message: maxVideoSizeMsg(maxVideoFileSize),
			},
		);
	}

	// --- サムネイルスキーマ ---
	// Zod v4: refine() は ZodEffects を返し元の型と互換でないためキャストが必要
	let thumbnailUploadFileSchema = z.instanceof(File);

	if (acceptedThumbnailTypes !== undefined) {
		thumbnailUploadFileSchema = thumbnailUploadFileSchema.refine(
			(file) => acceptedThumbnailTypes.includes(file.type),
			{ message: invalidThumbnailTypeMsg(acceptedThumbnailTypes) },
		) as unknown as typeof thumbnailUploadFileSchema;
	}

	if (maxThumbnailFileSize !== undefined) {
		thumbnailUploadFileSchema = thumbnailUploadFileSchema.refine(
			(file) => file.size <= maxThumbnailFileSize,
			{ message: maxThumbnailSizeMsg(maxThumbnailFileSize) },
		) as unknown as typeof thumbnailUploadFileSchema;
	}

	const thumbnailFromFrameSchema = z.object({
		source: z.literal(ThumbnailSource.Frame),
		blob: z.instanceof(Blob),
		timestamp: z.number(),
		uploadRef: z.string().optional(),
	});

	const thumbnailFromUploadSchema = z.object({
		source: z.literal(ThumbnailSource.Upload),
		file: thumbnailUploadFileSchema,
		uploadRef: z.string().optional(),
	});

	const thumbnailExistingSchema = z.object({
		source: z.literal(ThumbnailSource.Existing),
		uploadedUrl: z.url(),
	});

	// --- 動画スキーマ ---
	const newVideoSchema = z.object({
		...baseVideoSchema,
		status: z.literal(VideoFormStatus.New),
		id: z.undefined(),
		file: videoFileSchema,
		uploadRef: z.string().optional(),
		// 差し替え元の既存動画の id。id と同じ検証をかける
		replacesId: idSchema.optional(),
		thumbnail: z.nullable(
			z.union([thumbnailFromFrameSchema, thumbnailFromUploadSchema]),
		),
	});

	const existingVideoSchema = z.object({
		...baseVideoSchema,
		status: z.literal(VideoFormStatus.Existing),
		id: idSchema,
		file: z.undefined(),
		uploadedUrl: z.url(),
		thumbnail: z.nullable(
			z.union([
				thumbnailFromFrameSchema,
				thumbnailFromUploadSchema,
				thumbnailExistingSchema,
			]),
		),
		thumbnailRemoved: z.boolean(),
	});

	// discriminatedUnion にすると、status で 1 ブランチに確定してからそのブランチの
	// issue をそのまま報告する。z.union だと型不一致（`thumbnailRemoved: "yes"` など）は
	// 「どのブランチにも合致しない」と畳まれ、フィールドキーの無い項目単位エラーになるため、
	// 正規化しても items[tempId].<key> に届かない。
	const videoUnion = z.discriminatedUnion("status", [
		newVideoSchema,
		existingVideoSchema,
	]);

	let arraySchema = z.array(videoUnion);

	if (maxVideos !== undefined) {
		// Zod v4: refine() の戻り値型は元の型と互換でないためキャストが必要
		arraySchema = arraySchema.refine((videos) => videos.length <= maxVideos, {
			message: maxVideosMsg(maxVideos),
		}) as unknown as typeof arraySchema;
	}

	return arraySchema;
}

export function createDeletedVideoIdsSchema(options?: {
	idValidation?: (id: string) => boolean;
	idMessage?: string;
}) {
	const idSchema = options?.idValidation
		? z.string().refine(options.idValidation, {
				message: options.idMessage ?? "Invalid ID",
			})
		: z.string();
	return z.array(idSchema);
}

if (import.meta.vitest) {
	const { describe, it, expect } = import.meta.vitest;
	const {
		validNewVideo,
		validNewVideoWithThumbnail,
		validExistingVideo,
		validExistingVideoNoThumbnail,
		invalidNewVideoWithWrongType,
		invalidNewVideoWithoutFile,
		invalidExistingWithBadId,
		invalidExistingWithoutUploadedUrl,
		invalidVideoWithBadStatus,
		invalidNewVideoWithBadThumbnailType,
		makeMp4File,
		makeWebmFile,
		makeLargeVideoFile,
		makeLargeThumbnailFile,
		validThumbnailFromFrame,
		validThumbnailFromUpload,
		validNewVideoWithUploadRef,
		validNewVideoWithOpaqueUploadRef,
	} = await import("./__testdata__/videoSchemaTestData");

	// テスト用のデフォルトスキーマ
	const videosSchema = createVideosSchema({
		acceptedVideoTypes: ["video/mp4", "video/webm"],
	});

	describe("createVideosSchema (zod)", () => {
		describe("基本動作（acceptedVideoTypesのみ指定）", () => {
			it("空配列を受け入れること", () => {
				expect(videosSchema.safeParse([]).success).toBe(true);
			});

			it("正しいVideoNew配列を受け入れること", () => {
				expect(videosSchema.safeParse([validNewVideo]).success).toBe(true);
			});

			it("サムネイル付きVideoNewを受け入れること", () => {
				expect(
					videosSchema.safeParse([validNewVideoWithThumbnail]).success,
				).toBe(true);
			});

			it("正しいVideoExisting配列を受け入れること", () => {
				expect(videosSchema.safeParse([validExistingVideo]).success).toBe(true);
			});

			it("サムネイルなしVideoExistingを受け入れること", () => {
				expect(
					videosSchema.safeParse([validExistingVideoNoThumbnail]).success,
				).toBe(true);
			});

			it("2種混合配列を受け入れること", () => {
				expect(
					videosSchema.safeParse([validNewVideo, validExistingVideo]).success,
				).toBe(true);
			});
		});

		describe("uploadRef", () => {
			it("uploadRef付きVideoNewを受け入れること", () => {
				expect(
					videosSchema.safeParse([validNewVideoWithUploadRef]).success,
				).toBe(true);
			});

			it("URL形式でないuploadRefでも受け入れること", () => {
				expect(
					videosSchema.safeParse([validNewVideoWithOpaqueUploadRef]).success,
				).toBe(true);
			});
		});

		describe("異常系（基本）", () => {
			it("file.typeが不正なVideoNew → reject", () => {
				expect(
					videosSchema.safeParse([invalidNewVideoWithWrongType]).success,
				).toBe(false);
			});

			it("fileが存在しないVideoNew → reject", () => {
				expect(
					videosSchema.safeParse([invalidNewVideoWithoutFile]).success,
				).toBe(false);
			});

			it("idが任意の文字列でもデフォルトでは受け入れること", () => {
				expect(videosSchema.safeParse([invalidExistingWithBadId]).success).toBe(
					true,
				);
			});

			it("uploadedUrlがないVideoExisting → reject", () => {
				expect(
					videosSchema.safeParse([invalidExistingWithoutUploadedUrl]).success,
				).toBe(false);
			});

			it("不正なstatus値 → reject", () => {
				expect(
					videosSchema.safeParse([invalidVideoWithBadStatus]).success,
				).toBe(false);
			});
		});

		describe("idValidation", () => {
			it("カスタムidValidationで不正なIDをrejectすること", () => {
				const isUuid = (id: string) =>
					/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
						id,
					);
				const schema = createVideosSchema({
					acceptedVideoTypes: ["video/mp4"],
					idValidation: isUuid,
					idMessage: "ID must be a valid UUID",
				});
				expect(schema.safeParse([invalidExistingWithBadId]).success).toBe(
					false,
				);
			});

			it("カスタムidValidationで正しいIDを受け入れること", () => {
				const isUuid = (id: string) =>
					/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
						id,
					);
				const schema = createVideosSchema({
					acceptedVideoTypes: ["video/mp4"],
					idValidation: isUuid,
				});
				expect(schema.safeParse([validExistingVideo]).success).toBe(true);
			});
		});

		describe("acceptedVideoTypes", () => {
			it("カスタムtypes (webm) でvalidなファイルを受け入れること", () => {
				const schema = createVideosSchema({
					acceptedVideoTypes: ["video/webm"],
				});
				const data = [
					{
						tempId: "temp_webm",
						status: "new" as const,
						id: undefined,
						file: makeWebmFile(),
						uploadedUrl: undefined,
						thumbnail: null,
					},
				];
				expect(schema.safeParse(data).success).toBe(true);
			});

			it("カスタムtypesに含まれない形式はrejectされること", () => {
				const schema = createVideosSchema({
					acceptedVideoTypes: ["video/webm"],
				});
				const data = [
					{
						tempId: "temp_mp4",
						status: "new" as const,
						id: undefined,
						file: makeMp4File("video.mp4"),
						uploadedUrl: undefined,
						thumbnail: null,
					},
				];
				expect(schema.safeParse(data).success).toBe(false);
			});
		});

		describe("maxVideoFileSize", () => {
			it("サイズ超過時にリジェクトされること", () => {
				const schema = createVideosSchema({
					acceptedVideoTypes: ["video/mp4"],
					maxVideoFileSize: 100,
				});
				const data = [
					{
						tempId: "temp_large",
						status: "new" as const,
						id: undefined,
						file: makeLargeVideoFile(200),
						uploadedUrl: undefined,
						thumbnail: null,
					},
				];
				expect(schema.safeParse(data).success).toBe(false);
			});

			it("サイズ以内なら受け入れること", () => {
				const schema = createVideosSchema({
					acceptedVideoTypes: ["video/mp4"],
					maxVideoFileSize: 1000,
				});
				const data = [
					{
						tempId: "temp_small",
						status: "new" as const,
						id: undefined,
						file: new File(["small"], "small.mp4", { type: "video/mp4" }),
						uploadedUrl: undefined,
						thumbnail: null,
					},
				];
				expect(schema.safeParse(data).success).toBe(true);
			});

			it("未指定時はサイズ制限なし", () => {
				const schema = createVideosSchema({
					acceptedVideoTypes: ["video/mp4"],
				});
				const data = [
					{
						tempId: "temp_nolimit",
						status: "new" as const,
						id: undefined,
						file: makeLargeVideoFile(10000),
						uploadedUrl: undefined,
						thumbnail: null,
					},
				];
				expect(schema.safeParse(data).success).toBe(true);
			});
		});

		describe("maxVideos", () => {
			it("超過時にリジェクトされること", () => {
				const schema = createVideosSchema({
					acceptedVideoTypes: ["video/mp4"],
					maxVideos: 2,
				});
				const data = [
					{
						tempId: "temp_1",
						status: "new" as const,
						id: undefined,
						file: makeMp4File("a.mp4"),
						uploadedUrl: undefined,
						thumbnail: null,
					},
					{
						tempId: "temp_2",
						status: "new" as const,
						id: undefined,
						file: makeMp4File("b.mp4"),
						uploadedUrl: undefined,
						thumbnail: null,
					},
					{
						tempId: "temp_3",
						status: "new" as const,
						id: undefined,
						file: makeMp4File("c.mp4"),
						uploadedUrl: undefined,
						thumbnail: null,
					},
				];
				expect(schema.safeParse(data).success).toBe(false);
			});

			it("ちょうどmaxVideosなら受け入れること", () => {
				const schema = createVideosSchema({
					acceptedVideoTypes: ["video/mp4"],
					maxVideos: 2,
				});
				const data = [
					{
						tempId: "temp_1",
						status: "new" as const,
						id: undefined,
						file: makeMp4File("a.mp4"),
						uploadedUrl: undefined,
						thumbnail: null,
					},
					{
						tempId: "temp_2",
						status: "new" as const,
						id: undefined,
						file: makeMp4File("b.mp4"),
						uploadedUrl: undefined,
						thumbnail: null,
					},
				];
				expect(schema.safeParse(data).success).toBe(true);
			});

			it("未指定時は枚数制限なし", () => {
				const schema = createVideosSchema({
					acceptedVideoTypes: ["video/mp4"],
				});
				const data = Array.from({ length: 20 }, (_, i) => ({
					tempId: `temp_${i}`,
					status: "new" as const,
					id: undefined,
					file: makeMp4File(`${i}.mp4`),
					uploadedUrl: undefined,
					thumbnail: null,
				}));
				expect(schema.safeParse(data).success).toBe(true);
			});
		});

		describe("サムネイルバリデーション", () => {
			it("acceptedThumbnailTypes指定時、不正な形式をrejectすること", () => {
				const schema = createVideosSchema({
					acceptedVideoTypes: ["video/mp4"],
					acceptedThumbnailTypes: ["image/jpeg", "image/png"],
				});
				expect(
					schema.safeParse([invalidNewVideoWithBadThumbnailType]).success,
				).toBe(false);
			});

			it("acceptedThumbnailTypes指定時、正しい形式を受け入れること", () => {
				const schema = createVideosSchema({
					acceptedVideoTypes: ["video/mp4"],
					acceptedThumbnailTypes: ["image/jpeg", "image/png"],
				});
				const data = [
					{
						...validNewVideo,
						thumbnail: validThumbnailFromUpload,
					},
				];
				expect(schema.safeParse(data).success).toBe(true);
			});

			it("maxThumbnailFileSize超過をrejectすること", () => {
				const schema = createVideosSchema({
					acceptedVideoTypes: ["video/mp4"],
					maxThumbnailFileSize: 100,
				});
				const data = [
					{
						...validNewVideo,
						thumbnail: {
							source: ThumbnailSource.Upload,
							file: makeLargeThumbnailFile(200),
						},
					},
				];
				expect(schema.safeParse(data).success).toBe(false);
			});

			it("frameサムネイルはファイル形式・サイズチェック対象外であること", () => {
				const schema = createVideosSchema({
					acceptedVideoTypes: ["video/mp4"],
					acceptedThumbnailTypes: ["image/jpeg"],
					maxThumbnailFileSize: 10,
				});
				const data = [
					{
						...validNewVideo,
						thumbnail: validThumbnailFromFrame,
					},
				];
				expect(schema.safeParse(data).success).toBe(true);
			});
		});

		describe("messages", () => {
			it("カスタム動画メッセージが適用されること", () => {
				const schema = createVideosSchema({
					acceptedVideoTypes: ["video/webm"],
					maxVideoFileSize: 100,
					messages: {
						invalidVideoType: (types) => `Custom: only ${types.join("/")}`,
						maxVideoSize: (bytes) => `Custom: max ${bytes}B`,
					},
				});
				const data = [
					{
						tempId: "temp_custom",
						status: "new" as const,
						id: undefined,
						file: makeMp4File("video.mp4"),
						uploadedUrl: undefined,
						thumbnail: null,
					},
				];
				const result = schema.safeParse(data);
				expect(result.success).toBe(false);
				if (!result.success) {
					const messages = result.error.issues.map((i) => i.message);
					expect(messages.some((m) => m.includes("Custom: only"))).toBe(true);
				}
			});

			it("カスタムmaxVideosメッセージが適用されること", () => {
				const schema = createVideosSchema({
					acceptedVideoTypes: ["video/mp4"],
					maxVideos: 1,
					messages: {
						maxVideos: (max) => `Custom: max ${max} videos`,
					},
				});
				const data = [
					{
						tempId: "temp_1",
						status: "new" as const,
						id: undefined,
						file: makeMp4File("a.mp4"),
						uploadedUrl: undefined,
						thumbnail: null,
					},
					{
						tempId: "temp_2",
						status: "new" as const,
						id: undefined,
						file: makeMp4File("b.mp4"),
						uploadedUrl: undefined,
						thumbnail: null,
					},
				];
				const result = schema.safeParse(data);
				expect(result.success).toBe(false);
				if (!result.success) {
					const messages = result.error.issues.map((i) => i.message);
					expect(messages.some((m) => m === "Custom: max 1 videos")).toBe(true);
				}
			});
		});
	});
}
