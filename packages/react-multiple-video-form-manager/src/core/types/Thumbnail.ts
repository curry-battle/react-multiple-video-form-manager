// types

export const ThumbnailSource = {
	Frame: "frame",
	Upload: "upload",
	Existing: "existing",
} as const;

export type ThumbnailSource =
	(typeof ThumbnailSource)[keyof typeof ThumbnailSource];

export type ThumbnailFromFrame = {
	source: typeof ThumbnailSource.Frame;
	blob: Blob;
	timestamp: number;
	uploadRef?: string;
};

export type ThumbnailFromUpload = {
	source: typeof ThumbnailSource.Upload;
	file: File;
	uploadRef?: string;
};

export type ThumbnailExisting = {
	source: typeof ThumbnailSource.Existing;
	uploadedUrl: string;
};

/** 新規動画用サムネイル（フレームキャプチャ or ファイルアップロード） */
export type Thumbnail = ThumbnailFromFrame | ThumbnailFromUpload;

/** 全種類のサムネイル（既存含む） */
export type AnyThumbnail = Thumbnail | ThumbnailExisting;

// --- Submit用 ---

export const ThumbnailSubmitStatus = {
	New: "new",
	Unchanged: "unchanged",
	Replaced: "replaced",
	Removed: "removed",
} as const;

export type ThumbnailSubmitStatus =
	(typeof ThumbnailSubmitStatus)[keyof typeof ThumbnailSubmitStatus];

/** 新規サムネイル（元々サムネイルなしの動画に追加） */
export type ThumbnailForSubmitNew = {
	status: typeof ThumbnailSubmitStatus.New;
	thumbnail: Thumbnail;
};

/** 既存サムネイル変更なし */
export type ThumbnailForSubmitUnchanged = {
	status: typeof ThumbnailSubmitStatus.Unchanged;
	uploadedUrl: string;
};

/** 既存サムネイルを別のものに置き換え */
export type ThumbnailForSubmitReplaced = {
	status: typeof ThumbnailSubmitStatus.Replaced;
	thumbnail: Thumbnail;
};

/** サムネイル明示削除 */
export type ThumbnailForSubmitRemoved = {
	status: typeof ThumbnailSubmitStatus.Removed;
};

export type ThumbnailForSubmit =
	| ThumbnailForSubmitNew
	| ThumbnailForSubmitUnchanged
	| ThumbnailForSubmitReplaced
	| ThumbnailForSubmitRemoved;

// utilities (setThumbnail は VideoUtils に配置)

export const ThumbnailUtils = {
	/**
	 * HTMLVideoElement の現在フレームをキャプチャしてサムネイル生成
	 */
	captureFrame: (
		videoElement: HTMLVideoElement,
	): Promise<ThumbnailFromFrame> => {
		return new Promise((resolve, reject) => {
			const canvas = document.createElement("canvas");
			canvas.width = videoElement.videoWidth;
			canvas.height = videoElement.videoHeight;

			const ctx = canvas.getContext("2d");
			if (!ctx) {
				reject(new Error("Failed to get canvas 2d context"));
				return;
			}

			try {
				ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
			} catch (e) {
				if (e instanceof DOMException && e.name === "SecurityError") {
					reject(
						new Error(
							'Failed to capture frame: canvas is tainted by cross-origin video. Set crossOrigin="anonymous" on the <video> element and ensure the server sends appropriate CORS headers.',
						),
					);
					return;
				}
				throw e;
			}

			try {
				canvas.toBlob(
					(blob) => {
						if (!blob) {
							reject(new Error("Failed to capture frame as blob"));
							return;
						}

						resolve({
							source: ThumbnailSource.Frame,
							blob,
							timestamp: videoElement.currentTime,
						});
					},
					"image/jpeg",
					0.8,
				);
			} catch (e) {
				if (e instanceof DOMException && e.name === "SecurityError") {
					reject(
						new Error(
							'Failed to capture frame: canvas is tainted by cross-origin video. Set crossOrigin="anonymous" on the <video> element and ensure the server sends appropriate CORS headers.',
						),
					);
					return;
				}
				throw e;
			}
		});
	},

	/**
	 * アップロードされたファイルからサムネイルを生成
	 */
	fromFile: (file: File): ThumbnailFromUpload => {
		return {
			source: ThumbnailSource.Upload,
			file,
		};
	},
};

