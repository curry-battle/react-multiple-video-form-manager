import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
	PrepareForSubmitFn,
	PrepareForSubmitOptions,
} from "./prepareForSubmit";
import { prepareForSubmit } from "./prepareForSubmit";
import type {
	MultiVideoError,
	MultiVideoErrorType,
} from "./types/MultiVideoError";
import type { Thumbnail } from "./types/Thumbnail";
import { ThumbnailUtils } from "./types/Thumbnail";
import type {
	ProcessFileFn,
	UploadOnSelectOptions,
	Video,
} from "./types/Video";
import type {
	CoreMessages,
	ItemHandlers,
	VideoFieldError,
	VideoItem,
} from "./types/VideoSchemaTypes";
import {
	collectErrorMessages,
	defaultCoreMessages,
} from "./types/VideoSchemaTypes";
import type { VideoFieldAdapter } from "./VideoFieldAdapter";
import * as ops from "./videoListOps";

export type UseMultiVideoCoreParams = {
	adapter: VideoFieldAdapter;
	processFile?: ProcessFileFn;
	processThumbnailFile?: ProcessFileFn;
	/**
	 * ファイル選択時に即アップロードする戦略（opt-in）。
	 * 設定すると add / changeFile / setThumbnail* で
	 * 選択直後にアップロードが実行される。
	 * 未設定の場合、アップロードは prepareForSubmit(options) に委ねられる。
	 */
	uploadOnSelect?: UploadOnSelectOptions;
	onError?: (error: MultiVideoError) => void;
	maxVideos?: number;
	messages?: CoreMessages;
};

// フォームアダプタを内部生成する各コントローラ層 (RHF / TanStack) が
// `adapter` を除いてそのまま再宣言・転送するための共有オプション束。
export type MultiVideoCoreOptions = Omit<UseMultiVideoCoreParams, "adapter">;

export type UseMultiVideoCoreHandlers = {
	add: (file: File) => Promise<boolean>;
	changeFile: (tempId: string, file: File) => Promise<boolean>;
	delete: (tempId: string) => Promise<boolean>;
	moveUp: (tempId: string) => Promise<boolean>;
	moveDown: (tempId: string) => Promise<boolean>;
	move: (tempId: string, toIndex: number) => Promise<boolean>;
	setThumbnailFromFrame: (
		tempId: string,
		videoElement: HTMLVideoElement,
	) => Promise<boolean>;
	setThumbnailFromFile: (tempId: string, file: File) => Promise<boolean>;
	removeThumbnail: (tempId: string) => Promise<boolean>;
};

export type UseMultiVideoCoreReturn = {
	items: VideoItem[];
	rootErrors: VideoFieldError[];
	handlers: UseMultiVideoCoreHandlers;
	raw: { videos: readonly Video[]; deletedVideoIds: readonly string[] };
	pendingOperations: ReadonlySet<string>;
	isAdding: boolean;
	isBusy: boolean;
	prepareForSubmit: PrepareForSubmitFn;
};

export type MultiVideoRenderProps = Omit<
	UseMultiVideoCoreReturn,
	"handlers"
> & {
	addVideo: (file: File) => Promise<boolean>;
};

