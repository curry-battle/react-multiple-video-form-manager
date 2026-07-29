import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { harnesses, makeFile } from "./TestHarness";

describe.each(harnesses)("Upload Flow (%s)", (_label, Harness) => {
	it("uploadFile 成功 → uploadedUrl が動画に反映される", async () => {
		const uploadFile = vi.fn(async () => ({
			uploadedUrl: "https://s3.example.com/uploaded.mp4",
		}));

		await render(<Harness uploadFile={uploadFile} />);

		await userEvent.upload(
			page.getByTestId("add-input").element(),
			makeFile("video.mp4"),
		);

		await expect.element(page.getByTestId("item-count")).toHaveTextContent("1");
		await expect.element(page.getByTestId("status-0")).toHaveTextContent("new");
		await expect
			.element(page.getByTestId("uploaded-url-0"))
			.toHaveTextContent("https://s3.example.com/uploaded.mp4");
		expect(uploadFile).toHaveBeenCalledOnce();
	});

	it("uploadFile 失敗 → onError(upload_file) が呼ばれ動画は追加されない", async () => {
		const onError = vi.fn();
		const uploadFile = vi.fn(async () => {
			throw new Error("upload failed");
		});

		await render(<Harness uploadFile={uploadFile} onError={onError} />);

		await userEvent.upload(
			page.getByTestId("add-input").element(),
			makeFile("video.mp4"),
		);

		await expect.element(page.getByTestId("item-count")).toHaveTextContent("0");
		expect(onError).toHaveBeenCalledWith(
			expect.objectContaining({ type: "upload_file" }),
		);
	});

	it("processFile 成功 → 加工後のファイルで動画が追加される", async () => {
		const processFile = vi.fn(async (file: File) => {
			return new File([file], `processed_${file.name}`, { type: file.type });
		});

		await render(<Harness processFile={processFile} />);

		await userEvent.upload(
			page.getByTestId("add-input").element(),
			makeFile("video.mp4"),
		);

		await expect.element(page.getByTestId("item-count")).toHaveTextContent("1");
		await expect
			.element(page.getByTestId("name-0"))
			.toHaveTextContent("processed_video.mp4");
		expect(processFile).toHaveBeenCalledOnce();
	});

	it("processFile 失敗 → onError(process_file) が呼ばれ動画は追加されない", async () => {
		const onError = vi.fn();
		const processFile = vi.fn(async () => {
			throw new Error("process failed");
		});

		await render(<Harness processFile={processFile} onError={onError} />);

		await userEvent.upload(
			page.getByTestId("add-input").element(),
			makeFile("video.mp4"),
		);

		await expect.element(page.getByTestId("item-count")).toHaveTextContent("0");
		expect(onError).toHaveBeenCalledWith(
			expect.objectContaining({ type: "process_file" }),
		);
	});

	it("processFile + uploadFile 連鎖: processFile の出力が uploadFile に渡される", async () => {
		const processFile = vi.fn(async (file: File) => {
			return new File([file], `resized_${file.name}`, { type: file.type });
		});
		const uploadFile = vi.fn(async (file: File) => {
			expect(file.name).toBe("resized_video.mp4");
			return { uploadedUrl: "https://s3.example.com/resized.mp4" };
		});

		await render(<Harness processFile={processFile} uploadFile={uploadFile} />);

		await userEvent.upload(
			page.getByTestId("add-input").element(),
			makeFile("video.mp4"),
		);

		await expect.element(page.getByTestId("item-count")).toHaveTextContent("1");
		await expect
			.element(page.getByTestId("uploaded-url-0"))
			.toHaveTextContent("https://s3.example.com/resized.mp4");
		expect(processFile).toHaveBeenCalledOnce();
		expect(uploadFile).toHaveBeenCalledOnce();
	});

	it("upload-on-select 進行中に isBusy が true になる", async () => {
		let resolveUpload!: (value: { uploadedUrl: string }) => void;
		const uploadFile = vi.fn(
			() =>
				new Promise<{ uploadedUrl: string }>((resolve) => {
					resolveUpload = resolve;
				}),
		);

		await render(<Harness uploadFile={uploadFile} />);

		await expect
			.element(page.getByTestId("is-busy"))
			.toHaveTextContent("false");

		await userEvent.upload(
			page.getByTestId("add-input").element(),
			makeFile("video.mp4"),
		);

		await expect.element(page.getByTestId("is-busy")).toHaveTextContent("true");

		resolveUpload({ uploadedUrl: "https://s3.example.com/done.mp4" });

		await expect
			.element(page.getByTestId("is-busy"))
			.toHaveTextContent("false");
		await expect.element(page.getByTestId("item-count")).toHaveTextContent("1");
	});

	it("uploadFile 未設定時は uploadedUrl なしで動画が即追加される", async () => {
		await render(<Harness />);

		await userEvent.upload(
			page.getByTestId("add-input").element(),
			makeFile("immediate.mp4"),
		);

		await expect.element(page.getByTestId("item-count")).toHaveTextContent("1");
		await expect
			.element(page.getByTestId("uploaded-url-0"))
			.not.toBeInTheDocument();
	});
});
