import { defineConfig } from "tsdown";

export default defineConfig({
	entry: {
		index: "src/index.ts",
		"react-hook-form/index": "src/react-hook-form/index.ts",
		"tanstack-form/index": "src/tanstack-form/index.ts",
		"schemas/zod": "src/schemas/zod.ts",
		"schemas/valibot": "src/schemas/valibot.ts",
	},
	format: ["esm", "cjs"],
	target: "es2023",
	dts: true,
	splitting: true,
	sourcemap: true,
	clean: true,
	deps: {
		neverBundle: [
			"react",
			"react-hook-form",
			"@tanstack/react-form",
			"zod",
			"valibot",
		],
	},
	define: {
		"import.meta.vitest": "undefined",
	},
});
