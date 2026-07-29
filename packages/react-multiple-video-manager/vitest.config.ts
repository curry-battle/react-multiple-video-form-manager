import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [react()],
	test: {
		includeSource: ["src/**/*.{js,ts,tsx}"],
		browser: {
			enabled: true,
			provider: playwright(),
			instances: [{ browser: "chromium" }],
		},
		coverage: {
			provider: "v8",
			include: [
				"src/core/**",
				"src/react-hook-form/**",
				"src/tanstack-form/**",
				"src/schemas/**",
			],
			exclude: [
				"src/**/__tests__/**",
				"src/**/__testutils__/**",
				"src/**/__testdata__/**",
			],
		},
	},
});
