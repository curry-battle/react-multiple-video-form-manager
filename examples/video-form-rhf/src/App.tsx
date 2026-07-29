import {
	type Video,
	VideoUtils,
} from "@curry-battle/react-multiple-video-manager";
import { useState } from "react";
import { VideoForm } from "./components/VideoForm";
import { generateUUIDv7 } from "./libs/Uuid";

function App() {
	const [hasDefaultVideos, setHasDefaultVideos] = useState(true);

	const sampleData: Video[] = [
		VideoUtils.createExisting({
			id: generateUUIDv7(),
			uploadedUrl: "https://www.w3schools.com/html/mov_bbb.mp4",
			thumbnailUrl: "https://picsum.photos/320/180?random=1",
			tempId: "existing_1",
		}),
		VideoUtils.createExisting({
			id: generateUUIDv7(),
			uploadedUrl: "https://www.w3schools.com/html/movie.mp4",
			tempId: "existing_2",
		}),
	];

	const emptyData: Video[] = [];

	return (
		<main className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 p-8">
			<header className="text-center mb-10">
				<h1 className="text-4xl font-extrabold tracking-tight text-slate-800 mb-2">
					Video Form Example
				</h1>
				<div className="flex justify-center">
					<span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-100 text-blue-700 text-xs font-semibold">
						React Hook Form &amp; Zod
					</span>
				</div>
			</header>

			<div className="flex justify-center items-center mb-8">
				<ToggleButton
					checked={hasDefaultVideos}
					onChange={() => setHasDefaultVideos((prev) => !prev)}
					label={`デフォルト動画データ${hasDefaultVideos ? "あり" : "なし"}`}
				/>
			</div>
			<VideoForm
				key={hasDefaultVideos ? "default" : "empty"}
				initialVideos={hasDefaultVideos ? sampleData : emptyData}
			/>
		</main>
	);
}

export default App;

const ToggleButton = ({
	checked,
	onChange,
	label,
}: {
	checked: boolean;
	onChange: () => void;
	label?: string;
}) => (
	<label className="flex items-center gap-3 cursor-pointer select-none">
		{label && <span className="text-gray-700">{label}</span>}
		<button
			type="button"
			aria-pressed={checked}
			onClick={onChange}
			className={`relative w-12 h-7 rounded-full transition-colors duration-200 focus:outline-none ${checked ? "bg-blue-500" : "bg-gray-300"}`}
		>
			<span
				className={`absolute left-1 top-1 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${checked ? "translate-x-5" : ""}`}
			/>
		</button>
	</label>
);
