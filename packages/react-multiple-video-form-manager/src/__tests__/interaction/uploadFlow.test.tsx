import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import type {
	UploadFileContext,
	UploadFileFn,
	UploadFileResult,
} from "../../core/types/Upload";
import { harnesses, makeFile } from "./TestHarness";

/** 転送の解決タイミングをテスト側で握るための uploadFile */
function createUploadSpy() {
	const calls: {
		file: File;
		ctx: UploadFileContext;
		resolve: (result: UploadFileResult) => void;
		reject: (error: unknown) => void;
	}[] = [];
	const uploadFile: UploadFileFn = (file, ctx) =>
		new Promise<UploadFileResult>((resolve, reject) => {
			calls.push({ file, ctx, resolve, reject });
		});
	return { uploadFile, calls };
}

describe.each(harnesses)("Upload Flow (%s)", (_label, Harness) => {
	it("uploadFile 成功 → uploadRef が動画に反映される", async () => {
		const uploadFile = vi.fn(async () => ({
			uploadRef: "https://s3.example.com/uploaded.mp4",
		}));

		await render(<Harness uploadFile={uploadFile} />);

		await userEvent.upload(
			page.getByTestId("add-input").element(),
			makeFile("video.mp4"),
		);

		await expect.element(page.getByTestId("item-count")).toHaveTextContent("1");
		await expect.element(page.getByTestId("status-0")).toHaveTextContent("new");
		await expect
			.element(page.getByTestId("upload-ref-0"))
			.toHaveTextContent("https://s3.example.com/uploaded.mp4");
		expect(uploadFile).toHaveBeenCalledOnce();
	});

	it("転送の完了を待たずに項目が出て、uploadState が pending になる", async () => {
		const { uploadFile, calls } = createUploadSpy();

		await render(<Harness uploadFile={uploadFile} />);

		await userEvent.upload(
			page.getByTestId("add-input").element(),
			makeFile("video.mp4"),
		);

		await expect.element(page.getByTestId("item-count")).toHaveTextContent("1");
		await expect
			.element(page.getByTestId("upload-state-0"))
			.toHaveTextContent("video:pending");
		await expect
			.element(page.getByTestId("uploads-pending"))
			.toHaveTextContent("1");
		await expect
			.element(page.getByTestId("upload-ref-0"))
			.not.toBeInTheDocument();

		calls[0].resolve({ uploadRef: "https://s3.example.com/done.mp4" });

		await expect
			.element(page.getByTestId("upload-ref-0"))
			.toHaveTextContent("https://s3.example.com/done.mp4");
		await expect
			.element(page.getByTestId("uploads-pending"))
			.toHaveTextContent("0");
		await expect
			.element(page.getByTestId("upload-state-0"))
			.toHaveTextContent("");
	});

	it("onProgress の報告が uploadState に出る", async () => {
		const { uploadFile, calls } = createUploadSpy();

		await render(<Harness uploadFile={uploadFile} />);

		await userEvent.upload(
			page.getByTestId("add-input").element(),
			makeFile("video.mp4"),
		);
		await expect.element(page.getByTestId("item-count")).toHaveTextContent("1");

		calls[0].ctx.onProgress(0.5);

		await expect
			.element(page.getByTestId("upload-state-0"))
			.toHaveTextContent("video:pending:50");
	});

	it("uploadFile 失敗 → 項目は残り、onError(upload) と failed で伝わる", async () => {
		const onError = vi.fn();
		const uploadFile = vi.fn(async () => {
			throw new Error("upload failed");
		});

		await render(<Harness uploadFile={uploadFile} onError={onError} />);

		await userEvent.upload(
			page.getByTestId("add-input").element(),
			makeFile("video.mp4"),
		);

		await expect.element(page.getByTestId("item-count")).toHaveTextContent("1");
		await expect
			.element(page.getByTestId("upload-state-0"))
			.toHaveTextContent("video:failed");
		await expect
			.element(page.getByTestId("uploads-failed"))
			.toHaveTextContent("1");
		expect(onError).toHaveBeenCalledWith(
			expect.objectContaining({ type: "upload", kind: "video" }),
		);
	});

	it("失敗後の retry で転送が再送され uploadRef が入る", async () => {
		let attempt = 0;
		const uploadFile = vi.fn(async () => {
			attempt += 1;
			if (attempt === 1) throw new Error("upload failed");
			return { uploadRef: "https://s3.example.com/retried.mp4" };
		});

		await render(<Harness uploadFile={uploadFile} />);

		await userEvent.upload(
			page.getByTestId("add-input").element(),
			makeFile("video.mp4"),
		);
		await expect
			.element(page.getByTestId("upload-state-0"))
			.toHaveTextContent("video:failed");

		await page.getByTestId("retry-0").click();

		await expect
			.element(page.getByTestId("upload-ref-0"))
			.toHaveTextContent("https://s3.example.com/retried.mp4");
		await expect
			.element(page.getByTestId("uploads-failed"))
			.toHaveTextContent("0");
	});

	it("本体の転送中にサムネイルを設定しても本体の転送が破棄されない", async () => {
		const { uploadFile, calls } = createUploadSpy();

		await render(<Harness uploadFile={uploadFile} />);

		await userEvent.upload(
			page.getByTestId("add-input").element(),
			makeFile("video.mp4"),
		);
		await expect
			.element(page.getByTestId("upload-state-0"))
			.toHaveTextContent("video:pending");

		await userEvent.upload(
			page.getByTestId("thumbnail-input-0").element(),
			makeFile("thumb.jpg", "image/jpeg"),
		);
		await expect
			.element(page.getByTestId("has-thumbnail-0"))
			.toHaveTextContent("yes");
		await expect
			.element(page.getByTestId("upload-state-0"))
			.toHaveTextContent("video:pending,thumbnail:pending");

		for (const call of calls) {
			call.resolve({
				uploadRef:
					call.ctx.kind === "video"
						? "https://s3.example.com/v.mp4"
						: "https://s3.example.com/t.jpg",
			});
		}

		await expect
			.element(page.getByTestId("upload-ref-0"))
			.toHaveTextContent("https://s3.example.com/v.mp4");
		await expect
			.element(page.getByTestId("uploads-pending"))
			.toHaveTextContent("0");
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
			return { uploadRef: "https://s3.example.com/resized.mp4" };
		});

		await render(<Harness processFile={processFile} uploadFile={uploadFile} />);

		await userEvent.upload(
			page.getByTestId("add-input").element(),
			makeFile("video.mp4"),
		);

		await expect.element(page.getByTestId("item-count")).toHaveTextContent("1");
		await expect
			.element(page.getByTestId("upload-ref-0"))
			.toHaveTextContent("https://s3.example.com/resized.mp4");
		expect(processFile).toHaveBeenCalledOnce();
		expect(uploadFile).toHaveBeenCalledOnce();
	});

	it("uploadFile 未設定時は uploadRef なしで動画が即追加される", async () => {
		await render(<Harness />);

		await userEvent.upload(
			page.getByTestId("add-input").element(),
			makeFile("immediate.mp4"),
		);

		await expect.element(page.getByTestId("item-count")).toHaveTextContent("1");
		await expect
			.element(page.getByTestId("upload-ref-0"))
			.not.toBeInTheDocument();
		await expect
			.element(page.getByTestId("uploads-pending"))
			.toHaveTextContent("0");
	});
});
