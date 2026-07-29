import type { FieldApi, ReactFormExtendedApi } from "@tanstack/react-form";
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

export type AnyTanstackFieldApi<TFormData, TName extends string> = FieldApi<
	TFormData,
	TName,
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
	field: AnyTanstackFieldApi<TFormData, TFieldName>;
	name: TFieldName;
	deletedName: TDeletedFieldName;
	validateCause?: ValidateCause;
};

const EMPTY_VIDEOS: readonly Video[] = Object.freeze([]);
const EMPTY_DELETED_IDS: readonly string[] = Object.freeze([]);
const EMPTY_META_ERRORS: readonly unknown[] = Object.freeze([]);

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
	const { form, field, name, deletedName, validateCause = "change" } = params;

	if (deletedName.includes(".")) {
		throw new Error(
			`deletedName must be a top-level key (got "${deletedName}"). Nested paths are not supported.`,
		);
	}

	const anyField = field as any;
	const anyForm = form as any;

	const videos = useStore(
		anyField.store,
		(s: { value?: Video[] }) =>
			(s.value as Video[] | undefined) ?? (EMPTY_VIDEOS as Video[]),
	);

	const deletedVideoIds = useStore(
		anyForm.store,
		(s: { values?: Record<string, unknown> }) =>
			((s.values as Record<string, unknown> | undefined)?.[deletedName] as
				| string[]
				| undefined) ?? (EMPTY_DELETED_IDS as string[]),
	);

	const metaErrors = useStore(
		anyField.store,
		(s: { meta?: { errors?: unknown[] } }) =>
			s.meta?.errors ?? (EMPTY_META_ERRORS as unknown[]),
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
