import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, "fixtures");
const mp4Path = path.join(fixturesDir, "sample.mp4");
const mp4Path2 = path.join(fixturesDir, "sample2.mp4");

test.describe("動画の追加", () => {
	test("MP4追加で新規動画表示", async ({ page }) => {
		await page.goto("/");

		const fileInput = page.locator("#videoUpload-videos");
		await fileInput.setInputFiles(mp4Path);

		await expect(page.getByText("新規", { exact: true })).toBeVisible();
	});

	test("複数MP4連続追加", async ({ page }) => {
		await page.goto("/");

		const fileInput = page.locator("#videoUpload-videos");

		await fileInput.setInputFiles(mp4Path);
		await fileInput.setInputFiles(mp4Path2);
		await fileInput.setInputFiles(mp4Path);

		const newVideos = page.getByText("新規", { exact: true });
		await expect(newVideos).toHaveCount(3);
	});

	test("空状態から動画追加で空メッセージ消える", async ({ page }) => {
		await page.goto("/");

		await page.getByText(/デフォルト動画データ/).click();
		await expect(page.getByText("動画が選択されていません")).toBeVisible();

		const fileInput = page.locator("#videoUpload-videos");
		await fileInput.setInputFiles(mp4Path);

		await expect(page.getByText("動画が選択されていません")).not.toBeVisible();
	});
});

test.describe("動画の削除", () => {
	test("新規を削除", async ({ page }) => {
		await page.goto("/");
		page.on("dialog", (dialog) => dialog.accept());

		const fileInput = page.locator("#videoUpload-videos");
		await fileInput.setInputFiles(mp4Path);
		await expect(page.getByText("新規", { exact: true })).toBeVisible();

		const videoItems = page.getByTestId("video-item");
		const newVideoItem = videoItems.last();
		await newVideoItem.getByRole("button", { name: "動画を削除" }).click();

		await expect(page.getByText("新規", { exact: true })).not.toBeVisible();
	});

	test("既存を削除", async ({ page }) => {
		await page.goto("/");
		page.on("dialog", (dialog) => dialog.accept());

		const existingLabels = page.getByText("既存", { exact: true });
		await expect(existingLabels).toHaveCount(2);

		const videoItems = page.getByTestId("video-item");
		await videoItems
			.first()
			.getByRole("button", { name: "動画を削除" })
			.click();

		await expect(page.getByText("既存", { exact: true })).toHaveCount(1);
	});

	test("既存削除後は配列から除去される", async ({ page }) => {
		await page.goto("/");
		page.on("dialog", (dialog) => dialog.accept());

		const videoItems = page.getByTestId("video-item");
		await videoItems
			.first()
			.getByRole("button", { name: "動画を削除" })
			.click();

		await expect(videoItems).toHaveCount(1);
	});

	test("全動画削除で空メッセージ", async ({ page }) => {
		await page.goto("/");
		page.on("dialog", (dialog) => dialog.accept());

		const deleteButtons = page.getByRole("button", {
			name: "動画を削除",
		});
		await deleteButtons.first().click();
		await deleteButtons.first().click();

		await expect(page.getByText("動画が選択されていません")).toBeVisible();
	});
});

test.describe("動画のファイル差し替え", () => {
	test("新規動画を差し替え", async ({ page }) => {
		await page.goto("/");

		const fileInput = page.locator("#videoUpload-videos");
		await fileInput.setInputFiles(mp4Path);
		await expect(page.getByText("新規", { exact: true })).toBeVisible();

		const videoItems = page.getByTestId("video-item");
		const newVideoItem = videoItems.last();
		const changeInput = newVideoItem.locator(
			'input[type="file"][accept="video/*"]',
		);
		await changeInput.setInputFiles(mp4Path2);

		await expect(page.getByText("新規", { exact: true })).toBeVisible();
	});

	test("既存動画を差し替え", async ({ page }) => {
		await page.goto("/");

		const videoItems = page.getByTestId("video-item");
		const firstItem = videoItems.first();

		await expect(firstItem.getByText("既存", { exact: true })).toBeVisible();

		const changeInput = firstItem.locator(
			'input[type="file"][accept="video/*"]',
		);
		await changeInput.setInputFiles(mp4Path);

		await expect(firstItem.getByText("新規", { exact: true })).toBeVisible();
	});
});

test.describe("動画の並び替え", () => {
	test("上矢印ボタンで順序入替", async ({ page }) => {
		await page.goto("/");

		const videoItems = page.getByTestId("video-item");

		// デバッグJSONを開く
		await page.getByText("動画の状態 (デバッグ)").click();
		const preElement = page.locator("pre");
		await expect(preElement).toContainText('"tempId": "existing_1"');

		// 2番目のアイテムを上に移動
		const secondItem = videoItems.nth(1);
		await secondItem.getByRole("button", { name: "上へ" }).click();

		// existing_2 が先頭に来ていることを polling assert で確認
		await expect(async () => {
			const jsonText = await preElement.textContent();
			const videos = JSON.parse(jsonText || "[]");
			expect(videos[0].tempId).toBe("existing_2");
			expect(videos[1].tempId).toBe("existing_1");
		}).toPass();
	});

	test("下矢印ボタンで順序入替", async ({ page }) => {
		await page.goto("/");

		const videoItems = page.getByTestId("video-item");

		// デバッグJSONを開く
		await page.getByText("動画の状態 (デバッグ)").click();
		const preElement = page.locator("pre");

		// 1番目のアイテムを下に移動
		const firstItem = videoItems.first();
		await firstItem.getByRole("button", { name: "下へ" }).click();

		// existing_2 が先頭に来ていることを polling assert で確認
		await expect(async () => {
			const jsonText = await preElement.textContent();
			const videos = JSON.parse(jsonText || "[]");
			expect(videos[0].tempId).toBe("existing_2");
			expect(videos[1].tempId).toBe("existing_1");
		}).toPass();
	});

	test("先頭の上矢印は無効", async ({ page }) => {
		await page.goto("/");

		const videoItems = page.getByTestId("video-item");
		const firstItem = videoItems.first();

		await expect(
			firstItem.getByRole("button", { name: "上へ" }),
		).toBeDisabled();
	});

	test("末尾の下矢印は無効", async ({ page }) => {
		await page.goto("/");

		const videoItems = page.getByTestId("video-item");
		const lastItem = videoItems.last();

		await expect(lastItem.getByRole("button", { name: "下へ" })).toBeDisabled();
	});
});
