import React, { useEffect, useRef, useState } from "react";
import type { Snapshot } from "../application/service";
import type { AppState, Product } from "../domain/model";
import { relevant, requirements } from "../domain/planner";
import { unitLabel } from "./i18n";
import { ConfirmPanel } from "./confirm";
import { RowDetails } from "./details";
import { isLive } from "../stores/provider";
import { ComparePanel, CompareSummary, canCompare, feeRange } from "./compare";

export function ShoppingWorkspace({
  snapshot,
  busy,
  call,
  save,
  settings,
  view = "list",
}: {
  snapshot: Snapshot;
  busy: boolean;
  call: (method: string, input?: unknown) => Promise<boolean>;
  save: (state: AppState) => Promise<boolean>;
  settings: () => void;
  view?: "list" | "schedule" | "history";
}) {
  const state = snapshot.state;
  const fi = state.language === "fi";
  const tr = (a: string, b: string) => (fi ? a : b);
  const [note, setNote] = useState(
    () => sessionStorage.getItem("shopping-note") ?? state.note,
  );
  const [working, setWorking] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const stopRequested = useRef(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [scheduled, setScheduled] = useState(false);
  const [undo, setUndo] = useState<Record<string, string>>({});
  const currentNote = useRef(note);
  const attempted = useRef(state.note);
  const quoted = useRef(-1);
  const panel = useRef<HTMLElement>(null);
  const [comparing, setComparing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // The list row whose details are open.
  const [opened, setOpened] = useState<string | null>(null);
  // The list column is as tall as the window below its current top, so the total and
  // transfer bar at its bottom stays in view however far the page is scrolled.
  useEffect(() => {
    const fit = () => {
      const el = panel.current;
      if (!el) return;
      if (getComputedStyle(el).position !== "sticky") {
        el.style.maxHeight = "";
        return;
      }
      const top = Math.max(el.getBoundingClientRect().top, 12);
      el.style.maxHeight = `${window.innerHeight - top - 12}px`;
    };
    fit();
    window.addEventListener("scroll", fit, { passive: true });
    window.addEventListener("resize", fit);
    return () => {
      window.removeEventListener("scroll", fit);
      window.removeEventListener("resize", fit);
    };
  }, []);
  const active = useRef(true);
  const running = useRef(false);
  const savedNote = useRef(state.note);
  useEffect(() => {
    active.current = true;
    const stop = () => {
      if (!running.current) return;
      stopRequested.current = true;
      attempted.current = currentNote.current;
      setCancelled(true);
    };
    window.addEventListener("korikone:cancel-ai", stop);
    return () => {
      active.current = false;
      window.removeEventListener("korikone:cancel-ai", stop);
    };
  }, []);
  useEffect(() => {
    if (savedNote.current === state.note) return;
    savedNote.current = state.note;
    if (running.current) return;
    setNote(state.note);
    sessionStorage.setItem("shopping-note", state.note);
    currentNote.current = state.note;
    attempted.current = state.note;
  }, [state.note]);
  const changeNote = (value: string) => {
    setCancelled(false);
    sessionStorage.setItem("shopping-note", value);
    currentNote.current = value;
    setNote(value);
  };
  async function update() {
    if (
      running.current ||
      busy ||
      !note.trim() ||
      snapshot.ai.state !== "connected"
    )
      return;
    const requested = note;
    attempted.current = requested;
    running.current = true;
    stopRequested.current = false;
    setCancelled(false);
    setWorking(true);
    setRequesting(true);
    try {
      const generated = await call("generate", {
        prompt: requested,
        model: "auto",
        consent: true,
      });
      setRequesting(false);
      if (generated) {
        if (
          !stopRequested.current &&
          active.current &&
          currentNote.current === requested
        )
          await call("approveDraft");
      }
    } finally {
      running.current = false;
      if (active.current) {
        setWorking(false);
        setRequesting(false);
      }
    }
  }
  useEffect(() => {
    if (
      view !== "list" ||
      busy ||
      working ||
      note === attempted.current ||
      !note.trim() ||
      snapshot.ai.state !== "connected"
    )
      return;
    const timer = setTimeout(() => void update(), 1800);
    return () => clearTimeout(timer);
  }, [note, busy, working, snapshot.ai.state, view]);
  useEffect(() => {
    if (view !== "list" || busy || working || quoted.current === state.revision)
      return;
    quoted.current = state.revision;
    if (requirements(state).length) void call("buildBasket");
  }, [state.revision, busy, working]);
  const all = requirements(state, new Date(), true);
  const rows = requirements(state);
  const money = (cents: number) =>
    new Intl.NumberFormat(fi ? "fi-FI" : "en-FI", {
      style: "currency",
      currency: "EUR",
    }).format(cents / 100);
  const total = snapshot.basket.reduce(
    (sum, line) => sum + (line.total ?? 0),
    0,
  );
  const missing = rows.filter(
    (r) =>
      !snapshot.basket.some(
        (l) =>
          l.requirement.id === r.id &&
          l.requirement.unit === r.unit &&
          l.product,
      ),
  );
  const groups = state.meals
    .filter((m) => !m.leftovers)
    .map((meal) => ({
      meal,
      recipe: state.recipes.find((r) => r.id === meal.recipeId)!,
    }));
  const groupName = (kind?: string) =>
    ({
      ready: tr("Valmisruoka", "Ready meal"),
      breakfast: tr("Aamupalat", "Breakfast"),
      evening: tr("Iltapalat", "Evening food"),
      snack: tr("Herkut", "Treats"),
    })[kind ?? ""] ?? tr("Ateria", "Meal");
  const category = (name: string) => {
    if (/pakast|pizza|jäätelö/i.test(name))
      return tr("Pakasteet", "Frozen food");
    if (/\b(?:nakki|liha|broileri|kana(?!nmuna)|lohi|kala)/i.test(name))
      return tr("Liha ja kala", "Meat and fish");
    if (/maito|kerma|jogurtti|rahka|voi|juusto|kananmuna/i.test(name))
      return tr("Maito ja munat", "Dairy and eggs");
    if (
      /peruna(?!lastu)|porkkana|sipuli|banaani|omena|sitruuna|tomaatti(?!murska)|kurkku/i.test(
        name,
      )
    )
      return tr("Hedelmät ja vihannekset", "Fruit and vegetables");
    if (/suklaa|karkki|lastu|keksi/i.test(name)) return tr("Herkut", "Treats");
    if (/pasta|kahvi|hiutale|jauho|riisi|tomaattimurska|liemi/i.test(name))
      return tr("Kuivatuotteet", "Pantry");
    return tr("Muut ostokset", "Other groceries");
  };
  const categories = [...new Set(all.map((r) => category(r.name)))];
  const saveRecipe = (recipeId: string, servings: number) =>
    save({
      ...state,
      meals: [
        ...state.meals,
        {
          id: crypto.randomUUID(),
          recipeId,
          servings,
          day: 0,
          leftovers: false,
        },
      ],
    });
  if (view === "history")
    return (
      <section>
        <h1>{tr("Historia", "History")}</h1>
        <p>
          {tr(
            "Kaupan ostoskoriin siirretyt listat. Ostoksen maksaminen ei tallennu automaattisesti.",
            "Lists transferred to the store cart. Checkout is not recorded automatically.",
          )}
        </p>
        <div className="interpretations">
          {state.listHistory.map((h) => (
            <article className="card" key={h.id}>
              <h2>
                {new Date(h.date).toLocaleDateString(fi ? "fi-FI" : "en-FI")}
              </h2>
              <p>
                {h.note ||
                  h.meals
                    .map(
                      (m) =>
                        state.recipes.find((r) => r.id === m.recipeId)?.name,
                    )
                    .join(", ")}
              </p>
              <button
                disabled={busy}
                onClick={() => {
                  const restored = h.recipes.map((r) => ({
                    ...r,
                    id: crypto.randomUUID(),
                  }));
                  void save({
                    ...state,
                    note: h.note,
                    recipes: [...state.recipes, ...restored],
                    meals: h.meals.map((m) => ({
                      ...m,
                      recipeId:
                        restored[
                          h.recipes.findIndex((r) => r.id === m.recipeId)
                        ]?.id ?? m.recipeId,
                    })),
                    extras: h.extras,
                    skipped: h.skipped,
                    removed: h.removed,
                    quantities: h.quantities,
                  }).then((ok) => {
                    if (ok) changeNote(h.note);
                  });
                }}
              >
                {tr("Käytä listan pohjana", "Use as a starting list")}
              </button>
            </article>
          ))}
        </div>
        {!state.listHistory.length && (
          <p>
            {tr(
              "Siirretyt listat näkyvät tässä.",
              "Transferred lists will appear here.",
            )}
          </p>
        )}
        {!!state.history.length && (
          <section className="card">
            <h2>{tr("Aiempi viikko", "Earlier week")}</h2>
            <p>
              {state.history[0].meals
                .map(
                  (m) => state.recipes.find((r) => r.id === m.recipeId)?.name,
                )
                .filter(Boolean)
                .join(", ")}
            </p>
            <button
              disabled={busy}
              onClick={async () => {
                if (await call("reuseWeek")) changeNote("");
              }}
            >
              {tr("Käytä aiempaa viikkoa", "Use the earlier week")}
            </button>
          </section>
        )}
      </section>
    );
  if (view === "schedule") {
    const meals = groups.filter(
      (g) => !g.recipe.kind || g.recipe.kind === "meal",
    );
    return (
      <section>
        <h1>{tr("Viikkosuunnitelma", "Meal schedule")}</h1>
        <p>
          {tr(
            "Jaa ostoslistan ateriat tuleville päiville. Suunnitelma ei lisää aineksia ostoslistaan.",
            "Place the shopping list’s meals on upcoming days. This does not add ingredients to the list.",
          )}
        </p>
        <button disabled={!meals.length} onClick={() => setScheduled(true)}>
          {tr("Luonnostele viikko", "Plan the week")}
        </button>
        {!meals.length && (
          <p>
            {tr(
              "Lisää ensin aterioita ostoslistaan.",
              "Add meals to your shopping list first.",
            )}
          </p>
        )}
        {scheduled && (
          <div className="schedule-grid">
            {Array.from({ length: Math.max(7, meals.length) }, (_, i) => {
              const date = new Date();
              date.setDate(date.getDate() + i);
              return (
                <article className="card" key={i}>
                  <small>
                    {date.toLocaleDateString(fi ? "fi-FI" : "en-FI", {
                      weekday: "long",
                      day: "numeric",
                      month: "numeric",
                    })}
                  </small>
                  <h2>{meals[i]?.recipe.name ?? tr("Vapaa", "Open")}</h2>
                  {meals[i] && (
                    <p>
                      {meals[i].meal.servings} {tr("annosta", "portions")}
                    </p>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    );
  }
  return (
    <div className="shopping-workspace">
      <section className="planning-pane">
        <h1>
          {tr("Mitä tällä viikolla syödään?", "What shall we eat this week?")}
        </h1>
        {!groups.length && !state.extras.length && (
          <p className="muted">
            {tr(
              "Kirjoita kuin jääkaapin oven lappuun. Ruoat, raaka-aineet tai toiveet.",
              "Write a note: meals, groceries or ideas for the week.",
            )}
          </p>
        )}
        <div className={`note-box ${working ? "is-working" : ""}`}>
          <label className="sr-only" htmlFor="shopping-note">
            {tr("Mitä haluaisit valmistaa?", "What would you like to cook?")}
          </label>
          <textarea
            id="shopping-note"
            value={note}
            maxLength={10000}
            placeholder={tr(
              "Nakkikeitto, kanapasta ja pakastepizza. Aamuksi jogurttia ja banaaneja. Jotain herkkuja viikonlopuksi…",
              "Sausage soup, chicken pasta and frozen pizza. Yoghurt and bananas for breakfast. Some weekend treats…",
            )}
            onChange={(e) => changeNote(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                e.preventDefault();
                void update();
              }
            }}
          />
          <div className="note-footer">
            <button className="chip" onClick={settings}>
              {state.household.servings} {tr("henkeä", "people")}
            </button>
            <span className="chip">
              {new Date().toLocaleDateString(fi ? "fi-FI" : "en-FI", {
                day: "numeric",
                month: "long",
              })}
            </span>
            <button className="chip store-chip" onClick={settings}>
              {state.context.storeName}
            </button>
            <span className="note-status" role="status">
              {working
                ? tr("Muodostetaan listaa…", "Building your list…")
                : cancelled
                  ? tr("Listan päivitys peruutettu", "List update cancelled")
                  : busy
                    ? tr("Haetaan tuotteita…", "Finding products…")
                    : tr(
                        "Ctrl + Enter päivittää heti",
                        "Ctrl + Enter to update now",
                      )}
            </span>
            {requesting && (
              <button
                className="secondary"
                onClick={() => {
                  window.dispatchEvent(new Event("korikone:cancel-ai"));
                  void call("cancelAI");
                }}
                disabled={cancelled}
              >
                {tr("Peruuta listan päivitys", "Cancel list update")}
              </button>
            )}
            <button
              className="refresh-note"
              aria-label={tr("Päivitä ostoslista", "Update shopping list")}
              disabled={
                busy ||
                working ||
                !note.trim() ||
                snapshot.ai.state !== "connected"
              }
              onClick={() => void update()}
            >
              ↑
            </button>
          </div>
        </div>
        <p className="input-notice">
          {snapshot.developmentMode ? (
            tr(
              "Kehitystila käyttää paikallista testiaineistoa. Muistiinpanoa tai kuitteja ei lähetetä ChatGPT:lle.",
              "Development mode uses local fixtures. Your note and receipts are not sent to ChatGPT.",
            )
          ) : snapshot.ai.state === "connected" ? (
            tr(
              "Lista päivittyy kirjoitustauon jälkeen. Muistiinpano, reseptit, talouden tiedot ja tuodut kuitit lähetetään ChatGPT:lle.",
              "The list updates after a pause. Your note, recipes, household preferences and imported receipts are sent to ChatGPT.",
            )
          ) : (
            <>
              <span>
                {tr(
                  "Yhdistä ChatGPT, jotta muistiinpano muuttuu listaksi. Voit myös lisätä reseptejä ja tuotteita käsin.",
                  "Connect ChatGPT to turn your note into a list, or add recipes and groceries manually.",
                )}
              </span>{" "}
              <button className="text" onClick={settings}>
                {tr("Yhdistä", "Connect")}
              </button>
            </>
          )}
        </p>
        {!groups.length && (
          <section className="starter-ideas">
            <h2>{tr("Ideoita alkuun", "Ideas to start with")}</h2>
            {[
              tr("Arkiviikon helpot ruoat", "Easy weekday meals"),
              tr("Kasvisviikko", "Vegetarian week"),
              tr("Lapsiperheen viikko", "Family meals"),
              tr("Aamupalat ja iltapalat", "Breakfast and evening food"),
            ].map((idea) => (
              <button
                className="chip"
                key={idea}
                onClick={() => changeNote(idea)}
              >
                {idea}
              </button>
            ))}
          </section>
        )}
        {!!groups.length && (
          <>
            <div className="section-heading compact">
              <h2>
                {tr("Näin ymmärsin", "What I understood")}{" "}
                <span className="muted">· {groups.length}</span>
              </h2>
              <small>
                {tr(
                  "Valitse ateria nähdäksesi sen ainekset",
                  "Select a meal to highlight its ingredients",
                )}
              </small>
            </div>
            <div className="interpretations">
              {groups.map(({ meal, recipe }) => {
                const cost = snapshot.basket.reduce((sum, l) => {
                  const ingredient = recipe.ingredients.find(
                    (i) =>
                      i.id === l.requirement.id &&
                      i.unit === l.requirement.unit,
                  );
                  const sharedAmount = groups.reduce(
                    (amount, group) =>
                      amount +
                      group.recipe.ingredients
                        .filter(
                          (i) =>
                            i.id === l.requirement.id &&
                            i.unit === l.requirement.unit,
                        )
                        .reduce(
                          (sum, i) =>
                            sum +
                            (i.amount * group.meal.servings) /
                              group.recipe.servings,
                          0,
                        ),
                    0,
                  );
                  return (
                    sum +
                    (ingredient && l.total !== null
                      ? (l.total *
                          ((ingredient.amount * meal.servings) /
                            recipe.servings)) /
                        Math.max(l.requirement.amount, sharedAmount)
                      : 0)
                  );
                }, 0);
                return (
                  <article
                    className={`interpretation ${selected === recipe.name ? "selected" : ""}`}
                    key={meal.id}
                  >
                    <button
                      className="meal-select"
                      aria-pressed={selected === recipe.name}
                      onClick={() =>
                        setSelected(
                          selected === recipe.name ? null : recipe.name,
                        )
                      }
                    >
                      <small>{groupName(recipe.kind)}</small>
                      <h2>{recipe.name}</h2>
                      <small>
                        {recipe.ingredients.length}{" "}
                        {tr("ainesta", "ingredients")}
                        {cost > 0 ? ` · ≈ ${money(cost)}` : ""}
                      </small>
                    </button>
                    <div className="portion-control">
                      <button
                        aria-label={tr("Vähennä annoksia", "Fewer portions")}
                        disabled={busy || meal.servings <= 1}
                        onClick={() =>
                          void save({
                            ...state,
                            meals: state.meals.map((m) =>
                              m.id === meal.id
                                ? { ...m, servings: m.servings - 1 }
                                : m,
                            ),
                          })
                        }
                      >
                        −
                      </button>
                      <span>
                        {meal.servings} {tr("annosta", "portions")}
                      </span>
                      <button
                        aria-label={tr("Lisää annoksia", "More portions")}
                        disabled={busy || meal.servings >= 100}
                        onClick={() =>
                          void save({
                            ...state,
                            meals: state.meals.map((m) =>
                              m.id === meal.id
                                ? { ...m, servings: m.servings + 1 }
                                : m,
                            ),
                          })
                        }
                      >
                        +
                      </button>
                    </div>
                    <button
                      className="text remove-meal"
                      disabled={busy}
                      onClick={() =>
                        void save({
                          ...state,
                          meals: state.meals.filter((m) => m.id !== meal.id),
                        })
                      }
                    >
                      {tr("Poista", "Remove")}
                    </button>
                  </article>
                );
              })}
            </div>
          </>
        )}
        {state.assumptions && (
          <p className="input-notice">{state.assumptions}</p>
        )}
        <details className="recipe-adder">
          <summary>
            {tr("Lisää valmiita reseptejä", "Add saved recipes")}
          </summary>
          <form
            className="inline"
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              void saveRecipe(
                String(data.get("recipe")),
                Number(data.get("servings")),
              );
            }}
          >
            <label>
              {tr("Resepti", "Recipe")}
              <select name="recipe" aria-label={tr("Resepti", "Recipe")}>
                {state.recipes.map((r) => (
                  <option value={r.id} key={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {tr("Annoksia", "Portions")}
              <input
                name="servings"
                type="number"
                min="1"
                max="100"
                defaultValue={state.household.servings}
                required
              />
            </label>
            <button disabled={busy || !state.recipes.length}>
              {tr("Lisää resepti ostoslistaan", "Add recipe to shopping list")}
            </button>
          </form>
        </details>
        {!!state.staples.length && (
          <section className="forgotten card">
            <div className="section-heading compact">
              <h2>{tr("Unohtuiko jotain?", "Forgot anything?")}</h2>
              <small>{tr("Vakio-ostoksesi", "Your regular items")}</small>
            </div>
            {state.staples
              .filter((s) => !rows.some((r) => r.id === s.id))
              .map((s) => (
                <button
                  key={s.id}
                  className="chip"
                  disabled={busy}
                  onClick={() =>
                    void save({
                      ...state,
                      staples: state.staples.map((item) =>
                        item.id === s.id
                          ? { ...item, enabled: true, lastPurchased: null }
                          : item,
                      ),
                      skipped: state.skipped.filter(
                        (k) => k !== `${s.id}:${s.unit}`,
                      ),
                      removed: state.removed.filter(
                        (k) => k !== `${s.id}:${s.unit}`,
                      ),
                    })
                  }
                >
                  + {s.name} {s.amount} {unitLabel(s.unit, state.language)}
                </button>
              ))}
            {state.staples.every((s) => rows.some((r) => r.id === s.id)) && (
              <small>
                {tr(
                  "Vakio-ostokset ovat jo listalla.",
                  "Your regular items are already on the list.",
                )}
              </small>
            )}
          </section>
        )}
      </section>
      <aside className="shopping-panel" ref={panel}>
        <div className="section-heading compact">
          <h2>
            {tr("Ostoslista", "Shopping list")}{" "}
            <span className="muted">· {all.length}</span>
          </h2>
          <details className="list-menu">
            <summary aria-label={tr("Listan toiminnot", "List actions")}>
              ···
            </summary>
            <button
              className="text"
              disabled={busy}
              onClick={async () => {
                if (await call("newWeek")) changeNote("");
              }}
            >
              {tr("Tyhjennä ostoslista", "Clear shopping list")}
            </button>
            <button className="text" onClick={() => void call("exportList")}>
              {tr("Tallenna tekstinä", "Save as text")}
            </button>
            <button
              className="text"
              disabled={busy || !rows.length}
              onClick={() => void call("buildBasket")}
            >
              {tr("Päivitä tuotteet ja hinnat", "Refresh products and prices")}
            </button>
          </details>
        </div>
        <form
          className="quick-add"
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const data = new FormData(form);
            const name = String(data.get("item")).trim();
            const amount = Number(data.get("amount"));
            const unit = String(data.get("unit")) as "g" | "ml" | "pcs";
            if (name)
              void save({
                ...state,
                extras: [
                  ...state.extras,
                  { id: name.toLocaleLowerCase("fi"), name, amount, unit },
                ],
                removed: state.removed.filter(
                  (k) => k !== `${name.toLocaleLowerCase("fi")}:${unit}`,
                ),
              }).then((ok) => {
                if (ok) form.reset();
              });
          }}
        >
          <input
            name="item"
            aria-label={tr("Lisää tuote", "Add grocery")}
            placeholder={tr(
              "+ Lisää tuote, esim. kahvi",
              "+ Add a grocery, e.g. coffee",
            )}
            required
            maxLength={200}
          />
          <input
            name="amount"
            aria-label={tr("Tuotteen määrä", "Grocery amount")}
            type="number"
            min="1"
            max="10000000"
            defaultValue="1"
            required
          />
          <select
            name="unit"
            aria-label={tr("Tuotteen yksikkö", "Grocery unit")}
          >
            <option value="pcs">{tr("kpl", "pcs")}</option>
            <option value="g">g</option>
            <option value="ml">ml</option>
          </select>
          <button
            disabled={busy}
            aria-label={tr("Lisää tuote listaan", "Add grocery to list")}
          >
            +
          </button>
        </form>
        <label className="product-preference">
          {tr("Tuotevalinnat", "Product choices")}
          <select
            value={state.productPreference}
            disabled={busy}
            onChange={(e) =>
              void save({
                ...state,
                productPreference: e.target
                  .value as AppState["productPreference"],
                accepted: {},
              })
            }
          >
            <option value="price">
              {tr("Edullisin sopiva pakkausmäärä", "Lowest total pack cost")}
            </option>
            <option value="storeBrand">
              {tr("Suosi kaupan merkkejä", "Prefer store brands")}
            </option>
            <option value="avoidStoreBrand">
              {tr("Vältä kaupan merkkejä", "Avoid store brands")}
            </option>
          </select>
        </label>
        {!all.length && (
          <div className="empty-list">
            <span aria-hidden="true">☷</span>
            <h3>{tr("Lista täyttyy tähän", "Your list will appear here")}</h3>
            <p>
              {tr(
                "Kirjoita toiveesi vasemmalle. Jokaisen tuotteen kohdalla näkyy, mitä ruokaa varten se on.",
                "Write your note on the left. Each grocery shows which meal it belongs to.",
              )}
            </p>
          </div>
        )}
        {categories.map((cat) => (
          <section className="grocery-category" key={cat}>
            <h3>{cat}</h3>
            {all
              .filter((r) => category(r.name) === cat)
              .map((r) => {
                const key = `${r.id}:${r.unit}`;
                const line = snapshot.basket.find(
                  (l) =>
                    l.requirement.id === r.id && l.requirement.unit === r.unit,
                );
                const home = state.skipped.includes(key);
                const step = line?.product
                  ? line.product.packAmount * line.product.increment
                  : r.unit === "pcs"
                    ? 1
                    : 100;
                const count = line?.product ? line.packs : r.amount;
                const cost = (p: Product) =>
                  Math.ceil(r.amount / p.packAmount / p.increment) *
                  p.increment *
                  (p.price! + p.deposit);
                const cheaper = line?.candidates
                  .filter(
                    (p) =>
                      p.available &&
                      p.price !== null &&
                      p.packAmount > 0 &&
                      p.increment > 0 &&
                      line.total !== null &&
                      cost(p) < line.total &&
                      // A look-alike such as chicken mince is not the same ingredient.
                      (!isLive(state.context.providerId) ||
                        relevant(p.name, r.name)),
                  )
                  .sort((a, b) => cost(a) - cost(b))[0];
                return (
                  <div
                    className={`grocery-row ${home ? "at-home" : ""} ${selected && r.sources.includes(selected) ? "highlighted" : ""}`}
                    key={key}
                  >
                    <button
                      className="home-button"
                      aria-label={`${tr("Löytyy kotoa", "Already at home")}: ${r.name}`}
                      aria-pressed={home}
                      disabled={busy}
                      onClick={() =>
                        void save({
                          ...state,
                          skipped: home
                            ? state.skipped.filter((k) => k !== key)
                            : [...state.skipped, key],
                        })
                      }
                    >
                      ⌂
                    </button>
                    <div className="grocery-description">
                      {line ? (
                        <button
                          className="row-name"
                          aria-expanded={opened === key}
                          onClick={() => setOpened(opened === key ? null : key)}
                        >
                          {line.product?.name ?? r.name}
                        </button>
                      ) : (
                        <strong>{r.name}</strong>
                      )}
                      {!!line?.excluded && (
                        <small>
                          {line.excluded}{" "}
                          {tr(
                            "tuotetta rajattu pois ruokavalion perusteella",
                            "products hidden by household exclusions",
                          )}
                        </small>
                      )}
                      {r.sources.includes("staple") && (
                        <small>
                          {tr("Viimeksi ostettu", "Last purchased")}:{" "}
                          {state.staples.find((s) => s.id === r.id)
                            ?.lastPurchased
                            ? new Date(
                                state.staples.find((s) => s.id === r.id)!
                                  .lastPurchased!,
                              ).toLocaleDateString(fi ? "fi-FI" : "en-FI")
                            : tr("ei vielä merkitty", "not recorded")}
                        </small>
                      )}
                      <small>
                        {r.sources
                          .map((s) =>
                            s === "staple"
                              ? tr("Vakio-ostos", "Regular item")
                              : s === "extra"
                                ? tr("Lisätty käsin", "Extra grocery")
                                : s,
                          )
                          .filter((s, i, a) => a.indexOf(s) === i)
                          .join(" · ")}
                      </small>
                      <small>
                        {r.amount} {unitLabel(r.unit, state.language)}
                        {!home && !line?.product
                          ? ` · ${tr("Tuote puuttuu", "Needs a product")}`
                          : ""}
                      </small>
                    </div>
                    <div className="quantity-control">
                      <button
                        aria-label={`${tr("Vähennä", "Decrease")}: ${r.name}`}
                        disabled={busy || r.amount <= step}
                        onClick={() =>
                          void save({
                            ...state,
                            quantities: {
                              ...state.quantities,
                              [key]: Math.max(1, r.amount - step),
                            },
                          })
                        }
                      >
                        −
                      </button>
                      <span>{count}</span>
                      <button
                        aria-label={`${tr("Lisää", "Increase")}: ${r.name}`}
                        disabled={busy}
                        onClick={() =>
                          void save({
                            ...state,
                            quantities: {
                              ...state.quantities,
                              [key]: r.amount + step,
                            },
                          })
                        }
                      >
                        +
                      </button>
                    </div>
                    <strong className="row-price">
                      {home
                        ? tr("kotona", "at home")
                        : line?.total != null
                          ? money(line.total)
                          : "—"}
                    </strong>
                    <button
                      className="delete-row"
                      aria-label={`${tr("Poista", "Remove")}: ${r.name}`}
                      disabled={busy}
                      onClick={() =>
                        void save({
                          ...state,
                          removed: [...state.removed, key],
                          skipped: state.skipped.filter((k) => k !== key),
                        })
                      }
                    >
                      ×
                    </button>
                    {!home && cheaper && opened !== key && (
                      <button
                        className="text row-alternative"
                        onClick={() => setOpened(key)}
                      >
                        {tr("Edullisempi vaihtoehto", "Cheaper option")}{" "}
                        {money(line!.total! - cost(cheaper))}
                      </button>
                    )}
                    {undo[key] && (
                      <button
                        className="text row-alternative"
                        disabled={busy}
                        onClick={async () => {
                          if (
                            await call("accept", {
                              ingredientId: r.id,
                              productId: undo[key],
                            })
                          )
                            setUndo((prev) => {
                              const next = { ...prev };
                              delete next[key];
                              return next;
                            });
                        }}
                      >
                        {tr("Kumoa vaihto", "Undo swap")}
                      </button>
                    )}
                    {opened === key && line && (
                      <RowDetails
                        snapshot={snapshot}
                        line={line}
                        busy={busy}
                        money={money}
                        cheaper={
                          !home && cheaper
                            ? { product: cheaper, total: cost(cheaper) }
                            : null
                        }
                        choose={(p) => {
                          if (line.product)
                            setUndo({ ...undo, [key]: line.product.id });
                          void call("accept", {
                            ingredientId: r.id,
                            productId: p.id,
                          });
                        }}
                      />
                    )}
                  </div>
                );
              })}
          </section>
        ))}
        <div className="list-footer">
          {state.skipped.length > 0 && (
            <small>
              {state.skipped.length}{" "}
              {tr("tuotetta kotona, ei mukana", "items at home, excluded")}
            </small>
          )}
          {missing.length > 0 && (
            <p className="warning">
              {missing.length}{" "}
              {tr(
                "tuotteelta puuttuu hinta tai sopiva pakkaus. Ne eivät sisälly arvioon.",
                "items need a price or suitable pack. They are excluded from the estimate.",
              )}
            </p>
          )}
          <small>
            {snapshot.pickupFee
              ? `${tr("Noutomaksu", "Pickup fee")} ${feeRange(snapshot.pickupFee, money)} ${tr("noutoajan mukaan, ei mukana arviossa", "depending on the pickup time, not in the estimate")}`
              : tr(
                  "Toimitus- tai noutomaksu ei ole tiedossa.",
                  "The delivery or pickup fee is not known.",
                )}
          </small>
          {canCompare(snapshot) && (
            <ComparePanel
              snapshot={snapshot}
              busy={busy}
              call={call}
              tr={tr}
              money={money}
              open={comparing}
              onClose={() => setComparing(false)}
            />
          )}
          {state.context.providerId === "s-kaupat" && (
            <p className="input-notice">
              {tr(
                "Tuotteet siirtyvät S-kauppojen Korikone-ostoslistalle. Lisää ne ostoskoriin S-kauppojen sivulla.",
                "Products go to your Korikone shopping list at S-kaupat. Add them to the cart on the S-kaupat website.",
              )}
            </p>
          )}
          <div className="list-exports">
            <button
              className="secondary"
              disabled={busy || !rows.length}
              onClick={async () => {
                if (await call("copyList")) {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }
              }}
            >
              {copied
                ? tr("Kopioitu", "Copied")
                : tr("Kopioi tekstinä", "Copy as text")}
            </button>
            <button
              className="secondary"
              disabled={busy || !rows.length}
              onClick={() => void call("exportList")}
            >
              {tr("Tallenna lista", "Save list")}
            </button>
          </div>
          <small>
            {tr(
              "Tarkista toimitusmaksu ja mahdolliset pantit kaupassa.",
              "Check the fee and any unreported deposits at the store.",
            )}
          </small>
          {!isLive(state.context.providerId) && (
            <details className="demo-controls">
              <summary>{tr("Esimerkki", "Demo")}</summary>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => void call("scenario", "interrupt")}
              >
                {tr(
                  "Esimerkki: keskeytä seuraava siirto",
                  "Demo: interrupt next transfer",
                )}
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => void call("scenario", "price")}
              >
                {tr("Esimerkki: muuta hintoja", "Demo: change prices")}
              </button>
            </details>
          )}
        </div>
        {/* Stays at the bottom of the list column while the rows scroll. */}
        <div
          className="shopping-total"
          role="region"
          aria-label={tr("Yhteensä ja siirto", "Total and transfer")}
        >
          {confirming && (
            <ConfirmPanel
              snapshot={snapshot}
              busy={busy}
              call={call}
              money={money}
              onClose={() => setConfirming(false)}
              onRecover={() => void call("recover")}
            />
          )}
          {!confirming && snapshot.journal?.status === "partial" && (
            <p className="warning" role="status">
              {tr("Edellinen siirto keskeytyi.", "The last transfer stopped.")}{" "}
              <button className="text" onClick={() => setConfirming(true)}>
                {tr("Tarkista", "Check it")}
              </button>
            </p>
          )}
          <div className="total-line">
            <span>{tr("Arvio yhteensä", "Estimated total")}</span>
            <strong>{money(total)}</strong>
          </div>
          {canCompare(snapshot) && (
            <CompareSummary
              snapshot={snapshot}
              busy={busy}
              call={call}
              tr={tr}
              money={money}
              onOpen={() => setComparing(true)}
            />
          )}
          {!confirming && (
            <button
              className="transfer-button"
              disabled={busy || !rows.length || missing.length === rows.length}
              onClick={async () => {
                // An interrupted transfer is shown for recovery instead of a new review.
                if (
                  snapshot.journal?.status === "partial" ||
                  (await call("prepare", { allowMissing: true }))
                )
                  setConfirming(true);
              }}
            >
              {state.context.providerId === "s-kaupat" ? (
                tr("Siirrä S-kauppojen listalle", "Transfer to S-kaupat list")
              ) : (
                <>
                  {tr("Siirrä", "Transfer to")}{" "}
                  {state.context.providerId === "k-ruoka"
                    ? "K-Ruoan"
                    : tr("kaupan", "store")}{" "}
                  {tr("ostoskoriin", "cart")}
                </>
              )}
              {total > 0 && (
                <span className="transfer-total"> · {money(total)}</span>
              )}
            </button>
          )}
        </div>
      </aside>
    </div>
  );
}
