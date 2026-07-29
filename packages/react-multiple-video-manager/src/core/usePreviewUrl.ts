import { useEffect, useState } from "react";
import type { AnyThumbnail } from "./types/Thumbnail";
import { ThumbnailSource } from "./types/Thumbnail";
import type { Video } from "./types/Video";
import { VideoFormStatus } from "./types/VideoStatus";

/**
 * Blob/File から blob URL を生成し、参照変更・unmount 時に revoke する内部フック。
 *
 * useEffect 内で生成と revoke を同じライフサイクルに置くことで、
 * StrictMode の setup→cleanup→setup サイクルでも
 * 生成回数 = revoke 回数が保証される。
 */
function useObjectUrl(blobSource: Blob | File | null): string | undefined {
	const [url, setUrl] = useState<string | undefined>(undefined);

	useEffect(() => {
		if (!blobSource) {
			setUrl(undefined);
			return;
		}
		const objectUrl = URL.createObjectURL(blobSource);
		setUrl(objectUrl);
		return () => {
			URL.revokeObjectURL(objectUrl);
		};
	}, [blobSource]);

	return url;
}

/**
 * 動画の表示用 URL を導出するフック。
 *
 * VideoNew → file から blob URL を生成（unmount / file 変更時に revoke）。
 * VideoExisting → uploadedUrl をそのまま返す。
 */
export function usePreviewUrl(video: Video): string | undefined {
	const file = video.status === VideoFormStatus.New ? video.file : null;
	const blobUrl = useObjectUrl(file);

	if (video.status === VideoFormStatus.Existing) {
		return video.uploadedUrl;
	}
	return blobUrl;
}

/**
 * サムネイルの表示用 URL を導出するフック。
 *
 * ThumbnailFromFrame → blob から blob URL を生成。
 * ThumbnailFromUpload → file から blob URL を生成。
 * ThumbnailExisting → uploadedUrl をそのまま返す。
 * null → undefined を返す。
 */
export function useThumbnailPreviewUrl(
	thumbnail: AnyThumbnail | null,
): string | undefined {
	const blobSource =
		thumbnail?.source === ThumbnailSource.Frame
			? thumbnail.blob
			: thumbnail?.source === ThumbnailSource.Upload
				? thumbnail.file
				: null;

	const blobUrl = useObjectUrl(blobSource);

	if (thumbnail?.source === ThumbnailSource.Existing) {
		return thumbnail.uploadedUrl;
	}
	return blobUrl;
}
