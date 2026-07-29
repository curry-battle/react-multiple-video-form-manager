import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { harnesses, makeExisting, makeFile } from "./TestHarness";

describe.each(harnesses)("Delete (%s)", (_label, Harness) => {
	it("New 動画の削除 → DOM から除去される", async () => {
		await render(<Harness />);

		await userEvent.upload(
			page.getByTestId("add-input").element(),
			makeFile("a.mp4"),
		);
		await expect.element(page.getByTestId("item-count")).toHaveTextContent("1");

		await page.getByTestId("delete-0").click();

		await expect.element(page.getByTestId("item-count")).toHaveTextContent("0");
		await expect.element(page.getByTestId("empty-message")).toBeVisible();
	});

	it("Existing 動画の削除 → 非表示化・deletedVideoIds に id 追加・残りが正しく表示", async () => {
		await render(
			<Harness
				initialVideos={[
					makeExisting("temp_a", "id-a"),
					makeExisting("temp_b", "id-b"),
				]}
			/>,
		);
		await expect.element(page.getByTestId("item-count")).toHaveTextContent("2");
		await expect.element(page.getByTestId("deleted-ids")).toHaveTextContent("");

		await page.getByTestId("delete-0").click();

		await expect.element(page.getByTestId("item-count")).toHaveTextContent("1");
		await expect.element(page.getByTestId("name-0")).toHaveTextContent("id-b");
		await expect
			.element(page.getByTestId("deleted-ids"))
			.toHaveTextContent("id-a");
	});

	it("New 動画の削除では deletedVideoIds に id が追加されない", async () => {
		await render(<Harness />);

		await userEvent.upload(
			page.getByTestId("add-input").element(),
			makeFile("a.mp4"),
		);
		await expect.element(page.getByTestId("item-count")).toHaveTextContent("1");

		await page.getByTestId("delete-0").click();

		await expect.element(page.getByTestId("item-count")).toHaveTextContent("0");
		await expect.element(page.getByTestId("deleted-ids")).toHaveTextContent("");
	});

	it("Existing 動画の削除後に枠が解放されて追加可能になる", async () => {
		const onError = vi.fn();
		await render(
			<Harness
				maxVideos={1}
				initialVideos={[makeExisting("temp_a", "id-a")]}
				onError={onError}
			/>,
		);
		await expect.element(page.getByTestId("item-count")).toHaveTextContent("1");

		await userEvent.upload(
			page.getByTestId("add-input").element(),
			makeFile("b.mp4"),
		);
		await expect.element(page.getByTestId("item-count")).toHaveTextContent("1");
		expect(onError).toHaveBeenCalledWith(
			expect.objectContaining({ type: "max_videos" }),
		);

		await page.getByTestId("delete-0").click();
		await expect.element(page.getByTestId("item-count")).toHaveTextContent("0");

		onError.mockClear();
		await userEvent.upload(
			page.getByTestId("add-input").element(),
			makeFile("c.mp4"),
		);
		await expect.element(page.getByTestId("item-count")).toHaveTextContent("1");
		expect(onError).not.toHaveBeenCalled();
	});
});
