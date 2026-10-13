import React, { useState } from "react";
import type {
  MerchandiseAttribute,
  MerchandiseCapabilities,
  MerchandiseEvidence,
  MerchandiseIntent,
  MerchandiseStatus,
} from "../domain/merchandise";

const kindLabel = (kind: MerchandiseAttribute["kind"], fi: boolean) =>
  ({
    size: fi ? "koko" : "size",
    colour: fi ? "väri" : "colour",
    model: fi ? "malli" : "model",
    material: fi ? "materiaali" : "material",
    spec: fi ? "tarkenne" : "spec",
  })[kind];

/** One distinct sentence per statement; none is shown as another (F22.3). */
export function merchandiseStatusText(
  status: MerchandiseStatus,
  fi: boolean,
): string {
  const tr = (a: string, b: string) => (fi ? a : b);
  return {
    "exact-available": tr(
      "Pyydetty vaihtoehto löytyy tästä kaupasta ja on ilmoitettu saatavilla olevaksi.",
      "The requested variant is listed at this store and reported available.",
    ),
    "variant-missing": tr(
      "Tuoteryhmä löytyy tästä kaupasta, mutta yhtäkään tuotetta ei voitu vahvistaa pyydetyksi vaihtoehdoksi.",
      "The product family is listed at this store, but no product could be confirmed as the requested variant.",
    ),
    "not-listed-here": tr(
      "Tätä ei löytynyt tästä kaupasta. Tämä ei kerro muiden kauppojen valikoimasta.",
      "Nothing of this was found at this store. That says nothing about other stores.",
    ),
    "out-of-stock": tr(
      "Pyydetty vaihtoehto on listattu, mutta kauppa ilmoittaa sen loppuneen.",
      "The requested variant is listed, but the store reports it as not available.",
    ),
    unknown: tr(
      "Pyydetty vaihtoehto on listattu, mutta kauppa ei kerro onko se saatavilla.",
      "The requested variant is listed, but the store does not say whether it is available.",
    ),
    unsupported: tr(
      "Tämä kauppa ei tue ei-ruokatuotteiden hakua tässä sovelluksessa.",
      "This store does not support searching non-food products in this app.",
    ),
    "signed-out": tr(
      "Haku vaatii kirjautumisen kauppaan.",
      "Searching needs you to sign in to the store.",
    ),
    failed: tr(
      "Haku epäonnistui, joten mitään ei tiedetä. Yritä myöhemmin uudelleen.",
      "The search failed, so nothing is known. Try again later.",
    ),
    stale: tr(
      "Tulos koski toista kauppaa tai vanhempaa listaa, eikä sitä käytetä.",
      "The result belonged to another store or an older list and is not used.",
    ),
  }[status];
}

/**
 * The merchandise detail of one non-food row: the attributes the shopper gave, the one thing
 * still needed, the store's statement and the manual hand-off. Typing sends nothing; an answer is
 * one explicit edit.
 */
export function MerchandiseRow({
  language,
  intent,
  status,
  evidence,
  capabilities,
  busy,
  canOpenStore,
  answer,
  openStore,
}: {
  language: string;
  intent: MerchandiseIntent;
  status: MerchandiseStatus | null;
  evidence: MerchandiseEvidence | null;
  capabilities: MerchandiseCapabilities;
  busy: boolean;
  canOpenStore: boolean;
  answer: (
    kind: MerchandiseAttribute["kind"],
    value: string,
  ) => Promise<boolean>;
  openStore: () => void;
}) {
  const fi = language === "fi";
  const tr = (a: string, b: string) => (fi ? a : b);
  const [value, setValue] = useState("");
  const needed = intent.missing[0] ?? null;
  return (
    <div className="merchandise-row">
      {intent.attributes.length > 0 && (
        <small className="muted">
          {intent.attributes
            .map((a) => `${kindLabel(a.kind, fi)} ${a.value}`)
            .join(" · ")}
        </small>
      )}
      {needed ? (
        <form
          className="inline merchandise-ask"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!value.trim() || busy) return;
            if (await answer(needed, value.trim())) setValue("");
          }}
        >
          <p className="warning">
            {tr(
              `Tarvitaan vielä ${kindLabel(needed, true)}. Tuotetta ei haeta ennen sitä.`,
              `The ${kindLabel(needed, false)} is still needed. The product is not searched until then.`,
            )}
          </p>
          <label>
            {kindLabel(needed, fi).replace(/^./u, (c) =>
              c.toLocaleUpperCase(fi ? "fi" : "en"),
            )}
            <input
              value={value}
              maxLength={40}
              disabled={busy}
              onChange={(e) => setValue(e.target.value)}
            />
          </label>
          <button disabled={busy || !value.trim()}>
            {tr("Lisää tieto", "Add it")}
          </button>
        </form>
      ) : (
        status && (
          <p role="status" className="merchandise-status" data-status={status}>
            {merchandiseStatusText(status, fi)}
          </p>
        )
      )}
      {evidence && !needed && (
        <small className="muted merchandise-evidence">
          {[
            evidence.brand && `${tr("Merkki", "Brand")}: ${evidence.brand}`,
            evidence.inStore === true && tr("Kaupassa", "In the shop"),
            evidence.inStore === false &&
              tr("Ei myymälässä", "Not in the shop"),
            evidence.online === true && tr("Verkossa", "Online"),
            evidence.online === false && tr("Ei verkossa", "Not online"),
          ]
            .filter(Boolean)
            .join(" · ")}
        </small>
      )}
      {!capabilities.cartWrite && (
        <small className="muted merchandise-manual">
          {tr(
            "Ei-ruokatuotteita ei siirretä automaattisesti. Lisää tämä kaupan sivulla itse.",
            "Non-food products are not transferred automatically. Add this one on the store's own page.",
          )}
        </small>
      )}
      {canOpenStore && (
        <button className="text" type="button" onClick={openStore}>
          {tr("Avaa kaupan sivu", "Open the store page")}
        </button>
      )}
    </div>
  );
}
