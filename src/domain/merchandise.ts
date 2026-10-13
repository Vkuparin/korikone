import { z } from "zod";

/**
 * Non-food requests (F22.3). A non-food request is an ordinary shopping row, counted in pieces,
 * that also carries a merchandise intent: the product family the shopper named and the attributes
 * the product must have. It is not a second grocery model: the row keeps its ID, unit, amount,
 * edit target and place in backups, and a row without an intent behaves exactly as before.
 */
export const MERCHANDISE_VERSION = 1;
export const merchandiseLimits = Object.freeze({
  attributes: 6,
  valueCharacters: 40,
  familyCharacters: 80,
});
export const merchandiseAttributeKinds = [
  "size",
  "colour",
  "model",
  "material",
  "spec",
] as const;
export const merchandiseAttributeSchema = z
  .object({
    kind: z.enum(merchandiseAttributeKinds),
    value: z.string().trim().min(1).max(merchandiseLimits.valueCharacters),
    /**
     * explicit-note: the shopper wrote it in the request. clarified: the shopper answered a
     * question about it. Nothing a model assumed is ever an attribute.
     */
    provenance: z.enum(["explicit-note", "clarified"]),
  })
  .strict();
export type MerchandiseAttribute = z.infer<typeof merchandiseAttributeSchema>;
export const merchandiseIntentSchema = z
  .object({
    version: z.literal(MERCHANDISE_VERSION),
    /** The kind of product in the shopper's words, in base form: "kumisaapas", "paistinpannu". */
    family: z.string().trim().min(2).max(merchandiseLimits.familyCharacters),
    /** What the product must have. Every listed attribute is a hard requirement. */
    attributes: z
      .array(merchandiseAttributeSchema)
      .max(merchandiseLimits.attributes),
    /**
     * Attribute kinds this family cannot be bought without and the shopper has not given, such as
     * the size of boots. While any is listed the row is not searched or priced.
     */
    missing: z
      .array(z.enum(merchandiseAttributeKinds))
      .max(merchandiseLimits.attributes),
  })
  .strict()
  .refine(
    (intent) =>
      new Set(intent.attributes.map((a) => a.kind)).size ===
        intent.attributes.length &&
      new Set(intent.missing).size === intent.missing.length &&
      !intent.missing.some((kind) =>
        intent.attributes.some((a) => a.kind === kind),
      ),
  );
export type MerchandiseIntent = z.infer<typeof merchandiseIntentSchema>;

/**
 * What a store's answer establishes for one non-food row. Each value is a different statement and
 * none may be shown as another.
 */
export const merchandiseStatusSchema = z.enum([
  /** The requested variant is listed at this store and reported available. */
  "exact-available",
  /** The family is listed at this store, but no listed product is evidenced as the variant. */
  "variant-missing",
  /** This store's search returned nothing of the family. Says nothing about other stores. */
  "not-listed-here",
  /** The requested variant is listed and reported not available. */
  "out-of-stock",
  /** The variant is listed and the store did not say whether it is available. */
  "unknown",
  /** The provider cannot search non-food products at all. */
  "unsupported",
  /** The operation needs a sign-in that is not there. */
  "signed-out",
  /** The search failed; nothing is known. */
  "failed",
  /** The answer belongs to another store or an older list and is not used. */
  "stale",
]);
export type MerchandiseStatus = z.infer<typeof merchandiseStatusSchema>;

/**
 * What a provider can do for non-food products, per operation. Search results never imply the
 * ability to write: `cartWrite` is true only where a basket write is verified for such products.
 */
export const merchandiseCapabilitiesSchema = z
  .object({
    /** Store-scoped product discovery. */
    discovery: z.boolean(),
    /** How a variant is evidenced: by fields, by the printed name only, or not at all. */
    variants: z.enum(["structured", "name", "none"]),
    /** Whether availability is reported, as a flag with unknown allowed. Never a quantity. */
    stock: z.enum(["flag", "none"]),
    cartWrite: z.boolean(),
  })
  .strict();
export type MerchandiseCapabilities = z.infer<
  typeof merchandiseCapabilitiesSchema
>;
export const noMerchandise: MerchandiseCapabilities = Object.freeze({
  discovery: false,
  variants: "none",
  stock: "none",
  cartWrite: false,
});

/** Store evidence carried on a product that was read for a non-food row. All of it is optional. */
export const merchandiseEvidenceSchema = z
  .object({
    brand: z.string().min(1).max(80).nullable(),
    /** In the shop, and orderable online, as the store reports them; null when it does not say. */
    inStore: z.boolean().nullable(),
    online: z.boolean().nullable(),
  })
  .strict();
