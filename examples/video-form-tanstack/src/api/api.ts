import { generateUUIDv7, type UUID } from "../libs/Uuid";

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
	): Promise<string> => {
		await new Promise((resolve) => setTimeout(resolve, 1000));
		console.log(`Uploading file: ${file.name}`);

		try {
			console.log(`Uploading to URL: ${uploadUrl}`);
		} catch (e) {
			console.error("Error during upload:", e);
		}

		const filePath = `videos/${videoId}/${file.name}`;
		return `https://s3.example.com/${filePath}`;
	},

	updateVideos: async (
		videos: {
			id?: string;
			status: string;
			order: number;
			uploadedUrl?: string;
			thumbnail?: {
				status: string;
				source?: string;
				uploadedUrl?: string;
			};
		}[],
		deletedVideoIds: string[],
	): Promise<boolean> => {
		await new Promise((resolve) => setTimeout(resolve, 500));

		console.log(
			"Updating videos with data:",
			JSON.stringify({ videos, deletedVideoIds }, null, 2),
		);

		return true;
	},
};
