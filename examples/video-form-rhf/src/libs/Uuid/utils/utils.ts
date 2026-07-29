import { v7 as uuidv7, validate, version } from "uuid";

export type UUID = `${string}-${string}-${string}-${string}-${string}`;

export const isUUID = (value: unknown): value is UUID => {
	if (typeof value !== "string") {
		return false;
	}

	return validate(value) && version(value) === 7;
};

export const generateUUIDv7 = (): UUID => uuidv7() as UUID;
