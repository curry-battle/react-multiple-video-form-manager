import type { UseFormReturn } from "react-hook-form";
import type { FormWithVideoField } from "../core/types/VideoSchemaTypes";
import type {
	MultiVideoCoreOptions,
	MultiVideoRenderProps,
} from "../core/useMultiVideoCore";
import { useMultiVideoController } from "./useMultiVideoController";

export type MultiVideoControllerProps<
	TFieldName extends string,
	TDeletedFieldName extends string,
	TForm extends FormWithVideoField<TFieldName, TDeletedFieldName>,
> = {
	form: UseFormReturn<TForm>;
	name: TFieldName;
	deletedName?: TDeletedFieldName;
	render: (props: MultiVideoRenderProps) => React.ReactNode;
} & MultiVideoCoreOptions;

export function MultiVideoController<
	TFieldName extends string,
	TDeletedFieldName extends string = `${TFieldName}DeletedIds`,
	TForm extends FormWithVideoField<
		TFieldName,
		TDeletedFieldName
	> = FormWithVideoField<TFieldName, TDeletedFieldName>,
>({
	form,
	name,
	deletedName,
	render,
	...coreOptions
}: MultiVideoControllerProps<TFieldName, TDeletedFieldName, TForm>) {
	const result = useMultiVideoController<TFieldName, TDeletedFieldName, TForm>({
		form,
		name,
		deletedName,
		...coreOptions,
	});

	return render({
		items: result.items,
		rootErrors: result.rootErrors,
		addVideo: result.handlers.add,
		raw: result.raw,
		pendingOperations: result.pendingOperations,
		isAdding: result.isAdding,
		isBusy: result.isBusy,
		uploads: result.uploads,
	});
}
