import React, { useMemo, useRef, useState } from "react";
import type { Snapshot } from "../application/service";
import { requirementKey } from "../domain/edits";
import type { AppState } from "../domain/model";
import { reusableGroceries } from "../domain/repeat";
import { count, unitLabel } from "./i18n";

type HistoryEntry = AppState["listHistory"][number];

function isOrder(snapshot: Snapshot, entry: HistoryEntry) {
  return (
    !!entry.orderPlacedAt ||
    snapshot.purchaseSignals.some(
      (s) => s.transferId === entry.id && s.strength === "confirmed",
    )
  );
}

export function RepeatButton({
  snapshot,
  entry,
  replacing,
  busy,
  repeat,
  latest = false,
}: {
  snapshot: Snapshot;
  entry: HistoryEntry;
  replacing: boolean;
  busy: boolean;
  repeat: (rowKeys?: string[]) => Promise<boolean>;
  latest?: boolean;
}) {
  const fi = snapshot.state.language === "fi";
  const tr = (a: string, b: string) => (fi ? a : b);
  const [mode, setMode] = useState<"whole" | "items" | null>(null);
  const [keys, setKeys] = useState<string[]>([]);
  const opener = useRef<HTMLButtonElement | null>(null);
  const rows = useMemo(
    () => (mode === "items" ? reusableGroceries(snapshot.state, entry) : []),
    [mode, snapshot.state, entry],
  );
  const cancel = () => {
    setMode(null);
    setKeys([]);
    requestAnimationFrame(() => opener.current?.focus());
  };
  const run = async (selected?: string[]) => {
    if (await repeat(selected)) {
      setKeys([]);
      setMode(null);
    }
  };
  const placed = isOrder(snapshot, entry);
  const choose = placed
    ? latest
      ? tr(
          "Valitse ostoksia viime tilauksesta",
          "Choose items from your last order",
        )
      : tr("Valitse ostoksia tilauksesta", "Choose items from this order")
    : latest
      ? tr(
          "Valitse ostoksia edelliseltä listalta",
          "Choose items from your last list",
        )
      : tr("Valitse ostoksia listalta", "Choose items from this list");
  const warning = tr(
    "Tämä korvaa nykyisen listan ja lähettämättömän tekstin. Alkuperäinen lista säilyy historiassa.",
    "This replaces your current list and any unsent text. The original entry stays in History.",
  );
  return (
    <>
      <button
        type="button"
        className="secondary"
        disabled={busy}
        aria-expanded={mode === "items"}
        onClick={(e) => {
          opener.current = e.currentTarget;
          if (mode === "items") cancel();
          else setMode("items");
        }}
      >
        {choose}
      </button>
      <button
        type="button"
        className="secondary"
        disabled={busy}
        onClick={(e) => {
          opener.current = e.currentTarget;
          if (replacing) setMode("whole");
          else void run();
        }}
      >
        {latest
          ? tr(
              "Toista viimeksi kauppaan siirretty lista",
              "Repeat the list last transferred to the store",
            )
          : tr("Toista koko lista", "Repeat the whole list")}
      </button>
      {mode && (
        <div
          className="repeat-options"
          role="group"
          aria-label={
            mode === "items"
              ? choose
              : tr("Toista koko lista", "Repeat the whole list")
          }
        >
          {mode === "items" && (
            <fieldset>
              <legend>
                {tr("Ostokset uudelle listalle", "Items for your new list")}
              </legend>
              {!entry.sentGroceries && (
                <p className="muted">
                  {tr(
                    "Vaihtoehdot ovat vanhalle ostoslistalle tallennettuja aineksia.",
                    "These choices come from the groceries saved on the original list.",
                  )}
                </p>
              )}
              {rows.map((row, index) => {
                const key = requirementKey(row);
                return (
                  <label key={key}>
                    <input
                      type="checkbox"
                      autoFocus={index === 0}
                      disabled={busy}
                      checked={keys.includes(key)}
                      onChange={(e) =>
                        setKeys(
                          e.target.checked
                            ? [...keys, key]
                            : keys.filter((k) => k !== key),
                        )
                      }
                    />
                    {row.name} · {row.amount}{" "}
                    {unitLabel(row.unit, snapshot.state.language)}
                  </label>
                );
              })}
              {!rows.length && (
                <p>
                  {tr(
                    "Yksittäisiä ostoksia ei ole tallennettu. Voit toistaa koko listan.",
                    "This entry has no saved groceries to choose from. You can repeat the whole list.",
                  )}
                </p>
              )}
            </fieldset>
          )}
          {replacing && <p>{warning}</p>}
          <div className="actions">
            <button
              type="button"
              disabled={busy || (mode === "items" && !keys.length)}
              onClick={() => void run(mode === "items" ? keys : undefined)}
            >
              {mode === "items"
                ? tr(
                    "Aloita lista valituista",
                    "Start list with selected items",
                  )
                : tr("Toista lista", "Repeat the list")}
            </button>
            <button
              className="secondary"
              type="button"
              disabled={busy}
              onClick={cancel}
            >
              {tr("Peruuta", "Cancel")}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/** What the repeat produced, from `snapshot.repeat`: counts and names, never invented figures. */
export function RepeatSummary({
  snapshot,
  adjust,
}: {
  snapshot: Snapshot;
  adjust: () => void;
}) {
  const repeat = snapshot.repeat;
  if (!repeat) return null;
  const fi = snapshot.state.language === "fi";
  const tr = (a: string, b: string) => (fi ? a : b);
  const money = (cents: number) =>
    new Intl.NumberFormat(fi ? "fi-FI" : "en-FI", {
      style: "currency",
      currency: "EUR",
    }).format(cents / 100);
  const source = snapshot.state.listHistory.find(
    (entry) => entry.id === repeat.historyId,
  );
  const placed = source && isOrder(snapshot, source);
  const date = new Date(repeat.transferredAt).toLocaleDateString(
    fi ? "fi-FI" : "en-FI",
  );
  return (
    <section
      className="repeat-summary card"
      role="status"
      aria-label={tr("Toistettu lista", "Repeated list")}
    >
      <p>
        <strong>
          {tr(
            `${placed ? "Tilauksen" : "Siirretyn listan"} ostoksia uudella listalla · ${date}`,
            `Groceries from your ${placed ? "order" : "transferred list"} on ${date}`,
          )}
        </strong>
        {" · "}
        {count(repeat.rows, fi, ["rivi", "riviä"], ["row", "rows"])}
      </p>
      <p className="muted">
        {tr(
          "Hinnat on päivitetty. Muuta määriä listalla tai kerro tekoälylle, mitä haluat lisätä tai poistaa.",
          "Prices are up to date. Adjust quantities on the list or tell the AI what to add or remove.",
        )}
      </p>
      {repeat.rows > 0 && (
        <button className="text" type="button" onClick={adjust}>
          {tr("Muuta määriä listalla", "Adjust quantities on the list")}
        </button>
      )}
      {repeat.unresolvedRows > 0 && (
        <p>
          {repeat.unresolvedRows}{" "}
          {tr(
            "riville ei löytynyt tuotetta tai hintaa tässä kaupassa.",
            "rows have no product or price at this store.",
          )}
        </p>
      )}
      {repeat.storeChanged && (
        <p>
          {tr(
            "Lista siirrettiin eri kaupassa, joten vanhoja hintoja ei verrata.",
            "The list was transferred at another store, so earlier prices are not compared.",
          )}
        </p>
      )}
      {repeat.partialHistory && (
        <p>
          {tr(
            "Tämä vanha tallenne on osittainen: kauppa tai siirretyt tuotteet eivät ole tiedossa.",
            "This older record is partial: the store or the transferred products are unknown.",
          )}
        </p>
      )}
      {repeat.missingRecipes.length > 0 && (
        <p>
          {tr(
            `${count(repeat.missingRecipes.length, true, ["ateria jäi pois, koska sen reseptiä", "ateriaa jäi pois, koska niiden reseptiä"], ["", ""])} ei enää ole.`,
            `${count(repeat.missingRecipes.length, false, ["", ""], ["meal was left out because its recipe", "meals were left out because their recipe"])} no longer exists.`,
          )}
        </p>
      )}
      {repeat.changedPrices.length > 0 && (
        <details>
          <summary>
            {tr("Muuttuneet hinnat", "Changed prices")} (
            {repeat.changedPrices.length})
          </summary>
          <ul>
            {repeat.changedPrices.map((p) => (
              <li key={p.name}>
                {p.name}: {money(p.before)} → {money(p.now)}
              </li>
            ))}
          </ul>
        </details>
      )}
      {repeat.notSelected.length > 0 && (
        <details>
          <summary>
            {tr(
              "Tuotteet, joita ei valittu uudelleen",
              "Products not chosen again",
            )}{" "}
            ({repeat.notSelected.length})
          </summary>
          <ul>
            {repeat.notSelected.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
