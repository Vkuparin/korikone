import React, { useState } from "react";
import type { Snapshot } from "../application/service";
import { isLive } from "../stores/provider";

const chainName = (providerId: string) =>
  providerId === "s-kaupat" ? "S-kaupat" : "K-Ruoka";

export const feeRange = (
  fee: { min: number; max: number },
  money: (cents: number) => string,
) =>
  fee.min === fee.max ? money(fee.min) : `${money(fee.min)}–${money(fee.max)}`;

/** True when both chains are signed in and the other chain has a store chosen. */
export function canCompare(snapshot: Snapshot) {
  const { state } = snapshot;
  const active = state.context.providerId;
  const other = Object.values(state.stores).find(
    (s) => isLive(s.providerId) && s.providerId !== active,
  );
  return (
    isLive(active) &&
    !!other &&
    snapshot.storeLogins[active] === "signedIn" &&
    snapshot.storeLogins[other.providerId] === "signedIn"
  );
}

/** "Compare stores" under the total: the same list priced at the other chain, read-only. */
export function ComparePanel({
  snapshot,
  busy,
  call,
  tr,
  money,
}: {
  snapshot: Snapshot;
  busy: boolean;
  call: (method: string, input?: unknown) => Promise<boolean>;
  tr: (fi: string, en: string) => string;
  money: (cents: number) => string;
}) {
  const [open, setOpen] = useState(false);
  const { state, comparison } = snapshot;
  if (!open || !comparison)
    return (
      <button
        className="secondary"
        disabled={busy || !snapshot.basket.length}
        onClick={async () => {
          if (await call("compareStores")) setOpen(true);
        }}
      >
        {tr("Vertaa kauppoja", "Compare stores")}
      </button>
    );
  const { result, other, fees } = comparison;
  const fee = (range: { min: number; max: number } | null) =>
    range ? feeRange(range, money) : tr("ei tiedossa", "not known");
  const a = chainName(state.context.providerId);
  const b = chainName(other.providerId);
  const missing = (count: number) =>
    count ? ` · ${count} ${tr("ilman hintaa", "without a price")}` : "";
  return (
    <section
      className="comparison"
      aria-label={tr("Kauppojen vertailu", "Store comparison")}
    >
      <table>
        <thead>
          <tr>
            <th />
            <th scope="col">{a}</th>
            <th scope="col">{b}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">
              {tr("Molemmissa hinnoitellut", "Priced at both")} (
              {result.common.rows})
            </th>
            <td>{money(result.common.a)}</td>
            <td>{money(result.common.b)}</td>
          </tr>
          <tr>
            <th scope="row">{tr("Kaikki hinnoitellut", "All priced")}</th>
            <td>
              {money(result.a.priced)}
              {missing(result.a.missing)}
            </td>
            <td>
              {money(result.b.priced)}
              {missing(result.b.missing)}
            </td>
          </tr>
          <tr>
            <th scope="row">
              {tr("Tiedossa olevat pantit", "Known deposits")}
            </th>
            <td>{money(result.a.deposits)}</td>
            <td>{money(result.b.deposits)}</td>
          </tr>
          <tr>
            <th scope="row">{tr("Noutomaksu", "Pickup fee")}</th>
            <td>{fee(fees.a)}</td>
            <td>{fee(fees.b)}</td>
          </tr>
        </tbody>
      </table>
      <p role="status">
        {result.cheaper === null
          ? result.common.rows
            ? tr(
                "Yhteiset tuotteet maksavat saman verran.",
                "The shared items cost the same.",
              )
            : tr(
                "Ketjuilla ei ole yhteisiä hinnoiteltuja tuotteita.",
                "The chains have no priced items in common.",
              )
          : `${result.cheaper === "a" ? a : b} ${tr("on edullisempi", "is cheaper by")}${tr(" ", " ")}${money(Math.abs(result.common.a - result.common.b))}${tr(" yhteisillä tuotteilla.", " on the shared items.")}`}
      </p>
      {result.largest.length > 0 && (
        <>
          <h3>{tr("Suurimmat erot", "Largest differences")}</h3>
          <ul>
            {result.largest.map((row) => (
              <li key={`${row.requirement.id}:${row.requirement.unit}`}>
                {row.requirement.name}: {a} {money(row.a)} · {b} {money(row.b)}
              </li>
            ))}
          </ul>
        </>
      )}
      <small>
        {tr(
          "Vertailu ei muuta kumpaakaan ostoskoria. Summat ovat ilman nouto- ja toimitusmaksuja.",
          "Comparing changes neither cart. Totals exclude pickup and delivery fees.",
        )}
      </small>
      <div className="actions">
        <button
          disabled={busy}
          onClick={async () => {
            if (await call("save", { ...state, context: other }))
              setOpen(false);
          }}
        >
          {tr("Käytä tätä kauppaa", "Use this store")}: {b}
        </button>
        <button className="text" disabled={busy} onClick={() => setOpen(false)}>
          {tr("Sulje vertailu", "Close comparison")}
        </button>
      </div>
    </section>
  );
}
