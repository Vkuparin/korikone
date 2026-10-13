import { z } from "zod";
import { sourceEvidenceSchema, classificationKey } from "./categories";
import { IntentLedgerError } from "./draft-errors";
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
    // `assumed`: the note names the grocery without an amount and the planner chose one
    // ordinary purchase of it. It is a default the shopper can change, never a stated amount.
    provenance: z.enum(["explicit-note", "unknown", "assumed"]),
  })
  .strict()
  .refine((q) =>
    q.provenance === "unknown"
      ? q.amount === null && q.unit === null
      : q.provenance === "assumed"
        ? q.amount !== null && Number.isInteger(q.amount) && q.unit !== null
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
    // An assumed amount exists only for a grocery that is on the list with that amount.
    if (intent.quantity?.provenance === "assumed" && target === null) invalid();
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

const writtenNumbers: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  // Finnish, nominative and the genitive that precedes a unit ("kahden litran").
  yksi: 1,
  yhden: 1,
  kaksi: 2,
  kahden: 2,
  kolme: 3,
  kolmen: 3,
  neljä: 4,
  neljän: 4,
  viisi: 5,
  viiden: 5,
  kuusi: 6,
  kuuden: 6,
  seitsemän: 7,
  kahdeksan: 8,
  yhdeksän: 9,
  kymmenen: 10,
  yksitoista: 11,
  kaksitoista: 12,
  puoli: 0.5,
  puolitoista: 1.5,
};
const writtenNumberToken = Object.keys(writtenNumbers).join("|");
const unitToken =
  "kg|g|ml|dl|l|kpl|pcs|kappaletta|kappale|grammaa?|grams?|kilogrammaa?|kilograms?|kiloa?|kilon|litraa?|litran|litres?|liters?|desilitraa?|desilitran|millilitraa?|millilitres?|milliliters?";
/** A unit word in the singular that opens a request means one of it: "litra jäätelöä". */
const bareUnit = /^\s*(litra|kilo|kilogramma|desilitra)\s+(?=\p{L})/iu;
/**
 * A number that describes the product is not an amount: a size after "koko" or "size", and a
 * measure in centimetres, millimetres, inches, volts, watts or milliamp-hours.
 */
