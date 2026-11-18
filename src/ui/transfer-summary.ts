import type { IntentResult } from "../domain/intents";
import type { BasketLine, Review } from "../domain/model";
import { count } from "./i18n";

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
  const excess = Object.entries(sent).flatMap(([productId, entry]) => {
    const packs = entry.sent - (wanted.get(productId)?.packs ?? 0);
    return packs > 0 ? [{ productId, packs }] : [];
  });
  return { additions, previouslySent, excess };
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

/** Uses the same quoted rows and previous transfer as the shopping footer. */
export function editTransferHint(input: {
  fi: boolean;
  rows: number;
  ready: number;
  quoted: boolean;
  needsLogin: boolean;
  transferStatus: "sent" | "partial" | "review" | null;
  additionalPacks?: number;
  omitted: string[];
  manual: string[];
  hasMissingProducts: boolean;
}) {
  const { fi, omitted, manual } = input;
  const tr = (finnish: string, english: string) => (fi ? finnish : english);
  if (input.transferStatus) {
    const messages = {
      sent: tr(
        "Tämä lista on jo siirretty kauppaan.",
        "This list has already been sent to the store.",
      ),
      partial: tr(
        "Edellinen siirto jäi kesken.",
        "The previous transfer was interrupted.",
      ),
      review: tr("Tarkista siirron tiedot.", "Review the current transfer."),
    };
    return { target: "status", text: messages[input.transferStatus] } as const;
  }
  if (!input.rows && !omitted.length)
    return {
      target: "composer",
      text: tr(
        "Listalla ei ole siirrettäviä ostoksia.",
        "There are no items to send.",
      ),
    } as const;
  if (input.rows && !input.quoted)
    return {
      target: "prices",
      text: tr(
        "Hae tuotteet ja hinnat ennen siirtoa.",
        "Look up products and prices before sending.",
      ),
    } as const;
  const notes: string[] = [];
  if (!input.ready)
    notes.push(tr("Ei siirrettäviä tuotteita.", "No products ready to send."));
  else if (input.needsLogin)
    notes.push(
      tr(
        "Kirjaudu kauppaan ennen siirtoa.",
        "Sign in to the store before sending.",
      ),
    );
  else if (input.additionalPacks === 0)
    notes.push(
      tr(
        "Listalla ei ole lisäpakkauksia siirrettäväksi.",
        "There are no additional packs to send.",
      ),
    );
  else if (input.additionalPacks !== undefined)
    notes.push(
      count(
        input.additionalPacks,
        fi,
        ["lisäpakkaus siirrettävänä", "lisäpakkausta siirrettävänä"],
        ["additional pack to send", "additional packs to send"],
      ),
    );
  else
    notes.push(
      count(
        input.ready,
        fi,
        ["tuote valmis siirtoon", "tuotetta valmiina siirtoon"],
        ["product ready to send", "products ready to send"],
      ),
    );
  if (omitted.length)
    notes.push(
      tr("Jää pois siirrosta", "Left out of transfer") +
        " · " +
        shortNames(omitted),
    );
  if (manual.length)
    notes.push(
      tr("Lisää itse kaupassa", "Add at the store") +
        " · " +
        shortNames(manual),
    );
  const target = input.hasMissingProducts
    ? "review"
    : input.needsLogin && input.ready
      ? "settings"
      : omitted.length || manual.length || !input.ready
        ? "list"
        : "transfer";
  return { target, text: notes.join("\n") } as const;
}

function shortNames(names: string[]) {
  return names.length > 3
    ? `${names.slice(0, 3).join(", ")} (+${names.length - 3})`
    : names.join(", ");
}
