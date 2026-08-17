import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { useForm as useTanstackForm } from "@tanstack/react-form";
import type { ChangeEvent, ReactNode } from "react";
import { useEffect, useRef } from "react";
import { useForm as useRhfForm } from "react-hook-form";
import { z } from "zod";
import type { MultiVideoError } from "../../core/types/MultiVideoError";
import type {
	ProcessFileFn,
	UploadFileFn,
	Video,
	VideoExisting,
	VideoNew,
} from "../../core/types/Video";
import { VideoFormStatus } from "../../core/types/VideoStatus";
import { usePreviewUrl } from "../../core/usePreviewUrl";
import { MultiVideoController as RhfController } from "../../react-hook-form/MultiVideoController";
import {
	createDeletedVideoIdsSchema,
	createVideosSchema,
} from "../../schemas/zod";
import { MultiVideoController as TanstackController } from "../../tanstack-form/MultiVideoController";

// ---------- helpers ----------

export const makeFile = (name = "a.mp4", type = "video/mp4") =>
	new File(["data"], name, { type });

export const makeExisting = (tempId: string, id: string): VideoExisting => ({
	tempId,
	status: VideoFormStatus.Existing,
	id,
	file: undefined,
	uploadedUrl: `https://s3.example.com/${id}.mp4`,
	thumbnail: null,
	thumbnailRemoved: false,
});

export const makeNew = (tempId: string): VideoNew => ({
	tempId,
	status: VideoFormStatus.New,
	id: undefined,
	file: makeFile(),
	uploadRef: undefined,
	thumbnail: null,
});

// ---------- shared VideoItem component ----------

function VideoItem({
	video,
	index,
	onChangeFile,
	onDelete,
	onMoveUp,
	onMoveDown,
	onSetThumbnail,
	onCaptureThumbnail,
	onRemoveThumbnail,
	isFirst,
	isLast,
	error,
	thumbnailError,
}: {
	video: Video;
	index: number;
	onChangeFile: (tempId: string, file: File) => void;
	onDelete: (tempId: string) => void;
	onMoveUp: (tempId: string) => void;
	onMoveDown: (tempId: string) => void;
	onSetThumbnail: (tempId: string, file: File) => void;
	onCaptureThumbnail: (tempId: string) => void;
	onRemoveThumbnail: (tempId: string) => void;
	isFirst: boolean;
	isLast: boolean;
	error: string | undefined;
	thumbnailError: string | undefined;
}) {
	const previewUrl = usePreviewUrl(video);

	return (
		<div data-testid={`video-item-${index}`}>
			{previewUrl && (
				<img
					src={previewUrl}
					alt={`video-${index}`}
					data-testid={`preview-${index}`}
				/>
			)}
			<span data-testid={`status-${index}`}>{video.status}</span>
			<span data-testid={`name-${index}`}>
				{video.status === VideoFormStatus.New ? video.file.name : video.id}
			</span>
			{video.status === VideoFormStatus.New && video.uploadRef && (
				<span data-testid={`upload-ref-${index}`}>{video.uploadRef}</span>
			)}
			<span data-testid={`has-thumbnail-${index}`}>
				{video.thumbnail ? "yes" : "no"}
			</span>
			<button
				type="button"
				data-testid={`move-up-${index}`}
				disabled={isFirst}
				onClick={() => onMoveUp(video.tempId)}
			>
				up
			</button>
			<button
				type="button"
				data-testid={`move-down-${index}`}
				disabled={isLast}
				onClick={() => onMoveDown(video.tempId)}
			>
				down
			</button>
			<label data-testid={`change-label-${index}`}>
				change
				<input
					type="file"
					accept="video/*"
					data-testid={`change-input-${index}`}
					onChange={(e: ChangeEvent<HTMLInputElement>) => {
						const f = e.target.files?.[0];
						if (f) onChangeFile(video.tempId, f);
					}}
				/>
			</label>
			<label data-testid={`thumbnail-label-${index}`}>
				thumbnail
				<input
					type="file"
					accept="image/*"
					data-testid={`thumbnail-input-${index}`}
					onChange={(e: ChangeEvent<HTMLInputElement>) => {
						const f = e.target.files?.[0];
						if (f) onSetThumbnail(video.tempId, f);
					}}
				/>
			</label>
			<button
				type="button"
				data-testid={`capture-thumbnail-${index}`}
				onClick={() => onCaptureThumbnail(video.tempId)}
			>
				capture-thumb
			</button>
			<button
				type="button"
				data-testid={`remove-thumbnail-${index}`}
				onClick={() => onRemoveThumbnail(video.tempId)}
			>
				remove-thumb
			</button>
			<button
				type="button"
				data-testid={`delete-${index}`}
				onClick={() => onDelete(video.tempId)}
			>
				delete
			</button>
			{error && <span data-testid={`error-${index}`}>{error}</span>}
			{thumbnailError && (
				<span data-testid={`thumbnail-error-${index}`}>{thumbnailError}</span>
			)}
		</div>
	);
}

