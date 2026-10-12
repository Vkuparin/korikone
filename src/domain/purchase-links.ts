import type { TransferRecord } from "./memory";
import {
  purchaseLedgerSchema,
  type PurchaseChain,
  type PurchaseEvent,
  type PurchaseLedger,
} from "./purchases";

/**
 * Evidence thresholds for saying that two records are the same purchase. A link is made
 * automatically only when every condition of `strong` holds; anything weaker is offered for
 * review and changes nothing by itself. The earlier rule of half the products within three days
 * is, at most, a review candidate here.
 */
export const linkRules = Object.freeze({
  /** Share of the smaller record's rows that must be found in the other. */
  strongOverlap: 0.8,
  /** Rows that must match before row overlap counts as strong evidence at all. */
  strongRows: 3,
  /** A receipt and an order of the same purchase are at most this many hours apart. */
  orderHours: 36,
  /** A purchase follows its transfer within this many days. */
  transferDays: 7,
  reviewOverlap: 0.5,
  reviewDays: 3,
});
const HOUR = 3_600_000;

const tokens = (label: string) =>
  label
    .toLocaleLowerCase("fi")
    .split(/[^\p{L}]+/u)
    .filter((word) => word.length >= 4);
/** Two labels name the same thing when a word of one begins, or is begun by, a word of the other. */
export const sameGrocery = (a: string, b: string) => sameLabel(a, b);
const sameLabel = (a: string, b: string) => {
  const x = tokens(a),
    y = tokens(b);
  return x.some((p) => y.some((q) => p.startsWith(q) || q.startsWith(p)));
};
/** How many of `rows` have a counterpart in `others`, each counterpart used once. */
function matched(rows: string[], others: string[]) {
  const free = [...others];
  let count = 0;
  for (const row of rows) {
    const at = free.findIndex((other) => sameLabel(row, other));
    if (at >= 0) {
      free.splice(at, 1);
      count++;
    }
  }
  return count;
}
const productLabels = (event: PurchaseEvent) =>
  event.lines.filter((l) => l.role === "product").map((l) => l.label);
const printedTotal = (event: PurchaseEvent) =>
  event.printed.find((p) => p.role === "total")?.amount ?? null;
export const chainOfProvider = (providerId: string): PurchaseChain =>
  ["s-kaupat", "demo-s"].includes(providerId)
    ? "s-group"
    : ["k-ruoka", "demo-k"].includes(providerId)
      ? "k-group"
      : "unknown";

export type LinkCandidate =
  | {
      kind: "purchase";
      /** A receipt and an order, receipt first. */
      eventIds: [string, string];
      strength: "strong" | "review";
      matchedRows: number;
      rows: number;
      sameTotal: boolean | null;
    }
  | {
      kind: "transfer";
      transferId: string;
      eventId: string;
      strength: "strong" | "review";
      matchedRows: number;
      rows: number;
    };

/**
 * Finds records that may be the same purchase: a receipt and an order, or a verified transfer and
 * the purchase that followed it. Pairs the shopper already linked or rejected are left out.
 * Strong candidates are unique by construction: when one record has two strong counterparts,
 * all of them are downgraded to review, because similar trips must not be merged by a guess.
 */
