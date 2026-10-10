import { z } from "zod";
import {
  categorySchema,
  classificationSchema,
  validateAIClassification,
  type Category,
  type Qualifier,
} from "./categories";
import {
  categoryPreferenceSchema,
  categoryPreferencesSchema,
  type CategoryPreference,
} from "./preferences";
export {
  categoryPreferenceSchema,
  type CategoryPreference,
} from "./preferences";
import { foodNameFacts } from "./food-names";
import { productEvidenceSchema, type ProductFamily } from "./product-evidence";
import { match, relevant } from "./planner";
import type {
  AppState,
  BasketLine,
  Product,
  Requirement,
  StoreContext,
} from "./model";

type Value = Pick<Qualifier, "kind" | "value">;
const categoryRules: Record<
  Category,
  {
    families: ProductFamily[];
    type?: { kind: Value["kind"]; defaults: string[] };
  }
> = {
  milk: { families: ["plain-milk"] },
  bread: { families: ["bread"] },
  eggs: { families: ["hen-egg"] },
  mince: {
    families: ["meat-mince"],
    type: { kind: "meat", defaults: ["beef", "pork", "beef-pork"] },
  },
  onion: { families: ["onion"], type: { kind: "onion", defaults: ["yellow"] } },
  rice: { families: ["dry-rice"] },
  cream: { families: ["dairy-cream"], type: { kind: "cream", defaults: [] } },
  coffee: {
    families: ["ground-coffee", "coffee-beans", "instant-coffee"],
    type: { kind: "coffee", defaults: ["ground"] },
  },
};
export type MatchingOptions = {
  preference?: CategoryPreference;
  preferences?: CategoryPreference[];
  productPreference?: AppState["productPreference"];
  exclusions?: string[];
  accepted?: string[];
  context?: StoreContext;
  sourceNote?: string;
};
export const matchingReasonSchema = z.enum([
  "resolved",
  "approved",
  "empty-search",
  "identity",
  "invalid-evidence",
  "category",
  "family",
  "unknown-category",
  "unknown-family",
  "unsupported-request",
  "qualifier-conflict",
  "qualifier-unknown",
  "constraint-conflict",
  "excluded",
  "dietary-evidence",
  "preference-missing",
  "default-review",
  "stock",
  "price",
  "pack",
  "unit",
  "name",
]);
export type MatchingReason = z.infer<typeof matchingReasonSchema>;
const decisionSchema = z.object({
  id: z.string(),
  status: z.enum(["eligible", "approval-required", "rejected"]),
  reason: matchingReasonSchema,
});
export type CandidateDecision = z.infer<typeof decisionSchema>;
export const matchingSummarySchema = z.object({
  category: categorySchema.nullable(),
  status: z.enum(["resolved", "approval-required", "unresolved"]),
  reason: matchingReasonSchema,
  defaulted: z.boolean(),
  decisions: z.array(decisionSchema).max(60),
});
export type MatchingSummary = z.infer<typeof matchingSummarySchema>;
type Constraint = Value & {
  source: "explicit-note" | "recipe-inferred" | "legacy-name" | "remembered";
};
export type MatchingPolicy = {
  category: Category | null;
  required: Constraint[];
  preferred: Value[];
  conflict: boolean;
  unsupported: boolean;
  defaulted: boolean;
};

/** Recipe qualifiers describe the proposed recipe; model-added grocery specificity is not required. */
export function matchingPolicy(
  requirement: Requirement,
  options: MatchingOptions = {},
): MatchingPolicy {
  const named = foodNameFacts(requirement.name);
  const classification =
    requirement.classification &&
    classificationSchema.parse(requirement.classification);
  if (
    classification &&
    options.sourceNote !== undefined &&
    classification.provenance !== "remembered" &&
    classification.provenance !== "observed"
  )
    validateAIClassification(classification, options.sourceNote);
  const category = classification?.category ?? named.category;
  const required: Constraint[] = classification
    ? classification.qualifiers
        .filter(
          (q) =>
            q.provenance === "explicit-note" ||
            q.provenance === "recipe-inferred",
        )
        .map((q) => ({
          kind: q.kind,
          value: q.value,
          source: q.provenance as Constraint["source"],
        }))
    : named.qualifiers.map((q) => ({ ...q, source: "legacy-name" }));
  const preferences =
    options.preferences && categoryPreferencesSchema.parse(options.preferences);
  const rule =
    options.preference ?? preferences?.find((p) => p.category === category);
  const preference = rule && categoryPreferenceSchema.parse(rule);
  const preferred: Value[] = [];
  let conflict = false;
  if (preference?.category === category)
    for (const q of preference.qualifiers) {
      const current = required.find((r) => r.kind === q.kind);
      if (current?.source === "explicit-note") continue;
      if (preference.strength === "required") {
        if (current && current.value !== q.value) conflict = true;
        else if (!current) required.push({ ...q, source: "remembered" });
      } else preferred.push(q);
    }
  const unsupported =
    !!category &&
    !!named.family &&
    !categoryRules[category].families.includes(named.family);

  return {
    category,
    required,
    preferred,
    conflict,
    unsupported,
    defaulted: required.length === 0 && preferred.length === 0,
  };
}

