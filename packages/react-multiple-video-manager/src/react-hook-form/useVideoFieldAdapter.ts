import { useCallback, useMemo } from "react";
import type {
	ArrayPath,
	FieldValues,
	Path,
	PathValue,
	UseFormReturn,
} from "react-hook-form";
import { useFieldArray, useFormState, useWatch } from "react-hook-form";
import type { Video } from "../core/types/Video";
import type { FormWithVideoField } from "../core/types/VideoSchemaTypes";
import type { VideoFieldAdapter } from "../core/VideoFieldAdapter";
import { normalizeRhfErrors } from "./normalizeRhfErrors";
import type { RhfVideosError } from "./types";

function asArrayPath<TForm extends FieldValues>(
	fieldName: string,
): ArrayPath<TForm> {
	return fieldName as ArrayPath<TForm>;
}

function asPath<TForm extends FieldValues>(fieldName: string): Path<TForm> {
	return fieldName as unknown as Path<TForm>;
}

// biome-ignore lint/suspicious/noExplicitAny: react-hook-form v7.80+ exports FieldArray as a component, shadowing the internal type alias. Direct type import is no longer possible, so we cast through `any`.
function asFieldArrayItems(videos: Video[]): any[] {
	return videos;
}

function asPathValue<TForm extends FieldValues>(
	value: unknown,
): PathValue<TForm, Path<TForm>> {
	return value as unknown as PathValue<TForm, Path<TForm>>;
}

function asVideos(watched: unknown): Video[] {
	return (watched as Video[]) || [];
}

function asDeletedIds(watched: unknown): string[] {
	return (watched as string[]) || [];
}

export type UseVideoFieldAdapterParams<
	TFieldName extends string,
	TDeletedFieldName extends string,
	TForm extends FormWithVideoField<TFieldName, TDeletedFieldName>,
> = {
	form: UseFormReturn<TForm>;
	name: TFieldName;
	deletedName: TDeletedFieldName;
};

export function useVideoFieldAdapter<
	TFieldName extends string,
	TDeletedFieldName extends string,
	TForm extends FormWithVideoField<TFieldName, TDeletedFieldName>,
>(
	params: UseVideoFieldAdapterParams<TFieldName, TDeletedFieldName, TForm>,
): VideoFieldAdapter {
	const { form, name, deletedName } = params;
	const { control, trigger, setValue } = form;

	const { replace } = useFieldArray({
		control,
		name: asArrayPath<TForm>(name),
	});

	const videos = asVideos(
		useWatch({
			control,
			name: asPath<TForm>(name),
		}),
	);

	const deletedVideoIds = asDeletedIds(
		useWatch({
			control,
			name: asPath<TForm>(deletedName),
		}),
	);

	const { errors: formErrors } = useFormState({
		control,
		name: asPath<TForm>(name),
	});

	const rhfErrors = (formErrors as Record<string, unknown>)[
		name
	] as RhfVideosError;

	const normalizedErrors = useMemo(
		() => normalizeRhfErrors(rhfErrors, videos),
		[rhfErrors, videos],
	);

	const setDeletedVideoIds = useCallback(
		(next: string[]) => {
			setValue(asPath<TForm>(deletedName), asPathValue<TForm>(next), {
				shouldDirty: true,
			});
		},
		[setValue, deletedName],
	);

	return {
		videos,
		setVideos: (next) => {
			replace(asFieldArrayItems(next));
		},
		getVideos: () => asVideos(form.getValues(asPath<TForm>(name))),
		deletedVideoIds,
		setDeletedVideoIds,
		getDeletedVideoIds: () =>
			asDeletedIds(form.getValues(asPath<TForm>(deletedName))),
		validate: async () => {
			await trigger(asPath<TForm>(name));
		},
		errors: normalizedErrors,
	};
}
