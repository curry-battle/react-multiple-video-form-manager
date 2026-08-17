import * as v from "valibot";
import { describe, expect, it } from "vitest";
import { ThumbnailSource } from "../../core/types/Thumbnail";
import {
	invalidExistingWithBadId,
	invalidExistingWithoutUploadedUrl,
	invalidNewVideoWithBadThumbnailType,
	invalidNewVideoWithoutFile,
	invalidNewVideoWithWrongType,
	invalidVideoWithBadStatus,
	makeLargeThumbnailFile,
	makeLargeVideoFile,
	makeMp4File,
	validExistingVideo,
	validExistingVideoNoThumbnail,
	validNewVideo,
	validNewVideoWithOpaqueUploadRef,
	validNewVideoWithThumbnail,
	validNewVideoWithUploadRef,
	validThumbnailFromFrame,
	validThumbnailFromUpload,
} from "../__testdata__/videoSchemaTestData";
import {
	createDeletedVideoIdsSchema as createDeletedVideoIdsSchemaValibot,
	createVideosSchema as createVideosSchemaValibot,
} from "../valibot";
import {
	createDeletedVideoIdsSchema as createDeletedVideoIdsSchemaZod,
	createVideosSchema as createVideosSchemaZod,
} from "../zod";

type ParseResult = { success: boolean };

function parseZod(
	schema: ReturnType<typeof createVideosSchemaZod>,
	data: unknown,
): ParseResult {
	return schema.safeParse(data);
}

function parseValibot(
	schema: ReturnType<typeof createVideosSchemaValibot>,
	data: unknown,
): ParseResult {
	return v.safeParse(schema, data);
}

