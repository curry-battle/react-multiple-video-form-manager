import type { ReactFormExtendedApi } from "@tanstack/react-form";
import { useStore } from "@tanstack/react-form";
import { useCallback, useMemo } from "react";
import type { Video } from "../core/types/Video";
import type { FormWithVideoField } from "../core/types/VideoSchemaTypes";
import type { VideoFieldAdapter } from "../core/VideoFieldAdapter";
import { normalizeTanstackErrors } from "./normalizeTanstackErrors";

export type AnyTanstackFormApi<TFormData> = ReactFormExtendedApi<
	TFormData,
	any,
	any,
	any,
	any,
	any,
	any,
	any,
	any,
	any,
	any,
	any
>;

export type ValidateCause = "change" | "blur" | "submit" | "server";

export type UseTanstackVideoFieldAdapterParams<
	TFieldName extends string,
	TDeletedFieldName extends string,
	TFormData extends FormWithVideoField<TFieldName, TDeletedFieldName>,
> = {
	form: AnyTanstackFormApi<TFormData>;
	name: TFieldName;
	deletedName: TDeletedFieldName;
	validateCause?: ValidateCause;
};

const EMPTY_VIDEOS: readonly Video[] = Object.freeze([]);
const EMPTY_DELETED_IDS: readonly string[] = Object.freeze([]);
const EMPTY_META_ERRORS: readonly unknown[] = Object.freeze([]);

/**
 * ストアを素のキーアクセスで読む一方 `setFieldValue` / `validateField` は
 * TanStack のパス解決に載るため、ネストパスを渡すと read と write が別の場所を指す。
 * TanStack のパス構文はドットと角括弧の 2 種類なので両方を弾く。
 */
function assertTopLevelKey(label: string, key: string): void {
	if (key.includes(".") || key.includes("[")) {
		throw new Error(
			`${label} must be a top-level key (got "${key}"). Nested paths are not supported.`,
		);
	}
}

/**
 * TanStack Form を VideoFieldAdapter ポートに適合させる。
 *
 * read / write はすべてフォームストア経由なので、このフックはフォームレベルで
 * 呼べる。`<form.Field mode="array">` の内側である必要はない
 * — `FormApi.validateField` は field インスタンスが未登録ならフォームレベルの
 * 検証へフォールバックし、`FormApi.setFieldValue` が `fieldMeta[name]` を
 * 自前で生成するので、touched / dirty / フィールド単位のエラーは field 無しでも追える。
 *
 * `name` / `deletedName` はフォームデータのトップレベルキーであること。
 * ストアはネストパス解決ではなく素のキーアクセスで読む。
 */
export function useVideoFieldAdapter<
	TFieldName extends string,
	TDeletedFieldName extends string,
	TFormData extends FormWithVideoField<TFieldName, TDeletedFieldName>,
>(
	params: UseTanstackVideoFieldAdapterParams<
		TFieldName,
		TDeletedFieldName,
		TFormData
	>,
): VideoFieldAdapter {
	const { form, name, deletedName, validateCause = "change" } = params;

	assertTopLevelKey("name", name);
	assertTopLevelKey("deletedName", deletedName);

	const anyForm = form as any;

	const videos = useStore(
		anyForm.store,
		(s: { values?: Record<string, unknown> }) =>
			(s.values?.[name] as Video[] | undefined) ?? (EMPTY_VIDEOS as Video[]),
	);

	const deletedVideoIds = useStore(
		anyForm.store,
		(s: { values?: Record<string, unknown> }) =>
			((s.values as Record<string, unknown> | undefined)?.[deletedName] as
				| string[]
				| undefined) ?? (EMPTY_DELETED_IDS as string[]),
	);

	const metaErrors = useStore(
		anyForm.store,
		(s: { fieldMeta?: Record<string, { errors?: unknown[] } | undefined> }) =>
			s.fieldMeta?.[name]?.errors ?? (EMPTY_META_ERRORS as unknown[]),
	);
	const errorMap = useStore(
		anyForm.store,
		(s: { errorMap?: unknown }) => s.errorMap,
	);

	const errors = useMemo(
		() =>
			normalizeTanstackErrors({
				errorMap,
				metaErrors,
				fieldName: name,
				videos,
			}),
		[errorMap, metaErrors, name, videos],
	);

	const setDeletedVideoIds = useCallback(
		(next: string[]) => {
			anyForm.setFieldValue(deletedName, next);
		},
		[anyForm, deletedName],
	);

	return {
		videos,
		setVideos: (next) => {
			anyForm.setFieldValue(name, next);
		},
		getVideos: () =>
			(anyForm.store.state.values?.[name] as Video[] | undefined) ?? [],
		deletedVideoIds,
		setDeletedVideoIds,
		getDeletedVideoIds: () =>
			(anyForm.store.state.values?.[deletedName] as string[] | undefined) ?? [],
		validate: async () => {
			await anyForm.validateField(name, validateCause);
		},
		errors,
	};
}
