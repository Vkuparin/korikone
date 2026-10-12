import React, { useCallback, useEffect, useState } from "react";
import type { ReceiptImportCoordinator } from "../application/receipt-import";
import type { Snapshot } from "../application/service";
import { categorySchema } from "../domain/categories";
import { preferenceCategoryLabel } from "./category-preferences";

export type ReceiptsView = Awaited<
  ReturnType<ReceiptImportCoordinator["view"]>
>;
type Purchase = ReceiptsView["purchases"][number];
type PurchaseLine = Purchase["lines"][number];

type Call = (
  method: string,
  input?: unknown,
  options?: { preserveError?: boolean },
) => Promise<boolean>;

/**
 * The local receipt controls of the Data screen: import, the printed summary and balance, one
 * grouped review of uncertain rows, correction, interpretation and deletion. Import and review
 * are local; nothing here changes the shopping list, and no request leaves the device unless the
 * shopper uses the enrichment controls beside it.
 */
export function ReceiptsPanel({
  snapshot,
  busy,
  call,
  language,
}: {
  snapshot: Snapshot;
  busy: boolean;
  call: Call;
  language: string;
}) {
  const fi = language === "fi";
  const tr = (a: string, b: string) => (fi ? a : b);
  const [view, setView] = useState<ReceiptsView | null>(null);
  const [keepOriginal, setKeepOriginal] = useState(false);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    const result = await window.korikone.listPurchases();
    if (result.ok)
      setView((result.value as unknown as { receipts: ReceiptsView }).receipts);
  }, []);
  // The ledger also changes through imports of other kinds, so read it again whenever the
  // snapshot's own import summary or revision does.
  useEffect(() => {
    void refresh();
  }, [refresh, snapshot.purchaseImport, snapshot.receiptEnrichment]);
  const act = async (method: string, input?: unknown) => {
    const ok = await call(method, input);
    await refresh();
    return ok;
  };
  const money = (cents: number | null) =>
    cents === null
      ? tr("tuntematon", "unknown")
      : new Intl.NumberFormat(fi ? "fi-FI" : "en-FI", {
          style: "currency",
          currency: "EUR",
        }).format(cents / 100);
  const date = (purchase: Purchase) =>
    purchase.purchasedAt
      ? new Date(purchase.purchasedAt).toLocaleDateString(
          fi ? "fi-FI" : "en-FI",
        )
      : tr("päiväys tuntematon", "date unknown");
  const balance = (purchase: Purchase) =>
    ({
      balanced: tr("Summa täsmää", "Total matches"),
      unbalanced: tr("Summa ei täsmää", "Total does not match"),
      incomplete: tr("Summa on vajaa", "Total is incomplete"),
    })[purchase.reconciliation.status];
  const reason = (r: PurchaseLine["review"][number]) =>
    ({
      unreadable: tr("Riviä ei voitu lukea", "Row could not be read"),
      "missing-amount": tr("Hinta puuttuu", "Amount missing"),
      "unknown-quantity": tr("Määrä puuttuu", "Quantity missing"),
      uninterpreted: tr("Ei tulkintaa", "Not interpreted"),
      "model-proposal": tr("Ehdotus odottaa", "Proposal waiting"),
    })[r];
  // The provider disclosed and consented to is the one that would receive the labels.
  const providerId = snapshot.developmentAIProvider ?? "chatgpt";
  const providerName = providerId === "chatgpt" ? "ChatGPT" : providerId;
  const consent = view?.consent ?? null;
  const consentCurrent =
    !!consent?.automatic &&
    consent.automatic.providerId === providerId &&
    consent.automatic.scope === view?.dataScope;
  const consentStale = !!consent?.automatic && !consentCurrent;
  const aiReady = snapshot.ai.state === "connected";
  const scopeOf = view?.dataScope ?? 1;
  const enrichment = snapshot.receiptEnrichment;
  const enrichmentText = (e: NonNullable<typeof enrichment>) => {
    const counts = `${e.accepted} ${tr("ehdotusta", "proposals")}, ${e.rejected} ${tr("hylättyä", "rejected")}, ${e.unresolved} ${tr("avointa", "open")}${e.omitted ? `, ${e.omitted} ${tr("jätetty pois", "left out")}` : ""}`;
    return {
      enriched: `${tr("Tarkennus valmis", "Enrichment finished")}: ${counts}`,
      skipped:
        e.reason === "consent"
          ? tr(
              "Tarkennusta ei tehty: suostumusta ei ole annettu.",
              "Enrichment was not run: no consent was given.",
            )
          : tr(
              "Tarkennettavaa ei ollut.",
              "There was nothing ambiguous to enrich.",
            ),
      unavailable: tr(
        "Tarkennus ei ole käytettävissä. Kuitin tiedot säilyivät.",
        "Enrichment is unavailable. The receipt facts are unchanged.",
      ),
      failed: tr(
        "Tarkennus epäonnistui tai käyttöraja täyttyi. Kuitin tiedot säilyivät.",
        "Enrichment failed or hit a usage limit. The receipt facts are unchanged.",
      ),
      cancelled: tr(
        "Tarkennus peruttiin. Kuitin tiedot säilyivät.",
        "Enrichment was cancelled. The receipt facts are unchanged.",
      ),
      stale: tr(
        "Tulos hylättiin, koska kuittia oli muutettu sillä välin.",
        "The result was discarded because the receipt changed meanwhile.",
      ),
    }[e.status];
  };
  const imported = snapshot.purchaseImport;
  const ocrNotice = tr(
    "Kuitti luettiin paikallisella tekstintunnistuksella (OCR). Tarkista määrät ja hinnat alkuperäisestä kuitista, vaikka summa täsmäisi.",
    "This receipt was read with local text recognition (OCR). Check quantities and prices against the original receipt, even if the total matches.",
  );
  const summary = imported
    ? imported.source === "receipt"
      ? imported.outcome === "unsupported"
        ? tr(
            "Tiedostoa ei tunnistettu kuitiksi. Mitään ei tallennettu.",
            "The file was not recognised as a receipt. Nothing was saved.",
          )
        : imported.outcome === "duplicate"
          ? tr(
              "Tämä kuitti on jo tuotu. Mitään ei lisätty.",
              "This receipt was already imported. Nothing was added.",
            )
          : `${
              imported.outcome === "updated"
                ? tr("Kuitti päivitettiin", "Receipt updated")
                : tr("Kuitti tuotiin", "Receipt imported")
            }: ${imported.lines} ${tr("riviä", "rows")}${
              imported.unreadableLines
                ? `, ${imported.unreadableLines} ${tr("lukukelvotonta", "unreadable")}`
                : ""
            }`
      : imported.source === "orders"
        ? `${tr("Tilaukset", "Orders")}: ${imported.added} ${tr("lisättiin", "added")}, ${imported.duplicate} ${tr("jo tuotu", "already imported")}`
        : `${tr("Vanhat kuitit", "Older receipts")}: ${imported.added} ${tr("lisättiin", "added")}, ${imported.duplicate} ${tr("jo tuotu", "already imported")}, ${imported.unsupported} ${tr("jäi tekstiin", "left as text")}`
    : null;

  return (
    <section className="receipts-panel" aria-label={tr("Kuitit", "Receipts")}>
      <div className="actions">
        <button
          disabled={busy}
          onClick={() => void act("importPurchaseReceipt", { keepOriginal })}
        >
          {tr(
            "Tuo kuitti (PDF, teksti tai CSV)",
            "Import receipt (PDF, text or CSV)",
          )}
        </button>
        <label className="check">
          <input
            type="checkbox"
            checked={keepOriginal}
            onChange={(e) => setKeepOriginal(e.target.checked)}
          />
          {tr(
            "Säilytä alkuperäinen tiedosto paikallisesti",
            "Keep the original file on this device",
          )}
        </label>
      </div>
      <p className="muted">
        {tr(
          "Kuitti luetaan ja tarkistetaan paikallisesti: rivit, määrät, summat ja alennukset. Mitään ei lähetetä ja ostoslistaasi ei muuteta.",
          "The receipt is read and checked on this device: rows, quantities, totals and discounts. Nothing is sent and your shopping list is not changed.",
        )}
      </p>
      {busy && (
        <p role="status" className="muted">
          {tr(
            "Luetaan kuittia, tunnistetaan rivit ja tarkistetaan summat…",
            "Reading the receipt, identifying rows and checking totals…",
          )}
        </p>
      )}
      {summary && (
        <p role="status" className="receipt-summary">
          {summary}
          {imported?.source === "receipt" && imported.reconciliation
            ? ` · ${
                {
                  balanced: tr("summa täsmää", "total matches"),
                  unbalanced: tr("summa ei täsmää", "total does not match"),
                  incomplete: tr("summa vajaa", "total incomplete"),
                }[imported.reconciliation]
              }`
            : ""}
        </p>
      )}
      {imported?.source === "receipt" && !!imported.ocrPages?.length && (
        <p role="status" className="receipt-ocr-notice">
          {ocrNotice}
        </p>
      )}
      {view && view.purchases.length > 0 && (
        <section
          className="receipt-ai"
          aria-label={tr("Tekoälytarkennus", "AI enrichment")}
        >
          <h4>
            {tr("Valinnainen tekoälytarkennus", "Optional AI enrichment")}
          </h4>
          <p className="muted">
            {tr(
              `Voit antaa palvelun ${providerName} tulkita epäselviä rivinimiä. Lähetetään vain puhdistetut rivien nimet ja varmennetut määrät, enintään 40 riviä yhdessä pyynnössä. Kauppaa, päiväystä, hintoja, summia tai tunnisteita ei lähetetä. Tulos ei muuta määriä tai hintoja eikä tallenna mitään mieltymystä.`,
              `You can let ${providerName} interpret ambiguous row names. Only sanitized row names and verified quantities are sent, at most 40 rows in one request. No store, date, prices, totals or identifiers are sent. The result changes no quantity or amount and saves no preference.`,
            )}
          </p>
          {!consent?.asked && !consentCurrent && (
            <p role="status" className="receipt-first">
              {tr(
                "Tarkennetaanko uudet kuitit tästä lähtien automaattisesti?",
                "Enrich new receipts automatically from now on?",
              )}{" "}
              <button
                disabled={busy}
                onClick={() =>
                  void act("setReceiptConsent", {
                    automatic: true,
                    providerId,
                    scope: scopeOf,
                  })
                }
              >
                {tr("Salli", "Allow")}
              </button>{" "}
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void act("setReceiptConsent", {
                    automatic: false,
                    providerId,
                    scope: scopeOf,
                  })
                }
              >
                {tr("Ei nyt", "Not now")}
              </button>
            </p>
          )}
          <label className="check">
            <input
              type="checkbox"
              checked={consentCurrent}
              disabled={busy}
              onChange={(e) =>
                void act("setReceiptConsent", {
                  automatic: e.target.checked,
                  providerId,
                  scope: scopeOf,
                })
              }
            />
            {tr(
              `Tarkenna uudet kuitit automaattisesti (${providerName})`,
              `Enrich new receipts automatically (${providerName})`,
            )}
          </label>
          {consentStale && (
            <p role="status" className="muted">
              {tr(
                "Aiempi suostumus koski toista palvelua tai toista tietosisältöä, joten se ei ole voimassa. Anna uusi suostumus yllä.",
                "An earlier consent was for another provider or data scope, so it no longer applies. Give a new one above.",
              )}
            </p>
          )}
          {!aiReady && (
            <p className="muted">
              {tr(
                "Tekoäly ei ole yhdistetty, joten tarkennus ei ole käytettävissä. Paikallinen tuonti ja tarkistus toimivat silti.",
                "AI is not connected, so enrichment is unavailable. Local import and review still work.",
              )}
            </p>
          )}
          {enrichment && (
            <p role="status" className="receipt-enrichment">
              {enrichmentText(enrichment)}
            </p>
          )}
        </section>
      )}
      {view?.legacy && (
        <div className="receipt-legacy">
          <p>
            {tr(
              "Aiemmin tallennettu kuittiteksti on yhä tallessa muuttumattomana. Voit muuttaa sen ostoiksi tuomalla sen erikseen.",
              "Receipt text saved earlier is still kept unchanged. Import it explicitly to turn it into purchases.",
            )}
          </p>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void act("importLegacyReceipts")}
          >
            {tr("Tuo aiemmin tallennettu teksti", "Import the saved text")}
          </button>
        </div>
      )}
      {view && !view.purchases.length && (
        <p className="muted">
          {tr("Ei tuotuja kuitteja vielä.", "No imported receipts yet.")}
        </p>
      )}
      {view?.purchases.map((purchase) => {
        const review = purchase.lines.filter(
          (line) => line.review.length && !skipped.has(line.id),
        );
        return (
          <details
            className="card receipt-card"
            key={purchase.eventId}
            open={purchase.reviewCount > 0 ? true : undefined}
          >
            <summary>
              {(purchase.store ?? tr("Tuntematon kauppa", "Unknown store")) +
                " · " +
                date(purchase)}{" "}
              ·{" "}
              {money(
                purchase.printed.find((p) => p.role === "total")?.amount ??
                  null,
              )}
              {" · "}
              <span className={`recon ${purchase.reconciliation.status}`}>
                {balance(purchase)}
              </span>
              {purchase.reviewCount > 0 && (
                <span className="muted">
                  {" · "}
                  {purchase.reviewCount} {tr("tarkistettavaa", "to review")}
                </span>
              )}
            </summary>
            {!!purchase.ocrPages.length && (
              <p className="receipt-ocr-notice">
                {ocrNotice} {tr("Sivut", "Pages")}:{" "}
                {purchase.ocrPages.join(", ")}.
              </p>
            )}
            <table>
              <thead>
                <tr>
                  <th scope="col">{tr("Rivi", "Row")}</th>
                  <th scope="col">{tr("Määrä", "Quantity")}</th>
                  <th scope="col">{tr("Maksettu", "Paid")}</th>
                </tr>
              </thead>
              <tbody>
                {purchase.lines.map((line) => (
                  <tr key={line.id}>
                    <td>
                      {line.label}
                      {line.interpretation?.name
                        ? ` → ${line.interpretation.name}`
                        : ""}
                    </td>
                    <td>
                      {line.quantity.amount === null
                        ? tr("tuntematon", "unknown")
                        : `${line.quantity.amount} ${line.quantity.unit === "pcs" ? tr("kpl", "pcs") : line.quantity.unit}`}
                    </td>
                    <td>{money(line.net ?? line.gross)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {purchase.reconciliation.difference !== null &&
              purchase.reconciliation.difference !== 0 && (
                <p role="status">
                  {tr(
                    "Erotus painettuun summaan",
                    "Difference to printed total",
                  )}
                  : {money(purchase.reconciliation.difference)}
                </p>
              )}
            {purchase.printed.map((p) => (
              <small key={`${p.role}-${p.span.line}`} className="muted">
                {
                  {
                    total: tr("Yhteensä", "Total"),
                    subtotal: tr("Välisumma", "Subtotal"),
                    food: tr("Ruoka", "Food"),
                    "non-food": tr("Muut", "Non-food"),
                    discounts: tr("Alennukset", "Discounts"),
                    deposits: tr("Pantit", "Deposits"),
                    tax: tr("Vero", "Tax"),
                  }[p.role]
                }
                : {money(p.amount)}{" "}
              </small>
            ))}
            {review.length > 0 && (
              <section
                className="receipt-review"
                aria-label={tr("Tarkistettavat rivit", "Rows to review")}
              >
                <h4>
                  {tr("Tarkistettavat rivit", "Rows to review")} (
                  {review.length})
                </h4>
                {review.map((line) => (
                  <ReviewLine
                    key={line.id}
                    fi={fi}
                    line={line}
                    busy={busy}
                    reason={reason}
                    bind={{
                      eventId: purchase.eventId,
                      lineId: line.id,
                      revision: purchase.revision,
                    }}
                    act={act}
                    skip={() => setSkipped(new Set(skipped).add(line.id))}
                  />
                ))}
              </section>
            )}
            <div className="actions receipt-enrich">
              <button
                className="secondary"
                disabled={busy || !aiReady || purchase.status !== "completed"}
                onClick={() =>
                  void act("enrichPurchase", {
                    eventId: purchase.eventId,
                    consent: { providerId, scope: scopeOf },
                  })
                }
              >
                {enrichment?.eventId === purchase.eventId &&
                enrichment.status !== "enriched" &&
                enrichment.status !== "skipped"
                  ? tr("Yritä tarkennusta uudelleen", "Retry enrichment")
                  : tr(
                      `Tarkenna vain tämä kuitti (${providerName})`,
                      `Enrich this receipt only (${providerName})`,
                    )}
              </button>
              {busy && (
                <button
                  className="text"
                  onClick={() => void window.korikone.cancelAI()}
                >
                  {tr("Peruuta pyyntö", "Cancel the request")}
                </button>
              )}
            </div>
            <div className="actions receipt-delete">
              {purchase.retention === "original" && (
                <button
                  className="text"
                  disabled={busy}
                  onClick={() =>
                    void act("deletePurchase", {
                      eventId: purchase.eventId,
                      scope: "original",
                    })
                  }
                >
                  {tr("Poista alkuperäinen kopio", "Delete the original copy")}
                </button>
              )}
              <button
                className="text"
                disabled={busy}
                onClick={() =>
                  void act("deletePurchase", {
                    eventId: purchase.eventId,
                    scope: "annotations",
                  })
                }
              >
                {tr("Poista tulkinnat", "Delete interpretations")}
              </button>
              {confirmDelete === purchase.eventId ? (
                <>
                  <button
                    disabled={busy}
                    onClick={async () => {
                      setConfirmDelete(null);
                      await act("deletePurchase", {
                        eventId: purchase.eventId,
                        scope: "event",
                      });
                    }}
                  >
                    {tr(
                      "Poista kuitti ja sen tiedot",
                      "Delete receipt and its data",
                    )}
                  </button>
                  <button
                    className="secondary"
                    onClick={() => setConfirmDelete(null)}
                  >
                    {tr("Säilytä", "Keep")}
                  </button>
                </>
              ) : (
                <button
                  className="text"
                  disabled={busy}
                  onClick={() => setConfirmDelete(purchase.eventId)}
                >
                  {tr("Poista ostos", "Delete purchase")}
                </button>
              )}
            </div>
          </details>
        );
      })}
    </section>
  );
}

function ReviewLine({
  fi,
  line,
  busy,
  reason,
  bind,
  act,
  skip,
}: {
  fi: boolean;
  line: PurchaseLine;
  busy: boolean;
  reason: (r: PurchaseLine["review"][number]) => string;
  bind: { eventId: string; lineId: string; revision: number };
  act: (method: string, input?: unknown) => Promise<boolean>;
  skip: () => void;
}) {
  const tr = (a: string, b: string) => (fi ? a : b);
  const [amount, setAmount] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState<"pcs" | "g" | "ml">("pcs");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const cents = (text: string) => {
    const value = Number(text.replace(",", "."));
    return Number.isFinite(value) && value >= 0
      ? Math.round(value * 100)
      : null;
  };
  const proposal =
    line.proposal ??
    (line.interpretation?.origin === "model" ? line.interpretation : null);
  return (
    <div className="review-line">
      <strong>{line.label}</strong>
      <small className="muted"> · {line.review.map(reason).join(", ")}</small>
      <div className="actions">
        {line.review.includes("missing-amount") && (
          <form
            className="inline"
            onSubmit={(e) => {
              e.preventDefault();
              const value = cents(amount);
              if (value !== null)
                void act("correctPurchase", {
                  ...bind,
                  field: "gross",
                  amount: value,
                });
            }}
          >
            <label>
              {tr("Hinta (€)", "Amount (€)")}
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <button disabled={busy || cents(amount) === null}>
              {tr("Tallenna hinta", "Save amount")}
            </button>
          </form>
        )}
        {line.review.includes("unknown-quantity") && (
          <form
            className="inline"
            onSubmit={(e) => {
              e.preventDefault();
              const value = Number(quantity);
              if (Number.isInteger(value) && value > 0)
                void act("correctPurchase", {
                  ...bind,
                  field: "quantity",
                  amount: value,
                  unit,
                });
            }}
          >
            <label>
              {tr("Määrä", "Quantity")}
              <input
                inputMode="numeric"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </label>
            <select
              aria-label={tr("Yksikkö", "Unit")}
              value={unit}
              onChange={(e) => setUnit(e.target.value as typeof unit)}
            >
              <option value="pcs">{tr("kpl", "pcs")}</option>
              <option value="g">g</option>
              <option value="ml">ml</option>
            </select>
            <button disabled={busy || !quantity}>
              {tr("Tallenna määrä", "Save quantity")}
            </button>
          </form>
        )}
        {proposal && (
          <button
            disabled={busy}
            onClick={() =>
              void act("interpretPurchase", {
                ...bind,
                name: proposal.name,
                category: proposal.category,
                qualifiers: proposal.qualifiers.map((q) => ({
                  kind: q.kind,
                  value: q.value,
                })),
                scope: proposal.scope,
              })
            }
          >
            {tr("Hyväksy ehdotus", "Accept proposal")}
            {proposal.name ? `: ${proposal.name}` : ""}
          </button>
        )}
        {line.review.includes("uninterpreted") && !proposal && (
          <form
            className="inline"
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return;
              void act("interpretPurchase", {
                ...bind,
                name: name.trim(),
                category: category || null,
                qualifiers: [],
                scope: "food",
              });
            }}
          >
            <label>
              {tr("Mitä tämä on", "What this is")}
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <select
              aria-label={tr("Ryhmä", "Category")}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">{tr("Ei ryhmää", "No category")}</option>
              {categorySchema.options.map((c) => (
                <option key={c} value={c}>
                  {preferenceCategoryLabel(c, fi ? "fi" : "en")}
                </option>
              ))}
            </select>
            <button disabled={busy || !name.trim()}>
              {tr("Tallenna tulkinta", "Save interpretation")}
            </button>
          </form>
        )}
        <button className="text" onClick={skip}>
          {tr("Ohita", "Skip")}
        </button>
      </div>
    </div>
  );
}
