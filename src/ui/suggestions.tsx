import React, { useState } from "react";
import type { Snapshot } from "../application/service";
import type { AppState } from "../domain/model";
import type { Insights } from "./insights";

type Suggestion = Insights["suggestions"][number];

/**
 * Recurring-item suggestions from the shopper's own purchase history. A suggestion is evidence
 * with its period; it adds nothing by itself. "Add as regular item" is the existing explicit
 * recurring-item save, with an amount the shopper confirms.
 */
export function RecurringSuggestions({
  snapshot,
  suggestions,
  busy,
  save,
  call,
  refresh,
}: {
  snapshot: Snapshot;
  suggestions: Suggestion[];
  busy: boolean;
  save: (state: AppState) => Promise<boolean>;
  call: (method: string, input?: unknown) => Promise<boolean>;
  refresh: () => Promise<void>;
}) {
  const { state } = snapshot;
  const fi = state.language === "fi";
  const tr = (a: string, b: string) => (fi ? a : b);
  const day = (iso: string) =>
    new Date(iso).toLocaleDateString(fi ? "fi-FI" : "en-FI");
  if (!suggestions.length) return null;
  return (
    <div
      className="suggestions"
      aria-label={tr(
        "Ehdotukset ostohistoriasta",
        "Suggestions from purchase history",
      )}
    >
      <h3>{tr("Ostat usein", "You buy these often")}</h3>
      {suggestions.map((s) => (
        <SuggestionRow
          key={s.key}
          fi={fi}
          tr={tr}
          day={day}
          suggestion={s}
          busy={busy}
          onAccept={async (amount, unit) => {
            const ok = await save({
              ...state,
              staples: [
                ...state.staples,
                {
                  id: crypto.randomUUID(),
                  name: s.name ?? s.label,
                  amount,
                  unit,
                  everyDays: Math.min(
                    365,
                    Math.max(1, Math.round(s.medianGapDays ?? 7)),
                  ),
                  lastPurchased: null,
                  enabled: true,
                },
              ],
            });
            if (ok) await refresh();
          }}
          onDismiss={async () => {
            if (await call("dismissSuggestion", { key: s.key }))
              await refresh();
          }}
        />
      ))}
    </div>
  );
}

function SuggestionRow({
  fi,
  tr,
  day,
  suggestion: s,
  busy,
  onAccept,
  onDismiss,
}: {
  fi: boolean;
  tr: (a: string, b: string) => string;
  day: (iso: string) => string;
  suggestion: Suggestion;
  busy: boolean;
  onAccept: (amount: number, unit: "pcs" | "g" | "ml") => Promise<void>;
  onDismiss: () => Promise<void>;
}) {
  const [amount, setAmount] = useState(
    s.typical ? String(s.typical.amount) : "",
  );
  const [unit, setUnit] = useState<"pcs" | "g" | "ml">(
    s.typical?.unit === "pcs" || s.typical?.unit === "ml"
      ? s.typical.unit
      : "g",
  );
  const value = Number(amount.replace(",", "."));
  const valid = Number.isInteger(value) && value > 0;
  const unitText = (u: string) => (u === "pcs" ? tr("kpl", "pcs") : u);
  return (
    <article className="suggestion card">
      <strong>{s.display?.text ?? s.label}</strong>
      <p className="muted">
        {tr(
          `Ostettu ${s.weeksOfLastEight} viikolla viimeisestä kahdeksasta`,
          `Bought in ${s.weeksOfLastEight} of the last 8 weeks`,
        )}
        {s.medianGapDays !== null
          ? ` · ${tr("väli noin", "about every")} ${Math.round(s.medianGapDays)} ${tr("pv", "days")}`
          : ""}
        {" · "}
        {s.visits} {tr("ostoa", "purchases")} {day(s.from)}–{day(s.to)}
      </p>
      <p className="muted">
        {s.typical
          ? `${tr("Tyypillinen määrä", "Typical quantity")}: ${s.typical.amount} ${unitText(s.typical.unit)} (${s.typical.min}–${s.typical.max}, ${s.typical.visits} ${tr("ostoa", "purchases")})`
          : tr(
              "Tyypillinen määrä ei ole tiedossa: ostot eivät ole vertailukelpoisia.",
              "Typical quantity is unknown: the purchases are not comparable.",
            )}
      </p>
      <form
        className="inline"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) void onAccept(value, unit);
        }}
      >
        <label>
          {tr("Määrä", "Amount")}
          <input
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <select
          aria-label={tr("Yksikkö", "Unit")}
          value={unit}
          onChange={(e) => setUnit(e.target.value as typeof unit)}
        >
          <option value="g">g</option>
          <option value="ml">ml</option>
          <option value="pcs">{tr("kpl", "pcs")}</option>
        </select>
        <button disabled={busy || !valid}>
          {tr("Lisää vakiotuotteeksi", "Add as regular item")}
        </button>
        <button
          type="button"
          className="text"
          disabled={busy}
          onClick={() => void onDismiss()}
        >
          {tr("Ei nyt", "Not now")}
        </button>
      </form>
    </article>
  );
}
