import { expect, test } from "@playwright/test";

test.describe("初期表示", () => {
	test("ページタイトル・フォームが表示される", async ({ page }) => {
		await page.goto("/");

		await expect(page.getByText("Video Form Example")).toBeVisible();
		await expect(page.getByText("動画管理フォーム")).toBeVisible();
	});

	test("デフォルト動画あり: 既存2件表示", async ({ page }) => {
		await page.goto("/");

		const existingLabels = page.getByText("既存", { exact: true });
		await expect(existingLabels).toHaveCount(2);
	});

	test("保存ボタンが有効", async ({ page }) => {
		await page.goto("/");

		await expect(page.getByRole("button", { name: "保存" })).toBeEnabled();
	});
});

test.describe("トグル操作", () => {
	test("トグルOFF: 動画なし状態", async ({ page }) => {
		await page.goto("/");

		await page.getByText(/デフォルト動画データ/).click();

		await expect(page.getByText("動画が選択されていません")).toBeVisible();
	});

	test("トグルOFF→ON: 既存復元", async ({ page }) => {
		await page.goto("/");

		const toggle = page.getByText(/デフォルト動画データ/);

		await toggle.click();
		await toggle.click();

		const existingLabels = page.getByText("既存", { exact: true });
		await expect(existingLabels).toHaveCount(2);
	});
});
