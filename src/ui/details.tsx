import React from "react";
import type { Snapshot } from "../application/service";
import type { BasketLine, Product, Unit } from "../domain/model";
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
  confirmPack,
  cheaper,
}: {
  snapshot: Snapshot;
  line: BasketLine;
  busy: boolean;
  money: (cents: number) => string;
  choose: (product: Product) => void;
  confirmPack: (product: Product, amount: number, unit: Unit) => void;
  /** A cheaper product for the same ingredient, with its cost for the needed amount. */
  cheaper: { product: Product; total: number } | null;
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
      {cheaper && (
        <p className="row-alternative">
          {language === "fi" ? "Edullisempi vastaava" : "Cheaper alternative"}:{" "}
          {cheaper.product.name} · {money(cheaper.total)}{" "}
          <button
            className="text"
            disabled={busy}
            onClick={() => choose(cheaper.product)}
          >
            {language === "fi" ? "Vaihda" : "Swap"}
          </button>
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
              <span className="candidate-name">{p.name}</span>
              <small>
                {p.packAmount
                  ? `${p.packAmount} ${u(p.unit)}`
                  : t("packSizeUnknown")}
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
              {(!p.packAmount || p.id in state.packSizes) && (
                <PackSizeForm
                  key={`${p.id}:${p.packAmount}`}
                  product={p}
                  language={language}
                  busy={busy}
                  confirm={confirmPack}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Lets the shopper state the pack size of a product whose label the store leaves out. */
function PackSizeForm({
  product,
  language,
  busy,
  confirm,
}: {
  product: Product;
  language: string;
  busy: boolean;
  confirm: (product: Product, amount: number, unit: Unit) => void;
}) {
  const t = (key: Key) => (language === "fi" ? fi : en)[key];
  const [amount, setAmount] = React.useState(
    product.packAmount ? String(product.packAmount) : "",
  );
  const [unit, setUnit] = React.useState<Unit>(
    product.packAmount ? product.unit : "g",
  );
  const value = Number(amount);
  return (
    <form
      className="pack-size"
      onSubmit={(event) => {
        event.preventDefault();
        confirm(product, value, unit);
      }}
    >
      <input
        type="number"
        min={1}
        step={1}
        value={amount}
        aria-label={`${t("packSizeAmount")}: ${product.name}`}
        onChange={(event) => setAmount(event.target.value)}
      />
      <select
        value={unit}
        aria-label={`${t("packSizeUnit")}: ${product.name}`}
        onChange={(event) => setUnit(event.target.value as Unit)}
      >
        {(["g", "ml", "pcs"] as const).map((x) => (
          <option key={x} value={x}>
            {unitLabel(x, language)}
          </option>
        ))}
      </select>
      <button
        type="submit"
        className="secondary"
        disabled={busy || !Number.isInteger(value) || value < 1}
      >
        {t("confirmPackSize")}
      </button>
    </form>
  );
}
