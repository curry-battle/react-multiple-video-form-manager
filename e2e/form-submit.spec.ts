import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, "fixtures");
const mp4Path = path.join(fixturesDir, "sample.mp4");
const mp4Path2 = path.join(fixturesDir, "sample2.mp4");
const thumbnailPath = path.join(fixturesDir, "sample-thumbnail.jpg");

test.describe("フォーム送信", () => {
	test("有効データで送信", async ({ page }) => {
		await page.goto("/");

		const submitButton = page.getByRole("button", { name: "保存" });
		await submitButton.click();

		await expect(submitButton).toContainText("保存中...");
		await expect(submitButton).toHaveText("保存", { timeout: 10_000 });
	});

	test("送信中ボタン無効化", async ({ page }) => {
		await page.goto("/");

		const submitButton = page.getByRole("button", { name: "保存" });
		await submitButton.click();

		await expect(submitButton).toBeDisabled();
		await expect(submitButton).toContainText("保存中...");

		await expect(submitButton).toBeEnabled({ timeout: 10_000 });
	});

	test("既存動画のみで送信成功", async ({ page }) => {
		await page.goto("/");

		const submitButton = page.getByRole("button", { name: "保存" });
		await submitButton.click();

		await expect(submitButton).toHaveText("保存", { timeout: 10_000 });
		await expect(submitButton).toBeEnabled();
	});

	test("新規動画追加→送信でアップロード処理", async ({ page }) => {
		await page.goto("/");

		const consoleLogs: string[] = [];
		page.on("console", (msg) => {
			if (msg.type() === "log") {
				consoleLogs.push(msg.text());
			}
		});

		const fileInput = page.locator("#videoUpload-videos");
		await fileInput.setInputFiles(mp4Path);
		await expect(page.getByText("新規", { exact: true })).toBeVisible();

		const submitButton = page.getByRole("button", { name: "保存" });
		await submitButton.click();

		await expect(submitButton).toHaveText("保存", { timeout: 15_000 });

		const hasPresignedUrlLog = consoleLogs.some((log) =>
			log.includes("Getting presigned URL"),
		);
		expect(hasPresignedUrlLog).toBe(true);
	});

	test("既存動画の既存サムネイルURLが送信データに含まれる", async ({
		page,
	}) => {
		await page.goto("/");

		const consoleLogs: string[] = [];
		page.on("console", (msg) => {
			if (msg.type() === "log") {
				consoleLogs.push(msg.text());
			}
		});

		const submitButton = page.getByRole("button", { name: "保存" });
		await submitButton.click();
		await expect(submitButton).toHaveText("保存", { timeout: 10_000 });

		const updateLog = consoleLogs.find((log) =>
			log.includes("Updating videos with data:"),
		);
		expect(updateLog).toBeDefined();

		const jsonStr = (updateLog as string).replace(
			"Updating videos with data: ",
			"",
		);
		const data = JSON.parse(jsonStr);

		// 1件目: サムネイルありの既存動画 → thumbnail.status === "unchanged"
		const firstVideo = data.videos.find(
			(v: { order: number }) => v.order === 0,
		);
		expect(firstVideo.thumbnail.status).toBe("unchanged");
		expect(firstVideo.thumbnail.uploadedUrl).toContain("https://");

		// 2件目: サムネイルなしの既存動画 → thumbnail フィールド自体なし
		const secondVideo = data.videos.find(
			(v: { order: number }) => v.order === 1,
		);
		expect(secondVideo.thumbnail).toBeUndefined();
	});
});

