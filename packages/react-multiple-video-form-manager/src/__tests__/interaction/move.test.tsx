import { describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { harnesses, makeExisting, makeFile } from "./TestHarness";

describe.each(harnesses)("Move (%s)", (_label, Harness) => {
	it("下ボタンクリック → 動画の順序が入れ替わる", async () => {
		await render(<Harness />);

		const input = page.getByTestId("add-input");
		await userEvent.upload(input.element(), makeFile("a.mp4"));
		await userEvent.upload(input.element(), makeFile("b.mp4"));
		await expect.element(page.getByTestId("name-0")).toHaveTextContent("a.mp4");
		await expect.element(page.getByTestId("name-1")).toHaveTextContent("b.mp4");

		await page.getByTestId("move-down-0").click();

		await expect.element(page.getByTestId("name-0")).toHaveTextContent("b.mp4");
		await expect.element(page.getByTestId("name-1")).toHaveTextContent("a.mp4");
	});

	it("上ボタンクリック → 動画の順序が入れ替わる", async () => {
		await render(<Harness />);

		const input = page.getByTestId("add-input");
		await userEvent.upload(input.element(), makeFile("a.mp4"));
		await userEvent.upload(input.element(), makeFile("b.mp4"));

		await page.getByTestId("move-up-1").click();

		await expect.element(page.getByTestId("name-0")).toHaveTextContent("b.mp4");
		await expect.element(page.getByTestId("name-1")).toHaveTextContent("a.mp4");
	});

	it("先頭の上ボタンは disabled", async () => {
		await render(<Harness />);

		const input = page.getByTestId("add-input");
		await userEvent.upload(input.element(), makeFile("a.mp4"));
		await userEvent.upload(input.element(), makeFile("b.mp4"));

		await expect.element(page.getByTestId("move-up-0")).toBeDisabled();
	});

	it("末尾の下ボタンは disabled", async () => {
		await render(<Harness />);

		const input = page.getByTestId("add-input");
		await userEvent.upload(input.element(), makeFile("a.mp4"));
		await userEvent.upload(input.element(), makeFile("b.mp4"));

		await expect.element(page.getByTestId("move-down-1")).toBeDisabled();
	});

	it("Existing 削除後でも残ったアイテム間で move が動作する", async () => {
		await render(
			<Harness
				initialVideos={[
					makeExisting("temp_a", "id-a"),
					makeExisting("temp_b", "id-b"),
					makeExisting("temp_c", "id-c"),
				]}
			/>,
		);
		await expect.element(page.getByTestId("item-count")).toHaveTextContent("3");

		await page.getByTestId("delete-1").click();
		await expect.element(page.getByTestId("item-count")).toHaveTextContent("2");
		await expect.element(page.getByTestId("name-0")).toHaveTextContent("id-a");
		await expect.element(page.getByTestId("name-1")).toHaveTextContent("id-c");

		await page.getByTestId("move-down-0").click();
		await expect.element(page.getByTestId("name-0")).toHaveTextContent("id-c");
		await expect.element(page.getByTestId("name-1")).toHaveTextContent("id-a");
	});
});