export function linkCandidates(
  ledger: PurchaseLedger,
  transfers: TransferRecord[],
): LinkCandidate[] {
  const decided = new Set([
    ...ledger.links.map((l) => l.eventIds.join("\n")),
    ...ledger.rejectedLinks.map((l) => l.ids.join("\n")),
    ...ledger.transferLinks.map((l) => `${l.transferId}\n${l.eventId}`),
  ]);
  const completed = ledger.events.filter(
    (e) => e.status === "completed" && e.purchasedAt !== null,
  );
  const candidates: LinkCandidate[] = [];
  for (const receipt of completed.filter((e) => e.origin === "receipt"))
    for (const order of completed.filter((e) => e.origin === "order")) {
      if (
        receipt.chain === "unknown" ||
        receipt.chain !== order.chain ||
        decided.has([receipt.id, order.id].sort().join("\n"))
      )
        continue;
      // An order's date is a day; noon stands for it.
      const apart =
        Math.abs(
          Date.parse(receipt.purchasedAt!) -
            (Date.parse(order.purchasedAt!) + 12 * HOUR),
        ) / HOUR;
      const a = productLabels(receipt),
        b = productLabels(order);
      const rows = Math.min(a.length, b.length);
      const matchedRows = a.length <= b.length ? matched(a, b) : matched(b, a);
      const totals = [printedTotal(receipt), printedTotal(order)];
      const sameTotal =
        totals[0] === null || totals[1] === null
          ? null
          : totals[0] === totals[1];
      const overlap = rows ? matchedRows / rows : 0;
      const strong =
        apart <= linkRules.orderHours &&
        sameTotal === true &&
        matchedRows >= linkRules.strongRows &&
        overlap >= linkRules.strongOverlap;
      if (
        strong ||
        (apart <= linkRules.reviewDays * 24 &&
          (sameTotal === true || overlap >= linkRules.reviewOverlap))
      )
        candidates.push({
          kind: "purchase",
          eventIds: [receipt.id, order.id],
          strength: strong ? "strong" : "review",
          matchedRows,
          rows,
          sameTotal,
        });
    }
  for (const transfer of transfers) {
    const chain = chainOfProvider(transfer.storeKey.split(":")[0]);
    const names = transfer.items
      .filter((i) => i.quantity > 0)
      .map((i) => i.name);
    if (chain === "unknown" || !names.length) continue;
    const sent = Date.parse(transfer.date);
    for (const event of completed) {
      const bought = Date.parse(event.purchasedAt!);
      if (
        event.chain !== chain ||
        decided.has(`${transfer.id}\n${event.id}`) ||
        // A day-precision date may read earlier than the transfer made that same day.
        bought < sent - 24 * HOUR ||
        bought > sent + linkRules.transferDays * 24 * HOUR
      )
        continue;
      const matchedRows = matched(names, productLabels(event));
      const overlap = matchedRows / names.length;
      const strong =
        matchedRows >= linkRules.strongRows &&
        overlap >= linkRules.strongOverlap;
      if (strong || overlap >= linkRules.reviewOverlap)
        candidates.push({
          kind: "transfer",
          transferId: transfer.id,
          eventId: event.id,
          strength: strong ? "strong" : "review",
          matchedRows,
          rows: names.length,
        });
    }
  }
  // One record with several strong counterparts has no unique match.
  const sides = (c: LinkCandidate) =>
    c.kind === "purchase"
      ? c.eventIds.map((id) => `event:${id}`)
      : [`transfer:${c.transferId}`, `transfer-event:${c.eventId}`];
  const strongCount = new Map<string, number>();
  for (const c of candidates)
    if (c.strength === "strong")
      for (const side of sides(c))
        strongCount.set(side, (strongCount.get(side) ?? 0) + 1);
  return candidates.map((c) =>
    c.strength === "strong" && sides(c).some((s) => strongCount.get(s)! > 1)
      ? { ...c, strength: "review" as const }
      : c,
  );
}

/** Adds every strong candidate as a link made by rule. Review candidates are left for the shopper. */
export function linkStrong(
  ledger: PurchaseLedger,
  transfers: TransferRecord[],
): { ledger: PurchaseLedger; linked: number; review: LinkCandidate[] } {
  const candidates = linkCandidates(ledger, transfers);
  const strong = candidates.filter((c) => c.strength === "strong");
  const next = strong.length
    ? purchaseLedgerSchema.parse({
        ...ledger,
        links: [
          ...ledger.links,
          ...strong.flatMap((c) =>
            c.kind === "purchase"
              ? [{ eventIds: [...c.eventIds].sort(), by: "rule" as const }]
              : [],
          ),
        ],
        transferLinks: [
          ...ledger.transferLinks,
          ...strong.flatMap((c) =>
            c.kind === "transfer"
              ? [
                  {
                    transferId: c.transferId,
                    eventId: c.eventId,
                    by: "rule" as const,
                  },
                ]
              : [],
          ),
        ],
      })
    : ledger;
  return {
    ledger: next,
    linked: strong.length,
    review: candidates.filter((c) => c.strength === "review"),
  };
}

