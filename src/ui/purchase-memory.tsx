import React from "react";
import type { Snapshot } from "../application/service";
import { useInsights } from "./insights";

/**
 * What the purchase history says, for inspection: groceries the receipts and orders agree on,
 * how often, and whether only a model read them. Forgetting removes the interpretations, never
 * the receipts or their totals, and nothing here is a saved preference.
 */
export function PurchaseMemory({
  snapshot,
  busy,
  call,
}: {
  snapshot: Snapshot;
  busy: boolean;
  call: (method: string, input?: unknown) => Promise<boolean>;
}) {
  const fi = snapshot.state.language === "fi";
  const tr = (a: string, b: string) => (fi ? a : b);
  const { insights, refresh } = useInsights(snapshot);
  if (!insights || !insights.aliases.length) return null;
  const observed = insights.observedSummaries.length;
  const forgetAll = async () => {
    const result = await window.korikone.listPurchases();
    if (!result.ok) return;
    const { purchases } = (
      result.value as unknown as {
        receipts: { purchases: { eventId: string }[] };
      }
    ).receipts;
    for (const p of purchases)
      await call("deletePurchase", {
        eventId: p.eventId,
        scope: "annotations",
      });
    await refresh();
  };
  return (
    <section
      className="purchase-memory card"
      aria-label={tr("Ostohistoriasta opittu", "Learned from purchases")}
    >
      <h4>{tr("Ostohistoriasta opittu", "Learned from purchase history")}</h4>
      <p className="muted">
        {tr(
          "Nämä ovat havaintoja, eivät mieltymyksiä. Suosiot kerrotaan vain pyynnölle, jossa pyydät tavallisia ostoksiasi, ja nimenomainen mieltymys voittaa aina havainnon.",
          "These are observations, not preferences. They are shared only with a request that asks for your usual groceries, and an explicit preference always wins over an observation.",
        )}{" "}
        {tr(
          `Tekoälylle kelpaavia vahvistettuja havaintoja: ${observed}.`,
          `Confirmed observations that can be shared: ${observed}.`,
        )}
      </p>
      <ul>
        {insights.aliases.map((alias) => {
          // How each printed label reads: the shopper's or a rule's grounded name, a model's
          // proposal, a general name or the label itself. Nothing is called identified.
          const grounded = alias.labels.filter((l) =>
            ["user", "exact", "expanded"].includes(l.display.tier),
          ).length;
          const plain = alias.labels.length - grounded;
          const tentative = alias.context.reason === "model-only";
          return (
            <li key={alias.key} data-reason={alias.context.reason}>
              <strong>
                {alias.display?.text ??
                  alias.key
                    .replace(/^category:|^name:/, "")
                    .replace(/\|/g, ", ")}
              </strong>
              {" · "}
              {alias.observations} {tr("ostoa", "purchases")}
              {" · "}
              {tentative
                ? tr(
                    "tentatiivinen: vain tekoälyn tulkinta, ei vahvistettu",
                    "tentative: a model's reading only, not confirmed",
                  )
                : alias.confirmed
                  ? tr(
                      "vahvistettu säännöllä tai sinun valinnallasi",
                      "confirmed by a rule or by you",
                    )
                  : tr("ei vahvistettu", "not confirmed")}
              {alias.conflictsWithRemembered
                ? ` · ${tr("eri kuin muistettu mieltymys", "differs from a remembered preference")}`
                : ""}
              <br />
              <small className="muted">
                {tr(
                  `Kuiteissa ${alias.labels.length} painettua nimeä: ${grounded} luettavaksi kirjoitettu, ${plain} näkyy sellaisenaan tai yleisellä nimellä.`,
                  `${alias.labels.length} printed names in receipts: ${grounded} written out readably, ${plain} shown as printed or with a general name.`,
                )}
                {alias.labels.length > 0 &&
                  `: ${alias.labels
                    .slice(0, 3)
                    .map((l) => l.display.text)
                    .join(" · ")}`}
              </small>
            </li>
          );
        })}
      </ul>
      <button
        className="secondary"
        disabled={busy}
        onClick={() => void forgetAll()}
      >
        {tr(
          "Unohda kaikki tulkinnat (kuitit säilyvät)",
          "Forget all interpretations (receipts are kept)",
        )}
      </button>
    </section>
  );
}
