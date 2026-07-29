import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "vitest-browser-react";
import { setupBrowserMocks } from "../../__testutils__/browserMocks";
import type { AnyThumbnail } from "../types/Thumbnail";
import { ThumbnailSource } from "../types/Thumbnail";
import type { VideoExisting, VideoNew } from "../types/Video";
import { VideoFormStatus } from "../types/VideoStatus";
import { usePreviewUrl, useThumbnailPreviewUrl } from "../usePreviewUrl";

// --- Helpers ---

const makeNewVideo = (overrides?: Partial<VideoNew>): VideoNew => ({
	tempId: "temp_test",
	status: VideoFormStatus.New,
	id: undefined,
	file: new File(["data"], "test.mp4", { type: "video/mp4" }),
	uploadedUrl: undefined,
	thumbnail: null,
	...overrides,
});

const makeExistingVideo = (
	overrides?: Partial<VideoExisting>,
): VideoExisting => ({
	tempId: "temp_existing",
	status: VideoFormStatus.Existing,
	id: "id-1",
	uploadedUrl: "https://s3.example.com/video.mp4",
	file: undefined,
	thumbnail: null,
	thumbnailRemoved: false,
	...overrides,
});

// --- Tests ---

describe("usePreviewUrl", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("VideoNew に対して blob URL を返すこと", async () => {
		const { createObjectURL } = setupBrowserMocks();
		const video = makeNewVideo();
		const { result } = await renderHook(() => usePreviewUrl(video));
		expect(result.current).toMatch(/^blob:/);
		expect(createObjectURL).toHaveBeenCalledWith(video.file);
	});

	it("VideoExisting に対して uploadedUrl を返すこと", async () => {
		const video = makeExistingVideo();
		const { result } = await renderHook(() => usePreviewUrl(video));
		expect(result.current).toBe("https://s3.example.com/video.mp4");
	});

	it("VideoExisting に対して blob URL を生成しないこと", async () => {
		const { createObjectURL } = setupBrowserMocks();
		const video = makeExistingVideo();
		await renderHook(() => usePreviewUrl(video));
		expect(createObjectURL).not.toHaveBeenCalled();
	});

	it("unmount 時に blob URL が revoke されること", async () => {
		const { revokeObjectURL, createObjectURL } = setupBrowserMocks();
		const video = makeNewVideo();
		const { unmount } = await renderHook(() => usePreviewUrl(video));
		const createdUrl = createObjectURL.mock.results.at(-1)?.value;
		await unmount();
		expect(revokeObjectURL).toHaveBeenCalledWith(createdUrl);
	});

	it("VideoExisting の unmount 時に revoke しないこと", async () => {
		const { revokeObjectURL } = setupBrowserMocks();
		const video = makeExistingVideo();
		const { unmount } = await renderHook(() => usePreviewUrl(video));
		await unmount();
		expect(revokeObjectURL).not.toHaveBeenCalled();
	});

	it("[url-lifecycle] unmount → remount 後、revoke 済み URL を参照しないこと", async () => {
		const { createObjectURL } = setupBrowserMocks();
		const video = makeNewVideo();

		const { result: r1, unmount } = await renderHook(() =>
			usePreviewUrl(video),
		);
		const url1 = r1.current;
		expect(url1).toMatch(/^blob:/);

		await unmount();

		const { result: r2 } = await renderHook(() => usePreviewUrl(video));
		const url2 = r2.current;
		expect(url2).toMatch(/^blob:/);
		expect(url2).not.toBe(url1);
		expect(createObjectURL.mock.calls.length).toBeGreaterThanOrEqual(2);
	});
});

describe("useThumbnailPreviewUrl", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("ThumbnailFromFrame に対して blob URL を返すこと", async () => {
		const { createObjectURL } = setupBrowserMocks();
		const thumbnail: AnyThumbnail = {
			source: ThumbnailSource.Frame,
			blob: new Blob(["data"]),
			timestamp: 1.0,
		};
		const { result } = await renderHook(() =>
			useThumbnailPreviewUrl(thumbnail),
		);
		expect(result.current).toMatch(/^blob:/);
		expect(createObjectURL).toHaveBeenCalledWith(thumbnail.blob);
	});

	it("ThumbnailFromUpload に対して blob URL を返すこと", async () => {
		const { createObjectURL } = setupBrowserMocks();
		const thumbnail: AnyThumbnail = {
			source: ThumbnailSource.Upload,
			file: new File(["data"], "t.jpg", { type: "image/jpeg" }),
		};
		const { result } = await renderHook(() =>
			useThumbnailPreviewUrl(thumbnail),
		);
		expect(result.current).toMatch(/^blob:/);
		expect(createObjectURL).toHaveBeenCalledWith(thumbnail.file);
	});

	it("ThumbnailExisting に対して uploadedUrl を返すこと", async () => {
		const thumbnail: AnyThumbnail = {
			source: ThumbnailSource.Existing,
			uploadedUrl: "https://s3.example.com/thumb.jpg",
		};
		const { result } = await renderHook(() =>
			useThumbnailPreviewUrl(thumbnail),
		);
		expect(result.current).toBe("https://s3.example.com/thumb.jpg");
	});

	it("null に対して undefined を返すこと", async () => {
		const { result } = await renderHook(() => useThumbnailPreviewUrl(null));
		expect(result.current).toBeUndefined();
	});

	it("unmount 時に blob URL が revoke されること", async () => {
		const { revokeObjectURL, createObjectURL } = setupBrowserMocks();
		const thumbnail: AnyThumbnail = {
			source: ThumbnailSource.Upload,
			file: new File(["data"], "t.jpg", { type: "image/jpeg" }),
		};
		const { unmount } = await renderHook(() =>
			useThumbnailPreviewUrl(thumbnail),
		);
		const createdUrl = createObjectURL.mock.results.at(-1)?.value;
		await unmount();
		expect(revokeObjectURL).toHaveBeenCalledWith(createdUrl);
	});

	it("ThumbnailExisting の unmount 時に revoke しないこと", async () => {
		const { revokeObjectURL } = setupBrowserMocks();
		const thumbnail: AnyThumbnail = {
			source: ThumbnailSource.Existing,
			uploadedUrl: "https://s3.example.com/thumb.jpg",
		};
		const { unmount } = await renderHook(() =>
			useThumbnailPreviewUrl(thumbnail),
		);
		await unmount();
		expect(revokeObjectURL).not.toHaveBeenCalled();
	});
});
