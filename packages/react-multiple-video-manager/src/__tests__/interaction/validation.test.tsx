import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { harnesses, makeFile } from "./TestHarness";

describe.each(harnesses)("Validation — thumbnail (%s)", (_label, Harness) => {
	it("サムネイル型制限なしのとき任意ファイルがサムネイルとして受け入れられる", async () => {
		await render(<Harness schemaMaxVideos={3} />);

		const input = page.getByTestId("add-input");
		await userEvent.upload(input.element(), makeFile("video.mp4"));
		await expect.element(page.getByTestId("item-count")).toHaveTextContent("1");

		const thumbInput = page.getByTestId("thumbnail-input-0");
		await userEvent.upload(
			thumbInput.element(),
			new File(["img"], "thumb.txt", { type: "text/plain" }),
		);

		await expect
			.element(page.getByTestId("has-thumbnail-0"))
			.toHaveTextContent("yes");
	});
});

describe.each(harnesses)("Validation (%s)", (_label, Harness) => {
	it("不正ファイル追加 → エラーメッセージが DOM に表示される", async () => {
		await render(<Harness schemaMaxVideos={3} />);

		const input = page.getByTestId("add-input");
		await userEvent.upload(input.element(), makeFile("bad.avi", "video/avi"));

		await expect.element(page.getByTestId("item-count")).toHaveTextContent("1");
		await expect.element(page.getByTestId("error-0")).toBeVisible();
	});

	it("不正ファイルのエラーメッセージに acceptedVideoTypes の情報が含まれる", async () => {
		await render(<Harness schemaMaxVideos={3} />);

		const input = page.getByTestId("add-input");
		await userEvent.upload(input.element(), makeFile("bad.avi", "video/avi"));

		await expect.element(page.getByTestId("error-0")).toBeVisible();
		const errorText = page.getByTestId("error-0").element().textContent ?? "";
		expect(errorText).toMatch(/video\/mp4|video\/webm/);
	});

	it("maxVideos 超過 → onError で制御され2件目は追加されない", async () => {
		const onError = vi.fn();
		await render(<Harness maxVideos={1} onError={onError} />);

		const input = page.getByTestId("add-input");
		await userEvent.upload(input.element(), makeFile("a.mp4"));
		await expect.element(page.getByTestId("item-count")).toHaveTextContent("1");

		await userEvent.upload(input.element(), makeFile("b.mp4"));
		await expect.element(page.getByTestId("item-count")).toHaveTextContent("1");
		expect(onError).toHaveBeenCalledWith(
			expect.objectContaining({ type: "max_videos" }),
		);
	});

	it("不正ファイルを削除 → エラー表示が消える", async () => {
		await render(<Harness schemaMaxVideos={3} />);

		const input = page.getByTestId("add-input");
		await userEvent.upload(input.element(), makeFile("bad.avi", "video/avi"));
		await expect.element(page.getByTestId("error-0")).toBeVisible();

		await page.getByTestId("delete-0").click();

		await expect.element(page.getByTestId("item-count")).toHaveTextContent("0");
	});

	it("不正ファイルを正しいファイルに差し替え → エラーが消える", async () => {
		await render(<Harness schemaMaxVideos={3} />);

		const input = page.getByTestId("add-input");
		await userEvent.upload(input.element(), makeFile("bad.avi", "video/avi"));
		await expect.element(page.getByTestId("error-0")).toBeVisible();

		const changeInput = page.getByTestId("change-input-0");
		await userEvent.upload(changeInput.element(), makeFile("good.mp4"));

		await expect.element(page.getByTestId("item-count")).toHaveTextContent("1");
		await expect
			.element(page.getByTestId("name-0"))
			.toHaveTextContent("good.mp4");
		await expect.element(page.getByTestId("error-0")).not.toBeInTheDocument();
	});

	it("schemaMaxVideos 超過 → ルートエラーに枚数制限メッセージが表示される", async () => {
		await render(<Harness schemaMaxVideos={1} />);

		const input = page.getByTestId("add-input");
		await userEvent.upload(input.element(), makeFile("a.mp4"));
		await userEvent.upload(input.element(), makeFile("b.mp4"));

		await expect.element(page.getByTestId("root-error")).toBeVisible();
		const rootText = page.getByTestId("root-error").element().textContent ?? "";
		expect(rootText).toMatch(/1/);
	});

	it("schemaMaxVideos 超過分を削除 → ルートエラーが消える", async () => {
		await render(<Harness schemaMaxVideos={1} />);

		const input = page.getByTestId("add-input");
		await userEvent.upload(input.element(), makeFile("a.mp4"));
		await userEvent.upload(input.element(), makeFile("b.mp4"));
		await expect.element(page.getByTestId("root-error")).toBeVisible();

		await page.getByTestId("delete-1").click();

		await expect.element(page.getByTestId("item-count")).toHaveTextContent("1");
		await expect
			.element(page.getByTestId("root-error"))
			.not.toBeInTheDocument();
	});

	it("maxVideos で制御後に削除 → 再度追加可能になる", async () => {
		const onError = vi.fn();
		await render(<Harness maxVideos={1} onError={onError} />);

		const input = page.getByTestId("add-input");
		await userEvent.upload(input.element(), makeFile("a.mp4"));
		await expect.element(page.getByTestId("item-count")).toHaveTextContent("1");

		await page.getByTestId("delete-0").click();
		await expect.element(page.getByTestId("item-count")).toHaveTextContent("0");

		onError.mockClear();
		await userEvent.upload(input.element(), makeFile("b.mp4"));
		await expect.element(page.getByTestId("item-count")).toHaveTextContent("1");
		expect(onError).not.toHaveBeenCalled();
	});
});
