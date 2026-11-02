import { z } from "zod";

export const ERROR_KEY = "errors:log";
export const ERROR_LIMIT = 50;
export const errorLogSchema = z.array(
  z.object({ code: z.string(), time: z.string(), view: z.string() }),
);
export type ErrorEntry = z.infer<typeof errorLogSchema>[number];
/** An error code is one word of letters; anything else may be a message with personal text (B6.9). */
export const isErrorCode = (value: string) => /^[a-zA-Z]{1,64}$/.test(value);
