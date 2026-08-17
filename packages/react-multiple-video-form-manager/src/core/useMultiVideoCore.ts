import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildSubmitPayload } from "./submitPayload";
import type {
	MultiVideoError,
	MultiVideoErrorType,
} from "./types/MultiVideoError";
import type { SubmitVideo, UploadedSubmitVideo } from "./types/Submit";
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
import {
	applyUploadRef,
	readUnresolvedSource,
	readUploadRef,
	readUploadSource,
	slotKey,
} from "./uploadSlots";
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

/**
 * 走行中の転送を待ち合わせた結果。
 *
 * `videos` は可視順の送信素材（`SubmitVideo` の doc を参照）。`deletedIds` は
 * 削除対象の既存 id で、「配列に無いものは削除」と宣言する API では使わない。
 *
 * 失敗を例外にしないのは、期待される失敗（転送の失敗）に例外を使うのが
 * エルゴノミクス上よくないため。姉妹パッケージ
 * `react-multiple-image-form-manager` と戻り値の意味論も揃う。
 */
export type UploadWaitResult =
	| { ok: true; videos: SubmitVideo[]; deletedIds: string[] }
	| { ok: false; failedTempIds: string[] };

/** `uploadFile` を設定した場合。新規項目が転送参照を持つ形に確定する */
export type UploadWaitUploadedResult =
	| { ok: true; videos: UploadedSubmitVideo[]; deletedIds: string[] }
	| { ok: false; failedTempIds: string[] };

/**
 * 転送の完了を待たずに集めた送信素材。
 *
 * 未完了のスロットを持つ項目は `videos` に入らず `excludedTempIds` で返る。
 * 返さないと消費側が「この動画は含まれませんでした」と提示できない。
 */
export type ReadyVideos = {
	videos: SubmitVideo[];
	deletedIds: string[];
	excludedTempIds: string[];
};

/** `uploadFile` を設定した場合。新規項目が転送参照を持つ形に確定する */
export type ReadyUploadedVideos = {
	videos: UploadedSubmitVideo[];
	deletedIds: string[];
	excludedTempIds: string[];
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
	/**
	 * 走行中の転送の完了を待ってから送信素材を返す。未着手のスロットは
	 * この中で転送を発行して待つ。`uploadFile` 未設定なら待つ対象が無いので即座に
	 * ok を返す。
	 *
	 * 失敗したスロットは自動で再試行しない。`retry` を呼ぶまで `ok: false` が続く
	 */
	wait: () => Promise<UploadWaitResult>;
	/**
	 * 待たずに、いま送れるものだけで送信素材を作る。
	 *
	 * 未完了のスロットが 1 つでもある項目は丸ごと除外し `excludedTempIds` で返す。
	 * 「本体だけ送ってサムネイルを落とす」は、サムネイル無しで保存されるという
	 * データ上の縮退を作るため採らない。項目自体はフォームに残るので、消費側は
	 * 「今回は含まれなかった」と提示すること
	 */
	getReady: () => ReadyVideos;
};

/** `uploadFile` を設定した場合の uploads。送信素材の型だけが異なる */
export type UploadsUploadedApi = Omit<UploadsApi, "wait" | "getReady"> & {
	wait: () => Promise<UploadWaitUploadedResult>;
	getReady: () => ReadyUploadedVideos;
};

type CoreBase = {
	items: VideoItem[];
	rootErrors: VideoFieldError[];
	handlers: UseMultiVideoCoreHandlers;
	raw: { videos: readonly Video[]; deletedVideoIds: readonly string[] };
	pendingOperations: ReadonlySet<string>;
	isAdding: boolean;
	isBusy: boolean;
};

export type UseMultiVideoCoreReturn = CoreBase & { uploads: UploadsApi };

export type UseMultiVideoCoreUploadedReturn = CoreBase & {
	uploads: UploadsUploadedApi;
};

/**
 * render props で渡す形。送信素材は `uploadFile` の有無にかかわらず緩い型
 * （`SubmitVideo`）になる。render コールバックの引数の型を `uploadFile` の有無で
 * 分けると判別子が関数型になり、推論が不安定になるため。
 *
 * 緩い型は実行時に現れる形の上位集合なので嘘にはならないが、`uploadFile` を
 * 設定した場合に `file` を受け付けない保存 API へ渡すにはキャストが要る。
 * 送信素材の型を確定させたい場合はフックを直接使うこと
 */
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

