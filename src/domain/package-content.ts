import { z } from "zod";
import type { Product, Unit } from "./model";

/** Fixed pizza/cube contents; separate from estimated weighed-piece ordering. */
export const packageContentSchema = z
  .object({
    source: z.literal("retailer-label"),
    name: z.string().min(1).max(500),
    label: z.string().min(1).max(500),
    count: z.number().int().positive().max(100),
    weightGrams: z.number().int().positive().max(100_000),
  })
  .strict();
export type PackageContent = z.infer<typeof packageContentSchema>;

/** Pizza may establish a single item; stock cubes always need an explicit count. */
function labelledContent(
  name: string,
  label: string,
  cube: boolean,
): PackageContent | undefined {
  if (
    !(cube
      ? stockCubeName(name)
      : /(?<![\p{L}])(?:pakastepizzat?|pizzat?|pizzas)(?![\p{L}])/iu.test(
          name,
        )) ||
    /mini|pizzapala|pizzapohja|pizzakit|pizzakitti|taikina|dough|slice|base|kit|ateriapakkaus/iu.test(
      name,
    )
  )
    return;
  const parse = (text: string) => {
    const weights = [
      ...text.matchAll(/(?:^|\s|[x×])(\d+(?:[.,]\d+)?)\s*(kg|g)(?=\s|$)/giu),
    ];
    if (weights.length !== 1) return;
    const weight =
      Number(weights[0][1].replace(",", ".")) *
      (weights[0][2].toLowerCase() === "kg" ? 1000 : 1);
    const counts = [...text.matchAll(/(?:^|\s)(\d+)\s*(?:kpl|pcs)(?=\s|$)/giu)];
    const multiple = text.match(/(?:^|\s)(\d+)\s*[x×]\s*\d/iu);
    if (
      (/kpl|pcs/iu.test(text) && counts.length !== 1) ||
      (/\d\s*[x×]/iu.test(text) && !multiple) ||
      (/(?<![\p{L}])(?:[\p{L}-]*pakkaus|[\p{L}-]*pack|tupla[\p{L}-]*|tripla[\p{L}-]*)(?![\p{L}])/iu.test(
        text,
      ) &&
        !counts.length &&
        !multiple) ||
      (/\bpizzat\b|\bpakastepizzat\b|\bpizzas\b/iu.test(name) &&
        !counts.length &&
        !multiple) ||
      (cube && !counts.length && !multiple)
    )
      return;
    if (
      counts.length > 1 ||
      (counts.length &&
        multiple &&
        Number(counts[0][1]) !== Number(multiple[1]))
    )
      return;
    const count = Number(multiple?.[1] ?? counts[0]?.[1] ?? 1);
    return { count, weightGrams: multiple ? count * weight : weight };
  };
  const namedWeight = /\d+(?:[.,]\d+)?\s*(?:kg|g)(?=\s|$)/iu.test(name);
  let facts = parse(
    label !== name && !namedWeight ? `${name} ${label}` : label,
  );
  if (!facts) return;
  if (label !== name && namedWeight) {
    const named = parse(name);
    if (!named || named.weightGrams !== facts.weightGrams) return;
    const explicitCount = (text: string) =>
      /\d+\s*(?:kpl|pcs|[x×])/iu.test(text);
    if (
      explicitCount(name) &&
      explicitCount(label) &&
      named.count !== facts.count
    )
      return;
    if (explicitCount(name) && !explicitCount(label))
      facts = { ...facts, count: named.count };
  }
  const parsed = packageContentSchema.safeParse({
    source: "retailer-label",
    name,
    label,
    ...facts,
  });
  return parsed.success ? parsed.data : undefined;
}

export function stockCubeName(name: string): boolean {
  return (
    /(?<![\p{L}])(?:(?:liha|kasvis|kana|kala)?liemikuutio(?:t|ita)?|(?:beef|vegetable|chicken|fish)\s+stock\s+cubes?)(?![\p{L}])/iu.test(
      name,
    ) &&
    !/jauhe|powder|kastike|sauce|keitto|soup|nestemäinen|liquid/iu.test(name)
  );
}
export function pizzaPackageContent(
  name: string,
  label = name,
): PackageContent | undefined {
  return labelledContent(name, label, false);
}
export function stockCubePackageContent(
  name: string,
  label = name,
): PackageContent | undefined {
  return labelledContent(name, label, true);
}
export function retailerPackageContent(
  name: string,
  label = name,
): PackageContent | undefined {
  return (
    pizzaPackageContent(name, label) ?? stockCubePackageContent(name, label)
  );
}
/** A known mass cannot answer a cube-count request; keep the explicit local confirmation available. */
export function needsPackageCount(product: Product, unit: Unit): boolean {
  return (
    unit === "pcs" &&
    stockCubeName(product.name) &&
    !product.packageContent &&
    !product.pieceOrdering &&
    (product.unit !== "pcs" || !product.packAmount) &&
    ["kpl", "pcs"].includes(product.nativeUnit.toLowerCase())
  );
}

/** Revalidate persisted content claims instead of trusting a count field alone. */
export function packageAmount(product: Product, unit: Unit): number | null {
  if (product.packageContent) {
    const parsed = packageContentSchema.safeParse(product.packageContent);
    if (!parsed.success) return null;
    const source = parsed.data;
    const derived = retailerPackageContent(source.name, source.label);
    if (
      source.name !== product.name ||
      !derived ||
      source.count !== derived.count ||
      source.weightGrams !== derived.weightGrams ||
      product.unit !== "g" ||
      product.packAmount !== source.weightGrams
    )
      return null;
    if (unit === "pcs") {
      const pricing = product.cataloguePricing;
      if (
        !["kpl", "pcs"].includes(product.nativeUnit.toLowerCase()) ||
        product.pieceOrdering ||
        (pricing &&
          (pricing.approximate !== false ||
            ![null, "per_item"].includes(pricing.basis) ||
            !["kpl", "pcs"].includes(pricing.unit?.toLowerCase() ?? "")))
      )
        return null;
      return source.count;
    }
  }
  return product.unit === unit && product.packAmount > 0
    ? product.packAmount
    : null;
}
