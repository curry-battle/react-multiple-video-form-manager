import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, "fixtures");
const mp4Path = path.join(fixturesDir, "sample.mp4");
const thumbnailPath = path.join(fixturesDir, "sample-thumbnail.jpg");

test.describe("選択時アップロードの進行表示", () => {
	test("項目は転送の完了を待たずに出て、進捗が表示される", async ({ page }) => {
		await page.goto("/");

		const videoItems = page.getByTestId("video-item");
		await expect(videoItems).toHaveCount(2);

		const fileInput = page.locator("#videoUpload-videos");
		await fileInput.setInputFiles(mp4Path);

		// 転送が終わる前に項目が並ぶ
		await expect(videoItems).toHaveCount(3);
		const addedItem = videoItems.nth(2);
		const videoStatus = addedItem.getByTestId("upload-status-video");
		await expect(videoStatus).toBeVisible();
		await expect(videoStatus).toContainText("動画をアップロード中");

		// onProgress の報告がパーセントで出る
		await expect(videoStatus).toContainText("%");

		// 完了すると報告することが無くなるので消える
		await expect(videoStatus).toBeHidden({ timeout: 15_000 });
	});

	test("サムネイルの転送は本体とは別に表示される", async ({ page }) => {
		await page.goto("/");

		const fileInput = page.locator("#videoUpload-videos");
		await fileInput.setInputFiles(mp4Path);

		const addedItem = page.getByTestId("video-item").nth(2);
		// 本体の転送が終わるのを待ってからサムネイルを設定する
		await expect(addedItem.getByTestId("upload-status-video")).toBeHidden({
			timeout: 15_000,
		});

		await addedItem
			.getByTestId("upload-thumbnail-input")
			.setInputFiles(thumbnailPath);

		const thumbnailStatus = addedItem.getByTestId("upload-status-thumbnail");
		await expect(thumbnailStatus).toBeVisible();
		await expect(thumbnailStatus).toContainText("サムネイルをアップロード中");
		// 本体のスロットは巻き込まれない
		await expect(addedItem.getByTestId("upload-status-video")).toBeHidden();

		await expect(thumbnailStatus).toBeHidden({ timeout: 15_000 });
	});

	test("本体の転送中にサムネイルを設定しても本体の転送が破棄されない", async ({
		page,
	}) => {
		await page.goto("/");

		const consoleLogs: string[] = [];
		page.on("console", (msg) => {
			if (msg.type() === "log") consoleLogs.push(msg.text());
		});

		const fileInput = page.locator("#videoUpload-videos");
		await fileInput.setInputFiles(mp4Path);

		const addedItem = page.getByTestId("video-item").nth(2);
		await expect(addedItem.getByTestId("upload-status-video")).toBeVisible();

		// 本体の転送中にサムネイルを設定する
		await addedItem
			.getByTestId("upload-thumbnail-input")
			.setInputFiles(thumbnailPath);

		await expect(addedItem.getByTestId("upload-status-video")).toBeHidden({
			timeout: 15_000,
		});
		await expect(addedItem.getByTestId("upload-status-thumbnail")).toBeHidden({
			timeout: 15_000,
		});

		// 両方の転送が完了しているので、保存には本体とサムネイルの参照が載る
		const submitButton = page.getByRole("button", { name: "保存" });
		await submitButton.click();
		await expect(submitButton).toHaveText("保存", { timeout: 15_000 });

		const updateLog = consoleLogs.find((log) =>
			log.includes("Updating videos with data:"),
		);
		expect(updateLog).toBeDefined();
		const data = JSON.parse(
			(updateLog as string).replace("Updating videos with data: ", ""),
		);
		const added = data.videos.find(
			(v: { status: string }) => v.status === "new",
		);
		expect(typeof added.uploadRef).toBe("string");
		expect(added.thumbnail.status).toBe("new");
		expect(typeof added.thumbnail.uploadRef).toBe("string");
	});

	test("転送中に保存を押しても待ち合わせてから送信される", async ({ page }) => {
		await page.goto("/");

		const consoleLogs: string[] = [];
		page.on("console", (msg) => {
			if (msg.type() === "log") consoleLogs.push(msg.text());
		});

		const fileInput = page.locator("#videoUpload-videos");
		await fileInput.setInputFiles(mp4Path);

		const addedItem = page.getByTestId("video-item").nth(2);
		await expect(addedItem.getByTestId("upload-status-video")).toBeVisible();

		// 転送中のまま保存する
		const submitButton = page.getByRole("button", { name: "保存" });
		await submitButton.click();
		await expect(submitButton).toHaveText("保存", { timeout: 15_000 });

		const updateLog = consoleLogs.find((log) =>
			log.includes("Updating videos with data:"),
		);
		expect(updateLog).toBeDefined();
		const data = JSON.parse(
			(updateLog as string).replace("Updating videos with data: ", ""),
		);
		const added = data.videos.find(
			(v: { status: string }) => v.status === "new",
		);
		// 待ち合わせているので転送参照が載っている
		expect(typeof added.uploadRef).toBe("string");
	});
});
