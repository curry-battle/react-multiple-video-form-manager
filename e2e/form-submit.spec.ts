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

		// 表示順は配列の順序が表す
		const [firstVideo, secondVideo] = data.videos;

		// 1件目: サムネイルありの既存動画 → thumbnail.status === "unchanged"
		expect(firstVideo.thumbnail.status).toBe("unchanged");
		expect(firstVideo.thumbnail.uploadedUrl).toContain("https://");

		// 2件目: サムネイルなしの既存動画 → thumbnail は null
		expect(secondVideo.thumbnail).toBeNull();
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
		for (const v of data.videos) {
			// 表示順は配列の順序が表すので order は持たない
			expect(v).not.toHaveProperty("order");
			// 選択時アップロードが済んでいるので新規項目は転送参照を持つ
			if (v.status === "new") expect(typeof v.uploadRef).toBe("string");
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
		expect(video.thumbnail.uploadRef).toContain("https://s3.example.com/");
	});

	test("フレームキャプチャ中に保存してもサムネイルが送信素材に入る", async ({
		page,
	}) => {
		// setThumbnailFromFrame は captureFrame を必ず await するので、オプションの
		// ハンドラを 1 つも設定していない消費側でも「選んだのに送信素材へ入らない」窓を踏む
		await page.goto("/");

		const consoleLogs: string[] = [];
		page.on("console", (msg) => {
			if (msg.type() === "log") {
				consoleLogs.push(msg.text());
			}
		});

		const fileInput = page.locator("#videoUpload-videos");
		await fileInput.setInputFiles(mp4Path);

		const addedItem = page.getByTestId("video-item").nth(2);
		// 本体の転送を先に終わらせる。走行中だと保存が本体の完了を待ち、その間に
		// サムネイルの転送が台帳へ載ってしまうため、選択を待つかどうかを観測できない。
		//
		// visible を先に挟むのは、この表示が転送中しか要素を出さないため。
		// toBeHidden は要素が存在しないときも成功するので、いきなり待つと
		// 「まだ始まっていない」を「終わった」と読み違える
		const videoStatus = addedItem.getByTestId("upload-status-video");
		await expect(videoStatus).toBeVisible();
		await expect(videoStatus).toBeHidden({ timeout: 15_000 });

		await addedItem.getByRole("button", { name: "動画を再生" }).click();
		await expect(page.getByTestId("capture-thumbnail-btn")).toBeVisible();

		// キャプチャボタンの可視化だけでは足りない。モーダルの `src` は effect で
		// オブジェクト URL を作るので、ボタンが出た時点では空のことがある。その状態で
		// captureFrame を呼ぶと videoWidth 0 のまま何も返らず、サムネイルが素材に
		// 入らないまま保存が成功してしまう。
		//
		// videoWidth も見るのは、`src` が空のままでも readyState が紛らわしい値を
		// 返す経路を排除するため。モーダルの video だけが controls を持つ
		await page.waitForFunction(() => {
			const video = document.querySelector("video[controls]");
			return (
				video instanceof HTMLVideoElement &&
				video.readyState >= 2 &&
				video.videoWidth > 0
			);
		});

		// キャプチャと保存を同じタスクで押す。captureFrame の解決は canvas.toBlob の
		// コールバック（マクロタスク）なので、保存側のバリデーション（マイクロタスク）は
		// 必ずその前に走り終え、uploads.wait はキャプチャが走行中の状態で始まる。
		// Playwright のクリックを 2 回に分けると、その間の待ち時間で
		// キャプチャが終わってしまい、待ち合わせの有無を観測できない
		await page.evaluate(() => {
			const capture = document.querySelector(
				'[data-testid="capture-thumbnail-btn"]',
			);
			const submit = document.querySelector('button[type="submit"]');
			if (
				!(capture instanceof HTMLElement) ||
				!(submit instanceof HTMLElement)
			) {
				throw new Error("capture / submit button not found");
			}
			capture.click();
			submit.click();
		});

		// 「保存」は初期状態と同じ文言なので、開始を先に観測しないと押す前の状態で
		// 通過し、まだ出ていない update log を読みにいく
		const submitButton = page.getByRole("button", { name: "保存" });
		await expect(submitButton).toContainText("保存中...");
		await expect(submitButton).toHaveText("保存", { timeout: 15_000 });

		const updateLog = consoleLogs.find((log) =>
			log.includes("Updating videos with data:"),
		);
		expect(updateLog).toBeDefined();

		const jsonStr = (updateLog as string).replace(
			"Updating videos with data: ",
			"",
		);
		const data = JSON.parse(jsonStr);
		const added = data.videos.find(
			(v: { status: string }) => v.status === "new",
		);

		// 保存自体はサムネイルが落ちても成功するので、素材の中身まで見る
		expect(added.thumbnail).not.toBeNull();
		expect(added.thumbnail.status).toBe("new");
		expect(typeof added.thumbnail.uploadRef).toBe("string");
	});
});
