import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { harnesses, makeExisting, makeFile } from "./TestHarness";

describe.each(harnesses)("File Change (%s)", (_label, Harness) => {
	it("既存動画の差し替え → New に変わり数は変わらない", async () => {
		await render(<Harness initialVideos={[makeExisting("temp_a", "id-a")]} />);

		await expect.element(page.getByTestId("item-count")).toHaveTextContent("1");
		await expect
			.element(page.getByTestId("status-0"))
			.toHaveTextContent("existing");
		await expect.element(page.getByTestId("name-0")).toHaveTextContent("id-a");

		const changeInput = page.getByTestId("change-input-0");
		await userEvent.upload(changeInput.element(), makeFile("new.mp4"));

		await expect.element(page.getByTestId("item-count")).toHaveTextContent("1");
		await expect.element(page.getByTestId("status-0")).toHaveTextContent("new");
		await expect
			.element(page.getByTestId("name-0"))
			.toHaveTextContent("new.mp4");
	});

	it("New 動画の差し替え → file.name が更新される", async () => {
		await render(<Harness />);

		const addInput = page.getByTestId("add-input");
		await userEvent.upload(addInput.element(), makeFile("orig.mp4"));
		await expect.element(page.getByTestId("item-count")).toHaveTextContent("1");
		await expect
			.element(page.getByTestId("name-0"))
			.toHaveTextContent("orig.mp4");

		const changeInput = page.getByTestId("change-input-0");
		await userEvent.upload(changeInput.element(), makeFile("replaced.mp4"));

		await expect.element(page.getByTestId("item-count")).toHaveTextContent("1");
		await expect.element(page.getByTestId("status-0")).toHaveTextContent("new");
		await expect
			.element(page.getByTestId("name-0"))
			.toHaveTextContent("replaced.mp4");
	});

	it("maxVideos 到達時でも fileChange は可能", async () => {
		const onError = vi.fn();
		await render(
			<Harness
				maxVideos={1}
				initialVideos={[makeExisting("temp_a", "id-a")]}
				onError={onError}
			/>,
		);
		await expect.element(page.getByTestId("item-count")).toHaveTextContent("1");

		const changeInput = page.getByTestId("change-input-0");
		await userEvent.upload(changeInput.element(), makeFile("replaced.mp4"));

		await expect.element(page.getByTestId("item-count")).toHaveTextContent("1");
		await expect.element(page.getByTestId("status-0")).toHaveTextContent("new");
		await expect
			.element(page.getByTestId("name-0"))
			.toHaveTextContent("replaced.mp4");
		expect(onError).not.toHaveBeenCalled();
	});
});