test.describe("統合シナリオ", () => {
	test("動画追加→並び替え→送信", async ({ page }) => {
		await page.goto("/");

		const fileInput = page.locator("#videoUpload-videos");
		await fileInput.setInputFiles(mp4Path);

		const videoItems = page.getByTestId("video-item");
		await expect(videoItems).toHaveCount(3);

		// 新規動画(3番目)を上に移動
		const thirdItem = videoItems.nth(2);
		await thirdItem.getByRole("button", { name: "上へ" }).click();

		const submitButton = page.getByRole("button", { name: "保存" });
		await submitButton.click();
		await expect(submitButton).toHaveText("保存", { timeout: 15_000 });
		await expect(submitButton).toBeEnabled();
	});

	test("既存差し替え→削除→新規追加→送信でdeletedVideoIdsが送信される", async ({
		page,
	}) => {
		await page.goto("/");
		page.on("dialog", (dialog) => dialog.accept());

		const consoleLogs: string[] = [];
		page.on("console", (msg) => {
			if (msg.type() === "log") {
				consoleLogs.push(msg.text());
			}
		});

		const videoItems = page.getByTestId("video-item");

		// 1件目の既存動画を差し替え（uploadFile が設定されているため非同期アップロードが走る）
		const firstItem = videoItems.first();
		const changeInput = firstItem.locator(
			'input[type="file"][accept="video/*"]',
		);
		await changeInput.setInputFiles(mp4Path);
		await expect(firstItem.getByText("新規", { exact: true })).toBeVisible({
			timeout: 10_000,
		});

		// 2件目の既存動画を削除
		const secondItem = videoItems.nth(1);
		await secondItem.getByRole("button", { name: "動画を削除" }).click();

		// 新規動画を追加
		const fileInput = page.locator("#videoUpload-videos");
		await fileInput.setInputFiles(mp4Path2);

		const submitButton = page.getByRole("button", { name: "保存" });
		await submitButton.click();
		await expect(submitButton).toHaveText("保存", { timeout: 15_000 });
		await expect(submitButton).toBeEnabled();

		const updateLog = consoleLogs.find((log) =>
			log.includes("Updating videos with data:"),
		);
		expect(updateLog).toBeDefined();

		const jsonStr = (updateLog as string).replace(
			"Updating videos with data: ",
			"",
		);
		const data = JSON.parse(jsonStr);

		// 差し替え(1件) + 削除(1件) = deletedVideoIds に2件
		expect(data.deletedVideoIds).toHaveLength(2);
		// videos には ToBeDeleted がなく、全て order が number
		for (const v of data.videos) {
			expect(typeof v.order).toBe("number");
		}
	});

	test("空状態から動画追加→サムネイル設定→送信", async ({ page }) => {
		await page.goto("/");

		const consoleLogs: string[] = [];
		page.on("console", (msg) => {
			if (msg.type() === "log") {
				consoleLogs.push(msg.text());
			}
		});

		// トグルOFFで空状態にする
		await page.getByText(/デフォルト動画データ/).click();
		await expect(page.getByText("動画が選択されていません")).toBeVisible();

		// 動画追加
		const fileInput = page.locator("#videoUpload-videos");
		await fileInput.setInputFiles(mp4Path);
		await expect(page.getByText("新規", { exact: true })).toBeVisible();

		// サムネイルをアップロード
		const videoItems = page.getByTestId("video-item");
		const firstItem = videoItems.first();
		const thumbnailInput = firstItem.getByTestId("upload-thumbnail-input");
		await thumbnailInput.setInputFiles(thumbnailPath);
		await expect(firstItem.getByTestId("thumbnail-preview")).toBeVisible();

		// 送信
		const submitButton = page.getByRole("button", { name: "保存" });
		await submitButton.click();
		await expect(submitButton).toHaveText("保存", { timeout: 15_000 });

		// 動画とサムネイル両方のpresigned URL取得が行われる
		const presignedUrlLogs = consoleLogs.filter((log) =>
			log.includes("Getting presigned URL"),
		);
		expect(presignedUrlLogs.length).toBeGreaterThanOrEqual(2);

		// サムネイルURLが送信データに含まれる
		const updateLog = consoleLogs.find((log) =>
			log.includes("Updating videos with data:"),
		);
		expect(updateLog).toBeDefined();
		const jsonStr = (updateLog as string).replace(
			"Updating videos with data: ",
			"",
		);
		const data = JSON.parse(jsonStr);
		const video = data.videos.find(
			(v: { status: string }) => v.status === "new",
		);
		expect(video.thumbnail.status).toBe("new");
		expect(video.thumbnail.uploadedUrl).toContain("https://s3.example.com/");
	});
});
