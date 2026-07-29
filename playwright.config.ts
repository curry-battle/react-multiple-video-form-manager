import { defineConfig, devices } from "@playwright/test";

// react-hook-form 例(5174) と TanStack Form 例(5175) は機能・UI が同一の双子。
// 同じ e2e spec を 2 プロジェクトで両アプリに対して実行し、パリティを検証する。
export default defineConfig({
	testDir: "./e2e",
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: process.env.CI ? [["github"], ["html"]] : "html",
	use: {
		trace: "on-first-retry",
		screenshot: "only-on-failure",
	},
	projects: [
		{
			name: "rhf",
			use: {
				...devices["Desktop Chrome"],
				baseURL: "http://localhost:5174",
			},
		},
		{
			name: "tanstack",
			use: {
				...devices["Desktop Chrome"],
				baseURL: "http://localhost:5175",
			},
		},
	],
	webServer: [
		{
			command: "pnpm run dev:example:rhf",
			url: "http://localhost:5174",
			reuseExistingServer: !process.env.CI,
			timeout: 30_000,
		},
		{
			command: "pnpm run dev:example:tanstack",
			url: "http://localhost:5175",
			reuseExistingServer: !process.env.CI,
			timeout: 30_000,
		},
	],
});