export function useMultiVideoCore(
	params: UseMultiVideoCoreParams,
): UseMultiVideoCoreReturn {
	const {
		adapter,
		processFile,
		processThumbnailFile,
		uploadOnSelect,
		onError,
		maxVideos,
		messages,
	} = params;

	// adapter は毎レンダー新規オブジェクト。handler の identity を安定化するため ref 経由で参照する。
	const adapterRef = useRef<VideoFieldAdapter>(adapter);
	useEffect(() => {
		adapterRef.current = adapter;
	}, [adapter]);

	// onError / messages を ref に入れ、handler からは ref 経由で読む。
	// インラインコールバックを渡しても handler の identity が壊れないようにする。
	const onErrorRef = useRef(onError);
	useEffect(() => {
		onErrorRef.current = onError;
	}, [onError]);

	// 消費側はインラインオブジェクトを毎レンダー渡すため、effect 同期だと
	// 参照が変わるたびに再発火してしまう。レンダー時代入なら effect コスト無しで常に最新値を読める。
	const uploadOnSelectRef = useRef(uploadOnSelect);
	uploadOnSelectRef.current = uploadOnSelect;

	const notifyOrphan = useCallback((uploadedUrl: string) => {
		try {
			uploadOnSelectRef.current?.onOrphanedUpload?.(uploadedUrl);
		} catch {
			// cleanup hook の失敗は主操作の制御フローを壊さない
		}
	}, []);

	const msgRef = useRef<Required<CoreMessages>>(defaultCoreMessages);
	msgRef.current = {
		maxVideos: messages?.maxVideos ?? defaultCoreMessages.maxVideos,
		processFile: messages?.processFile ?? defaultCoreMessages.processFile,
		processThumbnailFile:
			messages?.processThumbnailFile ??
			defaultCoreMessages.processThumbnailFile,
		uploadFile: messages?.uploadFile ?? defaultCoreMessages.uploadFile,
		uploadThumbnailFile:
			messages?.uploadThumbnailFile ?? defaultCoreMessages.uploadThumbnailFile,
		frameCapture: messages?.frameCapture ?? defaultCoreMessages.frameCapture,
		validationFailed:
			messages?.validationFailed ?? defaultCoreMessages.validationFailed,
	};

	const watchedVideos = adapter.videos;
	const deletedVideoIds = adapter.deletedVideoIds;

	// tempId ごとに最後に発火した操作の連番。await 復帰後に
	// 自分の epoch が最新でなければ commit を破棄し、完了順逆転を防ぐ。
	const epochsRef = useRef(new Map<string, number>());

	// 参照カウント: 同一 tempId に対する並行操作（fileChange + thumbnailFromFile 等）で
	// 先に終わった操作の finally が pending を消さないようにする
	const pendingCountRef = useRef(new Map<string, number>());
	const [pendingOperations, setPendingOperations] = useState<
		ReadonlySet<string>
	>(() => new Set<string>());

	const addingCountRef = useRef(0);
	const [isAdding, setIsAdding] = useState(false);

	const addPending = useCallback((tempId: string) => {
		const count = (pendingCountRef.current.get(tempId) ?? 0) + 1;
		pendingCountRef.current.set(tempId, count);
		setPendingOperations((prev) => {
			if (prev.has(tempId)) return prev;
			const next = new Set(prev);
			next.add(tempId);
			return next;
		});
	}, []);

	const removePending = useCallback((tempId: string) => {
		const count = (pendingCountRef.current.get(tempId) ?? 1) - 1;
		if (count > 0) {
			pendingCountRef.current.set(tempId, count);
			return;
		}
		pendingCountRef.current.delete(tempId);
		setPendingOperations((prev) => {
			if (!prev.has(tempId)) return prev;
			const next = new Set(prev);
			next.delete(tempId);
			return next;
		});
	}, []);

	const incrementAdding = useCallback(() => {
		addingCountRef.current += 1;
		setIsAdding(true);
	}, []);

	const decrementAdding = useCallback(() => {
		addingCountRef.current -= 1;
		if (addingCountRef.current <= 0) {
			addingCountRef.current = 0;
			setIsAdding(false);
		}
	}, []);

	const safeValidate = useCallback(async () => {
		try {
			await adapterRef.current.validate();
		} catch (err) {
			onErrorRef.current?.({
				type: "unknown",
				message: msgRef.current.validationFailed(),
				cause: err,
			});
		}
	}, []);

	const executeProcess = useCallback(
		async (
			file: File,
			processFn: ProcessFileFn | undefined,
			errorType: MultiVideoErrorType,
			errorMessage: () => string,
		): Promise<File | null> => {
			if (!processFn) return file;
			try {
				return await processFn(file);
			} catch (err) {
				onErrorRef.current?.({
					type: errorType,
					message: errorMessage(),
					cause: err,
				});
				return null;
			}
		},
		[],
	);

	const executeUploadFile = useCallback(
		async (
			file: File,
			errorMessage: () => string,
		): Promise<{ uploadedUrl: string } | "skip" | "error"> => {
			const fn = uploadOnSelectRef.current?.uploadFile;
			if (!fn) return "skip";
			try {
				const result = await fn(file);
				return { uploadedUrl: result.uploadedUrl };
			} catch (err) {
				onErrorRef.current?.({
					type: "upload_file",
					message: errorMessage(),
					cause: err,
				});
				return "error";
			}
		},
		[],
	);

	const executeUploadThumbnailFile = useCallback(
		async (
			file: File,
			errorMessage: () => string,
		): Promise<{ uploadedUrl: string } | "skip" | "error"> => {
			const fn = uploadOnSelectRef.current?.uploadThumbnailFile;
			if (!fn) return "skip";
			try {
				const result = await fn(file);
				return { uploadedUrl: result.uploadedUrl };
			} catch (err) {
				onErrorRef.current?.({
					type: "upload_thumbnail_file",
					message: errorMessage(),
					cause: err,
				});
				return "error";
			}
		},
		[],
	);

	const appendDeletedId = useCallback((id: string) => {
		const next = [...adapterRef.current.getDeletedVideoIds(), id];
		adapterRef.current.setDeletedVideoIds(next);
	}, []);

	const bumpEpoch = useCallback((tempId: string) => {
		const epoch = (epochsRef.current.get(tempId) ?? 0) + 1;
		epochsRef.current.set(tempId, epoch);
		return epoch;
	}, []);

	const isEpochStale = useCallback(
		(tempId: string, epoch: number) => epochsRef.current.get(tempId) !== epoch,
		[],
	);

	const handleAdd = useCallback(
		async (file: File): Promise<boolean> => {
			const currentVideos = adapterRef.current.getVideos();
			if (maxVideos !== undefined && currentVideos.length >= maxVideos) {
				onErrorRef.current?.({
					type: "max_videos",
					message: msgRef.current.maxVideos(maxVideos),
				});
				return false;
			}

			incrementAdding();
			try {
				const processedFile = await executeProcess(
					file,
					processFile,
					"process_file",
					msgRef.current.processFile,
				);
				if (!processedFile) return false;

				const uploadResult = await executeUploadFile(
					processedFile,
					msgRef.current.uploadFile,
				);
				if (uploadResult === "error") return false;
				const uploadedUrl =
					uploadResult === "skip" ? undefined : uploadResult.uploadedUrl;

				const ad = adapterRef.current;
				const result = ops.addVideo(
					ad.getVideos(),
					processedFile,
					maxVideos,
					uploadedUrl,
				);
				if (!result.added) {
					if (uploadedUrl) notifyOrphan(uploadedUrl);
					onErrorRef.current?.({
						type: "max_videos",
						message: msgRef.current.maxVideos(maxVideos as number),
					});
					return false;
				}
				ad.setVideos(result.videos);

				await safeValidate();
				return true;
			} finally {
				decrementAdding();
			}
		},
		[
			decrementAdding,
			executeProcess,
			executeUploadFile,
			incrementAdding,
			maxVideos,
			notifyOrphan,
			processFile,
			safeValidate,
		],
	);

	const handleFileChange = useCallback(
		async (tempId: string, file: File): Promise<boolean> => {
			if (
				adapterRef.current
					.getVideos()
					.findIndex((vid) => vid.tempId === tempId) === -1
			) {
				return false;
			}

			const epoch = bumpEpoch(tempId);
			addPending(tempId);

			try {
				const processedFile = await executeProcess(
					file,
					processFile,
					"process_file",
					msgRef.current.processFile,
				);
				if (isEpochStale(tempId, epoch)) return false;
				if (!processedFile) return false;

				const uploadResult = await executeUploadFile(
					processedFile,
					msgRef.current.uploadFile,
				);
				if (isEpochStale(tempId, epoch)) {
					if (uploadResult !== "error" && uploadResult !== "skip") {
						notifyOrphan(uploadResult.uploadedUrl);
					}
					return false;
				}
				if (uploadResult === "error") return false;

				const uploadedUrl =
					uploadResult === "skip" ? undefined : uploadResult.uploadedUrl;

				const ad = adapterRef.current;
				const result = ops.changeFile(
					ad.getVideos(),
					tempId,
					processedFile,
					uploadedUrl,
				);
				if (!result.changed) {
					if (uploadedUrl) notifyOrphan(uploadedUrl);
					return false;
				}
				ad.setVideos(result.videos);
				if (result.deletedId !== null) {
					appendDeletedId(result.deletedId);
				}

				await safeValidate();
				return true;
			} finally {
				removePending(tempId);
			}
		},
		[
			addPending,
			appendDeletedId,
			bumpEpoch,
			executeProcess,
			executeUploadFile,
			isEpochStale,
			notifyOrphan,
			processFile,
			removePending,
			safeValidate,
		],
	);

	const handleDelete = useCallback(
		async (tempId: string): Promise<boolean> => {
			bumpEpoch(tempId);

			const ad = adapterRef.current;
			const result = ops.deleteVideo(ad.getVideos(), tempId);
			if (!result.deleted) return false;
			ad.setVideos(result.videos);
			if (result.deletedId !== null) {
				appendDeletedId(result.deletedId);
			}

			await safeValidate();
			return true;
		},
		[appendDeletedId, bumpEpoch, safeValidate],
	);

	const handleMoveUp = useCallback(
		async (tempId: string): Promise<boolean> => {
			const ad = adapterRef.current;
			const result = ops.moveUp(ad.getVideos(), tempId);
			if (!result.moved) return false;
			ad.setVideos(result.videos);
			await safeValidate();
			return true;
		},
		[safeValidate],
	);

	const handleMoveDown = useCallback(
		async (tempId: string): Promise<boolean> => {
			const ad = adapterRef.current;
			const result = ops.moveDown(ad.getVideos(), tempId);
			if (!result.moved) return false;
			ad.setVideos(result.videos);
			await safeValidate();
			return true;
		},
		[safeValidate],
	);

	const handleMove = useCallback(
		async (tempId: string, toIndex: number): Promise<boolean> => {
			const ad = adapterRef.current;
			const result = ops.moveTo(ad.getVideos(), tempId, toIndex);
			if (!result.moved) return false;
			ad.setVideos(result.videos);
			await safeValidate();
			return true;
		},
		[safeValidate],
	);

	const updateThumbnail = useCallback(
		(tempId: string, thumbnail: Thumbnail | null): boolean => {
			const ad = adapterRef.current;
			const result = ops.setThumbnail(ad.getVideos(), tempId, thumbnail);
			if (!result.updated) return false;
			ad.setVideos(result.videos);
			return true;
		},
		[],
	);

	const handleSetThumbnailFromFrame = useCallback(
		async (
			tempId: string,
			videoElement: HTMLVideoElement,
		): Promise<boolean> => {
			if (
				adapterRef.current
					.getVideos()
					.findIndex((vid) => vid.tempId === tempId) === -1
			) {
				return false;
			}

			const epoch = bumpEpoch(tempId);
			addPending(tempId);

			try {
				const captured = await ThumbnailUtils.captureFrame(videoElement);
				if (isEpochStale(tempId, epoch)) return false;

				const file = new File([captured.blob], "thumbnail.jpg", {
					type: "image/jpeg",
				});
				const uploadResult = await executeUploadThumbnailFile(
					file,
					msgRef.current.uploadThumbnailFile,
				);
				if (isEpochStale(tempId, epoch)) {
					if (uploadResult !== "error" && uploadResult !== "skip") {
						notifyOrphan(uploadResult.uploadedUrl);
					}
					return false;
				}
				if (uploadResult === "error") return false;
				const uploadedUrl =
					uploadResult === "skip" ? undefined : uploadResult.uploadedUrl;

				const thumbnail = { ...captured, uploadedUrl };
				if (!updateThumbnail(tempId, thumbnail)) {
					if (uploadedUrl) notifyOrphan(uploadedUrl);
					return false;
				}
				await safeValidate();
				return true;
			} catch (err) {
				onErrorRef.current?.({
					type: "unknown",
					message: msgRef.current.frameCapture(),
					cause: err,
				});
				return false;
			} finally {
				removePending(tempId);
			}
		},
		[
			addPending,
			bumpEpoch,
			executeUploadThumbnailFile,
			isEpochStale,
			notifyOrphan,
			removePending,
			safeValidate,
			updateThumbnail,
		],
	);

	const handleSetThumbnailFromFile = useCallback(
		async (tempId: string, file: File): Promise<boolean> => {
			if (
				adapterRef.current
					.getVideos()
					.findIndex((vid) => vid.tempId === tempId) === -1
			) {
				return false;
			}

			const epoch = bumpEpoch(tempId);
			addPending(tempId);

			try {
				const processedFile = await executeProcess(
					file,
					processThumbnailFile,
					"process_thumbnail_file",
					msgRef.current.processThumbnailFile,
				);
				if (isEpochStale(tempId, epoch)) return false;
				if (!processedFile) return false;

				const uploadResult = await executeUploadThumbnailFile(
					processedFile,
					msgRef.current.uploadThumbnailFile,
				);
				if (isEpochStale(tempId, epoch)) {
					if (uploadResult !== "error" && uploadResult !== "skip") {
						notifyOrphan(uploadResult.uploadedUrl);
					}
					return false;
				}
				if (uploadResult === "error") return false;
				const uploadedUrl =
					uploadResult === "skip" ? undefined : uploadResult.uploadedUrl;

				const thumbnail = {
					...ThumbnailUtils.fromFile(processedFile),
					uploadedUrl,
				};
				if (!updateThumbnail(tempId, thumbnail)) {
					if (uploadedUrl) notifyOrphan(uploadedUrl);
					return false;
				}

				await safeValidate();
				return true;
			} finally {
				removePending(tempId);
			}
		},
		[
			addPending,
			bumpEpoch,
			executeProcess,
			executeUploadThumbnailFile,
			isEpochStale,
			notifyOrphan,
			processThumbnailFile,
			removePending,
			safeValidate,
			updateThumbnail,
		],
	);

	const handleRemoveThumbnail = useCallback(
		async (tempId: string): Promise<boolean> => {
			bumpEpoch(tempId);
			if (!updateThumbnail(tempId, null)) return false;
			await safeValidate();
			return true;
		},
		[bumpEpoch, safeValidate, updateThumbnail],
	);

	const handlers = useMemo<UseMultiVideoCoreHandlers>(
		() => ({
			add: handleAdd,
			changeFile: handleFileChange,
			delete: handleDelete,
			moveUp: handleMoveUp,
			moveDown: handleMoveDown,
			move: handleMove,
			setThumbnailFromFrame: handleSetThumbnailFromFrame,
			setThumbnailFromFile: handleSetThumbnailFromFile,
			removeThumbnail: handleRemoveThumbnail,
		}),
		[
			handleAdd,
			handleFileChange,
			handleDelete,
			handleMoveUp,
			handleMoveDown,
			handleMove,
			handleSetThumbnailFromFrame,
			handleSetThumbnailFromFile,
			handleRemoveThumbnail,
		],
	);

	// ref 経由でベースハンドラを参照し、バインド済みハンドラの identity を tempId の生存期間中安定化する
	const handlersRef = useRef(handlers);
	handlersRef.current = handlers;

	const itemHandlerCache = useRef(new Map<string, ItemHandlers>());

	const getItemHandlers = useCallback((tempId: string): ItemHandlers => {
		const cached = itemHandlerCache.current.get(tempId);
		if (cached) return cached;

		const bound: ItemHandlers = {
			changeFile: (file) => handlersRef.current.changeFile(tempId, file),
			delete: () => handlersRef.current.delete(tempId),
			moveUp: () => handlersRef.current.moveUp(tempId),
			moveDown: () => handlersRef.current.moveDown(tempId),
			move: (toIndex) => handlersRef.current.move(tempId, toIndex),
			setThumbnailFromFrame: (videoElement) =>
				handlersRef.current.setThumbnailFromFrame(tempId, videoElement),
			setThumbnailFromFile: (file) =>
				handlersRef.current.setThumbnailFromFile(tempId, file),
			removeThumbnail: () => handlersRef.current.removeThumbnail(tempId),
		};
		itemHandlerCache.current.set(tempId, bound);
		return bound;
	}, []);

	const items = useMemo<VideoItem[]>(() => {
		const lastIndex = watchedVideos.length - 1;
		const activeTempIds = new Set<string>();
		const mapped = watchedVideos.map((vid, index) => {
			activeTempIds.add(vid.tempId);
			const errors = adapter.errors.items[vid.tempId];
			return {
				video: vid,
				errors,
				canMoveUp: index > 0,
				canMoveDown: index < lastIndex,
				errorMessages: collectErrorMessages(errors),
				isPending: pendingOperations.has(vid.tempId),
				handlers: getItemHandlers(vid.tempId),
			};
		});
		for (const key of itemHandlerCache.current.keys()) {
			if (!activeTempIds.has(key)) {
				itemHandlerCache.current.delete(key);
			}
		}
		return mapped;
	}, [watchedVideos, adapter.errors, pendingOperations, getItemHandlers]);

	const isBusy = isAdding || pendingOperations.size > 0;

	const raw = useMemo(
		() => ({ videos: watchedVideos, deletedVideoIds }),
		[watchedVideos, deletedVideoIds],
	);

	const boundPrepareForSubmit = useCallback(
		(options?: PrepareForSubmitOptions) =>
			prepareForSubmit(
				adapterRef.current.getVideos(),
				adapterRef.current.getDeletedVideoIds(),
				options,
			),
		[],
	);

	return {
		items,
		rootErrors: adapter.errors.root,
		handlers,
		raw,
		pendingOperations,
		isAdding,
		isBusy,
		prepareForSubmit: boundPrepareForSubmit,
	};
}
