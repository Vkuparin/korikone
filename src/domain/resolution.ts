import { z } from "zod";
import {
  categorySchema,
  provenanceSchema,
  qualifierSchema,
  qualifierValues,
} from "./categories";
import { productFamilySchema } from "./product-evidence";
import {
  ingredientSchema,
  unitSchema,
  type BasketLine,
  type Product,
  type StoreContext,
} from "./model";
import {
  candidateSuitability,
  matchRequirement,
  matchingPolicy,
  matchingReasonSchema,
  purchasable,
  type MatchingOptions,
} from "./matching";

export const resolutionLimits = Object.freeze({
  rows: 12,
  candidates: 5,
  characters: 24_000,
  inputRows: 500,
});
const valueSchema = z
  .object({
    kind: qualifierSchema.shape.kind,
    value: z.string().min(1).max(40),
  })
  .strict()
  .refine((q) =>
    (qualifierValues[q.kind] as readonly string[]).includes(q.value),
  );
const sourceSchema = z.enum([...provenanceSchema.options, "legacy-name"]);
const candidateSchema = z
  .object({
    candidateId: z.string().regex(/^candidate-[0-4]$/),
    name: z.string().min(1).max(500),
    category: categorySchema,
    family: productFamilySchema.nullable(),
    qualifiers: z.array(valueSchema).max(8),
    packAmount: z.number().positive(),
    unit: unitSchema,
    packs: z.number().positive(),
    total: z.number().nonnegative(),
    reason: matchingReasonSchema,
  })
  .strict();
export const resolutionRequestSchema = z
  .object({
    version: z.literal(1),
    rows: z
      .array(
        z
          .object({
            rowId: z.string().regex(/^row-(?:[0-9]|1[01])$/),
            requirement: z
              .object({
                name: z.string().min(1).max(200),
                amount: ingredientSchema.shape.amount,
                unit: unitSchema,
                category: categorySchema,
                provenance: sourceSchema,
                qualifiers: z
                  .array(
                    valueSchema.extend({ provenance: sourceSchema }).strict(),
                  )
                  .max(8),
                required: z
                  .array(valueSchema.extend({ source: sourceSchema }).strict())
                  .max(8),
                preferred: z.array(valueSchema).max(8),
              })
              .strict(),
            candidates: z
              .array(candidateSchema)
              .min(2)
              .max(resolutionLimits.candidates),
          })
          .strict(),
      )
      .min(1)
      .max(resolutionLimits.rows),
  })
  .strict()
  .refine(
    (request) =>
      new Set(request.rows.map((row) => row.rowId)).size ===
        request.rows.length &&
      request.rows.every(
        (row) =>
          new Set(row.candidates.map((candidate) => candidate.candidateId))
            .size === row.candidates.length,
      ),
  )
  .refine(
    (request) => JSON.stringify(request).length <= resolutionLimits.characters,
  );
export type ResolutionRequest = z.infer<typeof resolutionRequestSchema>;
export const resolutionResultSchema = z
  .object({
    version: z.literal(1),
    choices: z
      .array(
        z
          .object({
            rowId: z.string().regex(/^row-(?:[0-9]|1[01])$/),
            candidateId: z
              .string()
              .regex(/^candidate-[0-4]$/)
              .nullable(),
            status: z.enum(["approval-required", "unresolved"]),
            reason: z.enum(["type-alternative", "insufficient-evidence"]),
          })
          .strict()
          .refine((choice) =>
            choice.status === "approval-required"
              ? choice.candidateId !== null &&
                choice.reason === "type-alternative"
              : choice.candidateId === null &&
                choice.reason === "insufficient-evidence",
          ),
      )
      .max(resolutionLimits.rows),
  })
  .strict()
  .refine(
    (result) =>
      new Set(result.choices.map((choice) => choice.rowId)).size ===
      result.choices.length,
  );
export type ResolutionResult = z.infer<typeof resolutionResultSchema>;
export type ResolutionSource = { revision: number; context: StoreContext };
export type ResolutionCoverage = {
  requirementKey: string;
  reason:
    | "clear"
    | "no-purchasable-alternatives"
    | "same-type"
    | "bounded-out"
    | "requested";
};
export type ResolutionBatch = {
  readonly request: ResolutionRequest | null;
  readonly coverage: readonly ResolutionCoverage[];
  readonly plannedCalls: 0 | 1;
};
export type ResolutionSuggestion = {
  requirementKey: string;
  productId: string | null;
  status: "approval-required" | "unresolved";
  reason: "type-alternative" | "insufficient-evidence" | "no-response";
};
type Binding = {
  signature: string;
  rows: Map<string, { key: string; products: Product[] }>;
};
const bindings = new WeakMap<ResolutionBatch, Binding>();
const key = (line: BasketLine) =>
  `${line.requirement.id}:${line.requirement.unit}`;
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function snapshot(
  lines: BasketLine[],
  source: ResolutionSource,
  options: MatchingOptions,
): string {
  if (
    !Number.isSafeInteger(source.revision) ||
    source.revision < 0 ||
    lines.length > resolutionLimits.inputRows ||
    new Set(lines.map(key)).size !== lines.length
  )
    throw new Error("invalidResolutionSource");
  // Timestamps do not affect suitability. IDs, context, quantities, policy and all other quote facts do.
  return JSON.stringify({
    source,
    options,
    lines: lines.map((line) => ({
      requirement: line.requirement,
      selected: line.product?.id ?? null,
      candidates: line.candidates.map(
        ({ observedAt: _time, ...product }) => product,
      ),
    })),
  });
}
function semantics(product: Product): string {
  return JSON.stringify([
    product.evidence?.family,
    [...(product.evidence?.qualifiers ?? [])].sort((a, b) =>
      a.kind.localeCompare(b.kind),
    ),
  ]);
}

