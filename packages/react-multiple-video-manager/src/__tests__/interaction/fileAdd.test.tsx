import { describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { harnesses, makeExisting, makeFile } from "./TestHarness";

describe.each(harnesses)("File Add (%s)", (_label, Harness) => {
	it("ファイル選択 → 動画が追加される", async () => {
		await render(<Harness />);

		await expect.element(page.getByTestId("item-count")).toHaveTextContent("0");
		await expect.element(page.getByTestId("empty-message")).toBeVisible();

		const input = page.getByTestId("add-input");
		await userEvent.upload(input.element(), makeFile("video.mp4"));

		await expect.element(page.getByTestId("item-count")).toHaveTextContent("1");
		await expect.element(page.getByTestId("status-0")).toHaveTextContent("new");
	});

	it("複数ファイルを連続選択 → 全て追加される", async () => {
		await render(<Harness />);

		const input = page.getByTestId("add-input");
		await userEvent.upload(input.element(), makeFile("a.mp4"));
		await userEvent.upload(input.element(), makeFile("b.mp4"));
		await userEvent.upload(input.element(), makeFile("c.mp4"));

		await expect.element(page.getByTestId("item-count")).toHaveTextContent("3");
	});

	it("既存動画がある状態で新規動画を追加できる", async () => {
		await render(
			<Harness
				initialVideos={[
					makeExisting("temp_a", "id-a"),
					makeExisting("temp_b", "id-b"),
				]}
			/>,
		);
		await expect.element(page.getByTestId("item-count")).toHaveTextContent("2");

		await userEvent.upload(
			page.getByTestId("add-input").element(),
			makeFile("new.mp4"),
		);

		await expect.element(page.getByTestId("item-count")).toHaveTextContent("3");
		await expect.element(page.getByTestId("status-2")).toHaveTextContent("new");
		await expect
			.element(page.getByTestId("name-2"))
			.toHaveTextContent("new.mp4");
	});
});
