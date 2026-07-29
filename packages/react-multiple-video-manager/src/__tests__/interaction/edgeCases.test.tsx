import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { harnesses, makeExisting, makeFile } from "./TestHarness";

describe.each(harnesses)("Edge Cases (%s)", (_label, Harness) => {
	it("連続削除 → 全て正しく除去されて壊れない", async () => {
		const onError = vi.fn();
		await render(
			<Harness
				initialVideos={[
					makeExisting("temp_a", "id-a"),
					makeExisting("temp_b", "id-b"),
				]}
				onError={onError}
			/>,
		);
		await expect.element(page.getByTestId("item-count")).toHaveTextContent("2");

		await page.getByTestId("delete-0").click();
		await expect.element(page.getByTestId("item-count")).toHaveTextContent("1");
		await expect.element(page.getByTestId("name-0")).toHaveTextContent("id-b");

		await page.getByTestId("delete-0").click();
		await expect.element(page.getByTestId("item-count")).toHaveTextContent("0");
		await expect.element(page.getByTestId("empty-message")).toBeVisible();

		expect(onError).not.toHaveBeenCalled();
	});

	it("同一ファイルを連続で追加できる (add-input の value がリセットされる)", async () => {
		await render(<Harness />);

		const input = page.getByTestId("add-input");

		await userEvent.upload(input.element(), makeFile("same.mp4"));
		await expect.element(page.getByTestId("item-count")).toHaveTextContent("1");

		await userEvent.upload(input.element(), makeFile("same.mp4"));
		await expect.element(page.getByTestId("item-count")).toHaveTextContent("2");
	});
});

describe.each(harnesses)(
	"Race conditions — 実アダプタ経由 (%s)",
	(_label, Harness) => {
		it("複数ファイル同時追加 → 全件が lost update なく追加される", async () => {
			await render(<Harness />);

			const input = page.getByTestId("add-input");
			await userEvent.upload(input.element(), [
				makeFile("a.mp4"),
				makeFile("b.mp4"),
				makeFile("c.mp4"),
			]);

			await expect
				.element(page.getByTestId("item-count"))
				.toHaveTextContent("3");
			await expect
				.element(page.getByTestId("name-0"))
				.toHaveTextContent("a.mp4");
			await expect
				.element(page.getByTestId("name-1"))
				.toHaveTextContent("b.mp4");
			await expect
				.element(page.getByTestId("name-2"))
				.toHaveTextContent("c.mp4");
		});

		it("既存動画の連続削除 → 全 deletedVideoIds が保持される", async () => {
			await render(
				<Harness
					initialVideos={[
						makeExisting("temp_a", "id-a"),
						makeExisting("temp_b", "id-b"),
						makeExisting("temp_c", "id-c"),
					]}
				/>,
			);
			await expect
				.element(page.getByTestId("item-count"))
				.toHaveTextContent("3");

			await page.getByTestId("delete-0").click();
			await page.getByTestId("delete-0").click();
			await page.getByTestId("delete-0").click();

			await expect
				.element(page.getByTestId("item-count"))
				.toHaveTextContent("0");

			const deletedIds =
				page.getByTestId("deleted-ids").element().textContent ?? "";
			expect(deletedIds).toContain("id-a");
			expect(deletedIds).toContain("id-b");
			expect(deletedIds).toContain("id-c");
		});

		it("追加と削除の混在 → 最終状態が正しい", async () => {
			await render(
				<Harness initialVideos={[makeExisting("temp_a", "id-a")]} />,
			);
			await expect
				.element(page.getByTestId("item-count"))
				.toHaveTextContent("1");

			const input = page.getByTestId("add-input");
			await userEvent.upload(input.element(), makeFile("new.mp4"));
			await expect
				.element(page.getByTestId("item-count"))
				.toHaveTextContent("2");

			await page.getByTestId("delete-0").click();
			await expect
				.element(page.getByTestId("item-count"))
				.toHaveTextContent("1");
			await expect
				.element(page.getByTestId("name-0"))
				.toHaveTextContent("new.mp4");

			const deletedIds =
				page.getByTestId("deleted-ids").element().textContent ?? "";
			expect(deletedIds).toContain("id-a");
		});
	},
);
