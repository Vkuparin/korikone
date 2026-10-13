import type {
  MerchandiseAttribute,
  MerchandiseIntent,
} from "../domain/merchandise";

/**
 * Finite development reading of a non-food request, shared by the planning and edit fixtures:
 * rubber boots, a frying pan and batteries, in Finnish and English. An attribute is taken only
 * as the shopper wrote it; boots without a size get `size` in `missing`.
 */
export function merchandiseFixture(
  quote: string,
): { name: string; merchandise: MerchandiseIntent } | null {
  const attribute = (
    kind: MerchandiseAttribute["kind"],
    match: RegExpMatchArray | null,
  ): MerchandiseAttribute[] =>
    match
      ? [{ kind, value: match[1].trim(), provenance: "explicit-note" }]
      : [];
  const intent = (
    name: string,
    family: string,
    attributes: MerchandiseAttribute[],
    missing: MerchandiseIntent["missing"] = [],
  ) => ({
    name,
    merchandise: { version: 1 as const, family, attributes, missing },
  });
  if (/kumisaap|rubber boots?/i.test(quote)) {
    const size = attribute(
      "size",
      quote.match(/(?:koko|kokoa|size)\s*(\d{2})(?!\d)/i),
    );
    return intent(
      "Kumisaapas",
      /rubber/i.test(quote) ? "rubber boots" : "kumisaapas",
      size,
      size.length ? [] : ["size"],
    );
  }
  if (/paistinpannu|frying pan/i.test(quote))
    return intent(
      "Paistinpannu",
      /frying/i.test(quote) ? "frying pan" : "paistinpannu",
      attribute("spec", quote.match(/(\d{2}\s?cm)(?![\p{L}\p{N}])/iu)),
    );
  if (/paristo|batter/i.test(quote))
    return intent(
      "Alkaliparisto",
      /batter/i.test(quote) ? "batteries" : "paristo",
      attribute("model", quote.match(/(?<![\p{L}])(AAA|AA)(?![\p{L}])/u)),
    );
  return null;
}
