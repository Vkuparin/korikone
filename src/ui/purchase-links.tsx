import React from "react";
import type { Snapshot } from "../application/service";
import type { Insights } from "./insights";

type Candidate = Insights["linkReview"][number];

/**
 * Weak matches between a verified transfer and a purchase, or between a receipt and an order,
 * for the shopper to decide. Strong matches are linked on import and need nothing; a weak one
 * never counts as one purchase until the shopper says so, and the answer is kept either way.
 */
export function LinkReview({
  insights,
  snapshot,
  busy,
  call,
  refresh,
}: {
  insights: Insights;
  snapshot: Snapshot;
  busy: boolean;
  call: (method: string, input?: unknown) => Promise<boolean>;
  refresh: () => Promise<void>;
}) {
  const fi = snapshot.state.language === "fi";
  const tr = (a: string, b: string) => (fi ? a : b);
  if (!insights.linkReview.length) return null;
  const day = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleDateString(fi ? "fi-FI" : "en-FI")
      : tr("päiväys tuntematon", "date unknown");
  const money = (cents: number | null) =>
    cents === null
      ? tr("summa tuntematon", "total unknown")
      : new Intl.NumberFormat(fi ? "fi-FI" : "en-FI", {
          style: "currency",
          currency: "EUR",
        }).format(cents / 100);
  const purchaseOf = (eventId: string) =>
    insights.actualPurchases.find((p) => p.eventIds.includes(eventId));
  const describe = (candidate: Candidate) => {
    if (candidate.kind === "transfer") {
      const transfer = insights.transfers.find(
        (t) => t.id === candidate.transferId,
      );
      const purchase = purchaseOf(candidate.eventId);
      return tr(
        `Siirto ${day(transfer?.date ?? null)} ja ostos ${day(purchase?.purchasedAt ?? null)} (${money(purchase?.total ?? null)}): ${candidate.matchedRows} / ${candidate.rows} tuotetta vastaa.`,
        `Transfer on ${day(transfer?.date ?? null)} and purchase on ${day(purchase?.purchasedAt ?? null)} (${money(purchase?.total ?? null)}): ${candidate.matchedRows} of ${candidate.rows} products match.`,
      );
    }
    const [receipt, order] = candidate.eventIds.map(purchaseOf);
    const totals = candidate.sameTotal
      ? tr("sama loppusumma", "same total")
      : candidate.sameTotal === false
        ? tr("eri loppusumma", "different total")
        : tr("loppusumma ei tiedossa", "total unknown");
    return tr(
      `Kuitti ${day(receipt?.purchasedAt ?? null)} ja tilaus ${day(order?.purchasedAt ?? null)}: ${candidate.matchedRows} / ${candidate.rows} riviä vastaa, ${totals}.`,
      `Receipt on ${day(receipt?.purchasedAt ?? null)} and order on ${day(order?.purchasedAt ?? null)}: ${candidate.matchedRows} of ${candidate.rows} rows match, ${totals}.`,
    );
  };
  const decide = async (candidate: Candidate, same: boolean) => {
    const answer =
      candidate.kind === "transfer"
        ? {
            kind: "transfer" as const,
            transferId: candidate.transferId,
            eventId: candidate.eventId,
          }
        : { kind: "purchase" as const, eventIds: candidate.eventIds };
    if (await call("decidePurchaseLink", { candidate: answer, same }))
      await refresh();
  };
  return (
    <section
      className="link-review card"
      aria-label={tr("Tarkistettavat yhteydet", "Links to review")}
    >
      <h2>
        {tr("Onko kyseessä sama ostos?", "Is this the same purchase?")} (
        {insights.linkReview.length})
      </h2>
      <p className="muted">
        {tr(
          "Nämä vastaavat toisiaan vain osittain, joten niitä ei yhdistetty automaattisesti. Siirto ei yksin ole osto. Vastauksesi säilyy.",
          "These only partly match, so they were not linked automatically. A transfer alone is not a purchase. Your answer is kept.",
        )}
      </p>
      {insights.linkReview.map((candidate, i) => (
        <div className="link-candidate" key={i}>
          <p>{describe(candidate)}</p>
          <div className="actions">
            <button
              disabled={busy}
              onClick={() => void decide(candidate, true)}
            >
              {tr("Sama ostos", "Same purchase")}
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void decide(candidate, false)}
            >
              {tr("Eri ostos", "Different purchase")}
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}

/** Whether evidence has confirmed a transfer as bought, is waiting on the shopper, or neither. */
export function transferSignal(
  snapshot: Snapshot,
  transferId: string,
): "confirmed" | "review" | null {
  return (
    snapshot.purchaseSignals.find((s) => s.transferId === transferId)
      ?.strength ?? null
  );
}
