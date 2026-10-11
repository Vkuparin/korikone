import React, { useEffect, useRef, useState } from "react";
import type { Snapshot } from "../application/service";
import type { BasketLine } from "../domain/model";
import { correctRowSchema, type CorrectRow } from "../domain/corrections";
import { categoryPreferenceSchema } from "../domain/preferences";
import { matchingPolicy, selectableCandidate } from "../domain/matching";
import { exclusionTerms } from "../domain/planner";
import { unitLabel } from "./i18n";
import { preferenceAttributeLabel } from "./category-preferences";

type Draft = {
  revision: number;
  line: BasketLine;
  reason: CorrectRow["reason"] | "";
  amount: string;
  replacement: string;
  remember: boolean;
  strength: "required" | "preferred";
};

/** Corrections use only retained alternatives and never start a catalogue or AI request. */
export function RowCorrection({
  snapshot,
  line,
  busy,
  correct,
}: {
  snapshot: Snapshot;
  line: BasketLine;
  busy: boolean;
  correct: (input: CorrectRow) => Promise<boolean>;
}) {
  const { state } = snapshot;
  const tr = (fi: string, en: string) => (state.language === "fi" ? fi : en);
  const [draft, setDraft] = useState<Draft | null>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const reasonInput = useRef<HTMLSelectElement>(null);
  const returnFocus = useRef(false);
  const open = draft !== null;
  useEffect(() => {
    if (open) reasonInput.current?.focus();
  }, [open]);
  useEffect(() => {
    if (!open && !busy && returnFocus.current) {
      returnFocus.current = false;
      opener.current?.focus();
    }
  }, [open, busy]);
  const close = () => {
    returnFocus.current = true;
    setDraft(null);
  };
  const selected = draft?.replacement.startsWith("product:")
    ? draft.line.candidates.find(
        (product) => product.id === draft.replacement.slice(8),
      )
    : null;
  const stale = !!draft && draft.revision !== state.revision;
  const rule = categoryPreferenceSchema.safeParse({
    category: matchingPolicy(draft?.line.requirement ?? line.requirement)
      .category,
    qualifiers: selected?.evidence?.qualifiers ?? [],
    strength: draft?.strength ?? "preferred",
  });
  const canRemember =
    !stale &&
    selected &&
    rule.success &&
    selectableCandidate(draft!.line.requirement, selected, {
      preference: rule.data,
      accepted: [selected.id],
      context: state.context,
      sourceNote: state.note,
      exclusions: exclusionTerms(state.household.exclusions),
    });
  const binding = {
    revision: draft?.revision,
    requirementKey: `${(draft?.line ?? line).requirement.id}:${(draft?.line ?? line).requirement.unit}`,
  };
  const input =
    draft?.reason === "wrong-quantity"
      ? { ...binding, reason: draft.reason, amount: Number(draft.amount) }
      : draft?.reason && (selected || draft.replacement === "unresolved")
        ? {
            ...binding,
            reason: draft.reason,
            replacementProductId: selected?.id ?? null,
            ...(draft.remember && canRemember && rule.success
              ? { remember: rule.data }
              : {}),
          }
        : null;
  const parsed = correctRowSchema.safeParse(input);
  const valid = parsed.success && (!draft?.remember || !!canRemember);
  return (
    <div className="row-correction">
      <button
        ref={opener}
        type="button"
        className="text"
        disabled={busy || !snapshot.quotedAt}
        aria-expanded={open}
        aria-label={`${tr("Tarkoitin jotain muuta", "I meant something else")}: ${line.requirement.name}`}
        onClick={() =>
          open
            ? close()
            : setDraft({
                revision: state.revision,
                line: structuredClone(line),
                reason: "",
                amount: String(line.requirement.amount),
                replacement: "",
                remember: false,
                strength: "preferred",
              })
        }
      >
        {tr("Tarkoitin jotain muuta…", "I meant something else…")}
      </button>
      {draft && (
        <form
          className="form correction-form"
          aria-label={`${tr("Korjaa rivi", "Correct row")}: ${line.requirement.name}`}
          onKeyDown={(event) => {
            if (event.key === "Escape" && !busy) {
              event.stopPropagation();
              close();
            }
          }}
          onSubmit={async (event) => {
            event.preventDefault();
            if (
              valid &&
              !stale &&
              parsed.success &&
              (await correct(parsed.data))
            )
              close();
          }}
        >
          <label>
            {tr("Mikä meni väärin?", "What was wrong?")}
            <select
              ref={reasonInput}
              value={draft.reason}
              disabled={busy}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  reason: event.target.value as Draft["reason"],
                  remember: false,
                })
              }
            >
              <option value="">{tr("Valitse syy", "Choose a reason")}</option>
              <option value="wrong-product-type">
                {tr("Väärä tuotetyyppi", "Wrong product type")}
              </option>
              <option value="wrong-quantity">
                {tr("Väärä määrä", "Wrong quantity")}
              </option>
              <option value="unsuitable-alternative">
                {tr("Sopimaton vaihtoehto", "Unsuitable alternative")}
              </option>
            </select>
          </label>
          {draft.reason === "wrong-quantity" ? (
            <label>
              {tr("Tarvittava määrä", "Required amount")} (
              {unitLabel(draft.line.requirement.unit, state.language)})
              <input
                type="number"
                min={1}
                max={10_000_000}
                step={1}
                value={draft.amount}
                disabled={busy}
                onChange={(event) =>
                  setDraft({ ...draft, amount: event.target.value })
                }
              />
            </label>
          ) : (
            draft.reason && (
              <>
                <label>
                  {tr("Korvaava tuote", "Replacement product")}
                  <select
                    value={draft.replacement}
                    disabled={busy}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        replacement: event.target.value,
                        remember: false,
                        strength: "preferred",
                      })
                    }
                  >
                    <option value="">
                      {tr("Valitse vaihtoehto", "Choose an alternative")}
                    </option>
                    <option value="unresolved">
                      {tr(
                        "Sopivaa tuotetta ei ole – jätä ratkaisematta",
                        "No suitable product — leave unresolved",
                      )}
                    </option>
                    {draft.line.candidates.map((product) => (
                      <option key={product.id} value={`product:${product.id}`}>
                        {product.name}
                        {product.available === false
                          ? ` · ${tr("Ei saatavilla", "Unavailable")}`
                          : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <p>
                  {tr(
                    "Valinta koskee nykyistä listaa. Jos korvaava tuote ei täytä vaatimuksia, rivi jää ratkaisematta. Muita tuotteita ei valita automaattisesti.",
                    "This choice applies to the current list. If the replacement does not meet the requirements, the row stays unresolved. Another product is not chosen automatically.",
                  )}
                </p>
                {canRemember && rule.success && (
                  <>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={draft.remember}
                        disabled={busy}
                        onChange={(event) =>
                          setDraft({ ...draft, remember: event.target.checked })
                        }
                      />
                      {tr(
                        "Muista tämä tuotetyyppi tuleville listoille",
                        "Remember this product type for future lists",
                      )}
                    </label>
                    {draft.remember && (
                      <>
                        <p>
                          {rule.data.qualifiers
                            .map(
                              (qualifier) =>
                                `${preferenceAttributeLabel(qualifier.kind, state.language)}: ${preferenceAttributeLabel(qualifier.value, state.language)}`,
                            )
                            .join(" · ")}
                        </p>
                        <label>
                          {tr("Valinnan merkitys", "Meaning of the choice")}
                          <select
                            value={draft.strength}
                            disabled={busy}
                            onChange={(event) =>
                              setDraft({
                                ...draft,
                                strength: event.target
                                  .value as Draft["strength"],
                              })
                            }
                          >
                            <option value="preferred">
                              {tr("Suosittu", "Preferred")}
                            </option>
                            <option value="required">
                              {tr("Vaadittu", "Required")}
                            </option>
                          </select>
                        </label>
                        <p>
                          {tr(
                            "Vaadittu tyyppi pitää löytyä. Suosittu tyyppi on ensisijainen; muun tyypin käyttö vaatii hyväksyntäsi. Sääntö toimii molemmissa kauppaketjuissa.",
                            "Required types must be available. Preferred types are tried first; another type needs your approval. The rule applies on both chains.",
                          )}
                        </p>
                      </>
                    )}
                  </>
                )}
              </>
            )
          )}
          {stale && (
            <p className="warning">
              {tr(
                "Lista muuttui. Peruuta ja avaa korjaus uudelleen.",
                "The list changed. Cancel and reopen the correction.",
              )}
            </p>
          )}
          <button type="submit" disabled={busy || stale || !valid}>
            {tr("Tallenna korjaus", "Save correction")}
          </button>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={close}
          >
            {tr("Peruuta", "Cancel")}
          </button>
        </form>
      )}
    </div>
  );
}
