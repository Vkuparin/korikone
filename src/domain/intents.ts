import { z } from "zod";
import { sourceEvidenceSchema, classificationKey } from "./categories";
import type { BasketLine, Recipe, Requirement, Unit } from "./model";

export const intentLimits = Object.freeze({
  requests: 100,
  requirementsPerRequest: 100,
});
export const intentUnresolvedReasonSchema = z.enum([
  "unknown-quantity",
  "unknown-unit",
  "unsupported-quantity",
  "unsupported-request",
  "ambiguous-request",
  "excluded-request",
]);
export const intentQuantitySchema = z
  .object({
    amount: z.number().positive().max(10_000_000).nullable(),
    unit: z.enum(["g", "ml", "pcs"]).nullable(),
    provenance: z.enum(["explicit-note", "unknown"]),
  })
  .strict()
  .refine((q) =>
    q.provenance === "unknown"
      ? q.amount === null && q.unit === null
      : q.amount !== null,
  );
export const requestIntentSchema = z
  .object({
    id: z.string().min(1).max(100),
    kind: z.enum(["meal", "grocery"]),
    label: z.string().min(1).max(500),
    evidence: sourceEvidenceSchema,
    provenance: z.literal("explicit-note"),
    quantity: intentQuantitySchema.nullable(),
    mealIndex: z.number().int().min(0).max(99).nullable(),
    itemIndex: z.number().int().min(0).max(199).nullable(),
    unresolvedReason: intentUnresolvedReasonSchema.nullable(),
  })
  .strict()
  .superRefine((intent, ctx) => {
    const invalid = () =>
      ctx.addIssue({
        code: "custom",
        message: "Invalid request-intent target",
      });
    if (
      intent.kind === "meal"
        ? intent.quantity !== null || intent.itemIndex !== null
        : intent.quantity === null || intent.mealIndex !== null
    )
      invalid();
    const target = intent.kind === "meal" ? intent.mealIndex : intent.itemIndex;
    if (intent.unresolvedReason === null ? target === null : target !== null)
      invalid();
    if (
      intent.kind === "grocery" &&
      target !== null &&
      (!intent.quantity ||
        intent.quantity.amount === null ||
        intent.quantity.unit === null)
    )
      invalid();
    if (
      intent.unresolvedReason === "unknown-quantity" &&
      intent.quantity?.amount !== null
    )
      invalid();
    if (
      intent.unresolvedReason === "unknown-unit" &&
      (intent.quantity?.amount === null || intent.quantity?.unit !== null)
    )
      invalid();
    if (
      intent.quantity?.amount !== null &&
      intent.quantity?.unit &&
      !Number.isInteger(intent.quantity.amount) &&
      intent.unresolvedReason !== "unsupported-quantity"
    )
      invalid();
  });
export type RequestIntent = z.infer<typeof requestIntentSchema>;
type DraftTargets = {
  recipes: Recipe[];
  meals: { recipeId: string; servings: number; leftovers: boolean }[];
  items: { id: string; amount: number; unit: Unit }[];
};
const key = (r: { id: string; unit: Unit }) => `${r.id}:${r.unit}`;

/** Only literal supported numeric units prove an amount. Package weight is never inferred. */
export function noteQuantity(
  text: string,
): { amount: number; unit: Unit } | null {
  const matches = [
    ...text.matchAll(
      /(?:^|\s)(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l|kpl|pcs|grammaa|grams?|litraa|litres?|millilitraa)(?=\s|$|[,;.])/gi,
    ),
  ];
  if (matches.length !== 1) return null;
  const amount = Number(matches[0][1].replace(",", "."));
  const token = matches[0][2].toLocaleLowerCase("fi");
  const unit: Unit = /^(kpl|pcs)$/.test(token)
    ? "pcs"
    : /^(ml|l|litraa|litres?|millilitraa)$/.test(token)
      ? "ml"
      : "g";
  const canonical = amount * (/^(kg|l|litraa|litres?)$/.test(token) ? 1000 : 1);
  return Number.isFinite(canonical) && canonical > 0 && canonical <= 10_000_000
    ? { amount: canonical, unit }
    : null;
}
export function noteUnspecifiedCount(text: string): number | null {
  if (noteQuantity(text)) return null;
  const numbers = [...text.matchAll(/\b\d+(?:[.,]\d+)?\b(?!\s*%)/g)];
  const amount =
    numbers.length === 1 ? Number(numbers[0][0].replace(",", ".")) : NaN;
  return Number.isFinite(amount) && amount > 0 && amount <= 10_000_000
    ? amount
    : null;
}

