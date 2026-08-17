import { useForm as useTanstackForm } from "@tanstack/react-form";
import type { ReactNode } from "react";
import { act } from "react";
import { useForm as useRhfForm } from "react-hook-form";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import type { Video } from "../../core/types/Video";
import { useMultiVideoController as useRhfController } from "../../react-hook-form/useMultiVideoController";
import { useMultiVideoController as useTanstackController } from "../../tanstack-form/useMultiVideoController";

/**
 * `VideoFieldAdapter` が宣言する不変条件を、RHF / TanStack の実アダプタで検証する。
 * 破ると転送結果の書き戻し判定（参照同一性）と handler の連続実行が壊れるが、
 * 型では強制できないため実挙動で固定する。
 */

type Handle = {
	items: Array<{ video: Video }>;
	add: (file: File) => Promise<boolean>;
	setThumbnailFromFile: (tempId: string, file: File) => Promise<boolean>;
};

type Form = { videos: Video[]; videosDeletedIds: string[] };

function RhfHost(props: { handleRef: { current: Handle | null } }): ReactNode {
	const form = useRhfForm<Form>({
		defaultValues: { videos: [], videosDeletedIds: [] },
	});
	const result = useRhfController({ form, name: "videos" });
	props.handleRef.current = {
		items: result.items,
		add: result.handlers.add,
		setThumbnailFromFile: (tempId, file) => {
			const item = result.items.find((i) => i.video.tempId === tempId);
			return item
				? item.handlers.setThumbnailFromFile(file)
				: Promise.resolve(false);
		},
	};
	return <div data-testid="host">items:{result.items.length}</div>;
}

function TanstackHost(props: { handleRef: { current: Handle | null } }) {
	const form = useTanstackForm({
		defaultValues: { videos: [], videosDeletedIds: [] } as Form,
	});
	const result = useTanstackController({ form, name: "videos" });
	props.handleRef.current = {
		items: result.items,
		add: result.handlers.add,
		setThumbnailFromFile: (tempId, file) => {
			const item = result.items.find((i) => i.video.tempId === tempId);
			return item
				? item.handlers.setThumbnailFromFile(file)
				: Promise.resolve(false);
		},
	};
	return <div data-testid="host">items:{result.items.length}</div>;
}

const hosts: [
	string,
	(props: { handleRef: { current: Handle | null } }) => ReactNode,
][] = [
	["rhf", RhfHost],
	["tanstack", TanstackHost],
];

describe.each(hosts)("VideoFieldAdapter invariants (%s)", (_label, Host) => {
	it("setVideos に渡した File の参照が保持される", async () => {
		const handleRef: { current: Handle | null } = { current: null };
		await render(<Host handleRef={handleRef} />);

		const file = new File(["data"], "v.mp4", { type: "video/mp4" });
		await act(async () => {
			await handleRef.current?.add(file);
		});

		const stored = handleRef.current?.items[0]?.video;
		expect(stored?.status).toBe("new");
		expect(stored?.status === "new" && stored.file).toBe(file);
	});

	it("サムネイルの File の参照が保持される", async () => {
		const handleRef: { current: Handle | null } = { current: null };
		await render(<Host handleRef={handleRef} />);

		await act(async () => {
			await handleRef.current?.add(
				new File(["data"], "v.mp4", { type: "video/mp4" }),
			);
		});
		const tempId = handleRef.current?.items[0]?.video.tempId as string;

		const thumb = new File(["t"], "t.jpg", { type: "image/jpeg" });
		await act(async () => {
			await handleRef.current?.setThumbnailFromFile(tempId, thumb);
		});

		const stored = handleRef.current?.items[0]?.video.thumbnail;
		expect(stored?.source).toBe("upload");
		expect(stored?.source === "upload" && stored.file).toBe(thumb);
	});

	it("同一 tick の連続追加が lost update にならない（read-your-writes）", async () => {
		const handleRef: { current: Handle | null } = { current: null };
		await render(<Host handleRef={handleRef} />);

		await act(async () => {
			await Promise.all([
				handleRef.current?.add(new File(["a"], "a.mp4", { type: "video/mp4" })),
				handleRef.current?.add(new File(["b"], "b.mp4", { type: "video/mp4" })),
			]);
		});

		expect(handleRef.current?.items).toHaveLength(2);
	});
});
