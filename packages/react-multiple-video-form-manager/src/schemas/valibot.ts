import * as v from "valibot";
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
		? v.pipe(v.string(), v.check(idValidation, idMessage ?? "Invalid ID"))
		: v.string();

	const baseVideoSchema = {
		tempId: v.string(),
	};

	// --- 動画ファイルスキーマ ---
	const videoFileChecks: v.PipeItem<File, File, v.BaseIssue<unknown>>[] = [
		v.check(
			(file: File) => acceptedVideoTypes.includes(file.type),
			invalidVideoTypeMsg(acceptedVideoTypes),
		),
	];

	if (maxVideoFileSize !== undefined) {
		videoFileChecks.push(
			v.check(
				(file: File) => file.size <= maxVideoFileSize,
				maxVideoSizeMsg(maxVideoFileSize),
			),
		);
	}

	const videoFileSchema = v.pipe(v.instance(File), ...videoFileChecks);

	// --- サムネイルファイルスキーマ ---
	const thumbnailFileChecks: v.PipeItem<File, File, v.BaseIssue<unknown>>[] =
		[];

	if (acceptedThumbnailTypes !== undefined) {
		thumbnailFileChecks.push(
			v.check(
				(file: File) => acceptedThumbnailTypes.includes(file.type),
				invalidThumbnailTypeMsg(acceptedThumbnailTypes),
			),
		);
	}

	if (maxThumbnailFileSize !== undefined) {
		thumbnailFileChecks.push(
			v.check(
				(file: File) => file.size <= maxThumbnailFileSize,
				maxThumbnailSizeMsg(maxThumbnailFileSize),
			),
		);
	}

	const thumbnailUploadFileSchema =
		thumbnailFileChecks.length > 0
			? v.pipe(v.instance(File), ...thumbnailFileChecks)
			: v.instance(File);

	// --- サムネイルスキーマ ---
	const thumbnailFromFrameSchema = v.object({
		source: v.literal(ThumbnailSource.Frame),
		blob: v.instance(Blob),
		timestamp: v.number(),
		uploadRef: v.optional(v.string()),
	});

	const thumbnailFromUploadSchema = v.object({
		source: v.literal(ThumbnailSource.Upload),
		file: thumbnailUploadFileSchema,
		uploadRef: v.optional(v.string()),
	});

	const thumbnailExistingSchema = v.object({
		source: v.literal(ThumbnailSource.Existing),
		uploadedUrl: v.pipe(v.string(), v.url()),
	});

	// --- 動画スキーマ ---
	const newVideoSchema = v.object({
		...baseVideoSchema,
		status: v.literal(VideoFormStatus.New),
		id: v.undefined(),
		file: videoFileSchema,
		uploadRef: v.optional(v.string()),
		// 差し替え元の既存動画の id。id と同じ検証をかける
		replacesId: v.optional(idSchema),
		thumbnail: v.nullable(
			v.union([thumbnailFromFrameSchema, thumbnailFromUploadSchema]),
		),
	});

	const existingVideoSchema = v.object({
		...baseVideoSchema,
		status: v.literal(VideoFormStatus.Existing),
		id: idSchema,
		file: v.undefined(),
		uploadedUrl: v.pipe(v.string(), v.url()),
		thumbnail: v.nullable(
			v.union([
				thumbnailFromFrameSchema,
				thumbnailFromUploadSchema,
				thumbnailExistingSchema,
			]),
		),
		thumbnailRemoved: v.boolean(),
	});

	// variant にする理由は zod.ts の videoUnion と同じ
	const videoUnion = v.variant("status", [newVideoSchema, existingVideoSchema]);

	if (maxVideos !== undefined) {
		return v.pipe(
			v.array(videoUnion),
			v.check((videos) => videos.length <= maxVideos, maxVideosMsg(maxVideos)),
		);
	}

	return v.array(videoUnion);
}