/** The shopper's answer to a candidate: the same purchase, or not. Either answer is remembered. */
export function decideLink(
  ledger: PurchaseLedger,
  candidate:
    | { kind: "purchase"; eventIds: [string, string] }
    | { kind: "transfer"; transferId: string; eventId: string },
  same: boolean,
): PurchaseLedger {
  const ids =
    candidate.kind === "purchase"
      ? [...candidate.eventIds].sort()
      : [candidate.transferId, candidate.eventId];
  const events =
    candidate.kind === "purchase" ? candidate.eventIds : [candidate.eventId];
  if (events.some((id) => !ledger.events.some((e) => e.id === id)))
    throw new Error("purchaseMissing");
  const key = ids.join("\n");
  const without = {
    ...ledger,
    links: ledger.links.filter((l) => l.eventIds.join("\n") !== key),
    transferLinks: ledger.transferLinks.filter(
      (l) => `${l.transferId}\n${l.eventId}` !== key,
    ),
    rejectedLinks: ledger.rejectedLinks.filter((l) => l.ids.join("\n") !== key),
  };
  const result = purchaseLedgerSchema.safeParse(
    !same
      ? { ...without, rejectedLinks: [...without.rejectedLinks, { ids }] }
      : candidate.kind === "purchase"
        ? {
            ...without,
            links: [...without.links, { eventIds: ids, by: "user" }],
          }
        : {
            ...without,
            transferLinks: [
              ...without.transferLinks,
              {
                transferId: candidate.transferId,
                eventId: candidate.eventId,
                by: "user",
              },
            ],
          },
  );
  if (!result.success) throw new Error("purchaseInvalid");
  return result.data;
}

export type ActualPurchase = {
  /** The linked records of one purchase; a receipt first when there is one. */
  eventIds: string[];
  chain: PurchaseChain;
  purchasedAt: string | null;
  datePrecision: PurchaseEvent["datePrecision"];
  /** The one total that counts: the receipt's printed total, else the order's. Null when unknown. */
  total: number | null;
  totalSource: "receipt" | "order" | null;
  /** Every record's own printed total, so a disagreement stays visible. */
  totals: {
    eventId: string;
    origin: "receipt" | "order";
    total: number | null;
  }[];
  conflictingTotals: boolean;
  /** Printed by the source only; never computed from interpretations. */
  foodSubtotal: number | null;
  nonFoodSubtotal: number | null;
};
/**
 * Completed purchases with linked records counted once. This is the only source of actual
 * spending: a transfer is never in it, linked or not, and neither is a pending or cancelled order.
 */
export function actualPurchases(ledger: PurchaseLedger): ActualPurchase[] {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const up = parent.get(id) ?? id;
    return up === id ? id : find(up);
  };
  for (const link of ledger.links)
    parent.set(find(link.eventIds[0]), find(link.eventIds[1]));
  const groups = new Map<string, PurchaseEvent[]>();
  for (const event of ledger.events) {
    if (event.status !== "completed") continue;
    const root = find(event.id);
    groups.set(root, [...(groups.get(root) ?? []), event]);
  }
  return [...groups.values()].map((events) => {
    const ordered = [...events].sort(
      (a, b) =>
        Number(a.origin === "order") - Number(b.origin === "order") ||
        a.id.localeCompare(b.id),
    );
    const totals = ordered.map((e) => ({
      eventId: e.id,
      origin: e.origin,
      total: printedTotal(e),
    }));
    const known = totals.filter((t) => t.total !== null);
    const authoritative = known[0] ?? null;
    const dated =
      ordered.find((e) => e.datePrecision === "minute") ?? ordered[0];
    const printed = (role: "food" | "non-food") =>
      ordered.flatMap((e) => e.printed).find((p) => p.role === role)?.amount ??
      null;
    return {
      eventIds: ordered.map((e) => e.id),
      chain: dated.chain,
      purchasedAt: dated.purchasedAt,
      datePrecision: dated.datePrecision,
      total: authoritative?.total ?? null,
      totalSource: authoritative?.origin ?? null,
      totals,
      conflictingTotals: new Set(known.map((t) => t.total)).size > 1,
      foodSubtotal: printed("food"),
      nonFoodSubtotal: printed("non-food"),
    };
  });
}

/** Transfers that a linked completed purchase confirms, with the purchase time and who linked it. */
export function confirmedTransfers(ledger: PurchaseLedger) {
  return ledger.transferLinks.flatMap((link) => {
    const event = ledger.events.find((e) => e.id === link.eventId);
    return event?.status === "completed"
      ? [
          {
            transferId: link.transferId,
            eventId: link.eventId,
            by: link.by,
            purchasedAt: event.purchasedAt,
            labels: productLabels(event),
          },
        ]
      : [];
  });
}
