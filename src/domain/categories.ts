import { z } from "zod";

export const categorySchema = z.enum([
  "milk",
  "bread",
  "eggs",
  "mince",
  "onion",
  "rice",
  "cream",
  "coffee",
]);
export type Category = z.infer<typeof categorySchema>;
export const provenanceSchema = z.enum([
  "explicit-note",
  "recipe-inferred",
  "model-assumed",
  "remembered",
  "observed",
]);
export type Provenance = z.infer<typeof provenanceSchema>;
/** UTF-16 offsets into the operation's source note, never a model-written source. */
export const sourceEvidenceSchema = z
  .object({
    start: z.number().int().nonnegative().max(10_000),
    end: z.number().int().positive().max(10_000),
    quote: z.string().min(1).max(500),
  })
  .strict()
  .refine((e) => e.end - e.start === e.quote.length);

export const qualifierValues = {
  fat: ["skimmed", "semi-skimmed", "whole"],
  lactose: ["free", "low"],
  meat: ["beef", "pork", "beef-pork", "chicken", "turkey"],
  grain: ["rye", "wheat", "wholegrain"],
  onion: ["yellow", "red", "shallot", "spring"],
  rice: ["white", "brown", "jasmine", "basmati"],
  cream: ["cooking", "whipping"],
  coffee: ["ground", "beans", "instant"],
} as const;
export const qualifierSchema = z
  .object({
    kind: z.enum([
      "fat",
      "lactose",
      "meat",
      "grain",
      "onion",
      "rice",
      "cream",
      "coffee",
    ]),
    value: z.string().min(1).max(40),
    provenance: provenanceSchema,
    evidence: sourceEvidenceSchema.optional(),
  })
  .strict()
  .refine((q) =>
    (qualifierValues[q.kind] as readonly string[]).includes(q.value),
  );
export type Qualifier = z.infer<typeof qualifierSchema>;
const allowed: Record<Category, Qualifier["kind"][]> = {
  milk: ["fat", "lactose"],
  bread: ["grain"],
  eggs: [],
  mince: ["meat"],
  onion: ["onion"],
  rice: ["rice"],
  cream: ["cream", "lactose"],
  coffee: ["coffee"],
};
export const classificationSchema = z
  .object({
    category: categorySchema,
    provenance: provenanceSchema,
    evidence: sourceEvidenceSchema.optional(),
    qualifiers: z.array(qualifierSchema).max(8).default([]),
  })
  .strict()
  .superRefine((c, ctx) => {
    const kinds = new Set<string>();
    for (const q of c.qualifiers) {
      if (!allowed[c.category].includes(q.kind) || kinds.has(q.kind))
        ctx.addIssue({
          code: "custom",
          message: "Invalid or duplicate category qualifier",
        });
      kinds.add(q.kind);
    }
    for (const entry of [c, ...c.qualifiers]) {
      if (entry.provenance === "explicit-note" && !entry.evidence)
        ctx.addIssue({
          code: "custom",
          message: "Explicit claims require source evidence",
        });
      if (entry.provenance !== "explicit-note" && entry.evidence)
        ctx.addIssue({
          code: "custom",
          message: "Source evidence belongs to explicit claims",
        });
    }
  });
export type Classification = z.infer<typeof classificationSchema>;

const categoryWords: Record<Category, RegExp> = {
  milk: /maito|milk/i,
  bread: /leip|bread/i,
  eggs: /kananmun|egg/i,
  mince: /jauhelih|mince|ground beef/i,
  onion: /sipul|onion/i,
  rice: /riis|rice/i,
  cream: /kerma|cream/i,
  coffee: /kahv|coffee/i,
};
const qualifierWords: Record<string, RegExp> = {
  "fat:skimmed": /rasvaton|(?<!semi-)\bskimmed\b/i,
  "fat:semi-skimmed": /kevytmaito|semi-skimmed/i,
  "fat:whole": /täysmaito|whole milk/i,
  "lactose:free": /laktoositon|lactose.free/i,
  "lactose:low": /vähälaktoos|low.lactose/i,
  "meat:beef": /naudan|beef/i,
  "meat:pork": /sian|pork/i,
  "meat:beef-pork": /sika.nauta|nauta.sika|beef.and.pork/i,
  "meat:chicken": /kanan|broilerin|chicken/i,
  "meat:turkey": /kalkkunan|turkey/i,
  "grain:rye": /ruis|rye/i,
  "grain:wheat": /vehnä|wheat/i,
  "grain:wholegrain": /täysjyvä|wholegrain/i,
  "onion:yellow": /keltasipul|yellow onion/i,
  "onion:red": /punasipul|red onion/i,
  "onion:shallot": /salottisipul|shallot/i,
  "onion:spring": /kevätsipul|spring onion/i,
  "rice:white": /valkoinen|white/i,
  "rice:brown": /täysjyvä|ruskea|brown/i,
  "rice:jasmine": /jasmiini|jasmine/i,
  "rice:basmati": /basmati/i,
  "cream:cooking": /ruokakerma|cooking cream/i,
  "cream:whipping": /vispikerma|kuohukerma|whipping cream/i,
  "coffee:ground": /jauhettu|suodatin|ground|filter/i,
  "coffee:beans": /papu|pavut|bean/i,
  "coffee:instant": /pika|instant/i,
};

/** A conservative supported-phrase check, not proof of arbitrary natural-language intent. */
export function validateAIClassification(
  classification: Classification,
  source: string,
  recipeIngredient = false,
): Classification {
  const c = classificationSchema.parse(classification);
  for (const entry of [c, ...c.qualifiers]) {
    // Memory and retailer observations are supplied by domain code, never by model output.
    if (entry.provenance === "remembered" || entry.provenance === "observed")
      throw new Error("invalidDraft");
    if (entry.provenance === "explicit-note") {
      const e = entry.evidence!;
      if (
        recipeIngredient ||
        source.slice(e.start, e.end) !== e.quote ||
        !categoryWords[c.category].test(e.quote) ||
        /\b(?:ei|eikä|ilman|not|no|without|instead)\b/i.test(e.quote)
      )
        throw new Error("invalidDraft");
      if (
        "kind" in entry &&
        !qualifierWords[`${entry.kind}:${entry.value}`]?.test(e.quote)
      )
        throw new Error("invalidDraft");
    }
  }
  return c;
}

/** Names may suggest metadata but never establish an explicit shopper constraint. */
export function inferredClassification(
  name: string,
  provenance: "model-assumed" | "recipe-inferred",
): Classification | undefined {
  const category = (Object.keys(categoryWords) as Category[]).find((id) =>
    categoryWords[id].test(name),
  );
  if (!category) return undefined;
  const qualifiers: Qualifier[] = [];
  for (const kind of allowed[category]) {
    const matches: readonly string[] = qualifierValues[kind].filter((value) =>
      qualifierWords[`${kind}:${value}`]?.test(name),
    );
    // Overlapping meat words do not certify a single meat type.
    const value =
      matches.length === 1
        ? matches[0]
        : matches.includes("beef-pork")
          ? "beef-pork"
          : undefined;
    if (value) qualifiers.push({ kind, value, provenance });
  }
  return { category, provenance, qualifiers };
}

/** Distinct constraints must not share an ingredient identity or silently add together. */
export function classificationKey(c: Classification | undefined): string {
  if (!c) return "";
  return JSON.stringify([
    c.category,
    c.provenance,
    ...c.qualifiers.map((q) => [q.kind, q.value, q.provenance]).sort(),
  ]);
}
