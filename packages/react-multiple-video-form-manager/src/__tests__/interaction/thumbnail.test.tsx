import { describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { harnesses, makeFile } from "./TestHarness";

describe.each(harnesses)("Thumbnail (%s)", (_label, Harness) => {
	it("サムネイルファイルをアップロード → has-thumbnail が yes になる", async () => {
		await render(<Harness />);

		await userEvent.upload(
			page.getByTestId("add-input").element(),
			makeFile("video.mp4"),
		);
		await expect
			.element(page.getByTestId("has-thumbnail-0"))
			.toHaveTextContent("no");

		const thumbInput = page.getByTestId("thumbnail-input-0");
		await userEvent.upload(
			thumbInput.element(),
			new File(["thumb"], "thumb.jpg", { type: "image/jpeg" }),
		);

		await expect
			.element(page.getByTestId("has-thumbnail-0"))
			.toHaveTextContent("yes");
	});

	it("サムネイル削除 → has-thumbnail が no に戻る", async () => {
		await render(<Harness />);

		await userEvent.upload(
			page.getByTestId("add-input").element(),
			makeFile("video.mp4"),
		);
		await expect.element(page.getByTestId("item-count")).toHaveTextContent("1");

		await userEvent.upload(
			page.getByTestId("thumbnail-input-0").element(),
			new File(["thumb"], "thumb.jpg", { type: "image/jpeg" }),
		);
		await expect
			.element(page.getByTestId("has-thumbnail-0"))
			.toHaveTextContent("yes");

		await page.getByTestId("remove-thumbnail-0").click();

		await expect
			.element(page.getByTestId("has-thumbnail-0"))
			.toHaveTextContent("no");
	});

	it("動画差し替え後もサムネイル操作が可能", async () => {
		await render(<Harness />);

		await userEvent.upload(
			page.getByTestId("add-input").element(),
			makeFile("video.mp4"),
		);
		await expect.element(page.getByTestId("item-count")).toHaveTextContent("1");

		const changeInput = page.getByTestId("change-input-0");
		await userEvent.upload(changeInput.element(), makeFile("new.mp4"));
		await expect
			.element(page.getByTestId("name-0"))
			.toHaveTextContent("new.mp4");

		await userEvent.upload(
			page.getByTestId("thumbnail-input-0").element(),
			new File(["thumb"], "thumb.jpg", { type: "image/jpeg" }),
		);

		await expect
			.element(page.getByTestId("has-thumbnail-0"))
			.toHaveTextContent("yes");
	});
});