/**
 * 同じスロットで書き戻しが連続して自己破棄された回数の上限。
 *
 * 1 回は消費側が handlers を介さず adapter へ直接書き込んでファイルを差し替えた場合に
 * 正常に起こる。2 回連続は adapter が File / Blob の参照を保持していない疑いが濃く、
 * 放置すると再発行が永久に回るため失敗へ倒す（`VideoFieldAdapter` の doc を参照）
 */
const SELF_DISCARD_LIMIT = 2;

/**
 * `uploads.wait` の収束ループで、進捗の無い周回を何回続けたら打ち切るか。
 *
 * 1 回で打ち切ると、待機中のファイル選び直し（元の転送が中断され、新しい転送が
 * まだ結果を出していない周回）を誤って失敗と判定する。
 *
 * 既知の違反モード（参照を保持しない adapter、書き込みを捨てる adapter）では
 * `SELF_DISCARD_LIMIT` 側が先に発火するため、この打ち切りに到達する経路は
 * 見つかっていない。それでも残すのは、収束ループの停止性を再照合側の実装に
 * 依存させないため。自己破棄として数えられない破棄経路が将来生まれても、ここで止まる
 */
const STALLED_ROUND_LIMIT = 2;

export function useMultiVideoCore(
	params: UseMultiVideoCoreParams & { uploadFile: UploadFileFn },
): UseMultiVideoCoreUploadedReturn;
export function useMultiVideoCore(
	params: UseMultiVideoCoreParams,
): UseMultiVideoCoreReturn;
// 実装は緩い側で組む。厳しい側の保証（新規項目の転送参照が確定する）は
// uploadFile 設定時の ok 条件から導かれるもので、実装内部で表現できる事実ではない
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

	// 参照ではなく有無だけを見る。毎レンダー新しい関数を渡す消費側で
	// 再照合を無駄に発火させない
	const hasUploadFile = uploadFile !== undefined;

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

	const selfDiscardsRef = useRef(new Map<string, number>());

	/**
	 * 操作の世代。ファイル加工やフレームキャプチャの await から戻ったとき、同じ
	 * スロットへ後続の操作が発行されていたら書き込みを捨てる。加工の所要時間は
	 * ファイルによって違うため、これが無いと「先に選んだ重いファイル」が
	 * 「後に選んだ軽いファイル」を上書きする。
	 *
	 * 転送スロットごとに分けるのが要点。1 つのカウンタを本体とサムネイルで共有すると、
	 * 本体の加工中にサムネイルを設定しただけで本体の差し替えが黙って捨てられる。
	 */
	const generationsRef = useRef(new Map<string, number>());

	const bumpGeneration = useCallback(
		(tempId: string, kind: UploadKind): number => {
			const key = slotKey(tempId, kind);
			const generation = (generationsRef.current.get(key) ?? 0) + 1;
			generationsRef.current.set(key, generation);
			return generation;
		},
		[],
	);

	const isGenerationStale = useCallback(
		(tempId: string, kind: UploadKind, generation: number): boolean =>
			generationsRef.current.get(slotKey(tempId, kind)) !== generation,
		[],
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

			/**
			 * 書き戻しが反映されなかった回数を数え、上限で失敗へ倒す。
			 *
			 * 1 回は消費側が handlers を介さず adapter へ直接書き込んだ場合に正常に
			 * 起こる。2 回連続は adapter 側の契約違反が疑わしく、放置すると再発行が
			 * 永久に回る
			 */
			const countDiscard = (error: Error) => {
				const count = (selfDiscardsRef.current.get(key) ?? 0) + 1;
				selfDiscardsRef.current.set(key, count);
				if (count >= SELF_DISCARD_LIMIT) fail(error);
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
					if (applied === undefined) {
						// 自分がまだ現行レコードなのにスロットの中身が入れ替わっている
						// （＝自己破棄）。誰も引き継いでいないため、繰り返すなら adapter が
						// 参照を保持していない疑いが濃い
						countDiscard(
							new Error(
								"upload result was discarded repeatedly; the adapter may not preserve File / Blob references",
							),
						);
						return;
					}

					const next = [...videos];
					next[index] = applied;
					ad.setVideos(next);

					// read-your-writes の契約どおりなら、書き戻した参照は同期 read で
					// 見える。見えないなら adapter が書き込みを捨てており、発行し直しても
					// 同じところに戻る。転送参照の解決はフォーム state だけを見るので、
					// ここで気づかないと再発行が永久に回る
					const reflected = ad.getVideos().find((vid) => vid.tempId === tempId);
					if (reflected === undefined) return;
					if (readUploadRef(reflected, kind) === undefined) {
						countDiscard(
							new Error(
								"upload reference was written but not visible on the next read; the adapter may discard writes",
							),
						);
						return;
					}

					selfDiscardsRef.current.delete(key);

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

	/**
	 * ユーザー操作による転送の起動。転送すべきものがあったかどうかを返す。
	 *
	 * 明示的な差し替えは仕切り直しなので、自己破棄のカウントも解除する。
	 * 自動再発行（`reissueUnresolved`）はカウントを残すため、こちらを経由しない。
	 */
	const startUploadFor = useCallback(
		(video: Video, kind: UploadKind): boolean => {
			const source = readUploadSource(video, kind);
			if (source === undefined) return false;
			selfDiscardsRef.current.delete(slotKey(video.tempId, kind));
			startUpload(video.tempId, kind, source);
			return true;
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
			selfDiscardsRef.current.delete(key);
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

			const generation = bumpGeneration(tempId, UploadKind.Video);
			addPending(tempId);
			try {
				const processedFile = await executeProcess(
					file,
					processFile,
					"process_file",
					msgRef.current.processFile,
				);
				if (!processedFile) return false;
				if (isGenerationStale(tempId, UploadKind.Video, generation)) {
					return false;
				}

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
			bumpGeneration,
			discardSlot,
			executeProcess,
			findIndexByTempId,
			isGenerationStale,
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

			const generation = bumpGeneration(tempId, UploadKind.Thumbnail);
			addPending(tempId);
			try {
				// catch はキャプチャだけに掛ける。以降の失敗まで拾うと、無関係な
				// 例外がフレームキャプチャの失敗として消費側に伝わる
				let captured: Thumbnail;
				try {
					captured = await ThumbnailUtils.captureFrame(videoElement);
				} catch (err) {
					onErrorRef.current?.({
						type: "unknown",
						message: msgRef.current.frameCapture(),
						cause: err,
					});
					return false;
				}
				if (isGenerationStale(tempId, UploadKind.Thumbnail, generation)) {
					return false;
				}

				const updated = updateThumbnail(tempId, captured);
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
			bumpGeneration,
			findIndexByTempId,
			isGenerationStale,
			removePending,
			safeValidate,
			startUploadFor,
			updateThumbnail,
		],
	);

	const handleSetThumbnailFromFile = useCallback(
		async (tempId: string, file: File): Promise<boolean> => {
			if (findIndexByTempId(tempId) === undefined) return false;

			const generation = bumpGeneration(tempId, UploadKind.Thumbnail);
			addPending(tempId);
			try {
				const processedFile = await executeProcess(
					file,
					processThumbnailFile,
					"process_thumbnail_file",
					msgRef.current.processThumbnailFile,
				);
				if (!processedFile) return false;
				if (isGenerationStale(tempId, UploadKind.Thumbnail, generation)) {
					return false;
				}

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
			bumpGeneration,
			executeProcess,
			findIndexByTempId,
			isGenerationStale,
			processThumbnailFile,
			removePending,
			safeValidate,
			startUploadFor,
			updateThumbnail,
		],
	);

	const handleRemoveThumbnail = useCallback(
		async (tempId: string): Promise<boolean> => {
			// 加工中の設定操作より後の操作なので、世代を進めてそちらを捨てる。
			// 進めないと、削除したサムネイルが加工の完了後に戻ってくる
			bumpGeneration(tempId, UploadKind.Thumbnail);
			if (updateThumbnail(tempId, null) === null) return false;
			discardSlot(tempId, UploadKind.Thumbnail);
			await safeValidate();
			return true;
		},
		[bumpGeneration, discardSlot, safeValidate, updateThumbnail],
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

	/** 転送すべきものがあり、まだ参照を持たないスロットを列挙する */
	const listUnresolvedSlots = useCallback((): {
		video: Video;
		kind: UploadKind;
		source: UploadSource;
	}[] => {
		const slots: { video: Video; kind: UploadKind; source: UploadSource }[] =
			[];
		for (const video of adapterRef.current.getVideos()) {
			for (const kind of UPLOAD_KINDS) {
				const source = readUnresolvedSource(video, kind);
				if (source !== undefined) slots.push({ video, kind, source });
			}
		}
		return slots;
	}, []);

	const listUnresolvedTempIds = useCallback(
		(): string[] => [
			...new Set(listUnresolvedSlots().map(({ video }) => video.tempId)),
		],
		[listUnresolvedSlots],
	);

	/** 未転送のスロットへ転送を発行する */
	const reissueUnresolved = useCallback(() => {
		for (const { video, kind, source } of listUnresolvedSlots()) {
			const key = slotKey(video.tempId, kind);
			// tripwire が落ちたスロットは自動再発行しない。retry かファイル差し替えで解除する
			if ((selfDiscardsRef.current.get(key) ?? 0) >= SELF_DISCARD_LIMIT) {
				continue;
			}
			const rec = recordsRef.current.get(key);
			// 走行中ならトークンが違っても発行しない。1 転送スロットに生きた転送は
			// 1 本という制約を保つため。走行中の転送が対象を失っていれば、settle 時に
			// 台帳から落ち、次の照合で現在のトークンに対して発行される
			if (rec?.status === "pending") continue;
			// 失敗済みは自動再試行せず retry に委ねる。ただし現在のトークン基準で
			// 判定する。台帳が別のオブジェクトのものならこのスロットにとっては未着手で、
			// 発行しないと永久に未転送のまま残る
			if (rec?.status === "failed" && rec.token === source.token) continue;
			startUpload(video.tempId, kind, source);
		}
	}, [listUnresolvedSlots, startUpload]);

	const buildPayload = useCallback(
		(excluded?: ReadonlySet<string>) =>
			buildSubmitPayload(
				adapterRef.current.getVideos(),
				adapterRef.current.getDeletedVideoIds(),
				excluded,
			),
		[],
	);

	const getReady = useCallback((): ReadyVideos => {
		if (!uploadFileRef.current) {
			// 転送しない構成では参照が無いのが正常。除外対象として扱うと
			// 新規項目が全部消える
			return { ...buildPayload(), excludedTempIds: [] };
		}
		// 未完了のスロットを持つ項目を素材から抜く。項目自体はフォームに残る。
		// 走行中のものは転送が続き、未着手のものは次の wait が発行するが、
		// 失敗済みのものは自動再試行しないため retry を呼ぶまで除外され続ける
		const excludedTempIds = listUnresolvedTempIds();
		return {
			...buildPayload(new Set(excludedTempIds)),
			excludedTempIds,
		};
	}, [buildPayload, listUnresolvedTempIds]);

	const listFailedTempIds = useCallback((): string[] => {
		const failed = new Set<string>();
		for (const rec of recordsRef.current.values()) {
			if (rec.status === "failed") failed.add(rec.tempId);
		}
		return [...failed];
	}, []);

	const wait = useCallback(async (): Promise<UploadWaitResult> => {
		if (!uploadFileRef.current) {
			// 未設定の消費側では参照が無いのが正常。失敗扱いすると、一度も転送を
			// 試みていない項目が failedTempIds に並ぶ
			return { ok: true, ...buildPayload() };
		}

		// 収束ループ。待機開始時点のスナップショットだけを await すると、
		// 待機中に retry や再発行が始めた転送が待ち対象から漏れる
		const snapshot = () =>
			`${listUnresolvedTempIds().join(",")}|${listFailedTempIds().join(",")}`;

		let stalledRounds = 0;

		for (;;) {
			const before = snapshot();
			reissueUnresolved();

			// 待つのはフォームに残っている項目の転送だけ。handlers を介さない
			// 差し替え（form.reset や adapter への直接書き込み）で項目が消えると、
			// その転送の結果は書き戻し時に捨てられる。ok 判定と素材が getVideos() から
			// 出ているので、待機集合も同じ供給源に揃える
			const alive = new Set(
				adapterRef.current.getVideos().map((vid) => vid.tempId),
			);
			const inflight: Promise<void>[] = [];
			for (const rec of recordsRef.current.values()) {
				if (rec.status === "pending" && alive.has(rec.tempId)) {
					inflight.push(rec.settled);
				}
			}
			if (inflight.length > 0) {
				await Promise.allSettled(inflight);
				stalledRounds = snapshot() === before ? stalledRounds + 1 : 0;
				if (stalledRounds < STALLED_ROUND_LIMIT) continue;

				// await 中に retry が再発行していることがある。走行中の転送を failed で
				// 塗ると、その結果が破棄されて無駄撃ちになる
				const stuck = listUnresolvedSlots().filter(
					({ video, kind }) =>
						recordsRef.current.get(slotKey(video.tempId, kind))?.status !==
						"pending",
				);
				if (stuck.length === 0) {
					stalledRounds = 0;
					continue;
				}
				// 台帳にも失敗として残す。ここで返るだけだと uploads.failed が空のままに
				// なり、消費側が該当項目を提示することも retry することもできない
				writeRecords((draft) => {
					let changed = false;
					for (const { video, kind, source } of stuck) {
						const key = slotKey(video.tempId, kind);
						// 既に失敗している転送の error は原因を持っているので温存する。
						// ライブロックの説明で塗ると消費側に無関係な理由を見せることになる
						if (draft.get(key)?.status === "failed") continue;
						draft.set(key, {
							status: "failed",
							tempId: video.tempId,
							kind,
							token: source.token,
							error: new Error(
								"upload made no progress; the adapter may not preserve File / Blob references",
							),
						});
						changed = true;
					}
					return changed;
				});
				return {
					ok: false,
					failedTempIds: [...new Set(stuck.map(({ video }) => video.tempId))],
				};
			}

			const failedTempIds = listUnresolvedTempIds();
			if (failedTempIds.length > 0) return { ok: false, failedTempIds };
			return { ok: true, ...buildPayload() };
		}
	}, [
		buildPayload,
		listFailedTempIds,
		listUnresolvedSlots,
		listUnresolvedTempIds,
		reissueUnresolved,
		writeRecords,
	]);

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
				if (startUploadFor(video, kind)) restarted = true;
			}
			return restarted;
		},
		[startUploadFor],
	);

	// フォーム state から消えた項目の台帳を落とす。handlers を介さない差し替え
	// （form.reset や adapter への直接書き込み）で項目が消えると、その項目の failed が
	// uploads.failed に残り続け、消費側は items で引けず retry でも消せない状態になる。
	//
	// 「一度フォーム state で見た tempId」だけを対象にする。単に「今の配列に無い」で
	// 判定すると、追加直後の転送を反映待ちの間に中断してしまう
	const seenTempIdsRef = useRef(new Set<string>());
	const pruneOrphans = useCallback(() => {
		const alive = new Set(
			adapterRef.current.getVideos().map((vid) => vid.tempId),
		);
		const seen = seenTempIdsRef.current;
		for (const tempId of alive) seen.add(tempId);

		const orphanKeys: string[] = [];
		for (const [key, rec] of recordsRef.current) {
			if (alive.has(rec.tempId) || !seen.has(rec.tempId)) continue;
			if (rec.status === "pending") rec.controller.abort();
			orphanKeys.push(key);
		}
		for (const tempId of seen) {
			if (!alive.has(tempId)) seen.delete(tempId);
		}

		if (orphanKeys.length === 0) return;
		writeRecords((draft) => {
			for (const key of orphanKeys) {
				draft.delete(key);
				selfDiscardsRef.current.delete(key);
			}
			return true;
		});
		for (const key of orphanKeys) writeProgress(key, undefined);
	}, [writeProgress, writeRecords]);

	// 転送参照を持たないスロットが現れたら転送を発行する。unmount で in-flight と
	// 台帳は失われるがフォーム state には項目が残るため、remount や初期値の後差し込みでも
	// 「転送されないまま uploads.wait が ok を返す」状態にならない。
	//
	// records も依存に含める。中断された転送は settle 時に台帳から落ちるため、
	// これが無いと StrictMode の cleanup で中断された転送が開発時だけ再開されない。
	// hasUploadFile も含める。undefined の間に追加された項目は startUpload が即 return
	// するため、後から uploadFile が渡されたときに拾い直す必要がある
	// biome-ignore lint/correctness/useExhaustiveDependencies: pruneOrphans / reissueUnresolved は adapterRef / recordsRef 経由で読むため依存に現れないが、発火させたいのは動画と台帳と uploadFile の有無が変わったとき
	useEffect(() => {
		pruneOrphans();
		reissueUnresolved();
	}, [adapter.videos, records, hasUploadFile, pruneOrphans, reissueUnresolved]);

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
		return {
			pending: [...pending],
			failed: [...failed],
			retry,
			wait,
			getReady,
		};
	}, [records, retry, wait, getReady]);

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

	return {
		items,
		rootErrors: adapter.errors.root,
		handlers,
		raw,
		pendingOperations,
		isAdding,
		isBusy,
		uploads,
	};
}
