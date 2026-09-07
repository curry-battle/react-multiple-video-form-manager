import type { UseFormReturn } from "react-hook-form";
import type { UploadFileFn } from "../core/types/Upload";
import type { FormWithVideoField } from "../core/types/VideoSchemaTypes";
import type {
	MultiVideoCoreOptions,
	UseMultiVideoCoreReturn,
	UseMultiVideoCoreUploadedReturn,
} from "../core/useMultiVideoCore";
import { useMultiVideoCore } from "../core/useMultiVideoCore";
import { useVideoFieldAdapter } from "./useVideoFieldAdapter";

export type UseMultiVideoControllerParams<
	TFieldName extends string,
	TDeletedFieldName extends string = `${TFieldName}DeletedIds`,
	TForm extends FormWithVideoField<
		TFieldName,
		TDeletedFieldName
	> = FormWithVideoField<TFieldName, TDeletedFieldName>,
> = {
	form: UseFormReturn<TForm>;
	name: TFieldName;
	deletedName?: TDeletedFieldName;
} & MultiVideoCoreOptions;

export function useMultiVideoController<
	TFieldName extends string,
	TDeletedFieldName extends string = `${TFieldName}DeletedIds`,
	TForm extends FormWithVideoField<
		TFieldName,
		TDeletedFieldName
	> = FormWithVideoField<TFieldName, TDeletedFieldName>,
>(
	params: UseMultiVideoControllerParams<
		TFieldName,
		TDeletedFieldName,
		TForm
	> & { uploadFile: UploadFileFn },
): UseMultiVideoCoreUploadedReturn;
export function useMultiVideoController<
	TFieldName extends string,
	TDeletedFieldName extends string = `${TFieldName}DeletedIds`,
	TForm extends FormWithVideoField<
		TFieldName,
		TDeletedFieldName
	> = FormWithVideoField<TFieldName, TDeletedFieldName>,
>(
	params: UseMultiVideoControllerParams<TFieldName, TDeletedFieldName, TForm>,
): UseMultiVideoCoreReturn;
export function useMultiVideoController<
	TFieldName extends string,
	TDeletedFieldName extends string = `${TFieldName}DeletedIds`,
	TForm extends FormWithVideoField<
		TFieldName,
		TDeletedFieldName
	> = FormWithVideoField<TFieldName, TDeletedFieldName>,
>(
	params: UseMultiVideoControllerParams<TFieldName, TDeletedFieldName, TForm>,
): UseMultiVideoCoreUploadedReturn {
	const { form, name, deletedName, ...coreOptions } = params;
	const resolvedDeletedName = (deletedName ??
		`${name}DeletedIds`) as TDeletedFieldName;

	const adapter = useVideoFieldAdapter<TFieldName, TDeletedFieldName, TForm>({
		form,
		name,
		deletedName: resolvedDeletedName,
	});

	const core = useMultiVideoCore({ adapter, ...coreOptions });

	// uploadFile の有無は呼び出し側のオーバーロードで解決済み。実体は同じなので
	// 参照ごと通す。uploads のメンバだけ差し替えると uploads を組み直すことになり、
	// core が memo 化した参照が毎レンダー変わる
	return core as UseMultiVideoCoreUploadedReturn;
}
