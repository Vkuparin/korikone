import React, { useEffect, useRef, useState } from "react";
import type { Snapshot } from "../application/service";
import type { StoreContext } from "../domain/model";

export function ShoppingContext({
  snapshot,
  busy,
  apply,
  setBusy,
}: {
  snapshot: Snapshot;
  busy: boolean;
  apply: (snapshot: Snapshot) => void;
  setBusy: (busy: boolean) => void;
}) {
  const current = snapshot.state.context;
  const fi = snapshot.state.language === "fi";
  const tr = (a: string, b: string) => (fi ? a : b);
  const [opened, setOpened] = useState<"store" | "fulfillment" | null>(null);
  const [choice, setChoice] = useState(current);
  const [revision, setRevision] = useState(snapshot.state.revision);
  const [options, setOptions] = useState<StoreContext["fulfillment"][] | null>(
    null,
  );
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<StoreContext[]>([]);
  const [searched, setSearched] = useState(false);
  const [pending, setPending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(0);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const returnFocus = useRef(false);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (opened) panel.current?.focus();
  }, [opened]);
  useEffect(() => {
    if (!opened && !busy && !saving && returnFocus.current) {
      returnFocus.current = false;
      trigger.current?.focus();
    }
  }, [opened, busy, saving]);
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  function close() {
    if (saving) return;
    request.current++;
    setOpened(null);
    setPending(false);
    trigger.current?.focus();
  }
  async function readOptions(context: StoreContext) {
    const run = ++request.current;
    setPending(true);
    setOptions(null);
    setError("");
    try {
      const result = await window.korikone.getContextOptions(context);
      if (run !== request.current) return;
      if (!result.ok) throw new Error(result.error);
      const values = result.value.contextOptions!.fulfillments;
      setOptions(values);
      setChoice({
        ...context,
        fulfillment: values.includes(context.fulfillment)
          ? context.fulfillment
          : "pickup",
      });
    } catch {
      if (run === request.current)
        setError(
          tr(
            "Vaihtoehtojen haku epäonnistui. Yritä uudelleen.",
            "Could not retrieve options. Try again.",
          ),
        );
    } finally {
      if (run === request.current) setPending(false);
    }
  }
  function open(kind: "store" | "fulfillment", button: HTMLButtonElement) {
    trigger.current = button;
    setChoice(current);
    setRevision(snapshot.state.revision);
    setQuery("");
    setFound([]);
    setSearched(false);
    setOpened(kind);
    void readOptions(current);
  }
  async function search() {
    const run = ++request.current;
    setPending(true);
    setError("");
    setFound([]);
    setSearched(false);
    try {
      const result = await window.korikone.searchStores(query.trim());
      if (run !== request.current) return;
      if (!result.ok) throw new Error(result.error);
      setFound(result.value.storeResults);
      setSearched(true);
    } catch {
      if (run === request.current)
        setError(
          tr(
            "Kauppojen haku epäonnistui. Yritä uudelleen.",
            "Could not search stores. Try again.",
          ),
        );
    } finally {
      if (run === request.current) setPending(false);
    }
  }
  async function confirm() {
    setSaving(true);
    setBusy(true);
    setError("");
    try {
      const result = await window.korikone.changeContext({
        context: choice,
        revision,
      });
      if (!result.ok) throw new Error(result.error);
      apply(result.value);
      returnFocus.current = true;
      setOpened(null);
    } catch (failure) {
      setError(
        failure instanceof Error && failure.message === "draftStale"
          ? tr(
              "Lista muuttui. Sulje valinta ja avaa se uudelleen.",
              "The list changed. Close this selector and reopen it.",
            )
          : tr(
              "Valinnan muuttaminen epäonnistui. Nykyinen kauppa ja hinnat säilyivät. Yritä uudelleen.",
              "Could not change the selection. The current store and prices were kept. Try again.",
            ),
      );
    } finally {
      setSaving(false);
      setBusy(false);
    }
  }
  const stores = [
    ...new Map(
      [current, ...Object.values(snapshot.state.stores), ...found].map(
        (context) => [`${context.providerId}:${context.storeId}`, context],
      ),
    ).values(),
  ];
  const same = (context: StoreContext) =>
    context.providerId === choice.providerId &&
    context.storeId === choice.storeId;
  const unchanged = same(current) && choice.fulfillment === current.fulfillment;
  return (
    <>
      <div className="context">
        <button
          className="text"
          disabled={busy || saving}
          aria-expanded={opened === "store"}
          onClick={(event) => open("store", event.currentTarget)}
        >
          {current.storeName} · {tr("Vaihda kauppaa", "Change store")}
        </button>
        <button
          className="text"
          disabled={busy || saving}
          aria-expanded={opened === "fulfillment"}
          onClick={(event) => open("fulfillment", event.currentTarget)}
        >
          {current.fulfillment === "pickup"
            ? tr("Nouto", "Pickup")
            : tr("Toimitus", "Delivery")}{" "}
          · {tr("Vaihda toimitustapaa", "Change fulfillment")}
        </button>
      </div>
      {opened && (
        <section
          className="context-selector"
          role="dialog"
          tabIndex={-1}
          aria-label={
            opened === "store"
              ? tr("Vaihda kauppaa", "Change store")
              : tr("Vaihda toimitustapaa", "Change fulfillment")
          }
          ref={panel}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              close();
            }
          }}
        >
          <h2>
            {opened === "store"
              ? tr("Vaihda kauppaa", "Change store")
              : tr("Vaihda toimitustapaa", "Change fulfillment")}
          </h2>
          {opened === "store" ? (
            <>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void search();
                }}
              >
                <label>
                  {tr("Etsi kauppa", "Search stores")}
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    disabled={pending || saving}
                    maxLength={150}
                  />
                </label>
                <button disabled={pending || saving || query.trim().length < 2}>
                  {tr("Etsi", "Search")}
                </button>
              </form>
              <fieldset disabled={pending || saving}>
                <legend>{tr("Valitse kauppa", "Choose a store")}</legend>
                {stores.map((context) => (
                  <label
                    className="check"
                    key={`${context.providerId}:${context.storeId}`}
                  >
                    <input
                      type="radio"
                      name="header-store"
                      checked={same(context)}
                      onChange={() => {
                        setChoice(context);
                        void readOptions(context);
                      }}
                    />
                    {context.storeName}
                    {context.providerId === current.providerId &&
                    context.storeId === current.storeId
                      ? tr(" (nykyinen)", " (current)")
                      : ""}
                  </label>
                ))}
              </fieldset>
              {searched && !found.length && (
                <p role="status">
                  {tr("Kauppoja ei löytynyt.", "No stores found.")}
                </p>
              )}
            </>
          ) : (
            <fieldset disabled={pending || saving}>
              <legend>
                {tr("Valitse toimitustapa", "Choose fulfillment")}
              </legend>
              {(["pickup", "delivery"] as const).map((value) => (
                <label className="check" key={value}>
                  <input
                    type="radio"
                    name="header-fulfillment"
                    checked={choice.fulfillment === value}
                    disabled={!options?.includes(value)}
                    onChange={() =>
                      setChoice({ ...choice, fulfillment: value })
                    }
                  />
                  {value === "pickup"
                    ? tr("Nouto", "Pickup")
                    : tr("Toimitus", "Delivery")}
                  {current.fulfillment === value
                    ? tr(" (nykyinen)", " (current)")
                    : ""}
                </label>
              ))}
              {options && !options.includes("delivery") && (
                <p>
                  {tr(
                    "Toimitusta ei voi valita tässä kaupassa Korikonen kautta. Osoite ja toimitusaika valitaan kaupan sivulla.",
                    "Delivery cannot be selected for this store through Korikone. Choose the address and delivery time on the retailer site.",
                  )}
                </p>
              )}
            </fieldset>
          )}
          {(pending || saving) && (
            <p role="status">
              {saving
                ? tr(
                    "Päivitetään kauppaa ja hintoja…",
                    "Updating store and prices…",
                  )
                : tr("Haetaan vaihtoehtoja…", "Loading options…")}
            </p>
          )}
          {error && <p role="alert">{error}</p>}
          {error && !options && (
            <button
              disabled={pending || saving}
              onClick={() => void readOptions(choice)}
            >
              {tr("Yritä uudelleen", "Try again")}
            </button>
          )}
          <div className="actions">
            <button
              disabled={pending || saving || busy || !options || unchanged}
              onClick={() => void confirm()}
            >
              {tr("Vahvista valinta", "Confirm selection")}
            </button>
            <button className="secondary" disabled={saving} onClick={close}>
              {tr("Peruuta", "Cancel")}
            </button>
          </div>
        </section>
      )}
    </>
  );
}
