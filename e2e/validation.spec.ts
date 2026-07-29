import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, "fixtures");
const mp4Path = path.join(fixturesDir, "sample.mp4");

test.describe("バリデーション", () => {
	test("不正な形式のファイル追加 → per-item エラーが表示される", async ({
		page,
	}) => {
		await page.goto("/");

		const fileInput = page.locator("#videoUpload-videos");
		await fileInput.setInputFiles({
			name: "invalid.avi",
			mimeType: "video/avi",
			buffer: Buffer.from("dummy"),
		});

		const videoItems = page.getByTestId("video-item");
		await expect(videoItems).toHaveCount(3, { timeout: 10_000 });

		const newItem = videoItems.last();
		await expect(
			newItem.locator("p", { hasText: /ファイル形式/ }),
		).toBeVisible();
	});

	test("不正ファイル差し替え → エラー解消後に保存ボタンが有効化される", async ({
		page,
	}) => {
		await page.goto("/");

		const fileInput = page.locator("#videoUpload-videos");
		await fileInput.setInputFiles({
			name: "invalid.avi",
			mimeType: "video/avi",
			buffer: Buffer.from("dummy"),
		});

		const videoItems = page.getByTestId("video-item");
		await expect(videoItems).toHaveCount(3, { timeout: 10_000 });

		const newItem = videoItems.last();
		await expect(
			newItem.locator("p", { hasText: /ファイル形式/ }),
		).toBeVisible();

		// 正しいファイルに差し替え
		const changeInput = newItem.locator('input[type="file"][accept="video/*"]');
		await changeInput.setInputFiles(mp4Path);

		// エラーが消えるのを待つ（uploadFile の非同期処理完了を待つ）
		await expect(
			newItem.locator("p", { hasText: /ファイル形式/ }),
		).not.toBeVisible({ timeout: 10_000 });
	});

	test("maxVideos 超過（core ガード）→ operation-error が表示される", async ({
		page,
	}) => {
		await page.goto("/");

		const fileInput = page.locator("#videoUpload-videos");

		// 既存2件 + 新規3件 = 5件（上限）
		await fileInput.setInputFiles(mp4Path);
		await expect(page.getByText("新規", { exact: true })).toBeVisible({
			timeout: 10_000,
		});
		await fileInput.setInputFiles(mp4Path);
		await expect(page.getByText("新規", { exact: true })).toHaveCount(2, {
			timeout: 10_000,
		});
		await fileInput.setInputFiles(mp4Path);
		await expect(page.getByText("新規", { exact: true })).toHaveCount(3, {
			timeout: 10_000,
		});

		// 6件目 → maxVideos ガードで拒否、onError が発火
		await fileInput.setInputFiles(mp4Path);

		await expect(page.getByTestId("operation-error")).toBeVisible({
			timeout: 10_000,
		});
		await expect(page.getByTestId("operation-error")).toContainText("最大5件");
	});

	test("maxVideos 超過（schema）→ root-error が表示される", async ({
		page,
	}) => {
		await page.goto("/");
		page.on("dialog", (dialog) => dialog.accept());

		// 既存2件を全削除して空にする
		const deleteButtons = page.getByRole("button", { name: "動画を削除" });
		await deleteButtons.first().click();
		await deleteButtons.first().click();
		await expect(page.getByText("動画が選択されていません")).toBeVisible();

		const fileInput = page.locator("#videoUpload-videos");

		// 6件追加 → スキーマ上限 5 を超過
		for (let i = 0; i < 6; i++) {
			await fileInput.setInputFiles(mp4Path);
			await expect(page.getByText("新規", { exact: true })).toHaveCount(
				Math.min(i + 1, 5),
				{ timeout: 10_000 },
			);
		}

		// 6件目は core ガードで弾かれる → operation-error
		await expect(page.getByTestId("operation-error")).toBeVisible({
			timeout: 10_000,
		});
	});
});
