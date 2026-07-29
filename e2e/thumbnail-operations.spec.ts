import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, "fixtures");
const mp4Path = path.join(fixturesDir, "sample.mp4");
const thumbnailPath = path.join(fixturesDir, "sample-thumbnail.jpg");

test.describe("サムネイル操作", () => {
	test("ファイルアップロードでサムネイルを設定", async ({ page }) => {
		await page.goto("/");

		// 新規動画を追加
		const fileInput = page.locator("#videoUpload-videos");
		await fileInput.setInputFiles(mp4Path);
		await expect(page.getByText("新規", { exact: true })).toBeVisible();

		// 新規動画のサムネイルアップロード
		const videoItems = page.getByTestId("video-item");
		const newVideoItem = videoItems.last();
		const thumbnailInput = newVideoItem.getByTestId("upload-thumbnail-input");
		await thumbnailInput.setInputFiles(thumbnailPath);

		// サムネイルプレビューが表示される
		await expect(newVideoItem.getByTestId("thumbnail-preview")).toBeVisible();
	});

	test("サムネイル削除ボタンが表示されてクリックで削除", async ({ page }) => {
		await page.goto("/");

		// 新規動画を追加（uploadFile が設定されているため非同期アップロードが走る）
		const fileInput = page.locator("#videoUpload-videos");
		await fileInput.setInputFiles(mp4Path);
		await expect(page.getByText("新規", { exact: true })).toBeVisible({
			timeout: 10_000,
		});

		const videoItems = page.getByTestId("video-item");
		const newVideoItem = videoItems.last();

		// サムネイルアップロード（uploadThumbnailFile 経由のため非同期アップロードが走る）
		const thumbnailInput = newVideoItem.getByTestId("upload-thumbnail-input");
		await thumbnailInput.setInputFiles(thumbnailPath);
		await expect(newVideoItem.getByTestId("thumbnail-preview")).toBeVisible({
			timeout: 10_000,
		});

		// サムネイル削除ボタンが表示される
		const removeBtn = newVideoItem.getByTestId("remove-thumbnail-btn");
		await expect(removeBtn).toBeVisible();

		// サムネイル削除
		await removeBtn.click();

		// サムネイルが「なし」に戻る
		await expect(newVideoItem.getByTestId("thumbnail-empty")).toBeVisible();
		await expect(
			newVideoItem.getByTestId("thumbnail-preview"),
		).not.toBeVisible();
	});

	test("サムネイル未設定時は削除ボタンが非表示", async ({ page }) => {
		await page.goto("/");

		// 新規動画を追加
		const fileInput = page.locator("#videoUpload-videos");
		await fileInput.setInputFiles(mp4Path);

		const videoItems = page.getByTestId("video-item");
		const newVideoItem = videoItems.last();

		// サムネイル未設定なので削除ボタンは表示されない
		await expect(
			newVideoItem.getByTestId("remove-thumbnail-btn"),
		).not.toBeVisible();
	});

	test("既存動画の既存サムネイルが表示される", async ({ page }) => {
		await page.goto("/");

		const videoItems = page.getByTestId("video-item");
		const firstItem = videoItems.first();

		// 1件目の既存動画にはサムネイルがある
		await expect(firstItem.getByTestId("thumbnail-preview")).toBeVisible();
	});

	test("既存動画のサムネイルなしが正しく表示される", async ({ page }) => {
		await page.goto("/");

		const videoItems = page.getByTestId("video-item");
		const secondItem = videoItems.nth(1);

		// 2件目の既存動画にはサムネイルがない
		await expect(secondItem.getByTestId("thumbnail-empty")).toBeVisible();
	});

	test("既存動画にサムネイルをアップロードで設定", async ({ page }) => {
		await page.goto("/");

		const videoItems = page.getByTestId("video-item");
		const secondItem = videoItems.nth(1);

		// サムネイルなしを確認
		await expect(secondItem.getByTestId("thumbnail-empty")).toBeVisible();

		// サムネイルアップロード
		const thumbnailInput = secondItem.getByTestId("upload-thumbnail-input");
		await thumbnailInput.setInputFiles(thumbnailPath);

		// サムネイルプレビューが表示される
		await expect(secondItem.getByTestId("thumbnail-preview")).toBeVisible();
	});

	test("既存動画のサムネイルを削除するとthumbnailRemovedがtrueになる", async ({
		page,
	}) => {
		await page.goto("/");

		const videoItems = page.getByTestId("video-item");
		const firstItem = videoItems.first();

		// 既存サムネイルの削除
		const removeBtn = firstItem.getByTestId("remove-thumbnail-btn");
		await removeBtn.click();

		// JSON表示でthumbnailRemovedがtrueを確認
		const preElement = page.locator("pre");
		await expect(preElement).toContainText('"thumbnailRemoved": true');
	});
});