/** One deterministic type-specific alias; inferred model specificity never changes retrieval. */
export function requirementQueryHints(
  requirement: Requirement,
  options: MatchingOptions = {},
): string[] {
  const policy = matchingPolicy(requirement, options);
  if (!policy.category || policy.conflict || policy.unsupported) return [];
  const values = new Map(policy.preferred.map((q) => [q.kind, q.value]));
  for (const q of policy.required) values.set(q.kind, q.value);
  if (!values.size) return [];
  const names: Partial<Record<Value["kind"], Record<string, string>>> = {
    fat: {
      skimmed: "rasvaton maito",
      "semi-skimmed": "kevytmaito",
      whole: "täysmaito",
    },
    meat: {
      beef: "naudan jauheliha",
      pork: "sian jauheliha",
      "beef-pork": "sika-nauta jauheliha",
      chicken: "broilerin jauheliha",
      turkey: "kalkkunan jauheliha",
    },
    grain: {
      rye: "ruisleipä",
      wheat: "vehnäleipä",
      wholegrain: "täysjyväleipä",
    },
    onion: {
      yellow: "keltasipuli",
      red: "punasipuli",
      shallot: "salottisipuli",
      spring: "kevätsipuli",
    },
    rice: {
      white: "valkoinen riisi",
      brown: "täysjyväriisi",
      jasmine: "jasmiiniriisi",
      basmati: "basmatiriisi",
    },
    cream: { cooking: "ruokakerma", whipping: "kuohukerma" },
    coffee: {
      ground: "kahvi suodatinjauhatus",
      beans: "kahvipavut",
      instant: "pikakahvi",
    },
  };
  const base = {
    milk: "maito",
    bread: "leipä",
    eggs: "kananmuna",
    mince: "jauheliha",
    onion: "sipuli",
    rice: "riisi",
    cream: "kerma",
    coffee: "kahvi",
  }[policy.category];
  let query = base;
  for (const [kind, value] of values)
    if (names[kind]?.[value]) query = names[kind]![value];
  const lactose = values.get("lactose");
  if (lactose)
    query = `${lactose === "free" ? "laktoositon" : "vähälaktoosinen"} ${query}`;
  return [query];
}