/** Builds one read-only batch. All prices and approval requirements remain domain-owned. */
export function buildResolutionBatch(
  lines: BasketLine[],
  source: ResolutionSource,
  options: MatchingOptions = {},
): ResolutionBatch {
  const effective = { ...options, context: source.context };
  const signature = snapshot(lines, source, effective);
  const rows: ResolutionRequest["rows"] = [];
  const bound = new Map<string, { key: string; products: Product[] }>();
  const coverage: ResolutionCoverage[] = [];
  for (const line of lines) {
    const requirement = ingredientSchema.parse(line.requirement);
    const local = matchRequirement(
      line.requirement,
      line.candidates,
      effective,
    );
    const report = (reason: ResolutionCoverage["reason"]) =>
      coverage.push({ requirementKey: key(line), reason });
    if (local.product) {
      report("clear");
      continue;
    }
    const policy = matchingPolicy(line.requirement, effective);
    const available = line.candidates.filter(
      (p) =>
        candidateSuitability(line.requirement, p, effective).status ===
          "approval-required" && purchasable(line.requirement, p),
    );
    if (!policy.category || available.length < 2) {
      report("no-purchasable-alternatives");
      continue;
    }
    // Cheapest representative per known semantic type; brand and pack differences alone do not need AI.
    available.sort((a, b) => {
      const rankedA = matchRequirement(line.requirement, [a], {
        ...effective,
        accepted: [a.id],
      });
      const rankedB = matchRequirement(line.requirement, [b], {
        ...effective,
        accepted: [b.id],
      });
      return rankedA.total! - rankedB.total! || a.id.localeCompare(b.id);
    });
    const distinct = [
      ...new Map(
        available.map((p) => [semantics(p), p] as const).reverse(),
      ).values(),
    ].sort((a, b) => available.indexOf(a) - available.indexOf(b));
    if (distinct.length < 2) {
      report("same-type");
      continue;
    }
    if (rows.length === resolutionLimits.rows) {
      report("bounded-out");
      continue;
    }
    const products = distinct.slice(0, resolutionLimits.candidates);
    const rowId = `row-${rows.length}`;
    const row: ResolutionRequest["rows"][number] = {
      rowId,
      requirement: {
        name: requirement.name,
        amount: requirement.amount,
        unit: requirement.unit,
        category: policy.category,
        provenance: requirement.classification?.provenance ?? "legacy-name",
        qualifiers: (requirement.classification?.qualifiers ?? []).map(
          ({ kind, value, provenance }) => ({ kind, value, provenance }),
        ),
        required: policy.required,
        preferred: policy.preferred,
      },
      candidates: products.map((p, i) => {
        const ranked = matchRequirement(line.requirement, [p], {
          ...effective,
          accepted: [p.id],
        });
        return {
          candidateId: `candidate-${i}`,
          name: p.name,
          category: p.evidence!.category!,
          family: p.evidence!.family,
          qualifiers: p.evidence!.qualifiers,
          packAmount: p.packAmount,
          unit: p.unit,
          packs: ranked.packs,
          total: ranked.total!,
          reason: candidateSuitability(line.requirement, p, effective).reason,
        };
      }),
    };
    if (
      JSON.stringify({ version: 1, rows: [...rows, row] }).length >
      resolutionLimits.characters
    ) {
      report("bounded-out");
      continue;
    }
    rows.push(row);
    bound.set(rowId, { key: key(line), products: structuredClone(products) });
    report("requested");
  }
  const batch: ResolutionBatch = freeze({
    request: rows.length
      ? resolutionRequestSchema.parse({ version: 1, rows })
      : null,
    coverage,
    plannedCalls: rows.length ? 1 : 0,
  });
  bindings.set(batch, { signature, rows: bound });
  return batch;
}

/** Validates the entire response before returning proposals; never accepts a SKU or mutates a quote. */
export function validateResolutionResult(
  batch: ResolutionBatch,
  output: unknown,
  lines: BasketLine[],
  source: ResolutionSource,
  options: MatchingOptions = {},
): ResolutionSuggestion[] {
  const binding = bindings.get(batch);
  const effective = { ...options, context: source.context };
  if (
    !binding ||
    !batch.request ||
    snapshot(lines, source, effective) !== binding.signature
  )
    throw new Error("resolutionStale");
  const result = resolutionResultSchema.parse(output);
  const choices = new Map<string, ResolutionResult["choices"][number]>();
  for (const choice of result.choices) {
    const row = binding.rows.get(choice.rowId);
    if (!row || choices.has(choice.rowId))
      throw new Error("invalidResolutionChoice");
    if (choice.candidateId !== null) {
      const index = batch.request.rows
        .find((r) => r.rowId === choice.rowId)!
        .candidates.findIndex((c) => c.candidateId === choice.candidateId);
      const product = row.products[index];
      const line = lines.find((l) => key(l) === row.key)!;
      if (
        !product ||
        candidateSuitability(line.requirement, product, effective).status !==
          "approval-required" ||
        !purchasable(line.requirement, product)
      )
        throw new Error("invalidResolutionChoice");
    }
    choices.set(choice.rowId, choice);
  }
  return [...binding.rows].map(([rowId, row]) => {
    const choice = choices.get(rowId);
    const index = choice?.candidateId
      ? batch
          .request!.rows.find((r) => r.rowId === rowId)!
          .candidates.findIndex((c) => c.candidateId === choice.candidateId)
      : -1;
    return {
      requirementKey: row.key,
      productId: index >= 0 ? row.products[index].id : null,
      status: choice?.status ?? "unresolved",
      reason: choice?.reason ?? "no-response",
    };
  });
}
