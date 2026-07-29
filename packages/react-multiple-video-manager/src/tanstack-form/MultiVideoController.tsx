import type { ReactNode } from "react";
import type { FormWithVideoField } from "../core/types/VideoSchemaTypes";
import type {
	MultiVideoCoreOptions,
	MultiVideoRenderProps,
} from "../core/useMultiVideoCore";
import { useMultiVideoController } from "./useMultiVideoController";
import type {
	AnyTanstackFieldApi,
	AnyTanstackFormApi,
	ValidateCause,
} from "./useVideoFieldAdapter";

type InnerProps<
	TFieldName extends string,
	TDeletedFieldName extends string,
	TFormData extends FormWithVideoField<TFieldName, TDeletedFieldName>,
> = {
	form: AnyTanstackFormApi<TFormData>;
	field: AnyTanstackFieldApi<TFormData, TFieldName>;
	name: TFieldName;
	deletedName?: TDeletedFieldName;
	validateCause?: ValidateCause;
	render: (props: MultiVideoRenderProps) => ReactNode;
} & MultiVideoCoreOptions;

function MultiVideoControllerInner<
	TFieldName extends string,
	TDeletedFieldName extends string,
	TFormData extends FormWithVideoField<TFieldName, TDeletedFieldName>,
>({
	form,
	field,
	name,
	deletedName,
	validateCause,
	render,
	...coreOptions
}: InnerProps<TFieldName, TDeletedFieldName, TFormData>): ReactNode {
	const result = useMultiVideoController<
		TFieldName,
		TDeletedFieldName,
		TFormData
	>({
		form,
		field,
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
		prepareForSubmit: result.prepareForSubmit,
	});
}

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
	// biome-ignore lint/suspicious/noExplicitAny: form.Field render children's `field` arg has long generics
	const Field = (form as any).Field;
	return (
		<Field name={name} mode="array">
			{(field: AnyTanstackFieldApi<TFormData, TFieldName>) => (
				<MultiVideoControllerInner
					form={form}
					field={field}
					name={name}
					deletedName={deletedName}
					validateCause={validateCause}
					render={render}
					{...coreOptions}
				/>
			)}
		</Field>
	);
}
