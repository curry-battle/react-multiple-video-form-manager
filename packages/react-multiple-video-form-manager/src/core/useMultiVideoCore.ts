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
import type { UploadFileFn } from "./types/Upload";
import { UPLOAD_KINDS, UploadKind } from "./types/Upload";
import type { UploadState, VideoUploadState } from "./types/UploadState";
import type { ProcessFileFn, Video } from "./types/Video";
import { generateTempId, VideoUtils } from "./types/Video";
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
import type { UploadSource } from "./uploadSlots";
import { applyUploadRef, readUploadSource, slotKey } from "./uploadSlots";
import type { VideoFieldAdapter } from "./VideoFieldAdapter";
import * as ops from "./videoListOps";

export type UseMultiVideoCoreParams = {
	adapter: VideoFieldAdapter;
	processFile?: ProcessFileFn;
	processThumbnailFile?: ProcessFileFn;
	/**
	 * 選択されたファイルをストレージへ転送する。設定すると add / changeFile /
	 * setThumbnail* が項目を先にフォームへ入れ、転送は裏で走らせる。
	 * 未設定なら転送は起きず、送信素材は生の `File` を運ぶ。
	 */
	uploadFile?: UploadFileFn;
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

export type UploadsApi = {
	/** 転送中のスロットを持つ tempId。件数は length */
	pending: string[];
	/** 転送に失敗したスロットを持つ tempId */
	failed: string[];
	/**
	 * 失敗したスロットだけを再送する。全スロットを撃ち直すと、成功済みの本体を
	 * もう一度流すことになる。粒度を `retry(tempId, kind)` にしないのは、消費側の
	 * UI が項目ごとのリトライボタンで kind 単位の操作を必要としないため。
	 *
	 * 戻り値は再送を発行したかどうか。「本体 pending / サムネイル failed」なら
	 * サムネイルだけ再送して true、「両方 pending」なら false。転送の成否は
	 * `items[].uploadState` と `failed` で追う
	 */
	retry: (tempId: string) => boolean;
};

export type UseMultiVideoCoreReturn = {
	items: VideoItem[];
	rootErrors: VideoFieldError[];
	handlers: UseMultiVideoCoreHandlers;
	raw: { videos: readonly Video[]; deletedVideoIds: readonly string[] };
	pendingOperations: ReadonlySet<string>;
	isAdding: boolean;
	isBusy: boolean;
	uploads: UploadsApi;
	prepareForSubmit: PrepareForSubmitFn;
};

export type MultiVideoRenderProps = Omit<
	UseMultiVideoCoreReturn,
	"handlers"
> & {
	addVideo: (file: File) => Promise<boolean>;
};

/**
 * 転送の台帳。フォーム state には持たない（`UploadState` の doc を参照）。
 *
 * キーは `${tempId}:${kind}` の複合キー（`slotKey`）。`token` は書き戻しの可否を
 * 決める同一性比較の対象で、「その転送参照がどのオブジェクトのものか」を後から
 * 検証するために status を跨いで常に持つ。
 */
type UploadRecord = {
	tempId: string;
	kind: UploadKind;
	token: Blob | File;
} & (
	| {
			status: "pending";
			controller: AbortController;
			/** 転送が settle したら解決する */
			settled: Promise<void>;
	  }
	| { status: "done"; uploadRef: string }
	| { status: "failed"; error: unknown }
);

export function useMultiVideoCore(
	params: UseMultiVideoCoreParams,
): UseMultiVideoCoreReturn {
	const {
		adapter,
		processFile,
		processThumbnailFile,
		uploadFile,
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

	// 消費側はインライン関数を毎レンダー渡すため、effect 同期だと参照が変わるたびに
	// 再発火してしまう。レンダー時代入なら effect コスト無しで常に最新値を読める。
	const uploadFileRef = useRef(uploadFile);
	uploadFileRef.current = uploadFile;

	const msgRef = useRef<Required<CoreMessages>>(defaultCoreMessages);
	msgRef.current = {
		maxVideos: messages?.maxVideos ?? defaultCoreMessages.maxVideos,
		processFile: messages?.processFile ?? defaultCoreMessages.processFile,
		processThumbnailFile:
			messages?.processThumbnailFile ??
			defaultCoreMessages.processThumbnailFile,
		upload: messages?.upload ?? defaultCoreMessages.upload,
		frameCapture: messages?.frameCapture ?? defaultCoreMessages.frameCapture,
		validationFailed:
			messages?.validationFailed ?? defaultCoreMessages.validationFailed,
	};

	const watchedVideos = adapter.videos;
	const deletedVideoIds = adapter.deletedVideoIds;

	const recordsRef = useRef<ReadonlyMap<string, UploadRecord>>(new Map());
	const [records, setRecordsState] = useState<
		ReadonlyMap<string, UploadRecord>
	>(recordsRef.current);

	/** mutate は変更があったかを返す。false なら再レンダーを起こさない */
	const writeRecords = useCallback(
		(mutate: (draft: Map<string, UploadRecord>) => boolean) => {
			const draft = new Map(recordsRef.current);
			if (!mutate(draft)) return;
			recordsRef.current = draft;
			setRecordsState(draft);
		},
		[],
	);

	// 進捗は台帳と別に持つ。UploadRecord を差し替えて表現すると、書き戻しの可否を
	// 判定している「自分がまだ現行レコードか」の参照比較（startUpload の isCurrent）が
	// 進捗報告のたびに崩れる
	const progressRef = useRef<ReadonlyMap<string, number>>(new Map());
	const [progress, setProgressState] = useState<ReadonlyMap<string, number>>(
		progressRef.current,
	);

	const writeProgress = useCallback(
		(key: string, fraction: number | undefined) => {
			const draft = new Map(progressRef.current);
			if (fraction === undefined) {
				if (!draft.delete(key)) return;
			} else {
				draft.set(key, fraction);
			}
			progressRef.current = draft;
			setProgressState(draft);
		},
		[],
	);

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
			errorType: Exclude<MultiVideoErrorType, "upload">,
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

	const appendDeletedId = useCallback((id: string) => {
		const next = [...adapterRef.current.getDeletedVideoIds(), id];
		adapterRef.current.setDeletedVideoIds(next);
	}, []);

	const findIndexByTempId = useCallback(
		(tempId: string): number | undefined => {
			const index = adapterRef.current
				.getVideos()
				.findIndex((vid) => vid.tempId === tempId);
			return index === -1 ? undefined : index;
		},
		[],
	);

	const checkMaxVideos = useCallback((): boolean => {
		if (
			maxVideos !== undefined &&
			adapterRef.current.getVideos().length >= maxVideos
		) {
			onErrorRef.current?.({
				type: "max_videos",
				message: msgRef.current.maxVideos(maxVideos),
			});
			return false;
		}
		return true;
	}, [maxVideos]);

	/**
	 * 転送を開始する。完了を待たず即座に戻る。
	 *
	 * `source.token` には「フォーム state に格納したのと同一のオブジェクト」を渡すこと
	 * （`UploadSource` の doc を参照）。加工前の File を渡すと、書き戻し時の同一性比較が
	 * 常に不成立となり結果が一度も反映されない。
	 */
	const startUpload = useCallback(
		(tempId: string, kind: UploadKind, source: UploadSource): void => {
			const upload = uploadFileRef.current;
			if (!upload) return;

			const key = slotKey(tempId, kind);
			const current = recordsRef.current.get(key);
			// 同一トークンの転送が走行中なら二重発行しない。abort 済みでも settle 前は
			// 走行中として扱う。中断要求から settle までの間に再発行すると、中断待ちの
			// 転送と新しい転送が並走する
			if (current?.status === "pending" && current.token === source.token) {
				return;
			}
			// 同じスロットで別トークンの転送が走っている場合、その結果は書き戻し時に
			// 破棄されるが、転送を続ける理由も無いので中断する
			if (current?.status === "pending") current.controller.abort();

			const controller = new AbortController();
			let settle!: () => void;
			const settled = new Promise<void>((resolve) => {
				settle = resolve;
			});
			// 以降の書き込みは「台帳のエントリがまだ自分のものか」で判定する。
			// 差し替え・削除で置き換わっていれば書き込まない
			const record: UploadRecord = {
				status: "pending",
				tempId,
				kind,
				token: source.token,
				controller,
				settled,
			};
			const isCurrent = () => recordsRef.current.get(key) === record;

			const fail = (error: unknown) => {
				writeRecords((draft) => {
					if (draft.get(key) !== record) return false;
					draft.set(key, {
						status: "failed",
						tempId,
						kind,
						token: source.token,
						error,
					});
					return true;
				});
				onErrorRef.current?.({
					type: "upload",
					kind,
					message: msgRef.current.upload(kind),
					cause: error,
				});
			};

			// 進捗イベントはチャンクごとに飛びうる。台帳へそのまま書くと 1 チャンク
			// ごとに再レンダーが走るため、表示が変わらない報告は捨てる。
			// 丸めるのは書き込みの判定だけで、保持する値は報告されたまま
			let lastPercent = -1;
			const onProgress = (fraction: number): void => {
				if (!Number.isFinite(fraction) || !isCurrent()) return;
				const clamped = Math.min(1, Math.max(0, fraction));
				const percent = Math.floor(clamped * 100);
				if (percent === lastPercent) return;
				lastPercent = percent;
				writeProgress(key, clamped);
			};

			const run = async (): Promise<void> => {
				try {
					const result = await upload(source.file, {
						kind,
						signal: controller.signal,
						onProgress,
					});
					if (controller.signal.aborted || !isCurrent()) return;
					// resolve したのに参照が無い実装（API レスポンスの欠損など）を成功として
					// 扱うと、転送済みなのに未解決の項目が残り再発行が走り続ける。
					// 契約違反は失敗に倒して retry へ回す
					if (
						typeof result?.uploadRef !== "string" ||
						result.uploadRef === ""
					) {
						throw new Error("uploadFile resolved without uploadRef");
					}

					const ad = adapterRef.current;
					const videos = ad.getVideos();
					const index = videos.findIndex((vid) => vid.tempId === tempId);
					if (index === -1) return;
					// 差し替えは tempId を保つため、index の再解決だけでは対象の入れ替わりを
					// 検出できない。転送したオブジェクトとの同一性で判定する
					const applied = applyUploadRef(
						videos[index],
						kind,
						source.token,
						result.uploadRef,
					);
					if (applied === undefined) return;

					const next = [...videos];
					next[index] = applied;
					ad.setVideos(next);

					writeRecords((draft) => {
						if (draft.get(key) !== record) return false;
						draft.set(key, {
							status: "done",
							tempId,
							kind,
							token: source.token,
							uploadRef: result.uploadRef,
						});
						return true;
					});
				} catch (err) {
					if (controller.signal.aborted) return;
					fail(err);
				} finally {
					// 中断・破棄で早期 return した場合は pending のまま残る。
					// 台帳から落として待機対象から外す
					writeRecords((draft) =>
						draft.get(key) === record ? draft.delete(key) : false,
					);
					// 進捗は転送 1 本の寿命に閉じる。ただし別の転送に引き継がれていたら
					// 消さない。消すと後発の転送が報告済みの進捗が巻き戻る
					const latest = recordsRef.current.get(key);
					if (!(latest?.status === "pending" && latest !== record)) {
						writeProgress(key, undefined);
					}
					settle();
				}
			};

			// run() は同期 throw する uploadFile 実装で catch まで同期到達しうるため、
			// 台帳へ載せてから起動する
			writeRecords((draft) => {
				draft.set(key, record);
				return true;
			});
			writeProgress(key, undefined);
			void run();
		},
		[writeProgress, writeRecords],
	);

	/** その項目のスロットに転送すべきものがあれば転送を起動する */
	const startUploadFor = useCallback(
		(video: Video, kind: UploadKind): void => {
			const source = readUploadSource(video, kind);
			if (source === undefined) return;
			startUpload(video.tempId, kind, source);
		},
		[startUpload],
	);

	/** そのスロットの転送を中断し、台帳から落とす */
	const discardSlot = useCallback(
		(tempId: string, kind: UploadKind): void => {
			const key = slotKey(tempId, kind);
			const rec = recordsRef.current.get(key);
			if (rec?.status === "pending") rec.controller.abort();
			writeRecords((draft) => draft.delete(key));
			writeProgress(key, undefined);
		},
		[writeProgress, writeRecords],
	);

	const handleAdd = useCallback(
		async (file: File): Promise<boolean> => {
			if (!checkMaxVideos()) return false;

			incrementAdding();
			try {
				const processedFile = await executeProcess(
					file,
					processFile,
					"process_file",
					msgRef.current.processFile,
				);
				if (!processedFile) return false;

				// await 中に並行 add が挿入を終えている可能性があるため、
				// 挿入直前の状態で上限を再チェックする
				if (!checkMaxVideos()) return false;

				const newVideo = VideoUtils.createNew(generateTempId(), processedFile);
				const ad = adapterRef.current;
				ad.setVideos(ops.addVideo(ad.getVideos(), newVideo).videos);

				startUploadFor(newVideo, UploadKind.Video);

				await safeValidate();
				return true;
			} finally {
				decrementAdding();
			}
		},
		[
			checkMaxVideos,
			decrementAdding,
			executeProcess,
			incrementAdding,
			processFile,
			safeValidate,
			startUploadFor,
		],
	);

	const handleFileChange = useCallback(
		async (tempId: string, file: File): Promise<boolean> => {
			if (findIndexByTempId(tempId) === undefined) return false;

			addPending(tempId);
			try {
				const processedFile = await executeProcess(
					file,
					processFile,
					"process_file",
					msgRef.current.processFile,
				);
				if (!processedFile) return false;

				// await 中に並行操作で削除・移動されている可能性があるため、
				// 対象は tempId から再解決する（ops.changeFile が行う）
				const ad = adapterRef.current;
				const result = ops.changeFile(ad.getVideos(), tempId, processedFile);
				if (result.video === null) return false;
				ad.setVideos(result.videos);
				if (result.deletedId !== null) {
					appendDeletedId(result.deletedId);
					// 既存動画の差し替えでサムネイルは捨てられる。台帳を残すと、
					// 対象を失った転送の破棄が孤児回収まわりの経路に回る
					discardSlot(tempId, UploadKind.Thumbnail);
				}
				startUploadFor(result.video, UploadKind.Video);

				await safeValidate();
				return true;
			} finally {
				removePending(tempId);
			}
		},
		[
			addPending,
			appendDeletedId,
			discardSlot,
			executeProcess,
			findIndexByTempId,
			processFile,
			removePending,
			safeValidate,
			startUploadFor,
		],
	);

	const handleDelete = useCallback(
		async (tempId: string): Promise<boolean> => {
			const ad = adapterRef.current;
			const result = ops.deleteVideo(ad.getVideos(), tempId);
			if (!result.deleted) return false;
			ad.setVideos(result.videos);
			if (result.deletedId !== null) {
				appendDeletedId(result.deletedId);
			}
			// 項目が消える唯一の経路。台帳を残すと、削除した項目の失敗が
			// uploads.failed に残り続け、消費側は items で引けず retry でも消せない
			for (const kind of UPLOAD_KINDS) discardSlot(tempId, kind);

			await safeValidate();
			return true;
		},
		[appendDeletedId, discardSlot, safeValidate],
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
		(tempId: string, thumbnail: Thumbnail | null): Video | null => {
			const ad = adapterRef.current;
			const result = ops.setThumbnail(ad.getVideos(), tempId, thumbnail);
			if (result.video === null) return null;
			ad.setVideos(result.videos);
			return result.video;
		},
		[],
	);

	const handleSetThumbnailFromFrame = useCallback(
		async (
			tempId: string,
			videoElement: HTMLVideoElement,
		): Promise<boolean> => {
			if (findIndexByTempId(tempId) === undefined) return false;

			addPending(tempId);
			try {
				const captured = await ThumbnailUtils.captureFrame(videoElement);
				const updated = updateThumbnail(tempId, captured);
				if (updated === null) return false;

				startUploadFor(updated, UploadKind.Thumbnail);

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
			findIndexByTempId,
			removePending,
			safeValidate,
			startUploadFor,
			updateThumbnail,
		],
	);

	const handleSetThumbnailFromFile = useCallback(
		async (tempId: string, file: File): Promise<boolean> => {
			if (findIndexByTempId(tempId) === undefined) return false;

			addPending(tempId);
			try {
				const processedFile = await executeProcess(
					file,
					processThumbnailFile,
					"process_thumbnail_file",
					msgRef.current.processThumbnailFile,
				);
				if (!processedFile) return false;

				const updated = updateThumbnail(
					tempId,
					ThumbnailUtils.fromFile(processedFile),
				);
				if (updated === null) return false;

				startUploadFor(updated, UploadKind.Thumbnail);

				await safeValidate();
				return true;
			} finally {
				removePending(tempId);
			}
		},
		[
			addPending,
			executeProcess,
			findIndexByTempId,
			processThumbnailFile,
			removePending,
			safeValidate,
			startUploadFor,
			updateThumbnail,
		],
	);

	const handleRemoveThumbnail = useCallback(
		async (tempId: string): Promise<boolean> => {
			if (updateThumbnail(tempId, null) === null) return false;
			discardSlot(tempId, UploadKind.Thumbnail);
			await safeValidate();
			return true;
		},
		[discardSlot, safeValidate, updateThumbnail],
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

	const retry = useCallback(
		(tempId: string): boolean => {
			const video = adapterRef.current
				.getVideos()
				.find((vid) => vid.tempId === tempId);
			if (video === undefined) return false;

			let restarted = false;
			for (const kind of UPLOAD_KINDS) {
				// pending 中の再実行を許すと同一トークンの転送が 2 本 in-flight になり、
				// 参照同一性比較では区別できず両方が書き戻しに成功する
				const rec = recordsRef.current.get(slotKey(tempId, kind));
				if (rec?.status !== "failed") continue;
				const source = readUploadSource(video, kind);
				if (source === undefined) continue;
				startUpload(tempId, kind, source);
				restarted = true;
			}
			return restarted;
		},
		[startUpload],
	);

	// unmount 時のみ中断する。結果は破棄される。
	//
	// 中断した転送は settle を待たずに台帳から落とす。abort した時点でその転送に
	// 用は無いのに枠を占有させると、signal を無視する実装（settle が遅い・返らない）で
	// StrictMode の再 mount 後に転送が再開されなくなる
	useEffect(() => {
		return () => {
			writeRecords((draft) => {
				let changed = false;
				for (const [key, rec] of draft) {
					if (rec.status !== "pending") continue;
					rec.controller.abort();
					draft.delete(key);
					changed = true;
				}
				return changed;
			});
		};
	}, [writeRecords]);

	const uploads = useMemo<UploadsApi>(() => {
		const pending = new Set<string>();
		const failed = new Set<string>();
		for (const rec of records.values()) {
			if (rec.status === "pending") pending.add(rec.tempId);
			if (rec.status === "failed") failed.add(rec.tempId);
		}
		return { pending: [...pending], failed: [...failed], retry };
	}, [records, retry]);

	// done は公開しない（UploadState の doc を参照）。転送していないスロットの
	// キーも作らないので、両スロットとも報告が無い項目は空オブジェクトになる
	const uploadStates = useMemo(() => {
		const byTempId = new Map<string, VideoUploadState>();
		for (const [key, rec] of records) {
			if (rec.status === "done") continue;
			const state: UploadState =
				rec.status === "pending"
					? { status: "pending", progress: progress.get(key) }
					: { status: "failed", error: rec.error };
			const entry = byTempId.get(rec.tempId) ?? {};
			entry[rec.kind] = state;
			byTempId.set(rec.tempId, entry);
		}
		return byTempId;
	}, [records, progress]);

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
				uploadState: uploadStates.get(vid.tempId) ?? {},
				handlers: getItemHandlers(vid.tempId),
			};
		});
		for (const key of itemHandlerCache.current.keys()) {
			if (!activeTempIds.has(key)) {
				itemHandlerCache.current.delete(key);
			}
		}
		return mapped;
	}, [
		watchedVideos,
		adapter.errors,
		pendingOperations,
		uploadStates,
		getItemHandlers,
	]);

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
		uploads,
		prepareForSubmit: boundPrepareForSubmit,
	};
}
