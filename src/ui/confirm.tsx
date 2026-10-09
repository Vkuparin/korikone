import React, { useEffect, useRef, useState } from "react";
import type { Snapshot } from "../application/service";
import type { Review } from "../domain/model";
import { relevant } from "../domain/planner";
import { isLive } from "../stores/provider";
import { en, fi, unitLabel, type Key } from "./i18n";

const chainName = (review: Review) =>
  review.context.providerId === "k-ruoka"
    ? "K-Ruoka"
    : review.context.providerId === "s-kaupat"
      ? "S-kaupat"
      : review.context.storeName;

/** Rows the shopper should look at before confirming; everything else is in "Show all rows". */
export function attention(review: Review, budget: number) {
  const cheaper = review.quotes.flatMap((line) => {
    if (!line.product || line.total === null) return [];
    const best = line.candidates
      .filter(
        (p) =>
          p.available &&
          p.price !== null &&
          p.unit === line.product!.unit &&
          p.packAmount > 0 &&
          p.id !== line.product!.id &&
          // Only the ingredient itself counts, not a look-alike such as chicken mince.
          (!isLive(review.context.providerId) ||
            relevant(p.name, line.requirement.name)),
      )
      .map((p) => ({
        product: p,
        total:
          Math.ceil(line.requirement.amount / p.packAmount) * (p.price ?? 0),
      }))
      .sort((a, b) => a.total - b.total)[0];
    return best && best.total < line.total
      ? [{ line, product: best.product, saving: line.total - best.total }]
      : [];
  });
  return {
    unresolved: review.unresolved ?? [],
    overBudget: Math.max(review.total - budget, 0),
    inCart: review.targets.filter((target) => target.before > 0),
    cheaper,
  };
}

/**
 * Confirmation and result of a transfer, in the list column above the total bar.
 * Nothing is written to the store until the confirm button is pressed.
 */
