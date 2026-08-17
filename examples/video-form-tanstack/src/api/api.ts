import type { UploadedSubmitVideo } from "@curry-battle/react-multiple-video-form-manager";
import { generateUUIDv7, type UUID } from "../libs/Uuid";

/** 中断要求で止まる待機。転送ハンドラが ctx.signal を尊重する形を実演する */
const delay = (ms: number, signal?: AbortSignal): Promise<void> =>
	new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(signal.reason);
			return;
		}
		const timer = setTimeout(resolve, ms);
		signal?.addEventListener(
			"abort",
			() => {
				clearTimeout(timer);
				reject(signal.reason);
			},
			{ once: true },
		);
	});

export const API = {
	getPresignedUrl: async (filename: string, contentType: string) => {
		await new Promise((resolve) => setTimeout(resolve, 500));
		console.log(
			`Getting presigned URL for file ${filename}, contentType: ${contentType}`,
		);

		return {
			presignedUrl: "https://example.com/upload",
			videoId: generateUUIDv7(),
		};
	},

	uploadToS3: async (
		videoId: UUID,
		file: File,
		uploadUrl: string,
		signal?: AbortSignal,
	): Promise<string> => {
		await delay(1000, signal);
		console.log(`Uploading file: ${file.name}`);

		try {
			console.log(`Uploading to URL: ${uploadUrl}`);
		} catch (e) {
			console.error("Error during upload:", e);
		}

		const filePath = `videos/${videoId}/${file.name}`;
		return `https://s3.example.com/${filePath}`;
	},

	// 送信素材をそのまま受ける。表示順は配列の順序が表すので order は持たない
	updateVideos: async (
		videos: readonly UploadedSubmitVideo[],
		deletedVideoIds: readonly string[],
	): Promise<boolean> => {
		await new Promise((resolve) => setTimeout(resolve, 500));

		console.log(
			"Updating videos with data:",
			JSON.stringify({ videos, deletedVideoIds }, null, 2),
		);

		return true;
	},
};
