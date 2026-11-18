import { useEffect, useRef, useState, type FormEvent } from "react";
import type { StoreContext } from "../domain/model";
import type { Key } from "./i18n";

const chains = ["k-ruoka", "s-kaupat"] as const;
const chainName = (id: string) => (id === "k-ruoka" ? "K-Ruoka" : "S-kaupat");

export function StoreSearch({
  visible,
  busy,
  chain,
  language,
  t,
  choose,
}: {
  visible: boolean;
  busy: boolean;
  chain?: string;
  language: string;
  t: (key: Key) => string;
  choose: (store: StoreContext) => Promise<void>;
}) {
  const fi = language === "fi";
  const tr = (a: string, b: string) => (fi ? a : b);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{
    term: string;
    stores: StoreContext[] | null;
  } | null>(null);
  const term = query.trim();
  const current = result?.term === term ? result : null;
  useEffect(() => {
    if (visible) input.current?.focus({ preventScroll: true });
  }, [visible]);

  async function search(event: FormEvent) {
    event.preventDefault();
    if (busy || pending || term.length < 2) return;
    setPending(true);
    setResult(null);
    try {
      const response = await window.korikone.searchStores(term);
      setResult({
        term,
        stores: response.ok
          ? response.value.storeResults.filter(
              (store) => !chain || store.providerId === chain,
            )
          : null,
      });
    } catch {
      setResult({ term, stores: null });
    } finally {
      setPending(false);
    }
  }
  if (!visible) return null;
  return (
    <div className="store-search">
      <form className="inline" onSubmit={search}>
        <label>
          {chain
            ? chainName(chain) + ": " + t("searchStore")
            : t("searchStores")}
          <input
            name="query"
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            minLength={2}
            maxLength={150}
            required
            placeholder="Helsinki"
          />
        </label>
        <button disabled={busy || pending || term.length < 2}>
          {t("search")}
        </button>
      </form>
      <p role="status" className="store-search-status muted">
        {pending
          ? tr("Haetaan kauppoja…", "Searching for stores…")
          : current?.stores === null
            ? tr(
                "Haku epäonnistui. Yritä uudelleen.",
                "Store search failed. Try again.",
              )
            : current?.stores.length === 0
              ? tr(
                  "Kauppoja ei löytynyt. Kokeile toista paikkakuntaa tai kaupan nimeä.",
                  "No stores found. Try another town or store name.",
                )
              : current
                ? tr(
                    "Valitse kauppa hakutuloksista.",
                    "Choose a store from the results.",
                  )
                : ""}
      </p>
      {!!current?.stores?.length && (
        <div className="store-search-results">
          {chains.map((id) => {
            const stores = current.stores!.filter(
              (store) => store.providerId === id,
            );
            if (!stores.length) return null;
            return (
              <div key={id} role="group" aria-label={chainName(id)}>
                {!chain && <strong>{chainName(id)}</strong>}
                {stores.map((store) => (
                  <button
                    className="secondary"
                    key={store.storeId}
                    disabled={busy}
                    onClick={() => void choose(store)}
                  >
                    {store.storeName}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
