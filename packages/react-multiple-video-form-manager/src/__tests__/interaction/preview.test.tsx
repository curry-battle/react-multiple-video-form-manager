import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { setupBrowserMocks } from "../../__testutils__/browserMocks";
import { harnesses, makeExisting, makeFile } from "./TestHarness";

describe.each(harnesses)("Preview (%s)", (_label, Harness) => {
	afterEach(() => vi.unstubAllGlobals());

	it("New 動画 → blob URL がプレビューに表示される", async () => {
		setupBrowserMocks("preview");
		await render(<Harness />);

		await userEvent.upload(
			page.getByTestId("add-input").element(),
			makeFile("video.mp4"),
		);

		const img = page.getByTestId("preview-0");
		await expect.element(img).toBeVisible();
		const src = img.element().getAttribute("src");
		expect(src).toMatch(/^blob:/);
	});

	it("Existing 動画 → サーバー URL がプレビューに表示される", async () => {
		await render(<Harness initialVideos={[makeExisting("temp_a", "id-a")]} />);

		const img = page.getByTestId("preview-0");
		await expect.element(img).toBeVisible();
		const src = img.element().getAttribute("src");
		expect(src).toBe("https://s3.example.com/id-a.mp4");
	});

	it("fileChange 後にプレビューが新しい blob URL に更新される", async () => {
		setupBrowserMocks("fc");
		await render(<Harness />);

		await userEvent.upload(
			page.getByTestId("add-input").element(),
			makeFile("first.mp4"),
		);
		await expect.element(page.getByTestId("preview-0")).toBeVisible();
		const firstSrc = page
			.getByTestId("preview-0")
			.element()
			.getAttribute("src");
		expect(firstSrc).toMatch(/^blob:/);

		const changeInput = page.getByTestId("change-input-0");
		await userEvent.upload(changeInput.element(), makeFile("second.mp4"));

		await expect
			.element(page.getByTestId("name-0"))
			.toHaveTextContent("second.mp4");
		await vi.waitFor(() => {
			const src = page.getByTestId("preview-0").element().getAttribute("src");
			expect(src).not.toBe(firstSrc);
		});
		const secondSrc = page
			.getByTestId("preview-0")
			.element()
			.getAttribute("src");
		expect(secondSrc).toMatch(/^blob:/);
	});

	it("move 後もプレビューが正しい動画に追随する", async () => {
		await render(
			<Harness
				initialVideos={[
					makeExisting("temp_a", "id-a"),
					makeExisting("temp_b", "id-b"),
				]}
			/>,
		);

		const srcBefore0 = page
			.getByTestId("preview-0")
			.element()
			.getAttribute("src");
		const srcBefore1 = page
			.getByTestId("preview-1")
			.element()
			.getAttribute("src");

		await page.getByTestId("move-down-0").click();

		const srcAfter0 = page
			.getByTestId("preview-0")
			.element()
			.getAttribute("src");
		const srcAfter1 = page
			.getByTestId("preview-1")
			.element()
			.getAttribute("src");

		expect(srcAfter0).toBe(srcBefore1);
		expect(srcAfter1).toBe(srcBefore0);
	});
});
