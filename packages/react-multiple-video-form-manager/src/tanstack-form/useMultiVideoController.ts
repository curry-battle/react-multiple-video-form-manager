import type { UploadFileFn } from "../core/types/Upload";
import type { FormWithVideoField } from "../core/types/VideoSchemaTypes";
import type {
	MultiVideoCoreOptions,
	UseMultiVideoCoreReturn,
	UseMultiVideoCoreUploadedReturn,
} from "../core/useMultiVideoCore";
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
	> & { uploadFile: UploadFileFn },
): UseMultiVideoCoreUploadedReturn;
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
): UseMultiVideoCoreReturn;
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
): UseMultiVideoCoreUploadedReturn {
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

	const core = useMultiVideoCore({ adapter, ...coreOptions });

	// uploadFile の有無は呼び出し側のオーバーロードで解決済み。実体は同じなので
	// 参照ごと通す。uploads のメンバだけ差し替えると uploads を組み直すことになり、
	// core が memo 化した参照が毎レンダー変わる
	return core as UseMultiVideoCoreUploadedReturn;
}