export type MerchandiseEvidence = z.infer<typeof merchandiseEvidenceSchema>;

/**
 * Attribute kinds a family cannot be bought without. Footwear and clothing need a size; nothing
 * else is assumed to need anything. A required kind the shopper has not given is asked for, never
 * guessed.
 */
export function requiredMerchandiseKinds(
  family: string,
): MerchandiseAttribute["kind"][] {
  return /saap|saappa|kenk|kengä|tossu|sandaal|lenkkar|housu|farku|takki|paita|hanska|käsine|lapas|sukka|sukat|pipo|haalar|boots?\b|shoes?\b|sneakers?\b|trousers|jeans|jacket|shirt|gloves?\b|mittens?\b|socks?\b/iu.test(
    family,
  )
    ? ["size"]
    : [];
}
/** Whether a value is in a text as consecutive whole words, ignoring case. */
export function printedIn(text: string, value: string) {
  return printed(words(text), value);
}
const words = (text: string) =>
  text
    .toLocaleLowerCase("fi")
    .normalize("NFC")
    .split(/[^\p{L}\p{N},.]+/u)
    .map((w) => w.replace(/^[.,]+|[.,]+$/g, ""))
    .filter(Boolean);
/** A value such as "28 cm" or "AA" printed as consecutive whole words: "32" is not in "320". */
function printed(name: string[], value: string) {
  const wanted = words(value);
  return (
    wanted.length > 0 &&
    name.some((_, at) => wanted.every((w, i) => name[at + i] === w))
  );
}
const colours = [
  "musta",
  "valkoinen",
  "harmaa",
  "sininen",
  "punainen",
  "vihreä",
  "keltainen",
  "oranssi",
  "ruskea",
  "pinkki",
  "violetti",
  "beige",
  "black",
  "white",
  "grey",
  "blue",
  "red",
  "green",
  "yellow",
  "orange",
  "brown",
  "pink",
  "purple",
];
/**
 * Whether a product's printed name evidences one attribute. `printed`: the value is in the name.
 * `conflict`: the name prints another value of that attribute, such as another size after "koko"
 * or another colour. `absent`: the name says nothing about it, which proves nothing either way.
 */
export function attributeEvidence(
  productName: string,
  attribute: Pick<MerchandiseAttribute, "kind" | "value">,
): "printed" | "conflict" | "absent" {
  const name = words(productName);
  if (printed(name, attribute.value)) return "printed";
  if (attribute.kind === "size") {
    const at = name.findIndex((w) => w === "koko" || w === "size");
    return at >= 0 && name[at + 1] ? "conflict" : "absent";
  }
  if (attribute.kind === "colour")
    return name.some((w) => colours.includes(w)) ? "conflict" : "absent";
  return "absent";
}
/**
 * How a listed product relates to the requested variant: `exact` when its name prints every
 * required attribute, `other` when it prints a different value for one, `unverified` when it is
 * silent about at least one and contradicts none. Only `exact` may ever be chosen for the row.
 */
export function variantMatch(
  productName: string,
  intent: Pick<MerchandiseIntent, "attributes">,
): "exact" | "other" | "unverified" {
  const evidence = intent.attributes.map((a) =>
    attributeEvidence(productName, a),
  );
  return evidence.includes("conflict")
    ? "other"
    : evidence.includes("absent")
      ? "unverified"
      : "exact";
}
/** What one store search returned for a non-food row, as the adapter and application report it. */
export type MerchandiseSearch =
  | {
      kind: "results";
      /** Products of the requested family listed at the store, with their reported availability. */
      products: { name: string; available: boolean | null }[];
    }
  | { kind: "unsupported" | "signed-out" | "failed" | "stale" };
/**
 * Turns a search into the one statement it supports. Unknown availability stays `unknown`: it is
 * never read as in stock, and an empty answer is only ever "not listed at this store".
 */
export function merchandiseStatus(
  intent: Pick<MerchandiseIntent, "attributes">,
  search: MerchandiseSearch,
): MerchandiseStatus {
  if (search.kind !== "results") return search.kind;
  if (!search.products.length) return "not-listed-here";
  const exact = search.products.filter(
    (p) => variantMatch(p.name, intent) === "exact",
  );
  if (!exact.length) return "variant-missing";
  if (exact.some((p) => p.available === true)) return "exact-available";
  return exact.some((p) => p.available === null) ? "unknown" : "out-of-stock";
}
