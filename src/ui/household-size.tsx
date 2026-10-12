import React, { useEffect, useRef, useState } from "react";
import type { Snapshot } from "../application/service";

type Preview = {
  from: number;
  to: number;
  scaled: { mealId: string; name: string; before: number; after: number }[];
  kept: { mealId: string; name: string; servings: number }[];
};

/**
 * The household-size chip of the composer as a compact inline control. It shows what the new
 * count would do to the planned meals before it applies, applies it with the one local operation
 * that Settings also uses, and offers Undo through the usual edit outcome. Opening, typing and
 * cancelling make no request of any kind; Escape closes it and returns focus to the chip.
 */
export function HouseholdSizeControl({
  snapshot,
  busy,
  call,
  openSettings,
}: {
  snapshot: Snapshot;
  busy: boolean;
  call: (method: string, input?: unknown) => Promise<boolean>;
  openSettings: () => void;
}) {
  const { state } = snapshot;
  const fi = state.language === "fi";
  const tr = (a: string, b: string) => (fi ? a : b);
  const current = state.household.servings;
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(String(current));
  const [preview, setPreview] = useState<Preview | null>(null);
  const chip = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const value = Number(text);
  const valid =
    /^\d{1,3}$/.test(text.trim()) &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 100;
  const changed = valid && value !== current;

  useEffect(() => {
    if (open) requestAnimationFrame(() => input.current?.select());
  }, [open]);
  useEffect(() => {
    let live = true;
    if (!open || !changed) {
      setPreview(null);
      return;
    }
    // A read of the saved plan only: no model, catalogue or retailer is involved.
    void window.korikone.previewHouseholdSize({ servings: value }).then((r) => {
      if (live && r.ok) setPreview((r as unknown as { value: Preview }).value);
    });
    return () => {
      live = false;
    };
  }, [open, changed, value]);

  const close = () => {
    setOpen(false);
    requestAnimationFrame(() => chip.current?.focus());
  };
  const apply = async () => {
    if (!changed || busy) return;
    const ok = await call("setHouseholdSize", {
      revision: state.revision,
      servings: value,
    });
    if (ok) close();
  };
  return (
    <span className="household-size">
      <button
        ref={chip}
        className="chip"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          // The field starts at the saved size; set here so a later effect cannot overwrite typing.
          if (!open) setText(String(current));
          setOpen(!open);
        }}
      >
        {current} {tr("henkeä", "people")}
      </button>
      {open && (
        <div
          className="household-popover"
          role="dialog"
          aria-label={tr("Henkilömäärä", "Number of people")}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              close();
            }
          }}
        >
          <label>
            {tr("Henkilömäärä", "Number of people")}
            <input
              ref={input}
              inputMode="numeric"
              value={text}
              aria-invalid={!valid}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void apply();
                }
              }}
            />
          </label>
          {!valid && (
            <p role="status" className="muted">
              {tr(
                "Anna kokonaisluku väliltä 1–100.",
                "Enter a whole number from 1 to 100.",
              )}
            </p>
          )}
          {changed && preview && (
            <div role="status" className="household-preview">
              {preview.scaled.length > 0 ? (
                <ul>
                  {preview.scaled.map((m) => (
                    <li key={m.mealId}>
                      {m.name}: {m.before} → {m.after}{" "}
                      {tr("annosta", "servings")}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>
                  {tr("Yksikään ateria ei muutu.", "No planned meal changes.")}
                </p>
              )}
              {preview.kept.length > 0 && (
                <p className="muted">
                  {tr("Pysyvät ennallaan", "Kept as planned")}:{" "}
                  {preview.kept
                    .map((m) => `${m.name} (${m.servings})`)
                    .join(", ")}
                </p>
              )}
            </div>
          )}
          <div className="actions">
            <button disabled={busy || !changed} onClick={() => void apply()}>
              {tr("Käytä", "Apply")}
            </button>
            <button className="secondary" onClick={close}>
              {tr("Peruuta", "Cancel")}
            </button>
            <button
              className="text"
              onClick={() => {
                setOpen(false);
                openSettings();
              }}
            >
              {tr("Kotitalousasetukset", "Household settings")}
            </button>
          </div>
        </div>
      )}
    </span>
  );
}
