import type { IntentResult } from "../domain/intents";
import type { BasketLine, Review } from "../domain/model";

/** Local comparison with the last transfer. The store supplies the actual quantities at send time. */
export function compareSentQuantities(
  lines: BasketLine[],
  sent: NonNullable<Review["listSent"]>,
) {
  const wanted = new Map<string, { name: string; packs: number }>();
  for (const line of lines) {
    if (!line.product) continue;
    const { id, name } = line.product;
    const current = wanted.get(id);
    if (current) current.packs += line.packs;
    else wanted.set(id, { name, packs: line.packs });
  }
  const additions = [];
  const previouslySent = [];
  for (const [id, item] of wanted) {
    const credited = Math.min(item.packs, sent[id]?.sent ?? 0);
    if (credited)
      previouslySent.push({ productId: id, name: item.name, packs: credited });
    if (item.packs > credited)
      additions.push({
        productId: id,
        name: item.name,
        packs: item.packs - credited,
      });
  }
  return { additions, previouslySent };
}

/** Other unresolved requests are already represented by their shopping rows. */
export const requestWithoutRow = (result: IntentResult) =>
  result.status !== "resolved" &&
  (result.intent.unresolvedReason !== null ||
    result.reason === "missing-requirement");

export const omittedReviewItems = (review: Review) => [
  ...(review.unresolved ?? []).map((row) => row.name),
  ...(review.unresolvedIntents ?? [])
    .filter(requestWithoutRow)
    .map((result) => result.intent.label),
];
