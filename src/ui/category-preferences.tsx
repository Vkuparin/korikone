import React, { useEffect, useRef, useState } from "react";
import { classificationSchema, qualifierValues } from "../domain/categories";
import type { CategoryPreference } from "../domain/preferences";
import type { SettingsSectionProps } from "./settings-contract";

const copy = {
  fi: {
    title: "Muistetut tuotetyypit",
    help: "Vaadittu tyyppi pitää löytyä. Suosittu tyyppi on ensisijainen; muun tyypin käyttö vaatii hyväksyntäsi. Nykyisen listan tarkka pyyntö ohittaa muistetun valinnan vain sillä kertaa.",
    empty:
      "Muistettuja tuotetyyppejä ei ole. Voit muistaa valinnan ostosrivin yhteydessä.",
    edit: "Muokkaa",
    forget: "Unohda",
    save: "Tallenna tyyppi",
    cancel: "Peruuta",
    required: "Vaadittu",
    preferred: "Suosittu",
    strength: "Valinnan merkitys",
    any: "Ei muistettua rajaa",
    reset: "Unohda kaikki tuotetyypit",
    confirm: "Unohdetaanko kaikki muistetut tuotetyypit?",
    confirmHelp:
      "Tämä poistaa vain tuotetyyppien säännöt. Voit palauttaa ne aiemmin tallennetusta varmuuskopiosta.",
    confirmReset: "Vahvista unohtaminen",
    backup: "Tallenna varmuuskopio ennen muutoksia",
    invalid: "Valitse ainakin yksi tuotetyypin ominaisuus.",
  },
  en: {
    title: "Remembered product types",
    help: "Required types must be available. Preferred types are tried first; another type needs your approval. A specific request in the current list overrides memory for that run only.",
    empty:
      "No product types are remembered. You can remember a choice from a shopping row.",
    edit: "Edit",
    forget: "Forget",
    save: "Save type",
    cancel: "Cancel",
    required: "Required",
    preferred: "Preferred",
    strength: "Meaning of the choice",
    any: "No remembered constraint",
    reset: "Forget all product types",
    confirm: "Forget all remembered product types?",
    confirmHelp:
      "This removes only product type rules. You can restore them from a previously saved backup.",
    confirmReset: "Confirm forgetting",
    backup: "Save a backup before changes",
    invalid: "Select at least one product type attribute.",
  },
};
const categories = {
  fi: {
    milk: "Maito",
    bread: "Leipä",
    eggs: "Kananmunat",
    mince: "Jauheliha",
    onion: "Sipuli",
    rice: "Riisi",
    cream: "Kerma",
    coffee: "Kahvi",
  },
  en: {
    milk: "Milk",
    bread: "Bread",
    eggs: "Eggs",
    mince: "Mince",
    onion: "Onion",
    rice: "Rice",
    cream: "Cream",
    coffee: "Coffee",
  },
};
const labels: Record<string, [string, string]> = {
  fat: ["Rasvapitoisuus", "Fat content"],
  lactose: ["Laktoosi", "Lactose"],
  meat: ["Liha", "Meat"],
  grain: ["Vilja", "Grain"],
  onion: ["Sipulin tyyppi", "Onion type"],
  rice: ["Riisin tyyppi", "Rice type"],
  cream: ["Kerman tyyppi", "Cream type"],
  coffee: ["Kahvin muoto", "Coffee form"],
  skimmed: ["Rasvaton", "Skimmed"],
  "semi-skimmed": ["Kevyt", "Semi-skimmed"],
  whole: ["Täysmaito", "Whole milk"],
  free: ["Laktoositon", "Lactose free"],
  low: ["Vähälaktoosinen", "Low lactose"],
  beef: ["Nauta", "Beef"],
  pork: ["Sika", "Pork"],
  "beef-pork": ["Sika-nauta", "Beef and pork"],
  chicken: ["Broileri", "Chicken"],
  turkey: ["Kalkkuna", "Turkey"],
  rye: ["Ruis", "Rye"],
  wheat: ["Vehnä", "Wheat"],
  wholegrain: ["Täysjyvä", "Wholegrain"],
  yellow: ["Keltasipuli", "Yellow onion"],
  red: ["Punasipuli", "Red onion"],
  shallot: ["Salottisipuli", "Shallot"],
  spring: ["Kevätsipuli", "Spring onion"],
  white: ["Valkoinen", "White"],
  brown: ["Täysjyväriisi", "Brown"],
  jasmine: ["Jasmiini", "Jasmine"],
  basmati: ["Basmati", "Basmati"],
  cooking: ["Ruokakerma", "Cooking cream"],
  whipping: ["Vispikerma", "Whipping cream"],
  ground: ["Jauhettu", "Ground"],
  beans: ["Pavut", "Beans"],
  instant: ["Pikakahvi", "Instant coffee"],
};
export function preferenceAttributeLabel(
  value: string,
  language: string,
): string {
  return labels[value]?.[language === "fi" ? 0 : 1] ?? value;
}
type Props = Pick<SettingsSectionProps, "snapshot" | "busy" | "call">;
function PreferenceRow({
  rule,
  onRemoved,
  snapshot,
  busy,
  call,
}: Props & { rule: CategoryPreference; onRemoved: () => void }) {
  const language = snapshot.state.language === "fi" ? "fi" : "en";
  const c = copy[language];
  const name = categories[language][rule.category];
  const label = (value: string) => labels[value][language === "fi" ? 0 : 1];
  const [draft, setDraft] = useState<CategoryPreference | null>(null);
  const [revision, setRevision] = useState(0);
  const editButton = useRef<HTMLButtonElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const wasEditing = useRef(false);
  useEffect(() => {
    if (draft && !wasEditing.current)
      form.current?.querySelector("select")?.focus();
    if (!draft && wasEditing.current) editButton.current?.focus();
    wasEditing.current = !!draft;
  }, [!!draft]);
  const kinds = (
    Object.keys(qualifierValues) as (keyof typeof qualifierValues)[]
  ).filter(
    (kind) =>
      classificationSchema.safeParse({
        category: rule.category,
        provenance: "remembered",
        qualifiers: [
          { kind, value: qualifierValues[kind][0], provenance: "remembered" },
        ],
      }).success,
  );
  const finish = async (method: string, input: unknown) => {
    const saved = await call(method, input);
    if (!saved) await call("load", undefined, { preserveError: true });
    setDraft(null);
    editButton.current?.focus();
    if (saved && method === "forgetCategoryPreference") onRemoved();
  };
  return (
    <article className="card form" aria-label={name}>
      <h4>{name}</h4>
      {!draft ? (
        <>
          <p>
            {rule.qualifiers.map((q) => label(q.value)).join(", ")} ·{" "}
            {rule.strength === "required" ? c.required : c.preferred}
          </p>
          <div className="actions">
            <button
              ref={editButton}
              disabled={busy}
              onClick={() => {
                setDraft(structuredClone(rule));
                setRevision(snapshot.state.revision);
              }}
            >
              {c.edit}
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                void finish("forgetCategoryPreference", {
                  revision: snapshot.state.revision,
                  category: rule.category,
                })
              }
            >
              {c.forget}
            </button>
          </div>
        </>
      ) : (
        <form
          className="form"
          ref={form}
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.qualifiers.length)
              void finish("editCategoryPreference", {
                revision,
                preference: draft,
              });
          }}
        >
          {kinds.map((kind) => (
            <label key={kind}>
              {label(kind)}
              <select
                aria-label={`${name}: ${label(kind)}`}
                disabled={busy}
                value={
                  draft.qualifiers.find((q) => q.kind === kind)?.value ?? ""
                }
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    qualifiers: [
                      ...draft.qualifiers.filter((q) => q.kind !== kind),
                      ...(e.target.value
                        ? [{ kind, value: e.target.value }]
                        : []),
                    ],
                  })
                }
              >
                <option value="">{c.any}</option>
                {qualifierValues[kind].map((value) => (
                  <option key={value} value={value}>
                    {label(value)}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <label>
            {c.strength}
            <select
              aria-label={`${name}: ${c.strength}`}
              disabled={busy}
              value={draft.strength}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  strength: e.target.value as CategoryPreference["strength"],
                })
              }
            >
              <option value="required">{c.required}</option>
              <option value="preferred">{c.preferred}</option>
            </select>
          </label>
          {!draft.qualifiers.length && <p role="status">{c.invalid}</p>}
          <div className="actions">
            <button disabled={busy || !draft.qualifiers.length}>
              {c.save}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => {
                setDraft(null);
                editButton.current?.focus();
              }}
            >
              {c.cancel}
            </button>
          </div>
        </form>
      )}
    </article>
  );
}
export function CategoryPreferences(props: Props) {
  const c = copy[props.snapshot.state.language === "fi" ? "fi" : "en"];
  const [resetRevision, setResetRevision] = useState<number | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const resetButton = useRef<HTMLButtonElement>(null);
  const confirmation = useRef<HTMLDivElement>(null);
  const wasConfirming = useRef(false);
  useEffect(() => {
    if (resetRevision !== null)
      confirmation.current?.querySelector("button")?.focus();
    else if (wasConfirming.current)
      (resetButton.current ?? heading.current)?.focus();
    wasConfirming.current = resetRevision !== null;
  }, [resetRevision]);
  const rules = props.snapshot.state.categoryPreferences;
  return (
    <section aria-label={c.title}>
      <h3 ref={heading} tabIndex={-1}>
        {c.title}
      </h3>
      <p>{c.help}</p>
      <button
        className="secondary"
        disabled={props.busy}
        onClick={() => void props.call("exportData")}
      >
        {c.backup}
      </button>
      {!rules.length ? (
        <p>{c.empty}</p>
      ) : (
        rules.map((rule) => (
          <PreferenceRow
            key={rule.category}
            {...props}
            rule={rule}
            onRemoved={() => heading.current?.focus()}
          />
        ))
      )}
      {!!rules.length &&
        (resetRevision === null ? (
          <button
            ref={resetButton}
            className="secondary"
            disabled={props.busy}
            onClick={() => setResetRevision(props.snapshot.state.revision)}
          >
            {c.reset}
          </button>
        ) : (
          <div ref={confirmation} role="group" aria-label={c.confirm}>
            <p>{c.confirm}</p>
            <p>{c.confirmHelp}</p>
            <div className="actions">
              <button
                disabled={props.busy}
                onClick={async () => {
                  const saved = await props.call("resetCategoryPreferences", {
                    revision: resetRevision,
                  });
                  if (!saved)
                    await props.call("load", undefined, {
                      preserveError: true,
                    });
                  setResetRevision(null);
                }}
              >
                {c.confirmReset}
              </button>
              <button
                className="secondary"
                disabled={props.busy}
                onClick={() => setResetRevision(null)}
              >
                {c.cancel}
              </button>
            </div>
          </div>
        ))}
    </section>
  );
}