const dietary = new Set([
  "gluteeni",
  "gluten",
  "pähkinä",
  "pähkinät",
  "nuts",
  "peanut",
  "peanuts",
  "maito",
  "milk",
  "kananmuna",
  "eggs",
  "soija",
  "soy",
]);
function assess(
  requirement: Requirement,
  product: Product,
  policy: MatchingPolicy,
  options: MatchingOptions,
): CandidateDecision {
  const result = (
    status: CandidateDecision["status"],
    reason: MatchingReason,
  ): CandidateDecision => ({ id: product.id, status, reason });
  const reject = (reason: MatchingReason) => result("rejected", reason);
  const review = (reason: MatchingReason) =>
    result("approval-required", reason);
  if (
    product.ingredientId !== requirement.id ||
    (options.context &&
      (product.providerId !== options.context.providerId ||
        product.storeId !== options.context.storeId))
  )
    return reject("identity");
  if (policy.conflict) return reject("constraint-conflict");
  if (policy.unsupported) return reject("unsupported-request");
  const parsed =
    product.evidence && productEvidenceSchema.safeParse(product.evidence);
  if (parsed && (!parsed.success || parsed.data.quote !== product.name))
    return reject("invalid-evidence");
  const evidence = parsed && parsed.success ? parsed.data : undefined;
  for (const raw of options.exclusions ?? []) {
    const term = raw.trim().toLocaleLowerCase("fi");
    if (term === "laktoosi" || term === "lactose") {
      if (
        !evidence?.qualifiers.some(
          (q) => q.kind === "lactose" && q.value === "free",
        )
      )
        return reject("dietary-evidence");
    } else if (dietary.has(term)) return reject("dietary-evidence");
    else if (term && product.name.toLocaleLowerCase("fi").includes(term))
      return reject("excluded");
  }
  if (product.packAmount > 0 && product.unit !== requirement.unit)
    return reject("unit");
  if (!policy.category) {
    if (!relevant(product.name, requirement.name)) return reject("name");
  } else {
    if (!evidence?.category) return reject("unknown-category");
    if (evidence.category !== policy.category) return reject("category");
    for (const q of policy.required) {
      const actual = evidence.qualifiers.find((v) => v.kind === q.kind);
      if (!actual) return reject("qualifier-unknown");
      if (actual.value !== q.value) return reject("qualifier-conflict");
    }
    const value = (kind: Value["kind"]) =>
      evidence.qualifiers.find((q) => q.kind === kind)?.value;
    const requested = (kind: Value["kind"]) =>
      policy.required.find((q) => q.kind === kind)?.value ??
      policy.preferred.find((q) => q.kind === kind)?.value;
    if (!evidence.family) return review("unknown-family");
    const rule = categoryRules[policy.category];
    if (!rule.families.includes(evidence.family)) return reject("family");
    if (
      rule.type &&
      !requested(rule.type.kind) &&
      !rule.type.defaults.includes(value(rule.type.kind) ?? "")
    )
      return review("default-review");
    if (
      policy.preferred.some(
        (q) =>
          evidence.qualifiers.find((v) => v.kind === q.kind)?.value !== q.value,
      )
    )
      return review("preference-missing");
  }
  if (product.available !== true) return review("stock");
  if (
    product.price === null ||
    !Number.isSafeInteger(product.price) ||
    product.price < 0 ||
    !Number.isSafeInteger(product.deposit) ||
    product.deposit < 0
  )
    return review("price");
  if (
    !Number.isFinite(product.packAmount) ||
    product.packAmount <= 0 ||
    !Number.isFinite(product.increment) ||
    product.increment <= 0
  )
    return review("pack");
  if (!purchasable(requirement, product)) return review("price");
  return result("eligible", "resolved");
}
export function candidateSuitability(
  requirement: Requirement,
  product: Product,
  options: MatchingOptions = {},
): CandidateDecision {
  return assess(
    requirement,
    product,
    matchingPolicy(requirement, options),
    options,
  );
}
export function purchasable(
  requirement: Requirement,
  product: Product,
): boolean {
  if (
    product.available !== true ||
    product.price === null ||
    !Number.isSafeInteger(product.price) ||
    product.price < 0 ||
    !Number.isSafeInteger(product.deposit) ||
    product.deposit < 0 ||
    product.unit !== requirement.unit ||
    !Number.isFinite(product.packAmount) ||
    product.packAmount <= 0 ||
    !Number.isFinite(product.increment) ||
    product.increment <= 0 ||
    !Number.isFinite(requirement.amount) ||
    requirement.amount <= 0
  )
    return false;
  const packs =
    Math.ceil(requirement.amount / product.packAmount / product.increment) *
    product.increment;
  return (
    Number.isFinite(packs) &&
    Number.isSafeInteger(Math.round(packs * (product.price + product.deposit)))
  );
}
export function selectableCandidate(
  requirement: Requirement,
  product: Product,
  options: MatchingOptions = {},
): boolean {
  const decision = candidateSuitability(requirement, product, options);
  return (
    purchasable(requirement, product) &&
    (decision.status === "eligible" ||
      (decision.status === "approval-required" &&
        (options.accepted ?? []).includes(product.id)))
  );
}
export function matchRequirement(
  requirement: Requirement,
  products: Product[],
  options: MatchingOptions = {},
): BasketLine {
  if (
    products.length > 60 ||
    new Set(products.map((p) => p.id)).size !== products.length
  )
    throw new Error("invalidCandidates");
  const policy = matchingPolicy(requirement, options);
  const decisions = products.map((p) =>
    assess(requirement, p, policy, options),
  );
  const allowed = products.filter(
    (_p, i) => decisions[i].status !== "rejected",
  );
  const approved = allowed.filter(
    (p) =>
      (options.accepted ?? []).includes(p.id) && purchasable(requirement, p),
  );
  const automatic = products.filter(
    (p, i) => decisions[i].status === "eligible" && purchasable(requirement, p),
  );
  const storeBrand = (p: Product) =>
    /\b(pirkka|k-menu|k menu|rainbow|xtra|coop|kotimaista)\b/i.test(p.name);
  const branded = automatic.filter((p) =>
    options.productPreference === "storeBrand"
      ? storeBrand(p)
      : options.productPreference === "avoidStoreBrand"
        ? !storeBrand(p)
        : true,
  );
  const eligible = approved.length
    ? approved
    : branded.length
      ? branded
      : automatic;
  const line = match(
    requirement,
    allowed,
    eligible.map((p) => p.id),
  );
  const chosen = line.product;
  const pending = decisions.find((d) => d.status === "approval-required");
  line.excluded = decisions.filter(
    (d) => d.reason === "excluded" || d.reason === "dietary-evidence",
  ).length;
  line.matching = {
    category: policy.category,
    status: chosen ? "resolved" : pending ? "approval-required" : "unresolved",
    reason: chosen
      ? approved.length
        ? "approved"
        : "resolved"
      : (pending?.reason ?? decisions[0]?.reason ?? "empty-search"),
    defaulted: policy.defaulted,
    decisions,
  };
  return line;
}
