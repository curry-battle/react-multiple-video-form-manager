import {
	getFileFromChangeEvent,
	type MultiVideoError,
	type UploadFileFn,
	type UploadsUploadedApi,
	type Video,
} from "@curry-battle/react-multiple-video-form-manager";
import { useMultiVideoController } from "@curry-battle/react-multiple-video-form-manager/tanstack-form";
import { useForm } from "@tanstack/react-form";
import { type ChangeEvent, useCallback, useRef, useState } from "react";
import { API } from "../api/api";
import {
	type VideoPostFormType,
	videoPostSchema,
} from "../types/schemas/VideoPostSchema";
import { FormMultiVideoItem } from "./FormMultiVideoItem";

interface VideoFormProps {
	initialVideos?: Video[];
}

// 本体とサムネイルで転送先を分けたい場合は ctx.kind で分岐する。
// このサンプルは同じ presigned URL の発行経路を使うので分岐しない。
const uploadFile: UploadFileFn = async (file, ctx) => {
	const { presignedUrl, videoId } = await API.getPresignedUrl(
		file.name,
		file.type,
	);
	const uploadRef = await API.uploadToS3(videoId, file, presignedUrl, ctx);
	return { uploadRef };
};

export function VideoForm({ initialVideos }: VideoFormProps) {
	const [operationError, setOperationError] = useState<string | null>(null);

	// 連続してエラーが出たとき、先のタイマーが後のメッセージを早く消さないよう
	// 張り替える
	const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const showError = useCallback((message: string) => {
		setOperationError(message);
		if (errorTimerRef.current !== null) clearTimeout(errorTimerRef.current);
		errorTimerRef.current = setTimeout(() => setOperationError(null), 5000);
	}, []);

	const handleError = useCallback(
		(error: MultiVideoError) => showError(error.message),
		[showError],
	);

	// TanStack Form は onSubmit を useForm の引数で受けるため、後に組む uploads は
	// ref 経由で渡す
	const uploadsRef = useRef<UploadsUploadedApi | null>(null);

	const form = useForm({
		defaultValues: {
			videos: initialVideos ?? [],
			videosDeletedIds: [],
		} as VideoPostFormType,
		validators: { onChange: videoPostSchema },
		onSubmit: async () => {
			const uploads = uploadsRef.current;
			if (!uploads) return;

			try {
				// 走行中の転送を待ち合わせる。まだ転送していないスロットは
				// この中で発行されるので、保存を押した時点の取りこぼしが無い
				const result = await uploads.wait();
				if (!result.ok) {
					showError(
						`${result.failedTempIds.length} 件の動画をアップロードできませんでした。再試行してください。`,
					);
					return;
				}

				await API.updateVideos(result.videos, result.deletedIds);
			} catch (error) {
				console.error("Submit error:", error);
			}
		},
	});

	const maxVideos = 5;

	const { items, rootErrors, handlers, isBusy, raw, uploads } =
		useMultiVideoController({
			form,
			name: "videos",
			maxVideos,
			uploadFile,
			onError: handleError,
		});
	uploadsRef.current = uploads;

	return (
		<div className="max-w-4xl mx-auto p-8 bg-white rounded-2xl shadow-lg border border-slate-100">
			<h2 className="text-xl font-bold text-slate-800 mb-6 flex items-center gap-2">
				<span className="w-1 h-6 rounded-full bg-blue-500 inline-block" />
				動画管理フォーム
			</h2>

			<form
				onSubmit={(e) => {
					e.preventDefault();
					e.stopPropagation();
					void form.handleSubmit();
				}}
				className="space-y-6"
			>
				{operationError && (
					<div
						className="mb-4 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm flex items-center gap-2"
						data-testid="operation-error"
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							className="w-4 h-4 flex-shrink-0"
							viewBox="0 0 20 20"
							fill="currentColor"
						>
							<title>エラー</title>
							<path
								fillRule="evenodd"
								d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
								clipRule="evenodd"
							/>
						</svg>
						{operationError}
					</div>
				)}

				<div>
					<div className="flex items-center gap-2 mb-3">
						<p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
							動画一覧
						</p>
						<span className="text-xs font-medium text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
							{items.length} / {maxVideos}
						</span>
					</div>

					{rootErrors.length > 0 && (
						<div
							className="mb-3 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 text-sm"
							data-testid="root-error"
						>
							{rootErrors.map((err) => (
								<p key={(err as { message?: string }).message}>
									{(err as { message?: string }).message}
								</p>
							))}
						</div>
					)}

					<div className="space-y-3">
						{items.map((item, index) => (
							<FormMultiVideoItem
								key={item.video.tempId}
								video={item.video}
								index={index}
								handlers={item.handlers}
								canMoveUp={item.canMoveUp}
								canMoveDown={item.canMoveDown}
								isPending={item.isPending}
								uploadState={item.uploadState}
								onRetry={() => uploads.retry(item.video.tempId)}
								error={item.errorMessages[0]}
							/>
						))}

						{items.length === 0 && (
							<div className="text-center py-12 text-slate-400 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/50">
								<svg
									xmlns="http://www.w3.org/2000/svg"
									className="w-10 h-10 mx-auto mb-2 text-slate-300"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
								>
									<title>動画なし</title>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										strokeWidth={1.5}
										d="M15 10l4.553-2.069A1 1 0 0121 8.868v6.264a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z"
									/>
								</svg>
								<p className="text-sm">動画が選択されていません</p>
								<p className="text-xs text-slate-300 mt-1">
									下の + ボタンから追加してください
								</p>
							</div>
						)}

						<div>
							<input
								type="file"
								accept="video/*"
								onChange={async (e: ChangeEvent<HTMLInputElement>) => {
									const f = getFileFromChangeEvent(e);
									await handlers.add(f);
									e.target.value = "";
								}}
								className="hidden"
								id="videoUpload-videos"
							/>
							<div className="flex justify-center mt-2">
								<label
									htmlFor="videoUpload-videos"
									className="flex items-center gap-2 px-4 py-2 rounded-full border-2 border-dashed border-blue-300 text-blue-500 hover:border-blue-400 hover:bg-blue-50 cursor-pointer transition-colors text-sm font-medium"
								>
									<svg
										xmlns="http://www.w3.org/2000/svg"
										fill="none"
										viewBox="0 0 24 24"
										strokeWidth={2}
										stroke="currentColor"
										className="w-4 h-4"
									>
										<title>動画追加アイコン</title>
										<path
											strokeLinecap="round"
											strokeLinejoin="round"
											d="M12 4v16m8-8H4"
										/>
									</svg>
									動画を追加
								</label>
							</div>
						</div>

						<details className="mt-6 group">
							<summary className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400 cursor-pointer hover:text-slate-600 list-none select-none">
								<svg
									xmlns="http://www.w3.org/2000/svg"
									className="w-3.5 h-3.5 transition-transform group-open:rotate-90"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
								>
									<title>展開</title>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										strokeWidth={2}
										d="M9 5l7 7-7 7"
									/>
								</svg>
								動画の状態 (デバッグ)
							</summary>
							<pre className="mt-2 bg-slate-900 text-slate-300 rounded-xl p-4 text-xs overflow-x-auto leading-relaxed">
								{JSON.stringify(raw.videos, null, 2)}
							</pre>
						</details>
					</div>
				</div>

				<div className="pt-2">
					<form.Subscribe
						selector={(state) => ({
							isSubmitting: state.isSubmitting,
							canSubmit: state.canSubmit,
						})}
					>
						{({ isSubmitting, canSubmit }) => (
							<button
								type="submit"
								disabled={isSubmitting || isBusy || !canSubmit}
								className="w-full px-4 py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 active:scale-[0.99] transition-all disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed shadow-sm"
							>
								{isSubmitting ? (
									<span className="flex items-center justify-center gap-2">
										<svg
											className="animate-spin w-4 h-4"
											xmlns="http://www.w3.org/2000/svg"
											fill="none"
											viewBox="0 0 24 24"
										>
											<title>読み込み中</title>
											<circle
												className="opacity-25"
												cx="12"
												cy="12"
												r="10"
												stroke="currentColor"
												strokeWidth="4"
											/>
											<path
												className="opacity-75"
												fill="currentColor"
												d="M4 12a8 8 0 018-8v8z"
											/>
										</svg>
										保存中...
									</span>
								) : (
									"保存"
								)}
							</button>
						)}
					</form.Subscribe>
				</div>
			</form>
		</div>
	);
}
