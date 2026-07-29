import { createVideosSchema } from "@curry-battle/react-multiple-video-manager/schemas/zod";
import { z } from "zod";
import { isUUID } from "../../libs/Uuid";

const videosSchema = createVideosSchema({
	acceptedVideoTypes: ["video/mp4", "video/webm"],
	maxVideoFileSize: 100 * 1024 * 1024, // 100MB
	maxVideos: 5,
	acceptedThumbnailTypes: ["image/jpeg", "image/png"],
	maxThumbnailFileSize: 5 * 1024 * 1024, // 5MB
	idValidation: (id) => isUUID(id),
	idMessage: "ID must be a valid UUID",
});

export const videoPostSchema = z.object({
	videos: videosSchema,
	videosDeletedIds: z.array(z.string()),
});

export type VideoPostFormType = z.infer<typeof videoPostSchema>;
