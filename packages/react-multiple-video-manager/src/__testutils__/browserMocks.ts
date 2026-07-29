import { type Mock, vi } from "vitest";

export const setupBrowserMocks = (
	urlPrefix = "fake",
): {
	createObjectURL: Mock<(obj: Blob | MediaSource) => string>;
	revokeObjectURL: Mock<(url: string) => void>;
} => {
	let counter = 0;
	const createObjectURL = vi.fn(
		() => `blob:http://localhost/${urlPrefix}-${counter++}`,
	);
	const revokeObjectURL = vi.fn();
	const OriginalURL = globalThis.URL;
	const MockURL = class extends OriginalURL {
		static override createObjectURL = createObjectURL;
		static override revokeObjectURL = revokeObjectURL;
	};
	vi.stubGlobal("URL", MockURL);
	return { createObjectURL, revokeObjectURL };
};
