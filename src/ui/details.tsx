import React from "react";
import type { Snapshot } from "../application/service";
import type { BasketLine, Product } from "../domain/model";
import { en, fi, packCount, unitLabel, type Key } from "./i18n";

/**
 * The decision details of one list row: what is needed and bought, why this product,
 * unit prices and the other products the store offered. Opened from the row's product name.
 */
export function RowDetails({
  snapshot,
  line,
  busy,
  money,
  choose,
}: {
  snapshot: Snapshot;
  line: BasketLine;
  busy: boolean;
  money: (cents: number) => string;
  choose: (product: Product) => void;
}) {
  const { state } = snapshot;
  const language = state.language;
  const t = (key: Key) => (language === "fi" ? fi : en)[key];
  const u = (unit: string) => unitLabel(unit, language);
  const unitPrice = (p: Product) =>
    p.price === null || !p.packAmount
      ? ""
      : p.unit === "pcs"
        ? `${money(p.price / p.packAmount)} / ${t("perPiece")}`
        : `${money(Math.round((p.price * 1000) / p.packAmount))} / ${p.unit === "g" ? "kg" : "l"}`;
  const { requirement, product } = line;
  const context = state.context;
  const accepted =
    state.accepted[
      `${context.providerId}:${context.storeId}:${requirement.id}`
    ] ?? [];
  const bought = product ? line.packs * product.packAmount : 0;
  return (
    <div
      className="row-details"
      role="region"
      aria-label={`${language === "fi" ? "Tiedot" : "Details"}: ${requirement.name}`}
    >
      <p>
        {t("required")}: {requirement.amount} {u(requirement.unit)}
        {product && (
          <>
            {" · "}
            {t("bought")}: {packCount(line.packs, language)}, {bought}{" "}
            {u(product.unit)}
            {bought > requirement.amount &&
              ` · ${t("surplus")}: ${bought - requirement.amount} ${u(product.unit)}`}
          </>
        )}
      </p>
      {product ? (
        <p className="muted">
          {t(
            accepted.includes(product.id) ? "reasonAccepted" : "reasonCheapest",
          )}
          {unitPrice(product) && ` ${unitPrice(product)}`}
          {product.deposit > 0 &&
            ` · ${t("deposit")} ${money(product.deposit)}`}
        </p>
      ) : (
        <p className="warning">
          {t(line.candidates.length ? "unresolved" : "noCandidates")}
        </p>
      )}
      {!!line.excluded && (
        <p className="muted">
          {t("excludedProducts")}: {line.excluded}
        </p>
      )}
      {line.candidates.length > 0 && (
        <ul className="candidates">
          {line.candidates.map((p) => (
            <li className="candidate" key={p.id}>
              <span>{p.name}</span>
              <small>
                {p.packAmount} {u(p.unit)}
                {unitPrice(p) && ` · ${unitPrice(p)}`}
                {p.deposit > 0 && ` · ${t("deposit")} ${money(p.deposit)}`}
              </small>
              <strong>
                {p.price === null ? t("unknown") : money(p.price)}
              </strong>
              <button
                className="secondary"
                aria-label={`${t("choose")}: ${p.name}`}
                disabled={
                  busy ||
                  !p.available ||
                  p.price === null ||
                  !p.packAmount ||
                  p.id === product?.id
                }
                onClick={() => choose(p)}
              >
                {p.id === product?.id
                  ? t("chosen")
                  : p.available
                    ? t("choose")
                    : p.available === false
                      ? t("unavailable")
                      : t("stockUnknown")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
