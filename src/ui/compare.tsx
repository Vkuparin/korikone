import React, { useEffect, useRef } from "react";
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

type Props = {
  snapshot: Snapshot;
  busy: boolean;
  call: (method: string, input?: unknown) => Promise<boolean>;
  tr: (fi: string, en: string) => string;
  money: (cents: number) => string;
};

/**
 * The comparison line in the pinned total bar. Comparing searches the other chain for every
 * row, so it runs only when pressed; afterwards the line shows the result until the list changes.
 */
export function CompareSummary({
  snapshot,
  busy,
  call,
  tr,
  money,
  onOpen,
}: Props & { onOpen: () => void }) {
  const { state, comparison } = snapshot;
  if (!comparison)
    return (
      <button
        className="text compare-summary"
        disabled={busy || !snapshot.basket.length}
        onClick={async () => {
          if (await call("compareStores")) onOpen();
        }}
      >
        {tr("Vertaa kauppoja", "Compare stores")}
      </button>
    );
  const { result, other } = comparison;
  const difference = Math.abs(result.common.a - result.common.b);
  const cheaper =
    result.cheaper === "a"
      ? chainName(state.context.providerId)
      : chainName(other.providerId);
  return (
    <button className="text compare-summary" onClick={onOpen}>
      {result.cheaper === null
        ? result.common.rows
          ? tr("Sama hinta molemmissa", "Same price at both")
          : tr("Ei yhteisiä tuotteita", "No items in common")
        : `${cheaper} ${money(difference)} ${tr("halvempi", "cheaper")}`}
      {" · "}
      {tr("Vertaa", "Compare")}
    </button>
  );
}

/** The full comparison, opened from the pinned bar: the same list priced at the other chain, read-only. */
export function ComparePanel({
  snapshot,
  busy,
  call,
  tr,
  money,
  open,
  onClose,
}: Props & { open: boolean; onClose: () => void }) {
  const section = useRef<HTMLElement>(null);
  const { state, comparison } = snapshot;
  useEffect(() => {
    if (open) section.current?.scrollIntoView({ block: "nearest" });
  }, [open, comparison]);
  if (!open || !comparison) return null;
  const { result, other, fees } = comparison;
  const fee = (range: { min: number; max: number } | null) =>
    range ? feeRange(range, money) : tr("ei tiedossa", "not known");
  const a = chainName(state.context.providerId);
  const b = chainName(other.providerId);
  const missing = (count: number) =>
    count ? ` · ${count} ${tr("ilman hintaa", "without a price")}` : "";
  return (
    <section
      ref={section}
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
              onClose();
          }}
        >
          {tr("Käytä tätä kauppaa", "Use this store")}: {b}
        </button>
        <button className="text" disabled={busy} onClick={onClose}>
          {tr("Sulje vertailu", "Close comparison")}
        </button>
      </div>
    </section>
  );
}
