import React, { useState } from "react";
import type { Snapshot } from "../application/service";
import type { OfferIdea } from "../ai/offers";

export function OfferIdeas({
  snapshot,
  busy,
  call,
  append,
  canAppend,
}: {
  snapshot: Snapshot;
  busy: boolean;
  call: (method: string, input?: unknown) => Promise<unknown>;
  append: (idea: OfferIdea) => void;
  canAppend: (name: string) => boolean;
}) {
  const [running, setRunning] = useState(false);
  const fi = snapshot.state.language === "fi";
  const tr = (a: string, b: string) => (fi ? a : b);
  const view = snapshot.offerIdeas;
  const conditions = {
    "plussa-required": tr("Vaatii Plussa-kortin", "Requires a Plussa card"),
    "activation-unverified": tr(
      "Aktivointia ei ole varmistettu",
      "Activation has not been verified",
    ),
    "validity-unknown": tr("Voimassaoloa ei tunneta", "Validity is unknown"),
    "redemptions-unknown": tr(
      "Jäljellä olevia käyttökertoja ei tunneta",
      "Remaining redemptions are unknown",
    ),
    "price-basis-unknown": tr(
      "Hinnan yksikköä ei ole varmistettu",
      "Price basis has not been verified",
    ),
  };
  const money = (amount: number) =>
    new Intl.NumberFormat(fi ? "fi-FI" : "en-FI", {
      style: "currency",
      currency: "EUR",
    }).format(amount / 100);
  const productPrice = (p: OfferIdea["products"][number]) => {
    if (p.price.amount === null)
      return tr("Hinta ei saatavilla", "Price unavailable");
    const unit =
      p.price.basis === "pcs"
        ? `${p.price.quantity} ${fi ? "kpl" : "pcs"}`
        : p.price.basis === "unknown"
          ? p.price.unitLabel
          : p.price.basis;
    return `${money(p.price.amount)}${unit ? ` / ${unit}` : ""}`;
  };
  return (
    <section
      className="offer-ideas"
      aria-label={tr("Ideoita tarjouksista", "Ideas from offers")}
    >
      <button
        type="button"
        className="secondary"
        disabled={busy || running || !snapshot.offerDiscoverySupported}
        onClick={async () => {
          setRunning(true);
          try {
            await call("suggestOffers", { consent: true });
          } finally {
            setRunning(false);
          }
        }}
      >
        {tr("Ideoita tarjouksista", "Ideas from offers")}
      </button>
      <p className="muted">
        {!snapshot.offerDiscoverySupported
          ? tr(
              "Tarjousideoita ei vielä tueta tässä kaupassa. Voit silti luoda tavallisen ostoslistan.",
              "Offer ideas are not yet supported for this retailer. You can still create a regular shopping list.",
            )
          : tr(
              "Tekoäly ehdottaa aterioita nykyisen kaupan tarjouksista, kun painat painiketta. Muut ainekset voivat maksaa normaalihinnan.",
              "Press the button to ask AI for meals using this store’s offers. Other ingredients may cost their normal price.",
            )}
      </p>
      {running && (
        <div role="status">
          <p>
            {tr(
              "Haetaan tarjouksia ja ateriaideoita…",
              "Reading offers and suggesting meals…",
            )}
          </p>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              void call("cancelAI");
            }}
          >
            {tr("Peruuta ideat", "Cancel ideas")}
          </button>
        </div>
      )}
      {!running && view && view.status !== "ready" && (
        <p role="status">
          {view.status === "unsupported"
            ? tr(
                "Tämän kaupan tarjousten hakua ei tueta. Tekoälyä ei käytetty.",
                "Offer discovery is unavailable for this store. AI was not used.",
              )
            : view.status === "empty"
              ? tr(
                  "Nykyisiä tarjouksia ei löytynyt. Tekoälyä ei käytetty.",
                  "No current offers were found. AI was not used.",
                )
              : view.status === "signed-out"
                ? tr(
                    "Kirjaudu kaupan tilille Kauppa-välilehdellä. Tekoälyä ei käytetty.",
                    "Sign in to the retailer in the Store tab. AI was not used.",
                  )
                : view.status === "error" && view.code === "aiCancelled"
                  ? tr("Ideoiden haku peruutettu.", "Ideas cancelled.")
                  : tr(
                      "Ideoita ei voitu hakea. Yritä uudelleen.",
                      "Could not load ideas. Try again.",
                    )}
        </p>
      )}
      {!running && view?.status === "ready" && (
        <>
          {view.truncated && (
            <p className="muted">
              {tr(
                "Ideoissa käytetään enintään 30 tarjousta.",
                "Ideas use at most 30 offers.",
              )}
            </p>
          )}
          {view.ideas.map((idea) => (
            <article className="card" key={idea.id}>
              <h3>{idea.name}</h3>
              <ul>
                {idea.products.map((p) => (
                  <li key={`${p.offerId}:${p.productId}`}>
                    {p.name}: {productPrice(p)}
                    {p.eligibility === "conditional" && (
                      <strong>
                        {tr(" — ehdollinen tarjous", " — conditional offer")}
                      </strong>
                    )}
                    <p className="muted">
                      {p.validUntil
                        ? `${tr("Voimassa asti", "Valid until")} ${p.validUntil}`
                        : conditions["validity-unknown"]}
                      {p.remainingRedemptions !== null
                        ? ` · ${p.remainingRedemptions} ${tr("käyttökertaa jäljellä", "redemptions remaining")}`
                        : ""}
                    </p>
                    {!!p.conditions.length && (
                      <p>{p.conditions.map((c) => conditions[c]).join(". ")}</p>
                    )}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="secondary"
                disabled={busy || !canAppend(idea.name)}
                onClick={() => append(idea)}
              >
                {tr("Lisää muistiinpanoon", "Add to note")}
              </button>
            </article>
          ))}
          <p className="muted">
            {tr(
              "Valitut tarjousainekset säilyvät mukana, kun luot listan. Puuttuva tuote jää ratkaistavaksi. Ehdollista alennusta ei luvata.",
              "Selected offer ingredients carry into list creation. An unavailable product stays unresolved. Conditional discounts are not guaranteed.",
            )}
          </p>
        </>
      )}
    </section>
  );
}