/** Validates identified requests, not arbitrary-note comprehension. Independent fixture expectations remain necessary. */
export function validateIntentLedger(
  input: unknown,
  note: string,
  draft: DraftTargets,
): RequestIntent[] {
  const intents = z
    .array(requestIntentSchema)
    .min(1)
    .max(intentLimits.requests)
    .parse(input);
  const ids = new Set<string>(),
    spans: { start: number; end: number }[] = [],
    meals = new Set<number>(),
    items = new Set<number>();
  for (const intent of intents) {
    const e = intent.evidence;
    if (
      note.slice(e.start, e.end) !== e.quote ||
      intent.label !== e.quote ||
      e.end > note.length ||
      ids.has(intent.id) ||
      spans.some((span) => e.start < span.end && span.start < e.end)
    )
      throw new Error("invalidIntentLedger");
    // UTF-16 offsets cannot split an astral character.
    if (/^[\uDC00-\uDFFF]/.test(e.quote) || /[\uD800-\uDBFF]$/.test(e.quote))
      throw new Error("invalidIntentLedger");
    ids.add(intent.id);
    spans.push(e);
    if (intent.quantity?.provenance === "unknown" && noteQuantity(e.quote))
      throw new Error("invalidIntentLedger");
    if (intent.kind === "meal" && intent.mealIndex !== null) {
      if (!draft.meals[intent.mealIndex] || meals.has(intent.mealIndex))
        throw new Error("invalidIntentLedger");
      meals.add(intent.mealIndex);
    }
    if (intent.quantity?.provenance === "explicit-note") {
      const q = noteQuantity(e.quote);
      if (intent.quantity.unit !== null) {
        if (
          !q ||
          q.amount !== intent.quantity.amount ||
          q.unit !== intent.quantity.unit
        )
          throw new Error("invalidIntentLedger");
      } else {
        if (q || noteUnspecifiedCount(e.quote) !== intent.quantity.amount)
          throw new Error("invalidIntentLedger");
      }
    }
    if (intent.itemIndex !== null) {
      const item = draft.items[intent.itemIndex];
      if (
        !item ||
        items.has(intent.itemIndex) ||
        item.amount !== intent.quantity!.amount ||
        item.unit !== intent.quantity!.unit
      )
        throw new Error("invalidIntentLedger");
      items.add(intent.itemIndex);
    }
    intent.id = `intent-${e.start}-${e.end}`;
  }
  if (
    meals.size !== draft.meals.length ||
    items.size !== draft.items.length ||
    draft.recipes.some(
      (recipe) => !draft.meals.some((meal) => meal.recipeId === recipe.id),
    )
  )
    throw new Error("invalidIntentLedger");
  return intents;
}
export const intentMappingSchema = z
  .object({
    intent: requestIntentSchema,
    recipeId: z.string().min(1).max(200).nullable(),
    requirementKeys: z
      .array(z.string().min(1).max(110))
      .max(intentLimits.requirementsPerRequest),
  })
  .strict()
  .refine(
    (mapping) =>
      new Set(mapping.requirementKeys).size ===
        mapping.requirementKeys.length &&
      (mapping.intent.unresolvedReason
        ? mapping.recipeId === null && mapping.requirementKeys.length === 0
        : mapping.intent.kind === "meal"
          ? mapping.recipeId !== null
          : mapping.recipeId === null && mapping.requirementKeys.length === 1),
  );
export type IntentMapping = z.infer<typeof intentMappingSchema>;
export const intentResultSchema = intentMappingSchema
  .safeExtend({
    status: z.enum(["pending", "resolved", "approval-required", "unresolved"]),
    reason: z
      .enum([
        ...intentUnresolvedReasonSchema.options,
        "empty-search",
        "no-match",
        "bounded-out",
        "missing-requirement",
        "missing-result",
      ])
      .nullable(),
  })
  .strict()
  .refine((result) =>
    result.intent.unresolvedReason
      ? result.status === "unresolved" &&
        result.reason === result.intent.unresolvedReason
      : result.status === "unresolved"
        ? result.reason !== null
        : result.reason === null,
  );