export function createDeletedVideoIdsSchema(options?: {
	idValidation?: (id: string) => boolean;
	idMessage?: string;
}) {
	const idSchema = options?.idValidation
		? v.pipe(
				v.string(),
				v.check(options.idValidation, options.idMessage ?? "Invalid ID"),
			)
		: v.string();
	return v.array(idSchema);
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

	describe("createVideosSchema (valibot)", () => {
		describe("基本動作（acceptedVideoTypesのみ指定）", () => {
			it("空配列を受け入れること", () => {
				expect(v.safeParse(videosSchema, []).success).toBe(true);
			});

			it("正しいVideoNew配列を受け入れること", () => {
				expect(v.safeParse(videosSchema, [validNewVideo]).success).toBe(true);
			});

			it("サムネイル付きVideoNewを受け入れること", () => {
				expect(
					v.safeParse(videosSchema, [validNewVideoWithThumbnail]).success,
				).toBe(true);
			});

			it("正しいVideoExisting配列を受け入れること", () => {
				expect(v.safeParse(videosSchema, [validExistingVideo]).success).toBe(
					true,
				);
			});

			it("サムネイルなしVideoExistingを受け入れること", () => {
				expect(
					v.safeParse(videosSchema, [validExistingVideoNoThumbnail]).success,
				).toBe(true);
			});

			it("2種混合配列を受け入れること", () => {
				expect(
					v.safeParse(videosSchema, [validNewVideo, validExistingVideo])
						.success,
				).toBe(true);
			});
		});

		describe("uploadRef", () => {
			it("uploadRef付きVideoNewを受け入れること", () => {
				expect(
					v.safeParse(videosSchema, [validNewVideoWithUploadRef]).success,
				).toBe(true);
			});

			it("URL形式でないuploadRefでも受け入れること", () => {
				expect(
					v.safeParse(videosSchema, [validNewVideoWithOpaqueUploadRef]).success,
				).toBe(true);
			});
		});

		describe("異常系（基本）", () => {
			it("file.typeが不正なVideoNew → reject", () => {
				expect(
					v.safeParse(videosSchema, [invalidNewVideoWithWrongType]).success,
				).toBe(false);
			});

			it("fileが存在しないVideoNew → reject", () => {
				expect(
					v.safeParse(videosSchema, [invalidNewVideoWithoutFile]).success,
				).toBe(false);
			});

			it("idが任意の文字列でもデフォルトでは受け入れること", () => {
				expect(
					v.safeParse(videosSchema, [invalidExistingWithBadId]).success,
				).toBe(true);
			});

			it("uploadedUrlがないVideoExisting → reject", () => {
				expect(
					v.safeParse(videosSchema, [invalidExistingWithoutUploadedUrl])
						.success,
				).toBe(false);
			});

			it("不正なstatus値 → reject", () => {
				expect(
					v.safeParse(videosSchema, [invalidVideoWithBadStatus]).success,
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
				expect(v.safeParse(schema, [invalidExistingWithBadId]).success).toBe(
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
				expect(v.safeParse(schema, [validExistingVideo]).success).toBe(true);
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
				expect(v.safeParse(schema, data).success).toBe(true);
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
				expect(v.safeParse(schema, data).success).toBe(false);
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
				expect(v.safeParse(schema, data).success).toBe(false);
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
				expect(v.safeParse(schema, data).success).toBe(true);
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
				expect(v.safeParse(schema, data).success).toBe(true);
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
				expect(v.safeParse(schema, data).success).toBe(false);
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
				expect(v.safeParse(schema, data).success).toBe(true);
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
				expect(v.safeParse(schema, data).success).toBe(true);
			});
		});

		describe("サムネイルバリデーション", () => {
			it("acceptedThumbnailTypes指定時、不正な形式をrejectすること", () => {
				const schema = createVideosSchema({
					acceptedVideoTypes: ["video/mp4"],
					acceptedThumbnailTypes: ["image/jpeg", "image/png"],
				});
				expect(
					v.safeParse(schema, [invalidNewVideoWithBadThumbnailType]).success,
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
				expect(v.safeParse(schema, data).success).toBe(true);
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
				expect(v.safeParse(schema, data).success).toBe(false);
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
				expect(v.safeParse(schema, data).success).toBe(true);
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
				const result = v.safeParse(schema, data);
				expect(result.success).toBe(false);
				if (!result.success) {
					const messages = result.issues.map((i) => i.message);
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
				const result = v.safeParse(schema, data);
				expect(result.success).toBe(false);
				if (!result.success) {
					const messages = result.issues.map((i) => i.message);
					expect(messages.some((m) => m === "Custom: max 1 videos")).toBe(true);
				}
			});
		});
	});
}