describe("cross-parity: Zod and Valibot schemas produce identical results", () => {
	const zodSchema = createVideosSchemaZod({
		acceptedVideoTypes: ["video/mp4", "video/webm"],
		maxVideoFileSize: 10_000_000,
		maxVideos: 5,
		acceptedThumbnailTypes: ["image/jpeg", "image/png"],
		maxThumbnailFileSize: 5_000_000,
	});

	const valibotSchema = createVideosSchemaValibot({
		acceptedVideoTypes: ["video/mp4", "video/webm"],
		maxVideoFileSize: 10_000_000,
		maxVideos: 5,
		acceptedThumbnailTypes: ["image/jpeg", "image/png"],
		maxThumbnailFileSize: 5_000_000,
	});

	const cases: [string, unknown, boolean][] = [
		["empty array", [], true],
		["valid new video", [validNewVideo], true],
		["valid new video with thumbnail", [validNewVideoWithThumbnail], true],
		["valid existing video", [validExistingVideo], true],
		[
			"valid existing video no thumbnail",
			[validExistingVideoNoThumbnail],
			true,
		],
		["valid new video with uploadRef", [validNewVideoWithUploadRef], true],
		[
			"valid new video with opaque (non-URL) uploadRef",
			[validNewVideoWithOpaqueUploadRef],
			true,
		],
		["mixed new + existing", [validNewVideo, validExistingVideo], true],
		["invalid: wrong file type", [invalidNewVideoWithWrongType], false],
		["invalid: missing file", [invalidNewVideoWithoutFile], false],
		[
			"invalid: missing uploadedUrl",
			[invalidExistingWithoutUploadedUrl],
			false,
		],
		["invalid: bad status", [invalidVideoWithBadStatus], false],
		[
			"invalid: bad thumbnail type",
			[invalidNewVideoWithBadThumbnailType],
			false,
		],
		[
			"invalid: exceeds maxVideos",
			Array.from({ length: 6 }, (_, i) => ({
				...validNewVideo,
				tempId: `temp_${i}`,
				file: makeMp4File(`${i}.mp4`),
			})),
			false,
		],
		[
			"invalid: exceeds maxVideoFileSize",
			[{ ...validNewVideo, file: makeLargeVideoFile(20_000_000) }],
			false,
		],
		[
			"invalid: exceeds maxThumbnailFileSize",
			[
				{
					...validNewVideo,
					thumbnail: {
						source: ThumbnailSource.Upload,
						file: makeLargeThumbnailFile(10_000_000),
					},
				},
			],
			false,
		],
		[
			"valid: frame thumbnail bypasses file checks",
			[{ ...validNewVideo, thumbnail: validThumbnailFromFrame }],
			true,
		],
		[
			"valid: upload thumbnail with valid type",
			[{ ...validNewVideo, thumbnail: validThumbnailFromUpload }],
			true,
		],
	];

	it.each(cases)("%s → success=%s", (_label, data, expectedSuccess) => {
		const zodResult = parseZod(zodSchema, data);
		const valibotResult = parseValibot(valibotSchema, data);

		expect(zodResult.success).toBe(expectedSuccess);
		expect(valibotResult.success).toBe(expectedSuccess);
		expect(zodResult.success).toBe(valibotResult.success);
	});

	// 型不一致でも issue が項目内のキーまで指すこと（判別が要る理由は zod.ts の videoUnion）
	describe("issue path parity", () => {
		const pathCases: [string, unknown, string][] = [
			[
				"existing video with non-boolean thumbnailRemoved",
				[{ ...validExistingVideo, thumbnailRemoved: "yes" }],
				"thumbnailRemoved",
			],
			[
				"new video with non-string uploadRef",
				[{ ...validNewVideo, uploadRef: 42 }],
				"uploadRef",
			],
			[
				"new video with non-string replacesId",
				[{ ...validNewVideo, replacesId: 42 }],
				"replacesId",
			],
		];

		it.each(pathCases)("%s → both point at %s", (_label, data, key) => {
			const zodResult = zodSchema.safeParse(data);
			const valibotResult = v.safeParse(valibotSchema, data);

			expect(zodResult.success).toBe(false);
			expect(valibotResult.success).toBe(false);

			const zodPaths = zodResult.error?.issues.map((i) => i.path.join("."));
			expect(zodPaths).toContain(`0.${key}`);

			const valibotPaths = valibotResult.issues?.map((i) =>
				(i.path ?? []).map((p: { key: unknown }) => String(p.key)).join("."),
			);
			expect(valibotPaths).toContain(`0.${key}`);
		});
	});

	describe("idValidation parity", () => {
		const isUuid = (id: string) =>
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
				id,
			);

		const zodWithId = createVideosSchemaZod({
			acceptedVideoTypes: ["video/mp4"],
			idValidation: isUuid,
		});

		const valibotWithId = createVideosSchemaValibot({
			acceptedVideoTypes: ["video/mp4"],
			idValidation: isUuid,
		});

		it("valid UUID → both accept", () => {
			expect(parseZod(zodWithId, [validExistingVideo]).success).toBe(true);
			expect(parseValibot(valibotWithId, [validExistingVideo]).success).toBe(
				true,
			);
		});

		it("invalid UUID → both reject", () => {
			expect(parseZod(zodWithId, [invalidExistingWithBadId]).success).toBe(
				false,
			);
			expect(
				parseValibot(valibotWithId, [invalidExistingWithBadId]).success,
			).toBe(false);
		});
	});

	describe("deletedVideoIds schema parity", () => {
		const zodDeleted = createDeletedVideoIdsSchemaZod();
		const valibotDeleted = createDeletedVideoIdsSchemaValibot();

		const deletedCases: [string, unknown, boolean][] = [
			["empty array", [], true],
			["valid ids", ["id1", "id2"], true],
			["invalid: number in array", [123], false],
			["invalid: not an array", "not-array", false],
		];

		it.each(deletedCases)(
			"%s → success=%s",
			(_label, data, expectedSuccess) => {
				const zodResult = zodDeleted.safeParse(data);
				const valibotResult = v.safeParse(valibotDeleted, data);

				expect(zodResult.success).toBe(expectedSuccess);
				expect(valibotResult.success).toBe(expectedSuccess);
			},
		);

		it("with idValidation: both reject invalid ids", () => {
			const isUuid = (id: string) =>
				/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
					id,
				);

			const zodWithValidation = createDeletedVideoIdsSchemaZod({
				idValidation: isUuid,
			});
			const valibotWithValidation = createDeletedVideoIdsSchemaValibot({
				idValidation: isUuid,
			});

			expect(zodWithValidation.safeParse(["not-uuid"]).success).toBe(false);
			expect(v.safeParse(valibotWithValidation, ["not-uuid"]).success).toBe(
				false,
			);

			const validId = "019415a9-7c6c-7bf0-9c0f-1a2b3c4d5e6f";
			expect(zodWithValidation.safeParse([validId]).success).toBe(true);
			expect(v.safeParse(valibotWithValidation, [validId]).success).toBe(true);
		});
	});
});
