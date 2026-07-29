import { describe, expect, it } from "vitest";
import { isPlainObject, normalizeErrorLeaf } from "../normalizeErrorLeaf";

describe("isPlainObject", () => {
	it("plain object → true", () => {
		expect(isPlainObject({})).toBe(true);
		expect(isPlainObject({ a: 1 })).toBe(true);
	});

	it("array → false", () => {
		expect(isPlainObject([])).toBe(false);
	});

	it("null → false", () => {
		expect(isPlainObject(null)).toBe(false);
	});

	it("primitive → false", () => {
		expect(isPlainObject("str")).toBe(false);
		expect(isPlainObject(42)).toBe(false);
		expect(isPlainObject(true)).toBe(false);
		expect(isPlainObject(undefined)).toBe(false);
	});
});

describe("normalizeErrorLeaf", () => {
	describe("string input", () => {
		it("non-empty string → message + source", () => {
			expect(normalizeErrorLeaf("required")).toEqual({
				message: "required",
				source: "required",
			});
		});

		it("empty string → source only (no message)", () => {
			expect(normalizeErrorLeaf("")).toEqual({ source: "" });
		});
	});

	describe("object input", () => {
		it("object with message and type", () => {
			const raw = { message: "too long", type: "maxLength" };
			expect(normalizeErrorLeaf(raw)).toEqual({
				message: "too long",
				type: "maxLength",
				source: raw,
			});
		});

		it("object with message only", () => {
			const raw = { message: "error" };
			expect(normalizeErrorLeaf(raw)).toEqual({
				message: "error",
				source: raw,
			});
		});

		it("object with type only", () => {
			const raw = { type: "custom" };
			expect(normalizeErrorLeaf(raw)).toEqual({
				type: "custom",
				source: raw,
			});
		});

		it("object with empty message → no message field", () => {
			const raw = { message: "", type: "required" };
			expect(normalizeErrorLeaf(raw)).toEqual({
				type: "required",
				source: raw,
			});
		});

		it("object with non-string message → no message field", () => {
			const raw = { message: 123, type: "custom" };
			expect(normalizeErrorLeaf(raw)).toEqual({
				type: "custom",
				source: raw,
			});
		});

		it("object with non-string type → no type field", () => {
			const raw = { message: "err", type: 42 };
			expect(normalizeErrorLeaf(raw)).toEqual({
				message: "err",
				source: raw,
			});
		});

		it("empty object → source only", () => {
			const raw = {};
			expect(normalizeErrorLeaf(raw)).toEqual({ source: raw });
		});

		it("nested shape without top-level message → promotes child message", () => {
			const raw = { file: { message: "bad file", type: "custom" } };
			const result = normalizeErrorLeaf(raw);
			expect(result.message).toBe("bad file");
			expect(result.type).toBe("custom");
			expect(result.source).toBe(raw);
		});

		it("nested shape with top-level message → uses top-level (no promotion)", () => {
			const raw = {
				message: "top",
				file: { message: "child" },
			};
			const result = normalizeErrorLeaf(raw);
			expect(result.message).toBe("top");
		});

		it("nested shape with multiple children → promotes first found", () => {
			const raw = {
				file: { message: "first" },
				other: { message: "second" },
			};
			const result = normalizeErrorLeaf(raw);
			expect(result.message).toBe("first");
		});

		it("object with extra properties → only message/type/source extracted", () => {
			const raw = { message: "fail", type: "validation", extra: true };
			const result = normalizeErrorLeaf(raw);
			expect(result.message).toBe("fail");
			expect(result.type).toBe("validation");
			expect(result.source).toBe(raw);
			expect(Object.keys(result)).toEqual(
				expect.arrayContaining(["source", "message", "type"]),
			);
		});
	});

	describe("null/undefined input", () => {
		it("null → source: null", () => {
			expect(normalizeErrorLeaf(null)).toEqual({ source: null });
		});

		it("undefined → source: undefined", () => {
			expect(normalizeErrorLeaf(undefined)).toEqual({ source: undefined });
		});
	});

	describe("other primitives", () => {
		it("number → String(value) as message", () => {
			expect(normalizeErrorLeaf(42)).toEqual({
				message: "42",
				source: 42,
			});
		});

		it("boolean → String(value) as message", () => {
			expect(normalizeErrorLeaf(true)).toEqual({
				message: "true",
				source: true,
			});
		});

		it("symbol → String(value) as message", () => {
			const sym = Symbol("test");
			expect(normalizeErrorLeaf(sym)).toEqual({
				message: "Symbol(test)",
				source: sym,
			});
		});
	});
});