// ---------- types for harness props ----------

export type HarnessProps = {
	initialVideos?: Video[];
	/** core guard の maxVideos（add 自体をブロック） */
	maxVideos?: number;
	/** schema 側の maxVideos（バリデーション root error を発生させる用。指定なしならスキーマ無効） */
	schemaMaxVideos?: number;
	processFile?: ProcessFileFn;
	uploadFile?: UploadFileFn;
	onError?: (error: MultiVideoError) => void;
	onReset?: (resetFn: () => void) => void;
	createVideoElement?: () => HTMLVideoElement;
};

// ---------- RHF Harness ----------

type RhfForm = { videos: Video[]; videosDeletedIds: string[] };

export function makeDummyVideoElement(): HTMLVideoElement {
	const el = document.createElement("video");
	Object.defineProperty(el, "videoWidth", { value: 2 });
	Object.defineProperty(el, "videoHeight", { value: 2 });
	Object.defineProperty(el, "currentTime", { value: 1.5 });
	return el;
}

export function RhfHarness({
	initialVideos,
	maxVideos,
	schemaMaxVideos,
	processFile,
	uploadFile,
	onError,
	onReset,
	createVideoElement,
}: HarnessProps): ReactNode {
	const resolver = schemaMaxVideos
		? standardSchemaResolver(
				z.object({
					videos: createVideosSchema({
						acceptedVideoTypes: ["video/mp4", "video/webm"],
						maxVideos: schemaMaxVideos,
					}),
					videosDeletedIds: createDeletedVideoIdsSchema(),
				}),
			)
		: undefined;

	const form = useRhfForm<RhfForm>({
		defaultValues: {
			videos: initialVideos ?? [],
			videosDeletedIds: [],
		},
		resolver,
		mode: "onChange",
	});

	const resetRef = useRef(() =>
		form.reset({ videos: initialVideos ?? [], videosDeletedIds: [] }),
	);
	resetRef.current = () =>
		form.reset({ videos: initialVideos ?? [], videosDeletedIds: [] });
	useEffect(() => {
		if (onReset) onReset((...args) => resetRef.current(...args));
	}, [onReset]);

	const makeVideo = createVideoElement ?? makeDummyVideoElement;

	return (
		<RhfController
			form={form}
			name="videos"
			deletedName="videosDeletedIds"
			maxVideos={maxVideos}
			processFile={processFile}
			uploadOnSelect={uploadFile ? { uploadFile } : undefined}
			onError={onError}
			render={({ items, rootErrors, addVideo, isBusy, raw }) => (
				<div>
					<div data-testid="item-count">{items.length}</div>
					<div data-testid="deleted-ids">{raw.deletedVideoIds.join(",")}</div>
					<div data-testid="is-busy">{String(isBusy)}</div>
					{rootErrors.length > 0 && (
						<div data-testid="root-error">{rootErrors[0]?.message}</div>
					)}
					{items.map(
						(
							{ video, errors, handlers: itemHandlers, canMoveUp, canMoveDown },
							index,
						) => (
							<VideoItem
								key={video.tempId}
								video={video}
								index={index}
								onChangeFile={(_tempId, file) => itemHandlers.changeFile(file)}
								onDelete={() => itemHandlers.delete()}
								onMoveUp={() => itemHandlers.moveUp()}
								onMoveDown={() => itemHandlers.moveDown()}
								onSetThumbnail={(_tempId, file) =>
									itemHandlers.setThumbnailFromFile(file)
								}
								onCaptureThumbnail={() =>
									itemHandlers.setThumbnailFromFrame(makeVideo())
								}
								onRemoveThumbnail={() => itemHandlers.removeThumbnail()}
								isFirst={!canMoveUp}
								isLast={!canMoveDown}
								error={errors?.file?.message}
								thumbnailError={errors?.thumbnail?.message}
							/>
						),
					)}
					{items.length === 0 && (
						<div data-testid="empty-message">No videos</div>
					)}
					<input
						type="file"
						accept="video/*"
						data-testid="add-input"
						onChange={async (e: ChangeEvent<HTMLInputElement>) => {
							const files = e.target.files;
							if (!files) return;
							for (const f of Array.from(files)) {
								await addVideo(f);
							}
							e.target.value = "";
						}}
						multiple
					/>
				</div>
			)}
		/>
	);
}

