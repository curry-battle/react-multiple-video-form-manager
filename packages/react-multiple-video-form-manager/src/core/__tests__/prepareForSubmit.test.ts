import { describe, expect, it, vi } from "vitest";
import { PrepareForSubmitError, prepareForSubmit } from "../prepareForSubmit";
import { ThumbnailSource } from "../types/Thumbnail";
import type { UploadFileContext } from "../types/Upload";
import { UploadKind } from "../types/Upload";
import type { VideoExisting, VideoNew } from "../types/Video";
import { VideoFormStatus } from "../types/VideoStatus";

const makeNewVideo = (overrides?: Partial<VideoNew>): VideoNew => ({
	tempId: "temp_new-1",
	status: VideoFormStatus.New,
	id: undefined,
	file: new File(["data"], "test.mp4", { type: "video/mp4" }),
	thumbnail: null,
	...overrides,
});

const makeExistingVideo = (
	overrides?: Partial<VideoExisting>,
): VideoExisting => ({
	tempId: "temp_existing-1",
	status: VideoFormStatus.Existing,
	id: "uuid-1",
	file: undefined,
	uploadedUrl: "https://s3.example.com/existing.mp4",
	thumbnail: null,
	thumbnailRemoved: false,
	...overrides,
});

describe("prepareForSubmit", () => {
	it("resolves existing videos without upload", async () => {
		const existing = makeExistingVideo();
		const result = await prepareForSubmit([existing], []);

		expect(result.videos).toHaveLength(1);
		expect(result.videos[0]).toEqual({
			tempId: existing.tempId,
			id: existing.id,
			status: VideoFormStatus.Existing,
			order: 0,
			uploadedUrl: existing.uploadedUrl,
			thumbnail: null,
		});
	});

	it("resolves new videos with upload-on-select (uploadRef already set)", async () => {
		const video = makeNewVideo({
			uploadRef: "https://s3.example.com/already-uploaded.mp4",
		});
		const result = await prepareForSubmit([video], []);

		expect(result.videos[0].uploadedUrl).toBe(
			"https://s3.example.com/already-uploaded.mp4",
		);
	});

	it("uploads new videos via uploadFile callback", async () => {
		const video = makeNewVideo();
		const uploadFile = vi.fn().mockResolvedValue({
			uploadRef: "https://s3.example.com/uploaded.mp4",
		});

		const result = await prepareForSubmit([video], [], { uploadFile });

		expect(uploadFile).toHaveBeenCalledWith(
			video.file,
			expect.objectContaining({ kind: UploadKind.Video }),
		);
		expect(result.videos[0].uploadedUrl).toBe(
			"https://s3.example.com/uploaded.mp4",
		);
	});

	it("skips upload for new videos that already have uploadRef (upload-on-select)", async () => {
		const video = makeNewVideo({
			uploadRef: "https://s3.example.com/on-select.mp4",
		});
		const uploadFile = vi.fn();

		await prepareForSubmit([video], [], { uploadFile });

		expect(uploadFile).not.toHaveBeenCalled();
	});

	it("throws PrepareForSubmitError when new video has no uploadRef and no uploadFile", async () => {
		const video = makeNewVideo();

		await expect(prepareForSubmit([video], [])).rejects.toThrow(
			PrepareForSubmitError,
		);
	});

	it("collects all successful URLs even when some uploads fail (allSettled)", async () => {
		const v1 = makeNewVideo({ tempId: "temp_1" });
		const v2 = makeNewVideo({ tempId: "temp_2" });
		const v3 = makeNewVideo({ tempId: "temp_3" });

		let resolveSecond: (v: { uploadRef: string }) => void;
		const secondPromise = new Promise<{ uploadRef: string }>((r) => {
			resolveSecond = r;
		});

		const uploadFile = vi
			.fn()
			.mockResolvedValueOnce({
				uploadRef: "https://s3.example.com/v1.mp4",
			})
			.mockRejectedValueOnce(new Error("upload failed"))
			.mockImplementationOnce(() => {
				// v3 resolves after v2 fails — allSettled waits for this
				resolveSecond!({ uploadRef: "https://s3.example.com/v3.mp4" });
				return secondPromise;
			});

		try {
			await prepareForSubmit([v1, v2, v3], [], { uploadFile });
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(PrepareForSubmitError);
			const e = err as PrepareForSubmitError;
			expect(e.successfulUploadRefs).toContain("https://s3.example.com/v1.mp4");
			expect(e.successfulUploadRefs).toContain("https://s3.example.com/v3.mp4");
			expect(e.successfulUploadRefs).toHaveLength(2);
		}
	});

	it("includes successful upload URLs in error for orphan cleanup", async () => {
		const v1 = makeNewVideo({ tempId: "temp_1" });
		const v2 = makeNewVideo({ tempId: "temp_2" });
		const uploadFile = vi
			.fn()
			.mockResolvedValueOnce({
				uploadRef: "https://s3.example.com/success.mp4",
			})
			.mockRejectedValueOnce(new Error("upload failed"));

		try {
			await prepareForSubmit([v1, v2], [], { uploadFile });
		} catch (err) {
			expect(err).toBeInstanceOf(PrepareForSubmitError);
			expect((err as PrepareForSubmitError).successfulUploadRefs).toContain(
				"https://s3.example.com/success.mp4",
			);
		}
	});

	it("resolves unchanged thumbnail on existing video", async () => {
		const video = makeExistingVideo({
			thumbnail: {
				source: ThumbnailSource.Existing,
				uploadedUrl: "https://s3.example.com/thumb.jpg",
			},
		});
		const result = await prepareForSubmit([video], []);

		expect(result.videos[0].thumbnail).toEqual({
			status: "unchanged",
			uploadedUrl: "https://s3.example.com/thumb.jpg",
		});
	});

	it("resolves removed thumbnail", async () => {
		const video = makeExistingVideo({
			thumbnail: null,
			thumbnailRemoved: true,
		});
		const result = await prepareForSubmit([video], []);

		expect(result.videos[0].thumbnail).toEqual({ status: "removed" });
	});

	it("uploads new thumbnail through the shared handler with kind: thumbnail", async () => {
		const thumbFile = new File(["thumb"], "thumb.jpg", { type: "image/jpeg" });
		const video = makeNewVideo({
			thumbnail: { source: ThumbnailSource.Upload, file: thumbFile },
		});
		const uploadFile = vi.fn(async (_file: File, ctx: UploadFileContext) => ({
			uploadRef:
				ctx.kind === UploadKind.Thumbnail
					? "https://s3.example.com/thumb.jpg"
					: "https://s3.example.com/video.mp4",
		}));

		const result = await prepareForSubmit([video], [], { uploadFile });

		expect(uploadFile).toHaveBeenCalledWith(
			thumbFile,
			expect.objectContaining({ kind: UploadKind.Thumbnail }),
		);
		expect(uploadFile).toHaveBeenCalledWith(
			video.file,
			expect.objectContaining({ kind: UploadKind.Video }),
		);
		expect(result.videos[0].thumbnail).toEqual({
			status: "new",
			source: ThumbnailSource.Upload,
			uploadedUrl: "https://s3.example.com/thumb.jpg",
		});
	});

	it("uses pre-uploaded thumbnail URL (upload-on-select)", async () => {
		const thumbFile = new File(["thumb"], "thumb.jpg", { type: "image/jpeg" });
		const video = makeNewVideo({
			uploadRef: "https://s3.example.com/video.mp4",
			thumbnail: {
				source: ThumbnailSource.Upload,
				file: thumbFile,
				uploadRef: "https://s3.example.com/thumb-on-select.jpg",
			},
		});
		const uploadFile = vi.fn();

		const result = await prepareForSubmit([video], [], { uploadFile });

		expect(uploadFile).not.toHaveBeenCalled();
		expect(result.videos[0].thumbnail?.status).toBe("new");
		if (
			result.videos[0].thumbnail?.status === "new" ||
			result.videos[0].thumbnail?.status === "replaced"
		) {
			expect(result.videos[0].thumbnail.uploadedUrl).toBe(
				"https://s3.example.com/thumb-on-select.jpg",
			);
		}
	});

	it("uploads frame-captured thumbnail (blob → File conversion)", async () => {
		const video = makeNewVideo({
			uploadRef: "https://s3.example.com/video.mp4",
			thumbnail: {
				source: ThumbnailSource.Frame,
				blob: new Blob(["thumb"], { type: "image/jpeg" }),
				timestamp: 1.5,
			},
		});
		const uploadFile = vi
			.fn()
			.mockResolvedValue({ uploadRef: "https://s3.example.com/thumb.jpg" });

		const result = await prepareForSubmit([video], [], { uploadFile });

		const calledFile = uploadFile.mock.calls[0][0] as File;
		expect(calledFile).toBeInstanceOf(File);
		expect(calledFile.name).toBe("thumbnail.jpg");
		expect(result.videos[0].thumbnail).toEqual({
			status: "new",
			source: ThumbnailSource.Frame,
			uploadedUrl: "https://s3.example.com/thumb.jpg",
		});
	});

	it("preserves order based on array position", async () => {
		const v1 = makeExistingVideo({ tempId: "temp_a" });
		const v2 = makeExistingVideo({
			tempId: "temp_b",
			id: "uuid-2",
			uploadedUrl: "https://s3.example.com/b.mp4",
		});

		const result = await prepareForSubmit([v1, v2], []);
		expect(result.videos.map((v) => v.order)).toEqual([0, 1]);
	});

	it("passes through deletedIds", async () => {
		const result = await prepareForSubmit([], ["deleted-1", "deleted-2"]);
		expect(result.deletedIds).toEqual(["deleted-1", "deleted-2"]);
	});

	it("handles replaced thumbnail on existing video", async () => {
		const thumbFile = new File(["new-thumb"], "new-thumb.jpg", {
			type: "image/jpeg",
		});
		const video = makeExistingVideo({
			thumbnail: { source: ThumbnailSource.Upload, file: thumbFile },
			thumbnailRemoved: true,
		});
		const uploadFile = vi.fn().mockResolvedValue({
			uploadRef: "https://s3.example.com/replaced-thumb.jpg",
		});

		const result = await prepareForSubmit([video], [], { uploadFile });

		expect(result.videos[0].thumbnail).toEqual({
			status: "replaced",
			source: ThumbnailSource.Upload,
			uploadedUrl: "https://s3.example.com/replaced-thumb.jpg",
		});
	});

	it("throws when thumbnail has no uploadRef and no uploadFile", async () => {
		const thumbFile = new File(["thumb"], "thumb.jpg", { type: "image/jpeg" });
		const video = makeNewVideo({
			uploadRef: "https://s3.example.com/video.mp4",
			thumbnail: { source: ThumbnailSource.Upload, file: thumbFile },
		});

		await expect(prepareForSubmit([video], [])).rejects.toThrow(
			PrepareForSubmitError,
		);
		await expect(prepareForSubmit([video], [])).rejects.toThrow(
			/Missing uploadRef for thumbnail/,
		);
	});
});
