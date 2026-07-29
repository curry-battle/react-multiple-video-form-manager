import type { UseFormReturn } from "react-hook-form";
import type { FormWithVideoField } from "../core/types/VideoSchemaTypes";
import type { MultiVideoCoreOptions } from "../core/useMultiVideoCore";
import { useMultiVideoCore } from "../core/useMultiVideoCore";
import { useVideoFieldAdapter } from "./useVideoFieldAdapter";

export function useMultiVideoController<
	TFieldName extends string,
	TDeletedFieldName extends string = `${TFieldName}DeletedIds`,
	TForm extends FormWithVideoField<
		TFieldName,
		TDeletedFieldName
	> = FormWithVideoField<TFieldName, TDeletedFieldName>,
>(
	params: {
		form: UseFormReturn<TForm>;
		name: TFieldName;
		deletedName?: TDeletedFieldName;
	} & MultiVideoCoreOptions,
) {
	const { form, name, deletedName, ...coreOptions } = params;
	const resolvedDeletedName = (deletedName ??
		`${name}DeletedIds`) as TDeletedFieldName;

	const adapter = useVideoFieldAdapter<TFieldName, TDeletedFieldName, TForm>({
		form,
		name,
		deletedName: resolvedDeletedName,
	});

	return useMultiVideoCore({ adapter, ...coreOptions });
}
