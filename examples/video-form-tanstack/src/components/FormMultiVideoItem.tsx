import {
	getFileFromChangeEvent,
	type ItemHandlers,
	usePreviewUrl,
	useThumbnailPreviewUrl,
	type Video,
	VideoFormStatus,
} from "@curry-battle/react-multiple-video-manager";
import type { ChangeEvent } from "react";
import { useEffect, useRef, useState } from "react";

interface Props {
	video: Video;
	index: number;
	handlers: ItemHandlers;
	canMoveUp: boolean;
	canMoveDown: boolean;
	isPending: boolean;
	error: string | undefined;
}

export function FormMultiVideoItem({
	video,
	index,
	handlers,
	canMoveUp,
	canMoveDown,
	isPending,
	error,
}: Props) {
	const videoRef = useRef<HTMLVideoElement>(null);
	const [isModalOpen, setIsModalOpen] = useState(false);
	const [isThumbnailModalOpen, setIsThumbnailModalOpen] = useState(false);

	const previewUrl = usePreviewUrl(video);

	const hasThumbnail = video.thumbnail !== null;

	const thumbnailPreviewUrl = useThumbnailPreviewUrl(video.thumbnail);

	const isNew = video.status === VideoFormStatus.New;

	const fileChangeInputId = `file-change-${video.tempId}`;
	const thumbnailUploadInputId = `thumbnail-upload-${video.tempId}`;
	const thumbnailUploadEmptyInputId = `thumbnail-upload-empty-${video.tempId}`;

	const anyModalOpen = isModalOpen || isThumbnailModalOpen;

	useEffect(() => {
		if (!anyModalOpen) return;

		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";

		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				setIsModalOpen(false);
				setIsThumbnailModalOpen(false);
			}
		};
		document.addEventListener("keydown", handleKeyDown);

		return () => {
			document.body.style.overflow = previousOverflow;
			document.removeEventListener("keydown", handleKeyDown);
		};
	}, [anyModalOpen]);

	const handleDeleteWithConfirm = () => {
		if (window.confirm(`動画 #${index + 1} を削除しますか?`)) {
			handlers.delete();
		}
	};

	const handleChangeFile = (e: ChangeEvent<HTMLInputElement>) => {
		const file = getFileFromChangeEvent(e);
		handlers.changeFile(file);
		e.target.value = "";
	};

	const handleUploadThumbnail = (e: ChangeEvent<HTMLInputElement>) => {
		const file = getFileFromChangeEvent(e);
		handlers.setThumbnailFromFile(file);
		e.target.value = "";
	};

	return (
		<div
			className="flex border border-slate-200 rounded-xl bg-white shadow-sm hover:shadow-md transition-shadow overflow-hidden"
			data-testid="video-item"
		>
			{/* Left sidebar - order number + move buttons */}
			<div className="flex flex-col items-center justify-center gap-1 px-2 py-3 bg-slate-50 border-r border-slate-200 flex-shrink-0">
				<button
					type="button"
					onClick={() => handlers.moveUp()}
					disabled={!canMoveUp}
					title="上へ移動"
					className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						className="w-3.5 h-3.5"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
					>
						<title>上へ</title>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth={2.5}
							d="M5 15l7-7 7 7"
						/>
					</svg>
				</button>
				<span className="text-xs font-bold text-slate-500 select-none">
					{index + 1}
				</span>
				<button
					type="button"
					onClick={() => handlers.moveDown()}
					disabled={!canMoveDown}
					title="下へ移動"
					className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						className="w-3.5 h-3.5"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
					>
						<title>下へ</title>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth={2.5}
							d="M19 9l-7 7-7-7"
						/>
					</svg>
				</button>
			</div>

			{/* Main content - 2 column layout */}
			<div className="relative flex-1 flex min-w-0">
				{/* Delete button (top-right corner of card) */}
				<button
					type="button"
					onClick={handleDeleteWithConfirm}
					className="absolute top-2 right-2 z-10 w-9 h-9 flex items-center justify-center rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
					aria-label="動画を削除"
					title="動画を削除"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						className="w-5 h-5"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						strokeWidth={2}
					>
						<title>削除</title>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							d="M6 18L18 6M6 6l12 12"
						/>
					</svg>
				</button>

				{/* Left column: Video */}
				<div className="flex-1 p-4 min-w-0">
					<p className="text-xs font-medium text-slate-400 mb-2">動画</p>
					<div className="flex items-start gap-3">
						{/* Video preview (click to open modal) */}
						<button
							type="button"
							className="relative w-44 h-44 flex-shrink-0 rounded-lg overflow-hidden bg-slate-900 cursor-pointer group"
							onClick={() => setIsModalOpen(true)}
							aria-label="動画を再生"
						>
							<video
								src={previewUrl}
								className="w-full h-full object-cover"
								preload="metadata"
								muted
							/>
							{/* Status badge */}
							<span
								className={`absolute top-1 left-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${isNew ? "bg-emerald-100 text-emerald-700" : "bg-slate-100/90 text-slate-600"}`}
							>
								{isPending && (
									<svg
										className="animate-spin w-3 h-3"
										viewBox="0 0 24 24"
										fill="none"
									>
										<title>処理中</title>
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
								)}
								{isNew ? "新規" : "既存"}
							</span>
							{/* Play icon */}
							<div className="absolute inset-0 flex items-center justify-center">
								<div className="w-9 h-9 bg-black/40 rounded-full flex items-center justify-center group-hover:bg-black/60 transition-colors">
									<svg
										xmlns="http://www.w3.org/2000/svg"
										className="w-4 h-4 text-white ml-0.5"
										viewBox="0 0 24 24"
										fill="currentColor"
									>
										<title>再生</title>
										<path d="M8 5v14l11-7z" />
									</svg>
								</div>
							</div>
						</button>

						{/* Video action buttons */}
						<div className="flex flex-col gap-1.5">
							<label
								htmlFor={fileChangeInputId}
								className="inline-flex items-center justify-center px-3 py-1.5 text-xs font-medium border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
							>
								変更
								<input
									id={fileChangeInputId}
									type="file"
									accept="video/*"
									className="hidden"
									onChange={handleChangeFile}
								/>
							</label>
						</div>
					</div>
					{/* Error display */}
					{error && (
						<p className="mt-2 text-xs text-red-500 flex items-center gap-1">
							<svg
								xmlns="http://www.w3.org/2000/svg"
								className="w-3 h-3 flex-shrink-0"
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
							{error}
						</p>
					)}
				</div>

				{/* Vertical divider */}
				<div className="w-px bg-slate-100 my-3" />

				{/* Right column: Thumbnail */}
				<div className="flex-1 p-4 min-w-0">
					<p className="text-xs font-medium text-slate-400 mb-2">サムネイル</p>
					<div className="flex items-start gap-3">
						{/* Thumbnail preview */}
						{hasThumbnail && thumbnailPreviewUrl ? (
							<button
								type="button"
								className="w-44 h-44 flex-shrink-0 rounded-lg overflow-hidden border border-slate-100 cursor-pointer group"
								onClick={() => setIsThumbnailModalOpen(true)}
								aria-label="サムネイルを拡大"
							>
								<img
									src={thumbnailPreviewUrl}
									alt={`Thumbnail ${index + 1}`}
									className="w-full h-full object-cover group-hover:scale-105 transition-transform"
									data-testid="thumbnail-preview"
								/>
							</button>
						) : (
							<label
								htmlFor={thumbnailUploadEmptyInputId}
								className="w-44 h-44 bg-slate-50 rounded-lg flex flex-col items-center justify-center text-xs text-slate-400 flex-shrink-0 border-2 border-dashed border-slate-200 hover:border-blue-300 hover:bg-blue-50/50 hover:text-blue-500 cursor-pointer transition-colors"
								data-testid="thumbnail-empty"
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									className="w-5 h-5 mb-1"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
								>
									<title>サムネイル追加</title>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										strokeWidth={1.5}
										d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
									/>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										strokeWidth={1.5}
										d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
									/>
								</svg>
								クリックしてアップロード
								<input
									id={thumbnailUploadEmptyInputId}
									type="file"
									accept="image/*"
									className="hidden"
									onChange={handleUploadThumbnail}
									data-testid="upload-thumbnail-empty-input"
								/>
							</label>
						)}

						{/* Thumbnail action buttons */}
						<div className="flex flex-col gap-1.5">
							<label
								htmlFor={thumbnailUploadInputId}
								className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
								data-testid="upload-thumbnail-label"
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									className="w-3.5 h-3.5"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
								>
									<title>アップロード</title>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										strokeWidth={2}
										d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
									/>
								</svg>
								画像アップロード
								<input
									id={thumbnailUploadInputId}
									type="file"
									accept="image/*"
									className="hidden"
									onChange={handleUploadThumbnail}
									data-testid="upload-thumbnail-input"
								/>
							</label>
							{hasThumbnail && (
								<button
									type="button"
									onClick={() => handlers.removeThumbnail()}
									className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border border-red-200 text-red-500 rounded-lg hover:bg-red-50 hover:border-red-300 transition-colors"
									data-testid="remove-thumbnail-btn"
								>
									<svg
										xmlns="http://www.w3.org/2000/svg"
										className="w-3.5 h-3.5"
										fill="none"
										viewBox="0 0 24 24"
										stroke="currentColor"
									>
										<title>削除</title>
										<path
											strokeLinecap="round"
											strokeLinejoin="round"
											strokeWidth={2}
											d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
										/>
									</svg>
									削除
								</button>
							)}
						</div>
					</div>
				</div>
			</div>

			{/* Modal with body scroll lock + Escape key */}
			{isModalOpen && (
				<div
					className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center"
					onClick={() => setIsModalOpen(false)}
					onKeyDown={(e) => e.stopPropagation()}
					role="dialog"
					aria-modal="true"
					aria-label="動画プレーヤー"
				>
					{/* biome-ignore lint/a11y/noStaticElementInteractions: Modal content area needs stopPropagation to prevent backdrop click from closing */}
					<div
						className="bg-white rounded-2xl p-4 w-full max-w-2xl mx-4 shadow-2xl"
						onClick={(e) => e.stopPropagation()}
						onKeyDown={(e) => e.stopPropagation()}
					>
						{/* Modal header */}
						<div className="flex items-center justify-between mb-3">
							<span className="text-sm font-medium text-slate-700">
								動画 #{index + 1}
							</span>
							<button
								type="button"
								onClick={() => setIsModalOpen(false)}
								className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
								aria-label="閉じる"
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									className="w-4 h-4"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
								>
									<title>閉じる</title>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										strokeWidth={2}
										d="M6 18L18 6M6 6l12 12"
									/>
								</svg>
							</button>
						</div>

						{/* Video player */}
						<div className="rounded-lg overflow-hidden bg-slate-900 aspect-square">
							{/* 外部オリジンの動画（S3/CloudFront等）でフレームキャプチャを使う場合、
							    crossOrigin="anonymous" を追加し、サーバー側でCORS設定が必要です。
							    詳細はライブラリの README を参照してください。
							    注意: サーバー側のCORS設定なしで crossOrigin="anonymous" を追加すると、
							    動画の読み込み自体が失敗します。 */}
							<video
								ref={videoRef}
								src={previewUrl}
								className="w-full h-full object-contain"
								controls
								preload="metadata"
							>
								<track kind="captions" />
							</video>
						</div>

						{/* Frame capture button */}
						<div className="mt-3 flex justify-end">
							<button
								type="button"
								onClick={() => {
									if (videoRef.current) {
										handlers.setThumbnailFromFrame(videoRef.current);
										setIsModalOpen(false);
									}
								}}
								className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 transition-colors"
								data-testid="capture-thumbnail-btn"
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									className="w-3.5 h-3.5"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
								>
									<title>キャプチャ</title>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										strokeWidth={2}
										d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
									/>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										strokeWidth={2}
										d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
									/>
								</svg>
								フレームキャプチャしてサムネイルにする
							</button>
						</div>
					</div>
				</div>
			)}

			{/* Thumbnail modal */}
			{isThumbnailModalOpen && thumbnailPreviewUrl && (
				<div
					className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center"
					onClick={() => setIsThumbnailModalOpen(false)}
					onKeyDown={(e) => e.stopPropagation()}
					role="dialog"
					aria-modal="true"
					aria-label="サムネイルプレビュー"
				>
					{/* biome-ignore lint/a11y/noStaticElementInteractions: Modal content area needs stopPropagation to prevent backdrop click from closing */}
					<div
						className="bg-white rounded-2xl p-4 w-full max-w-2xl mx-4 shadow-2xl"
						onClick={(e) => e.stopPropagation()}
						onKeyDown={(e) => e.stopPropagation()}
					>
						<div className="flex items-center justify-between mb-3">
							<span className="text-sm font-medium text-slate-700">
								サムネイル #{index + 1}
							</span>
							<button
								type="button"
								onClick={() => setIsThumbnailModalOpen(false)}
								className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
								aria-label="閉じる"
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									className="w-4 h-4"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
								>
									<title>閉じる</title>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										strokeWidth={2}
										d="M6 18L18 6M6 6l12 12"
									/>
								</svg>
							</button>
						</div>
						<div className="rounded-lg overflow-hidden bg-slate-100 aspect-square">
							<img
								src={thumbnailPreviewUrl}
								alt={`Thumbnail ${index + 1}`}
								className="w-full h-full object-contain"
							/>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