export type IntentResult = z.infer<typeof intentResultSchema>;
export function pendingIntentResults(
  mappings: IntentMapping[],
): IntentResult[] {
  return mappings.map((mapping) =>
    intentResultSchema.parse({
      ...mapping,
      status: mapping.intent.unresolvedReason
        ? "unresolved"
        : mapping.requirementKeys.length
          ? "pending"
          : "resolved",
      reason: mapping.intent.unresolvedReason,
    }),
  );
}
export function projectIntentMappings(
  intents: RequestIntent[],
  draft: DraftTargets,
  savedRecipes: Recipe[],
): IntentMapping[] {
  return intents.map((intent) => {
    let recipeId: string | null = null,
      requirementKeys: string[] = [];
    if (intent.mealIndex !== null) {
      const meal = draft.meals[intent.mealIndex];
      if (!meal) throw new Error("invalidIntentLedger");
      recipeId = meal.recipeId;
      const recipe = [...savedRecipes, ...draft.recipes].find(
        (recipe) => recipe.id === recipeId,
      );
      if (!recipe) throw new Error("invalidIntentLedger");
      requirementKeys = meal.leftovers
        ? []
        : [...new Set(recipe.ingredients.map(key))];
    } else if (intent.itemIndex !== null) {
      const item = draft.items[intent.itemIndex];
      if (!item) throw new Error("invalidIntentLedger");
      requirementKeys = [key(item)];
    }
    return intentMappingSchema.parse({ intent, recipeId, requirementKeys });
  });
}
export function mapIntentResults(
  mappings: IntentMapping[],
  requirements: Requirement[],
  lines: BasketLine[],
  options: { complete?: boolean; boundedOut?: string[] } = {},
): IntentResult[] {
  if (
    new Set(mappings.map((mapping) => mapping.intent.id)).size !==
      mappings.length ||
    new Set(requirements.map(key)).size !== requirements.length ||
    new Set(lines.map((line) => key(line.requirement))).size !== lines.length
  )
    throw new Error("invalidIntentMapping");
  if (
    mappings.some(
      (mapping) =>
        new Set(mapping.requirementKeys).size !==
        mapping.requirementKeys.length,
    )
  )
    throw new Error("invalidIntentMapping");
  const wanted = new Map(requirements.map((r) => [key(r), r]));
  for (const line of lines) {
    const requirement = wanted.get(key(line.requirement));
    if (
      !requirement ||
      requirement.amount !== line.requirement.amount ||
      requirement.name !== line.requirement.name ||
      classificationKey(requirement.classification) !==
        classificationKey(line.requirement.classification)
    )
      throw new Error("invalidIntentMapping");
  }
  const rowMap = new Map(lines.map((line) => [key(line.requirement), line]));
  return mappings.map((mapping) => {
    let status: IntentResult["status"] = "resolved",
      reason: IntentResult["reason"] = null;
    if (mapping.intent.unresolvedReason) {
      status = "unresolved";
      reason = mapping.intent.unresolvedReason;
    } else
      for (const requirementKey of mapping.requirementKeys) {
        const row = rowMap.get(requirementKey);
        if (!wanted.has(requirementKey)) {
          status = "unresolved";
          reason = "missing-requirement";
          break;
        }
        if (options.boundedOut?.includes(requirementKey)) {
          status = "unresolved";
          reason = "bounded-out";
          break;
        }
        if (!row) {
          if (options.complete) {
            status = "unresolved";
            reason = "missing-result";
            break;
          }
          status = "pending";
          continue;
        }
        if (!row.product || row.total === null) {
          const approval = row.matching?.status === "approval-required";
          if (!approval) {
            status = "unresolved";
            reason =
              row.matching?.reason === "empty-search"
                ? "empty-search"
                : "no-match";
            break;
          }
          if (status !== "pending") status = "approval-required";
        }
      }
    return intentResultSchema.parse({ ...mapping, status, reason });
  });
}
