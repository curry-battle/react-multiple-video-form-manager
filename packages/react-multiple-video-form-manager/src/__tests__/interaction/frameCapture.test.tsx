import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { harnesses, makeFile } from "./TestHarness";

describe.each(harnesses)("Frame Capture (%s)", (_label, Harness) => {
	it("フレームキャプチャ → has-thumbnail が yes になる", async () => {
		await render(<Harness />);

		await userEvent.upload(
			page.getByTestId("add-input").element(),
			makeFile("video.mp4"),
		);
		await expect
			.element(page.getByTestId("has-thumbnail-0"))
			.toHaveTextContent("no");

		await page.getByTestId("capture-thumbnail-0").click();

		await expect
			.element(page.getByTestId("has-thumbnail-0"))
			.toHaveTextContent("yes");
	});

	it("フレームキャプチャ後にサムネイル削除 → has-thumbnail が no に戻る", async () => {
		await render(<Harness />);

		await userEvent.upload(
			page.getByTestId("add-input").element(),
			makeFile("video.mp4"),
		);

		await page.getByTestId("capture-thumbnail-0").click();
		await expect
			.element(page.getByTestId("has-thumbnail-0"))
			.toHaveTextContent("yes");

		await page.getByTestId("remove-thumbnail-0").click();
		await expect
			.element(page.getByTestId("has-thumbnail-0"))
			.toHaveTextContent("no");
	});

	it("captureFrame 失敗 → onError が type: 'unknown' で呼ばれる", async () => {
		const onError = vi.fn();
		const failingVideoElement = () => {
			const el = document.createElement("video");
			Object.defineProperty(el, "videoWidth", { value: 0 });
			Object.defineProperty(el, "videoHeight", { value: 0 });
			Object.defineProperty(el, "currentTime", { value: 0 });
			return el;
		};

		await render(
			<Harness onError={onError} createVideoElement={failingVideoElement} />,
		);

		await userEvent.upload(
			page.getByTestId("add-input").element(),
			makeFile("video.mp4"),
		);
		await expect.element(page.getByTestId("item-count")).toHaveTextContent("1");

		await page.getByTestId("capture-thumbnail-0").click();

		await vi.waitFor(() => {
			expect(onError).toHaveBeenCalledWith(
				expect.objectContaining({ type: "unknown" }),
			);
		});

		await expect
			.element(page.getByTestId("has-thumbnail-0"))
			.toHaveTextContent("no");
	});
});
