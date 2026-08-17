import type { ReactNode } from "react";
import type { FormWithVideoField } from "../core/types/VideoSchemaTypes";
import type {
	MultiVideoCoreOptions,
	MultiVideoRenderProps,
} from "../core/useMultiVideoCore";
import { useMultiVideoController } from "./useMultiVideoController";
import type { AnyTanstackFormApi, ValidateCause } from "./useVideoFieldAdapter";

export type MultiVideoControllerProps<
	TFieldName extends string,
	TDeletedFieldName extends string,
	TFormData extends FormWithVideoField<TFieldName, TDeletedFieldName>,
> = {
	form: AnyTanstackFormApi<TFormData>;
	name: TFieldName;
	deletedName?: TDeletedFieldName;
	validateCause?: ValidateCause;
	render: (props: MultiVideoRenderProps) => ReactNode;
} & MultiVideoCoreOptions;

/**
 * `useMultiVideoController` の糖衣。
 *
 * submit ハンドラから `prepareForSubmit` を使う場合はフックを直接呼ぶこと。
 * このコンポーネントは render の内側にしか渡さないので ref での橋渡しが要る。
 */
export function MultiVideoController<
	TFieldName extends string,
	TDeletedFieldName extends string = `${TFieldName}DeletedIds`,
	TFormData extends FormWithVideoField<
		TFieldName,
		TDeletedFieldName
	> = FormWithVideoField<TFieldName, TDeletedFieldName>,
>({
	form,
	name,
	deletedName,
	validateCause,
	render,
	...coreOptions
}: MultiVideoControllerProps<
	TFieldName,
	TDeletedFieldName,
	TFormData
>): ReactNode {
	const result = useMultiVideoController<
		TFieldName,
		TDeletedFieldName,
		TFormData
	>({
		form,
		name,
		deletedName,
		validateCause,
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
		prepareForSubmit: result.prepareForSubmit,
	});
}