if (import.meta.vitest) {
	const { describe, it, expect, vi, afterEach } = import.meta.vitest;

	describe("ThumbnailUtils", () => {
		afterEach(() => {
			vi.restoreAllMocks();
		});

		describe("fromFile", () => {
			it("ThumbnailFromUpload を返すこと", () => {
				const file = new File(["data"], "thumb.jpg", { type: "image/jpeg" });

				const result = ThumbnailUtils.fromFile(file);

				expect(result.source).toBe(ThumbnailSource.Upload);
				expect(result.file).toBe(file);
			});
		});

		describe("captureFrame", () => {
			const setupCanvasMock = (mockCanvas: unknown) => {
				const spy = vi.spyOn(document, "createElement");
				spy.mockReturnValue(mockCanvas as HTMLElement);
				return spy;
			};

			it("canvas を使ってフレームキャプチャすること", async () => {
				const mockBlob = new Blob(["fake-image"], { type: "image/jpeg" });
				const mockCtx = {
					drawImage: vi.fn(),
				};
				const mockCanvas = {
					width: 0,
					height: 0,
					getContext: vi.fn(() => mockCtx),
					toBlob: vi.fn((callback: (blob: Blob | null) => void) => {
						callback(mockBlob);
					}),
				};
				setupCanvasMock(mockCanvas);

				const mockVideoElement = {
					videoWidth: 1920,
					videoHeight: 1080,
					currentTime: 5.5,
				} as HTMLVideoElement;

				const result = await ThumbnailUtils.captureFrame(mockVideoElement);

				expect(result.source).toBe(ThumbnailSource.Frame);
				expect(result.blob).toBe(mockBlob);
				expect(result.timestamp).toBe(5.5);
				expect(mockCanvas.width).toBe(1920);
				expect(mockCanvas.height).toBe(1080);
				expect(mockCtx.drawImage).toHaveBeenCalledWith(
					mockVideoElement,
					0,
					0,
					1920,
					1080,
				);
			});

			it("canvas context が取得できない場合 reject すること", async () => {
				const mockCanvas = {
					width: 0,
					height: 0,
					getContext: vi.fn(() => null),
					toBlob: vi.fn(),
				};
				setupCanvasMock(mockCanvas);

				const mockVideoElement = {
					videoWidth: 1920,
					videoHeight: 1080,
					currentTime: 0,
				} as HTMLVideoElement;

				await expect(
					ThumbnailUtils.captureFrame(mockVideoElement),
				).rejects.toThrow("Failed to get canvas 2d context");
			});

			it("toBlob が null を返す場合 reject すること", async () => {
				const mockCtx = { drawImage: vi.fn() };
				const mockCanvas = {
					width: 0,
					height: 0,
					getContext: vi.fn(() => mockCtx),
					toBlob: vi.fn((callback: (blob: Blob | null) => void) => {
						callback(null);
					}),
				};
				setupCanvasMock(mockCanvas);

				const mockVideoElement = {
					videoWidth: 640,
					videoHeight: 480,
					currentTime: 2.0,
				} as HTMLVideoElement;

				await expect(
					ThumbnailUtils.captureFrame(mockVideoElement),
				).rejects.toThrow("Failed to capture frame as blob");
			});

			it("drawImage で SecurityError が発生した場合 CORS エラーメッセージで reject すること", async () => {
				const securityError = new DOMException(
					"The operation is insecure.",
					"SecurityError",
				);
				const mockCtx = {
					drawImage: vi.fn(() => {
						throw securityError;
					}),
				};
				const mockCanvas = {
					width: 0,
					height: 0,
					getContext: vi.fn(() => mockCtx),
					toBlob: vi.fn(),
				};
				setupCanvasMock(mockCanvas);

				const mockVideoElement = {
					videoWidth: 1920,
					videoHeight: 1080,
					currentTime: 3.0,
				} as HTMLVideoElement;

				await expect(
					ThumbnailUtils.captureFrame(mockVideoElement),
				).rejects.toThrow("canvas is tainted by cross-origin video");
			});

			it("toBlob で SecurityError が発生した場合 CORS エラーメッセージで reject すること", async () => {
				const securityError = new DOMException(
					"The operation is insecure.",
					"SecurityError",
				);
				const mockCtx = { drawImage: vi.fn() };
				const mockCanvas = {
					width: 0,
					height: 0,
					getContext: vi.fn(() => mockCtx),
					toBlob: vi.fn(() => {
						throw securityError;
					}),
				};
				setupCanvasMock(mockCanvas);

				const mockVideoElement = {
					videoWidth: 1920,
					videoHeight: 1080,
					currentTime: 3.0,
				} as HTMLVideoElement;

				await expect(
					ThumbnailUtils.captureFrame(mockVideoElement),
				).rejects.toThrow("canvas is tainted by cross-origin video");
			});
		});
	});
}
