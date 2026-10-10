import { z } from "zod";
import type { BasketLine, Product } from "../domain/model";
import { relevant } from "../domain/planner";

export const METRICS_KEY = "metrics:operations";
export const METRICS_LIMIT = 100;
export const unresolvedReasonSchema = z.enum([
  "empty-search",
  "search-error",
  "normalization",
  "stock",
  "pack",
  "price",
  "unit",
  "suitability",
  "ranking",
  "missing-request",
  "invalid-output",
  "incomplete",
]);
export type UnresolvedReason = z.infer<typeof unresolvedReasonSchema>;
const count = z.number().int().min(0).max(1_000_000);
export const operationMetricSchema = z
  .object({
    kind: z.enum(["interpretation", "recipe-import", "pricing", "planning"]),
    outcome: z.enum(["success", "failed", "cancelled", "obsolete"]),
    latencyMs: z.number().int().min(0).max(600_000),
    aiCalls: count,
    repairCalls: count,
    payloadCharacters: z.number().int().min(0).max(100_000_000),
    searches: count,
    resolverCalls: count,
    unresolved: z.partialRecord(unresolvedReasonSchema, count),
  })
  .strict();
export type OperationMetric = z.infer<typeof operationMetricSchema>;
export type OperationCounters = Omit<
  OperationMetric,
  "kind" | "outcome" | "latencyMs"
>;
export function readMetrics(input: unknown): OperationMetric[] {
  if (!Array.isArray(input)) return [];
  return input.slice(-METRICS_LIMIT).flatMap((entry) => {
    const parsed = operationMetricSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}
export function unresolvedReason(
  line: BasketLine,
  products: Product[],
): UnresolvedReason {
  if (!products.length) return "empty-search";
  const available = products.filter((p) => p.available);
  if (!available.length) return "stock";
  if (available.every((p) => p.packAmount === 0)) return "pack";
  const compatible = available.filter((p) => p.unit === line.requirement.unit);
  if (!compatible.length) return "unit";
  const packed = compatible.filter((p) => p.packAmount > 0);
  if (!packed.length) return "pack";
  const priced = packed.filter((p) => p.price !== null);
  if (!priced.length) return "price";
  if (!priced.some((p) => relevant(p.name, line.requirement.name)))
    return "suitability";
  return "ranking";
}
