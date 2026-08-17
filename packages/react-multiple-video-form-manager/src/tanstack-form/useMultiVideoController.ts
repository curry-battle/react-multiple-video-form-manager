import type { FormWithVideoField } from "../core/types/VideoSchemaTypes";
import type { MultiVideoCoreOptions } from "../core/useMultiVideoCore";
import { useMultiVideoCore } from "../core/useMultiVideoCore";
import type { AnyTanstackFormApi, ValidateCause } from "./useVideoFieldAdapter";
import { useVideoFieldAdapter } from "./useVideoFieldAdapter";

export type UseMultiVideoControllerParams<
	TFieldName extends string,
	TDeletedFieldName extends string = `${TFieldName}DeletedIds`,
	TFormData extends FormWithVideoField<
		TFieldName,
		TDeletedFieldName
	> = FormWithVideoField<TFieldName, TDeletedFieldName>,
> = {
	form: AnyTanstackFormApi<TFormData>;
	name: TFieldName;
	deletedName?: TDeletedFieldName;
	validateCause?: ValidateCause;
} & MultiVideoCoreOptions;

export function useMultiVideoController<
	TFieldName extends string,
	TDeletedFieldName extends string = `${TFieldName}DeletedIds`,
	TFormData extends FormWithVideoField<
		TFieldName,
		TDeletedFieldName
	> = FormWithVideoField<TFieldName, TDeletedFieldName>,
>(
	params: UseMultiVideoControllerParams<
		TFieldName,
		TDeletedFieldName,
		TFormData
	>,
) {
	const { form, name, deletedName, validateCause, ...coreOptions } = params;
	const resolvedDeletedName = (deletedName ??
		`${name}DeletedIds`) as TDeletedFieldName;

	const adapter = useVideoFieldAdapter<
		TFieldName,
		TDeletedFieldName,
		TFormData
	>({
		form,
		name,
		deletedName: resolvedDeletedName,
		validateCause,
	});

	return useMultiVideoCore({ adapter, ...coreOptions });
}
