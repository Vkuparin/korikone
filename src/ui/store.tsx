import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Snapshot } from "../application/service";
import { isLive, liveProviders } from "../stores/provider";
import { omittedReviewItems } from "./transfer-summary";
import { CheckoutButton, type CheckoutOrder } from "./checkout";

export type Chain = "k-ruoka" | "s-kaupat";
const NAMES: Record<string, string> = {
  "k-ruoka": "K-Ruoka",
  "s-kaupat": "S-kaupat",
};

/** Chains with a chosen store get a tab. */
export const storeChains = (snapshot: Snapshot) =>
  liveProviders.filter(
    (id) =>
      snapshot.state.context.providerId === id || !!snapshot.state.stores[id],
  ) as Chain[];

/**
 * The store's own site inside Korikone. The page itself is drawn by the main process over the
 * frame below; this component only tells it where the frame is.
 */
export function StorePage({
  snapshot,
  chain,
  setChain,
  settings,
  returnToList,
  order,
}: {
  snapshot: Snapshot;
  chain: Chain | null;
  setChain: (chain: Chain) => void;
  settings: () => void;
  /** Leaves the Store view for Korikone's shopping list. Absent during first setup. */
  returnToList?: (destination: "position" | "add") => void;
  order?: CheckoutOrder;
}) {
  const fi = snapshot.state.language === "fi";
  const tr = (a: string, b: string) => (fi ? a : b);
  const chains = storeChains(snapshot);
  if (chain && !chains.includes(chain)) chains.push(chain);
  const current =
    chain && chains.includes(chain)
      ? chain
      : (chains.find((c) => c === snapshot.state.context.providerId) ??
        chains[0] ??
        null);
  const frame = useRef<HTMLDivElement>(null);
  // Whether each chain's store page has an earlier page of its own. Unknown counts as none.
  const [history, setHistory] = useState<Record<string, boolean>>({});
  useEffect(
    () =>
      window.korikone.onStoreHistoryChange(({ chain, canGoBack }) =>
        setHistory((known) => ({ ...known, [chain]: canGoBack })),
      ),
    [],
  );
  useEffect(() => {
    if (!current) return;
    void window.korikone.storeHistory({ chain: current }).then((result) => {
      if (result.ok)
        setHistory((known) => ({
          ...known,
          [current]: result.value.canGoBack,
        }));
    });
  }, [current]);

  useLayoutEffect(() => {
    if (!current) return;
    let pendingFrame = 0;
    let lastArea: {
      x: number;
      y: number;
      width: number;
      height: number;
    } | null = null;
    const place = () => {
      pendingFrame = 0;
      const element = frame.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      const height = Math.max(window.innerHeight - rect.top - 16, 200);
      const area = {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(height),
      };
      if (
        lastArea &&
        area.x === lastArea.x &&
        area.y === lastArea.y &&
        area.width === lastArea.width &&
        area.height === lastArea.height
      )
        return;
      lastArea = area;
      element.style.height = `${height}px`;
      void window.korikone
        .storeView({ chain: current, area })
        .then((result) => {
          if (!result.ok && lastArea === area) lastArea = null;
        });
    };
    const schedule = () => {
      if (!pendingFrame) pendingFrame = requestAnimationFrame(place);
    };
    place();
    const observer = new ResizeObserver(schedule);
    if (frame.current) observer.observe(frame.current);
    observer.observe(document.body);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(pendingFrame);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
    };
  }, [current]);
  useEffect(() => () => void window.korikone.hideStore(), []);

  // The example list runs on a sample store, which has no retailer page to show (B7.8).
  const sample = !isLive(snapshot.state.context.providerId);
  if (!current && sample)
    return (
      <section className="store-page store-sample">
        <h1>{tr("Kauppa", "Store")}</h1>
        <p>
          {tr(
            `Esimerkkilista käyttää mallikauppaa (${snapshot.state.context.storeName}), joten tässä ei ole kaupan sivua. Kun valitset oikean kaupan, sen sivu avautuu tähän ja lista siirtyy sinne.`,
            `The example list uses a sample store (${snapshot.state.context.storeName}), so there is no store page here. Once you choose a real store, its page opens here and the list moves there.`,
          )}
        </p>
        <button onClick={settings}>
          {tr("Valitse oikea kauppa", "Choose a real store")}
        </button>
      </section>
    );
  if (!current)
    return (
      <section className="store-page">
        <h1>{tr("Kauppa", "Store")}</h1>
        <p>
          {tr(
            "Valitse ensin kauppa Asetuksista.",
            "Choose a store in Settings first.",
          )}
        </p>
        <button onClick={settings}>
          {tr("Avaa Asetukset", "Open Settings")}
        </button>
      </section>
    );
  const action = (name: "back" | "reload" | "browser") =>
    void window.korikone.storeAction({ chain: current, action: name });
  const journal = snapshot.journal;
  const handoff =
    returnToList &&
    journal?.status === "verified" &&
    !journal.listClosed &&
    (journal.batchKey === snapshot.transferBatchKey ||
      (order?.placed &&
        current &&
        snapshot.state.stores[current]?.storeId ===
          journal.review.context.storeId)) &&
    journal.review.context.providerId === current
      ? journal.review
      : null;
  const addAtStore = handoff
    ? [
        ...omittedReviewItems(handoff),
        ...(handoff.manual ?? []).map((item) => item.productName),
      ]
    : [];
  return (
    <section className="store-page" aria-label={tr("Kauppa", "Store")}>
      <div className="store-toolbar">
        <div role="tablist" aria-label={tr("Kaupat", "Stores")}>
          {chains.map((id) => (
            <button
              key={id}
              role="tab"
              aria-selected={id === current}
              className={id === current ? "" : "secondary"}
              onClick={() => setChain(id)}
            >
              {NAMES[id]}
            </button>
          ))}
        </div>
        {returnToList && (
          <button
            className="secondary"
            data-store-return="list"
            onClick={() => returnToList("position")}
          >
            {tr("Palaa ostoslistaan", "Return to shopping list")}
          </button>
        )}
        <button
          className="text"
          data-store-action="back"
          disabled={!history[current]}
          aria-describedby="store-back-help"
          onClick={() => action("back")}
        >
          ←{" "}
          {tr(
            `Edellinen sivu (${NAMES[current]})`,
            `Previous page (${NAMES[current]})`,
          )}
        </button>
        <span id="store-back-help" className="sr-only">
          {history[current]
            ? tr(
                "Siirtyy kaupan sivuston edelliselle sivulle. Ei poistu Kauppa-näkymästä.",
                "Goes to the previous page of the store site. Does not leave the Store view.",
              )
            : tr(
                "Kaupan sivustolla ei ole aiempaa sivua tässä näkymässä.",
                "The store site has no earlier page in this view.",
              )}
        </span>
        <button className="text" onClick={() => action("reload")}>
          {tr("Lataa uudelleen", "Reload")}
        </button>
        {!snapshot.developmentMode && (
          <button className="text" onClick={() => action("browser")}>
            {tr("Avaa selaimessa", "Open in browser")}
          </button>
        )}
        <button className="text" onClick={settings}>
          {tr("Kauppojen asetukset", "Store settings")}
        </button>
      </div>
      {handoff ? (
        <section
          className="store-handoff"
          aria-label={tr("Siirto kauppaan", "Store transfer")}
        >
          <strong>
            {order?.placed
              ? tr("Tilaus merkitty tehdyksi", "Order marked as placed")
              : current === "s-kaupat"
                ? tr(
                    "Lisää Korikone-listan tuotteet S-kauppojen ostoskoriin.",
                    "Add the products from your Korikone list to the S-kaupat basket.",
                  )
                : tr(
                    "Tarkista K-Ruoan ostoskori ja viimeistele tilaus.",
                    "Check your K-Ruoka basket and complete your order.",
                  )}
          </strong>
          {!order?.placed && returnToList && (
            <button
              type="button"
              className="secondary"
              onClick={() => returnToList("add")}
            >
              {tr(
                "Palaa listaan lisäämään tuote",
                "Return to the list to add an item",
              )}
            </button>
          )}
          {order && (
            <div className="checkout-action">
              {!order.placed && (
                <p>
                  {tr(
                    "Kun olet tehnyt tilauksen kaupassa, merkitse se ostoshistoriaan.",
                    "Once you’ve placed the order at the store, mark it in your shopping history.",
                  )}
                </p>
              )}
              <CheckoutButton
                order={order}
                language={snapshot.state.language}
              />
            </div>
          )}
          {!!handoff.alreadySent?.length && (
            <p>
              {handoff.targets.length
                ? tr("Lisätty tällä kertaa", "Added this time")
                : tr(
                    "Kauppaan ei tarvinnut lisätä tuotteita.",
                    "The store quantities needed no top-up.",
                  )}
              {handoff.targets.length > 0 &&
                ` · ${handoff.targets.map((item) => `${item.name} × ${item.quantity - item.before}`).join(", ")}`}
            </p>
          )}
          {!order?.placed && addAtStore.length > 0 && (
            <details open={addAtStore.length <= 4}>
              <summary>
                {tr("Lisää tarvittaessa itse", "Add these yourself if needed")}{" "}
                · {addAtStore.length}
              </summary>
              <p>{addAtStore.join(", ")}</p>
            </details>
          )}
        </section>
      ) : (
        <p className="muted">
          {tr(
            "Kirjaudu tähän näkymään kerran; kirjautuminen säilyy. Tilaus ja maksu tehdään aina täällä itse.",
            "Sign in here once; the sign-in is kept. You always place the order and pay here yourself.",
          )}
        </p>
      )}
      <div
        ref={frame}
        className="store-frame"
        data-chain={current}
        aria-label={`${NAMES[current]} ${tr("sivusto", "site")}`}
        role="region"
      />
    </section>
  );
}
