import z from "zod";
import { isUUID, type UUID } from "../utils/utils";

export const uuidSchema = z
	.custom<UUID>()
	.refine((val) => val === undefined || isUUID(val), {
		message: "ID must be a valid UUID",
	});
