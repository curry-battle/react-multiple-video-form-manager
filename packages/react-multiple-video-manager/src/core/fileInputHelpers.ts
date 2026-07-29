import type { ChangeEvent } from "react";

export function getFileFromChangeEvent(
	event: ChangeEvent<HTMLInputElement>,
): File {
	const file = event.target.files?.[0];
	if (!file) throw new Error("No file selected");
	return file;
}

export function getFilesFromChangeEvent(
	event: ChangeEvent<HTMLInputElement>,
): File[] {
	const fileList = event.target.files;
	if (!fileList || fileList.length === 0) throw new Error("No files selected");
	return Array.from(fileList);
}

if (import.meta.vitest) {
	const { describe, it, expect } = import.meta.vitest;

	const makeEvent = (files: File[] | null) =>
		({
			target: {
				files: files
					? Object.assign(files, { item: (i: number) => files[i] ?? null })
					: null,
			},
		}) as unknown as ChangeEvent<HTMLInputElement>;

	describe("getFileFromChangeEvent", () => {
		it("returns the first file", () => {
			const file = new File(["data"], "video.mp4", { type: "video/mp4" });
			expect(getFileFromChangeEvent(makeEvent([file]))).toBe(file);
		});

		it("throws when no files", () => {
			expect(() => getFileFromChangeEvent(makeEvent(null))).toThrow(
				"No file selected",
			);
		});

		it("throws when empty FileList", () => {
			expect(() => getFileFromChangeEvent(makeEvent([]))).toThrow(
				"No file selected",
			);
		});
	});

	describe("getFilesFromChangeEvent", () => {
		it("returns all files as array", () => {
			const f1 = new File(["a"], "a.mp4", { type: "video/mp4" });
			const f2 = new File(["b"], "b.mp4", { type: "video/mp4" });
			expect(getFilesFromChangeEvent(makeEvent([f1, f2]))).toEqual([f1, f2]);
		});

		it("throws when no files", () => {
			expect(() => getFilesFromChangeEvent(makeEvent(null))).toThrow(
				"No files selected",
			);
		});

		it("throws when empty FileList", () => {
			expect(() => getFilesFromChangeEvent(makeEvent([]))).toThrow(
				"No files selected",
			);
		});
	});
}
