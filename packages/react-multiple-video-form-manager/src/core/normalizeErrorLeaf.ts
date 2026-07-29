import type { VideoFieldError } from "./types/VideoSchemaTypes";

// Date/File 等のクラスインスタンスにも true を返すが、入力がフォームライブラリの
// エラーオブジェクトに限定されるため prototype チェックは省略している。
export const isPlainObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * フォームライブラリ非依存の葉エラー正規化。
 * RHF / TanStack 双方のアダプタが同一仕様で生値を中立 `VideoFieldError` に変換するため、
 * core に一本化して仕様ズレ・重複実装を防ぐ。
 *
 * - 文字列: 空文字は message を省略し source のみ残す（"エラーはあるがメッセージ未指定" を識別可能に）。
 * - オブジェクト: `message`（非空文字）/ `type`（文字列）を拾い、生値を source に保持する。
 *   トップに `message` が無い入れ子 shape（例: `{ file: { message } }`）は一段だけ子を探索し昇格する。
 * - null / undefined: source に生値のみ。
 * - その他のプリミティブ: `String(value)` を message に、生値を source に。
 */
export const normalizeErrorLeaf = (raw: unknown): VideoFieldError => {
	if (typeof raw === "string") {
		return raw.length > 0 ? { message: raw, source: raw } : { source: raw };
	}
	if (isPlainObject(raw)) {
		let message =
			typeof raw.message === "string" && raw.message.length > 0
				? raw.message
				: undefined;
		let type = typeof raw.type === "string" ? raw.type : undefined;
		// message がトップに無い入れ子 shape（例: { file: { message: "..." } }）から
		// 一段だけ子を探索して message / type を昇格する。
		if (message === undefined) {
			for (const val of Object.values(raw)) {
				if (isPlainObject(val)) {
					if (typeof val.message === "string" && val.message.length > 0) {
						message = val.message;
						if (type === undefined && typeof val.type === "string") {
							type = val.type;
						}
						break;
					}
				}
			}
		}
		const out: VideoFieldError = { source: raw };
		if (message !== undefined) out.message = message;
		if (type !== undefined) out.type = type;
		return out;
	}
	if (raw === undefined || raw === null) return { source: raw };
	return { message: String(raw), source: raw };
};
