import React, { useState } from "react";
import type { Snapshot } from "../application/service";

type Call = (method: string, input?: unknown) => Promise<boolean>;

/**
 * "Repeat this list" for one transferred list in History, or the most recent one from an empty
 * list. It starts a new list from a verified transfer, priced fresh at the selected store, with
 * no AI request. A transfer is shopping intent, not a purchase, and the button says so. When a
 * list is already in progress the shopper confirms first; cancelling changes nothing.
 */
export function RepeatButton({
  snapshot,
  historyId,
  hasList,
  busy,
  call,
  label,
}: {
  snapshot: Snapshot;
  historyId: string;
  hasList: boolean;
  busy: boolean;
  call: Call;
  label?: string;
}) {
  const fi = snapshot.state.language === "fi";
  const tr = (a: string, b: string) => (fi ? a : b);
  const [asking, setAsking] = useState(false);
  const run = async () => {
    setAsking(false);
    await call("repeatList", {
      historyId,
      revision: snapshot.state.revision,
    });
  };
  if (asking)
    return (
      <span className="repeat-confirm" role="group">
        <span>
          {tr(
            "Nykyinen lista arkistoidaan ja tilalle tulee tämä lista.",
            "The current list is archived and this list replaces it.",
          )}{" "}
        </span>
        <button disabled={busy} onClick={() => void run()}>
          {tr("Toista lista", "Repeat the list")}
        </button>{" "}
        <button className="secondary" onClick={() => setAsking(false)}>
          {tr("Peruuta", "Cancel")}
        </button>
      </span>
    );
  return (
    <button
      className="secondary"
      disabled={busy}
      onClick={() => (hasList ? setAsking(true) : void run())}
    >
      {label ?? tr("Toista tämä lista", "Repeat this list")}
    </button>
  );
}

/** What the repeat produced, from `snapshot.repeat`: counts and names, never invented figures. */
export function RepeatSummary({ snapshot }: { snapshot: Snapshot }) {
  const repeat = snapshot.repeat;
  if (!repeat) return null;
  const fi = snapshot.state.language === "fi";
  const tr = (a: string, b: string) => (fi ? a : b);
  const money = (cents: number) =>
    new Intl.NumberFormat(fi ? "fi-FI" : "en-FI", {
      style: "currency",
      currency: "EUR",
    }).format(cents / 100);
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
            `Lista toistettu kauppaan siirretystä listasta ${date}`,
            `List repeated from the list transferred to the store on ${date}`,
          )}
        </strong>
        {" · "}
        {repeat.rows} {tr("riviä", "rows")}
      </p>
      <p className="muted">
        {tr(
          "Siirto ei ole osto. Hinnat haettiin uudelleen, ja listaa voi muokata kuten muitakin.",
          "A transfer is not a purchase. Prices were looked up again, and the list can be edited like any other.",
        )}
      </p>
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
            `${repeat.missingRecipes.length} ateriaa jäi pois, koska reseptiä ei enää ole.`,
            `${repeat.missingRecipes.length} meals were left out because their recipe no longer exists.`,
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
