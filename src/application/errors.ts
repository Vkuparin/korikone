import { z } from "zod";

export const ERROR_KEY = "errors:log";
export const ERROR_LIMIT = 50;
export const errorLogSchema = z.array(
  z.object({ code: z.string(), time: z.string(), view: z.string() }),
);
export type ErrorEntry = z.infer<typeof errorLogSchema>[number];
