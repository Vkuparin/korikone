import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Snapshot } from "../application/service";
import { liveProviders } from "../stores/provider";

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
}: {
  snapshot: Snapshot;
  chain: Chain | null;
  setChain: (chain: Chain) => void;
  settings: () => void;
  /** Leaves the Store view for Korikone's shopping list. Absent during first setup. */
  returnToList?: () => void;
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
    const place = () => {
      const element = frame.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      const height = Math.max(window.innerHeight - rect.top - 16, 200);
      element.style.height = `${height}px`;
      void window.korikone.storeView({
        chain: current,
        area: {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(height),
        },
      });
    };
    place();
    const observer = new ResizeObserver(place);
    if (frame.current) observer.observe(frame.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [current]);
  useEffect(() => () => void window.korikone.hideStore(), []);

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
            onClick={returnToList}
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
      <p className="muted">
        {tr(
          "Kirjaudu tähän näkymään kerran; kirjautuminen säilyy. Tilaus ja maksu tehdään aina täällä itse.",
          "Sign in here once; the sign-in is kept. You always place the order and pay here yourself.",
        )}
      </p>
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