export function ConfirmPanel({
  snapshot,
  busy,
  call,
  money,
  onClose,
  onRecover,
}: {
  snapshot: Snapshot;
  busy: boolean;
  call: (method: string, input?: unknown) => Promise<boolean>;
  money: (cents: number) => string;
  onClose: () => void;
  onRecover: () => void;
}) {
  const { state, review, journal } = snapshot;
  const language = state.language;
  const t = (key: Key) => (language === "fi" ? fi : en)[key];
  const tr = (a: string, b: string) => (language === "fi" ? a : b);
  const u = (unit: string) => unitLabel(unit, language);
  const confirm = useRef<HTMLButtonElement>(null);
  const [accepted, setAccepted] = useState(false);
  useEffect(() => setAccepted(false), [review?.id]);
  const section = useRef<HTMLElement>(null);
  const items = review && attention(review, state.household.budget);
  const quiet =
    !!items &&
    !items.unresolved.length &&
    !items.overBudget &&
    !items.inCart.length;
  useEffect(() => {
    section.current?.scrollIntoView({ block: "nearest" });
    if (quiet) confirm.current?.focus();
  }, [review?.id, quiet]);

  if (review && items) {
    const count = review.targets.length;
    return (
      <section
        ref={section}
        className="confirm-panel"
        aria-label={tr("Siirron vahvistus", "Transfer confirmation")}
      >
        <h3>
          {tr("Siirto", "Transfer to")} {review.context.storeName}
        </h3>
        {isLive(review.context.providerId) && (
          <p className="muted">
            {t("account")}: {review.baseline.accountName || t("signedIn")}
          </p>
        )}
        {quiet ? (
          <p>{tr("Ei huomautettavaa.", "Nothing needs attention.")}</p>
        ) : (
          <ul className="attention-list">
            {items.unresolved.length > 0 && (
              <li>
                {tr(
                  "Ei siirretä, tuote puuttuu:",
                  "Not transferred, no product:",
                )}{" "}
                {items.unresolved.map((r) => r.name).join(", ")}
              </li>
            )}
            {items.overBudget > 0 && (
              <li>
                {tr("Viikkobudjetti ylittyy", "Over the weekly budget by")}{" "}
                {money(items.overBudget)}
              </li>
            )}
            {items.inCart.map((target) => (
              <li key={`cart:${target.productId}`}>
                {tr("Jo korissa:", "Already in the cart:")} {target.name}{" "}
                {target.before} → {target.quantity} {u(target.unit)}
              </li>
            ))}
          </ul>
        )}
        {review.context.providerId === "s-kaupat" && (
          <p className="muted">{t("sKaupatListInfo")}</p>
        )}
        <details>
          <summary>{tr("Näytä kaikki rivit", "Show all rows")}</summary>
          <ul>
            {review.targets.map((target) => (
              <li key={target.productId}>
                {target.name}: {target.before} → {target.quantity}{" "}
                {u(target.unit)}
              </li>
            ))}
          </ul>
          <p className="muted">{t("retained")}</p>
        </details>
        {items.overBudget > 0 && (
          <label className="check">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
            />
            {t("confirmBudget")}
          </label>
        )}
        <div className="actions">
          <button
            ref={confirm}
            disabled={busy || (items.overBudget > 0 && !accepted)}
            onClick={() =>
              void call("execute", {
                id: review.id,
                acknowledged: accepted,
              })
            }
          >
            {tr("Vahvista", "Confirm")}: {count} {tr("tuotetta", "products")} →{" "}
            {chainName(review)} · {money(review.total)}
          </button>
          <button className="text" disabled={busy} onClick={onClose}>
            {tr("Peru", "Cancel")}
          </button>
        </div>
      </section>
    );
  }

  if (
    snapshot.transferException === "priceChanged" ||
    snapshot.transferException === "unresolved"
  )
    return (
      <section className="confirm-panel" role="alert">
        <p>{t(snapshot.transferException)}</p>
        <button
          disabled={busy}
          onClick={async () => {
            if (await call("buildBasket")) onClose();
          }}
        >
          {tr("Hae tuotteet ja hinnat", "Get products and prices")}
        </button>
        <button className="text" onClick={onClose}>
          {tr("Peru", "Cancel")}
        </button>
      </section>
    );
  if (!journal) return null;
  const left = journal.review.unresolved ?? [];
  const live = isLive(journal.review.context.providerId);
  return (
    <section
      ref={section}
      className="confirm-panel"
      aria-label={tr("Siirron tulos", "Transfer result")}
    >
      <h3 role="status">
        {t(journal.status === "verified" ? "verified" : "partial")}
      </h3>
      <p>
        {t("verifiedLines")}: {journal.verified.length} /{" "}
        {journal.review.targets.length}
      </p>
      {left.length > 0 && (
        <p>
          {tr("Jäi siirtämättä:", "Left out:")}{" "}
          {left.map((r) => r.name).join(", ")}
        </p>
      )}
      {journal.uncertain && (
        <p className="warning">
          {t("uncertain")}: {journal.uncertain}
        </p>
      )}
      {journal.status === "verified" ? (
        <>
          {snapshot.handoffError && (
            <p role="alert">
              {tr(
                "Siirto tarkistettu, mutta kaupan avaaminen epäonnistui. Avaa kauppa uudelleen alla.",
                "Transfer verified, but the store could not open. Retry opening below.",
              )}
            </p>
          )}
          <p className="muted">
            {snapshot.developmentMode
              ? tr(
                  "Kehitystila: siirto tarkistettiin testikorissa. Oikeaa kaupan ikkunaa ei avata. Avauspainike testaa avaamisen lisäämättä tuotteita.",
                  "Development mode: transfer verified in the test basket. No real store window opens. The open button tests opening without adding products.",
                )
              : journal.review.context.providerId === "s-kaupat"
                ? t("sKaupatHandoff")
                : tr(
                    "Viimeistele tilaus kaupan ostoskorissa. Tarvittaessa voit avata sen uudelleen.",
                    "Complete checkout in the store basket. You can reopen it if needed.",
                  )}
          </p>
          {snapshot.developmentMode && (
            <p aria-live="polite">
              {tr("Testatut avaukset", "Tested openings")}:{" "}
              {snapshot.developmentHandoffs.length}
            </p>
          )}
          <div className="actions">
            {live && (
              <button
                disabled={busy}
                onClick={() => void call("openStoreCart")}
              >
                {journal.review.context.providerId === "s-kaupat"
                  ? tr("Avaa S-kaupat-lista uudelleen", "Reopen S-kaupat list")
                  : tr(
                      "Avaa K-Ruoan ostoskori uudelleen",
                      "Reopen K-Ruoka basket",
                    )}
              </button>
            )}
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void call("confirmPurchase")}
            >
              {t("ordered")}
            </button>
            <button
              className="text"
              disabled={busy}
              onClick={() => void call("prepare", { allowMissing: true })}
            >
              {tr("Siirrä sama lista uudelleen…", "Transfer this list again…")}
            </button>
            <button className="text" onClick={onClose}>
              {tr("Sulje", "Close")}
            </button>
          </div>
        </>
      ) : (
        <div className="actions">
          <button disabled={busy} onClick={onRecover}>
            {t("recover")}
          </button>
          <button className="text" onClick={onClose}>
            {tr("Sulje", "Close")}
          </button>
        </div>
      )}
    </section>
  );
}