// ---------- TanStack Harness ----------

type TanstackForm = { videos: Video[]; videosDeletedIds: string[] };

export function TanstackHarness({
	initialVideos,
	maxVideos,
	schemaMaxVideos,
	processFile,
	uploadFile,
	onError,
	onReset,
	createVideoElement,
}: HarnessProps): ReactNode {
	const form = useTanstackForm({
		defaultValues: {
			videos: initialVideos ?? [],
			videosDeletedIds: [],
		} as TanstackForm,
		validators: schemaMaxVideos
			? {
					onChange: z.object({
						videos: createVideosSchema({
							acceptedVideoTypes: ["video/mp4", "video/webm"],
							maxVideos: schemaMaxVideos,
						}),
						videosDeletedIds: createDeletedVideoIdsSchema(),
					}),
				}
			: undefined,
	});

	const resetRef = useRef(() =>
		form.reset({ videos: initialVideos ?? [], videosDeletedIds: [] }),
	);
	resetRef.current = () =>
		form.reset({ videos: initialVideos ?? [], videosDeletedIds: [] });
	useEffect(() => {
		if (onReset) onReset((...args) => resetRef.current(...args));
	}, [onReset]);

	const makeVideo = createVideoElement ?? makeDummyVideoElement;

	return (
		<TanstackController
			form={form}
			name="videos"
			deletedName="videosDeletedIds"
			maxVideos={maxVideos}
			processFile={processFile}
			uploadOnSelect={uploadFile ? { uploadFile } : undefined}
			onError={onError}
			render={({ items, rootErrors, addVideo, isBusy, raw }) => (
				<div>
					<div data-testid="item-count">{items.length}</div>
					<div data-testid="deleted-ids">{raw.deletedVideoIds.join(",")}</div>
					<div data-testid="is-busy">{String(isBusy)}</div>
					{rootErrors.length > 0 && (
						<div data-testid="root-error">
							{(rootErrors[0] as { message?: string })?.message}
						</div>
					)}
					{items.map(
						(
							{ video, errors, handlers: itemHandlers, canMoveUp, canMoveDown },
							index,
						) => (
							<VideoItem
								key={video.tempId}
								video={video}
								index={index}
								onChangeFile={(_tempId, file) => itemHandlers.changeFile(file)}
								onDelete={() => itemHandlers.delete()}
								onMoveUp={() => itemHandlers.moveUp()}
								onMoveDown={() => itemHandlers.moveDown()}
								onSetThumbnail={(_tempId, file) =>
									itemHandlers.setThumbnailFromFile(file)
								}
								onCaptureThumbnail={() =>
									itemHandlers.setThumbnailFromFrame(makeVideo())
								}
								onRemoveThumbnail={() => itemHandlers.removeThumbnail()}
								isFirst={!canMoveUp}
								isLast={!canMoveDown}
								error={errors?.file?.message}
								thumbnailError={errors?.thumbnail?.message}
							/>
						),
					)}
					{items.length === 0 && (
						<div data-testid="empty-message">No videos</div>
					)}
					<input
						type="file"
						accept="video/*"
						data-testid="add-input"
						onChange={async (e: ChangeEvent<HTMLInputElement>) => {
							const files = e.target.files;
							if (!files) return;
							for (const f of Array.from(files)) {
								await addVideo(f);
							}
							e.target.value = "";
						}}
						multiple
					/>
				</div>
			)}
		/>
	);
}

// ---------- dual runner ----------

export type HarnessComponent = (props: HarnessProps) => ReactNode;

export const harnesses: [string, HarnessComponent][] = [
	["RHF", RhfHarness],
	["TanStack", TanstackHarness],
];
