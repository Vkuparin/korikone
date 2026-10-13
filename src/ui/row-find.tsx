import React, { useEffect, useRef, useState } from "react";

export type FindResult = "resolved" | "options" | "none" | "failed";

/**
 * An explicit way to say what an unresolved row should be (B2.4). Nothing is searched while the
 * shopper types: the wording is sent once, with the row as context, when Find is pressed.
 */
export function RowFind({
  language,
  name,
  amountLabel,
  busy,
  aiConnected,
  find,
}: {
  language: string;
  name: string;
  amountLabel: string;
  busy: boolean;
  aiConnected: boolean;
  find: (wording: string) => Promise<FindResult>;
}) {
  const tr = (fi: string, en: string) => (language === "fi" ? fi : en);
  const [open, setOpen] = useState(false);
  const [wording, setWording] = useState("");
  const [result, setResult] = useState<FindResult | null>(null);
  const [searched, setSearched] = useState("");
  const [working, setWorking] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const returnFocus = useRef(false);
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  useEffect(() => {
    if (!open && returnFocus.current && !busy) {
      returnFocus.current = false;
      opener.current?.focus();
    }
  }, [open, busy]);
  const close = () => {
    returnFocus.current = true;
    setOpen(false);
    setResult(null);
    setWording("");
  };
  const text = wording.trim();
  return (
    <div className="row-find">
      <button
        ref={opener}
        type="button"
        className="text"
        aria-expanded={open}
        aria-label={`${tr("Etsi tuote", "Find a product")}: ${name}`}
        disabled={busy && !open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        {tr("Etsi tuote…", "Find a product…")}
      </button>
      {open && (
        <form
          className="form find-form"
          aria-label={`${tr("Etsi tuote riville", "Find a product for the row")}: ${name}`}
          onKeyDown={(event) => {
            if (event.key === "Escape" && !working) {
              event.stopPropagation();
              close();
            }
          }}
          onSubmit={async (event) => {
            event.preventDefault();
            if (!text || busy || working || !aiConnected) return;
            setWorking(true);
            setResult(null);
            setSearched(text);
            const outcome = await find(text);
            setWorking(false);
            if (outcome === "resolved" || outcome === "options") {
              setOpen(false);
              setWording("");
              setResult(null);
            } else {
              setResult(outcome);
              input.current?.focus();
            }
          }}
        >
          <p className="muted">
            {tr("Rivi", "Row")}: <strong>{name}</strong> · {amountLabel}
          </p>
          <label>
            {tr(
              "Tuotteen nimi, merkki tai tyyppi",
              "Product name, brand or type",
            )}
            <input
              ref={input}
              type="text"
              maxLength={200}
              value={wording}
              disabled={busy || working}
              onChange={(event) => setWording(event.target.value)}
            />
          </label>
          <p className="muted">
            {tr(
              "Haku tehdään vasta, kun painat Etsi. Rivin määrä säilyy, eikä valintaa tallenneta tuleville listoille.",
              "The search runs only when you press Find. The row keeps its amount and nothing is saved for future lists.",
            )}
          </p>
          {!aiConnected && (
            <p className="warning">
              {tr(
                "Tuotteen etsintä tarvitsee ChatGPT-yhteyden. Kirjaudu Asetuksissa.",
                "Finding a product needs the ChatGPT connection. Sign in under Settings.",
              )}
            </p>
          )}
          {result === "none" && (
            <p role="alert" className="warning">
              {tr(
                `Nimellä "${searched}" ei löytynyt sopivaa tuotetta. Rivin määrä säilyi. Kokeile toista nimeä tai merkkiä, tai jätä rivi pois siirrosta.`,
                `No suitable product was found for "${searched}". The row keeps its amount. Try another name or brand, or leave the row out of the transfer.`,
              )}
            </p>
          )}
          {result === "failed" && (
            <p role="alert" className="warning">
              {tr(
                "Hakua ei voitu tehdä. Lista ei muuttunut. Yritä uudelleen.",
                "The search could not be made. The list did not change. Try again.",
              )}
            </p>
          )}
          <button
            type="submit"
            disabled={busy || working || !text || !aiConnected}
          >
            {working ? tr("Etsitään…", "Searching…") : tr("Etsi", "Find")}
          </button>
          <button
            type="button"
            className="secondary"
            disabled={working}
            onClick={close}
          >
            {tr("Peruuta", "Cancel")}
          </button>
        </form>
      )}
    </div>
  );
}