const withoutAttributeNumbers = (text: string) =>
  text
    .replace(
      /(?<![\p{L}])(?:koko|kokoa|size|numero|nro)\s*\d+(?:[.,]\d+)?(?![\p{L}\p{N}])/giu,
      " ",
    )
    .replace(
      /\d+(?:[.,]\d+)?\s*(?:cm|mm|tuumaa|tuuman|inch|inches|"|v|w|mah)(?![\p{L}\p{N}])/giu,
      " ",
    );
function literalNumbers(source: string) {
  const text = withoutAttributeNumbers(source);
  // Do not interpret the supported tail of a compound number, range or signed amount.
  if (
    /\b(?:thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|minus|negative)\b/i.test(
      text,
    ) ||
    /\d\s*[-–/]\s*\d/.test(text) ||
    /[+−–-]\s*(?:\d|one\b|two\b|three\b|four\b|five\b|six\b|seven\b|eight\b|nine\b|ten\b|eleven\b|twelve\b)/i.test(
      text,
    )
  )
    return [];
  return [
    ...text.matchAll(
      new RegExp(
        `(?<![\\p{L}\\p{N}.+\\-])(?:\\d+(?:[.,]\\d+)?(?=$|[^\\p{L}\\p{N}]|(?:${unitToken})(?=\\s|$|[,;.]))|(?:${writtenNumberToken})(?![\\p{L}\\p{N}]))`,
        "giu",
      ),
    ),
  ].filter(
    (match) => !/^\s*%/.test(text.slice(match.index! + match[0].length)),
  );
}
const literalAmount = (token: string) =>
  writtenNumbers[token.toLowerCase()] ?? Number(token.replace(",", "."));

/** Supported literal quantities prove an amount; explicit egg counts prove pieces. No package inference. */
export function noteQuantity(
  text: string,
): { amount: number; unit: Unit } | null {
  const numbers = literalNumbers(text);
  if (!numbers.length) {
    const bare = text.match(bareUnit)?.[1].toLowerCase();
    if (!bare) return null;
    return bare === "desilitra"
      ? { amount: 100, unit: "ml" }
      : { amount: 1000, unit: bare === "litra" ? "ml" : "g" };
  }
  if (numbers.length !== 1) return null;
  const number = numbers[0];
  const amount = literalAmount(number[0]);
  const after = text.slice(number.index! + number[0].length);
  const token = after
    .match(new RegExp(`^\\s*(${unitToken})(?=\\s|$|[,;.])`, "i"))?.[1]
    .toLowerCase();
  if (!token) {
    const egg =
      "(?:eggs?|kananmunia|kananmunaa|kananmunat|kananmuna|munia|munaa|munat|muna)";
    const before = text.slice(0, number.index!);
    const explicitEggs =
      new RegExp(`\\b${egg}\\s*$`, "i").test(before) ||
      new RegExp(`^\\s+${egg}(?=\\s|$|[,;.])`, "i").test(after);
    return explicitEggs &&
      !/\b(?:packs?|packages?|cartons?|boxes?|dozen|pakkaus|pakkausta|pakettia|rasiaa)\b/i.test(
        text,
      ) &&
      Number.isInteger(amount) &&
      amount > 0 &&
      amount <= 10_000_000
      ? { amount, unit: "pcs" }
      : null;
  }
  const unit: Unit = /^(kpl|pcs|kappale|kappaletta)$/.test(token)
    ? "pcs"
    : /^(ml|dl|l|litraa?|litran|litres?|liters?|desilitraa?|desilitran|millilitraa?|millilitres?|milliliters?)$/.test(
          token,
        )
      ? "ml"
      : "g";
  const canonical =
    amount *
    (/^(kg|kilogrammaa?|kilograms?|kiloa?|kilon|l|litraa?|litran|litres?|liters?)$/.test(
      token,
    )
      ? 1000
      : /^(dl|desilitraa?|desilitran)$/.test(token)
        ? 100
        : 1);
  return Number.isFinite(canonical) && canonical > 0 && canonical <= 10_000_000
    ? { amount: canonical, unit }
    : null;
}
export function noteUnspecifiedCount(text: string): number | null {
  if (noteQuantity(text)) return null;
  const numbers = literalNumbers(text);
  const amount = numbers.length === 1 ? literalAmount(numbers[0][0]) : NaN;
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
  const parsed = z
    .array(requestIntentSchema)
    .min(1)
    .max(intentLimits.requests)
    .safeParse(input);
  if (!parsed.success) {
    const at = parsed.error.issues[0]?.path[0];
    throw new IntentLedgerError("shape", typeof at === "number" ? at : null);
  }
  const intents = parsed.data;
  const ids = new Set<string>(),
    spans: { start: number; end: number }[] = [],
    meals = new Set<number>(),
    items = new Set<number>();
  for (const [index, intent] of intents.entries()) {
    const e = intent.evidence;
    if (
      note.slice(e.start, e.end) !== e.quote ||
      intent.label !== e.quote ||
      e.end > note.length ||
      ids.has(intent.id) ||
      spans.some((span) => e.start < span.end && span.start < e.end)
    )
      throw new IntentLedgerError("intent-span", index);
    // UTF-16 offsets cannot split an astral character.
    if (/^[\uDC00-\uDFFF]/.test(e.quote) || /[\uD800-\uDBFF]$/.test(e.quote))
      throw new IntentLedgerError("intent-span", index);
    ids.add(intent.id);
    spans.push(e);
    // An amount the note states can be neither unknown nor replaced by an assumed one.
    if (
      (intent.quantity?.provenance === "unknown" ||
        intent.quantity?.provenance === "assumed") &&
      (noteQuantity(e.quote) || noteUnspecifiedCount(e.quote) !== null)
    )
      throw new IntentLedgerError("intent-quantity", index);
    if (intent.kind === "meal" && intent.mealIndex !== null) {
      if (!draft.meals[intent.mealIndex] || meals.has(intent.mealIndex))
        throw new IntentLedgerError("intent-target", index);
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
          throw new IntentLedgerError("intent-quantity", index);
      } else {
        if (q || noteUnspecifiedCount(e.quote) !== intent.quantity.amount)
          throw new IntentLedgerError("intent-quantity", index);
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
        throw new IntentLedgerError("intent-target", index);
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
    throw new IntentLedgerError("intent-coverage");
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
/** Durable source evidence remains valid even when an explicit edit removes a referenced requirement. */
export function validStoredIntents(
  mappings: IntentMapping[],
  note: string,
): boolean {
  const seen = new Set<string>();
  const spans: { start: number; end: number }[] = [];
  return mappings.every(({ intent }) => {
    const { start, end, quote } = intent.evidence;
    const quantity = intent.quantity;
    const known = noteQuantity(quote);
    if (
      (quantity?.provenance === "unknown" ||
        quantity?.provenance === "assumed") &&
      (known || noteUnspecifiedCount(quote) !== null)
    )
      return false;
    if (
      quantity?.provenance === "explicit-note" &&
      (quantity.unit === null
        ? known !== null || noteUnspecifiedCount(quote) !== quantity.amount
        : !known ||
          known.amount !== quantity.amount ||
          known.unit !== quantity.unit)
    )
      return false;
    if (
      intent.id !== `intent-${start}-${end}` ||
      seen.has(intent.id) ||
      note.slice(start, end) !== quote ||
      intent.label !== quote ||
      end > note.length ||
      /^[\uDC00-\uDFFF]/.test(quote) ||
      /[\uD800-\uDBFF]$/.test(quote) ||
      spans.some((span) => start < span.end && span.start < end)
    )
      return false;
    seen.add(intent.id);
    spans.push({ start, end });
    return true;
  });
}
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
  options: {
    complete?: boolean;
    boundedOut?: string[];
    settledKeys?: string[];
  } = {},
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
        if (options.settledKeys?.includes(requirementKey)) continue;
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
              row.matching?.reason === "bounded-out"
                ? "bounded-out"
                : row.matching?.reason === "empty-search"
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
