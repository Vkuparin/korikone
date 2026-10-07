import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Snapshot } from "../application/service";
import {
  initialState,
  parseAmount,
  type AppState,
  type Recipe,
  type Unit,
} from "../domain/model";
import { requirements } from "../domain/planner";
import { en, fi, type Key } from "./i18n";
import "./style.css";
declare global {
  interface Window {
    korikone: Record<
      string,
      (
        input?: unknown,
      ) => Promise<{ ok: boolean; value: Snapshot; error?: string }>
    >;
  }
}
function App() {
  const [snapshot, setSnapshot] = useState<Snapshot>({
    state: initialState(),
    basket: [],
    review: null,
    journal: null,
    storeResults: [],
    storeLogin: "notStarted",
  });
  const [page, setPage] = useState<Key>("week");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Recipe | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  useEffect(() => setAcknowledged(false), [snapshot.review?.id]);
  const state = snapshot.state;
  const t = (key: Key) => (state.language === "fi" ? fi : en)[key];
  const money = (cents: number) =>
    new Intl.NumberFormat(state.language === "fi" ? "fi-FI" : "en-FI", {
      style: "currency",
      currency: "EUR",
    }).format(cents / 100);
  const days =
    state.language === "fi"
      ? [
          "Maanantai",
          "Tiistai",
          "Keskiviikko",
          "Torstai",
          "Perjantai",
          "Lauantai",
          "Sunnuntai",
        ]
      : [
          "Monday",
          "Tuesday",
          "Wednesday",
          "Thursday",
          "Friday",
          "Saturday",
          "Sunday",
        ];
  async function call(method: string, input?: unknown) {
    setBusy(true);
    setError("");
    try {
      const result = await window.korikone[method](input);
      if (!result.ok) throw new Error(result.error);
      setSnapshot(result.value);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "operationFailed");
      return false;
    } finally {
      setBusy(false);
    }
  }
  const save = (next: AppState) => call("save", next);
  async function changeLanguage(language: "fi" | "en") {
    setSnapshot((current) => ({
      ...current,
      state: { ...current.state, language },
    }));
    const result = await window.korikone.setLanguage(language);
    if (!result.ok) setError(result.error ?? "storageFailed");
  }
  useEffect(() => {
    void call("load").then(() => setLoaded(true));
  }, []);
  useEffect(() => {
    document.documentElement.lang = state.language;
  }, [state.language]);
  const field = (label: string, control: React.ReactNode) => (
    <label>
      {label}
      {control}
    </label>
  );
  if (!loaded)
    return (
      <main>
        <p role="status">{t("working")}</p>
      </main>
    );
  return (
    <>
      <header>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setPage("week");
          }}
        >
          korikone<span>{t("tagline")}</span>
        </a>
        {field(
          t("language"),
          <select
            aria-label={t("language")}
            value={state.language}
            onChange={(e) => void changeLanguage(e.target.value as "fi" | "en")}
          >
            <option value="fi">Suomi</option>
            <option value="en">English</option>
          </select>,
        )}
      </header>
      <div className="demo">
        {t(state.context.providerId === "k-ruoka" ? "liveStore" : "demo")}
      </div>
      {error && (
        <div role="alert" className="error">
          {t(error in en ? (error as Key) : "operationFailed")}
        </div>
      )}
      {busy && (
        <div role="status" className="progress">
          {t("working")}
          <button
            className="text"
            onClick={() => void window.korikone.cancelTransfer()}
          >
            {t("cancel")}
          </button>
        </div>
      )}
      {!state.onboarded ? (
        <main className="welcome">
          <div className="eyebrow">KORIKONE / 01</div>
          <h1>{t("welcome")}</h1>
          <p>{t("intro")}</p>
          <div className="actions">
            <button
              disabled={busy}
              onClick={() =>
                void save({
                  ...state,
                  onboarded: true,
                  meals: [
                    {
                      id: crypto.randomUUID(),
                      day: 0,
                      recipeId: "pasta",
                      servings: 4,
                      leftovers: false,
                    },
                    {
                      id: crypto.randomUUID(),
                      day: 2,
                      recipeId: "soup",
                      servings: 4,
                      leftovers: false,
                    },
                  ],
                })
              }
            >
              {t("start")}
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void save({ ...state, onboarded: true })}
            >
              {t("manual")}
            </button>
          </div>
        </main>
      ) : (
        <>
          <nav>
            {(
              ["week", "recipes", "staples", "basket", "settings"] as Key[]
            ).map((key) => (
              <button
                key={key}
                aria-current={page === key ? "page" : undefined}
                onClick={() => setPage(key)}
              >
                {t(key)}
              </button>
            ))}
          </nav>
          <main>
            <div className="context">
              <span>{state.context.storeName}</span>
              <span>{t(state.context.fulfillment)}</span>
            </div>
            {page === "week" && (
              <>
                <div className="section-heading">
                  <div>
                    <div className="eyebrow">VIIKKO / WEEK</div>
                    <h1>{t("welcome")}</h1>
                  </div>
                  <button
                    disabled={busy}
                    onClick={async () => {
                      if (await call("buildBasket")) setPage("basket");
                    }}
                  >
                    {t("buildBasket")}
                  </button>
                </div>
                <div className="columns">
                  <section>
                    <form
                      className="card inline"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const data = new FormData(e.currentTarget);
                        void save({
                          ...state,
                          meals: [
                            ...state.meals,
                            {
                              id: crypto.randomUUID(),
                              recipeId: String(data.get("recipe")),
                              day: Number(data.get("day")),
                              servings: Number(data.get("servings")),
                              leftovers: false,
                            },
                          ],
                        });
                      }}
                    >
                      {field(
                        t("recipe"),
                        <select name="recipe">
                          {state.recipes.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name}
                            </option>
                          ))}
                        </select>,
                      )}
                      {field(
                        t("day"),
                        <select name="day">
                          {days.map((day, i) => (
                            <option key={day} value={i}>
                              {day}
                            </option>
                          ))}
                        </select>,
                      )}
                      {field(
                        t("servings"),
                        <input
                          name="servings"
                          type="number"
                          min="1"
                          max="100"
                          defaultValue={state.household.servings}
                          required
                        />,
                      )}
                      <button disabled={busy || !state.recipes.length}>
                        {t("addMeal")}
                      </button>
                    </form>
                    {!state.meals.length && (
                      <p className="muted">{t("empty")}</p>
                    )}
                    {[...state.meals]
                      .sort((a, b) => a.day - b.day)
                      .map((meal) => (
                        <article className="card meal" key={meal.id}>
                          <div className="day">{days[meal.day]}</div>
                          <h2>
                            {
                              state.recipes.find((r) => r.id === meal.recipeId)
                                ?.name
                            }
                          </h2>
                          <div className="inline">
                            {field(
                              t("servings"),
                              <input
                                type="number"
                                min="1"
                                max="100"
                                value={meal.servings}
                                disabled={busy}
                                onChange={(e) => {
                                  const n = Number(e.target.value);
                                  if (n >= 1 && n <= 100)
                                    void save({
                                      ...state,
                                      meals: state.meals.map((m) =>
                                        m.id === meal.id
                                          ? { ...m, servings: n }
                                          : m,
                                      ),
                                    });
                                }}
                              />,
                            )}
                            <label className="check">
                              <input
                                type="checkbox"
                                checked={meal.leftovers}
                                disabled={busy}
                                onChange={(e) =>
                                  void save({
                                    ...state,
                                    meals: state.meals.map((m) =>
                                      m.id === meal.id
                                        ? { ...m, leftovers: e.target.checked }
                                        : m,
                                    ),
                                  })
                                }
                              />
                              {t("leftovers")}
                            </label>
                            <button
                              className="text"
                              disabled={busy}
                              onClick={() =>
                                void save({
                                  ...state,
                                  meals: state.meals.filter(
                                    (m) => m.id !== meal.id,
                                  ),
                                })
                              }
                            >
                              {t("remove")}
                            </button>
                          </div>
                        </article>
                      ))}
                  </section>
                  <aside className="card">
                    <h2>{t("shoppingList")}</h2>
                    {requirements(state).map((r) => (
                      <div className="requirement" key={`${r.id}:${r.unit}`}>
                        <strong>{r.name}</strong>
                        <span>
                          {r.amount} {r.unit}
                        </span>
                        <small>
                          {r.sources
                            .map((s) => (s === "staple" ? t("staple") : s))
                            .join(", ")}
                        </small>
                        <button
                          className="text"
                          disabled={busy}
                          onClick={() =>
                            void save({
                              ...state,
                              skipped: [...state.skipped, `${r.id}:${r.unit}`],
                            })
                          }
                        >
                          {t("alreadyHave")}
                        </button>
                      </div>
                    ))}
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => void call("exportList")}
                    >
                      {t("exportList")}
                    </button>
                    {!!state.skipped.length && (
                      <button
                        className="text"
                        onClick={() => void save({ ...state, skipped: [] })}
                      >
                        {t("restoreItems")}
                      </button>
                    )}
                  </aside>
                </div>
              </>
            )}
            {page === "recipes" && (
              <>
                <div className="section-heading">
                  <h1>{t("recipes")}</h1>
                  <button
                    onClick={() =>
                      setEditing({
                        id: crypto.randomUUID(),
                        name: "",
                        servings: 4,
                        ingredients: [],
                        instructions: "",
                      })
                    }
                  >
                    {t("newRecipe")}
                  </button>
                </div>
                {editing ? (
                  <RecipeForm
                    key={editing.id}
                    recipe={editing}
                    t={t}
                    onCancel={() => setEditing(null)}
                    onSave={async (recipe) => {
                      if (
                        await save({
                          ...state,
                          recipes: [
                            ...state.recipes.filter((r) => r.id !== recipe.id),
                            recipe,
                          ],
                        })
                      )
                        setEditing(null);
                    }}
                  />
                ) : (
                  <div className="grid">
                    {state.recipes.map((r) => (
                      <article className="card" key={r.id}>
                        <h2>{r.name}</h2>
                        <p>
                          {r.servings} {t("servings").toLowerCase()}
                        </p>
                        <ul>
                          {r.ingredients.map((i) => (
                            <li key={i.id}>
                              {i.name} · {i.amount} {i.unit}
                            </li>
                          ))}
                        </ul>
                        <button
                          className="secondary"
                          onClick={() => setEditing(r)}
                        >
                          {t("edit")}
                        </button>
                      </article>
                    ))}
                  </div>
                )}
              </>
            )}
            {page === "staples" && (
              <>
                <h1>{t("staples")}</h1>
                {state.staples.map((s) => (
                  <article className="card inline" key={s.id}>
                    <div>
                      <h2>{s.name}</h2>
                      <p>
                        {s.amount} {s.unit} · {t("everyDays")}: {s.everyDays}
                      </p>
                      <small>
                        {t("lastPurchased")}:{" "}
                        {s.lastPurchased
                          ? new Date(s.lastPurchased).toLocaleDateString()
                          : t("noDate")}
                      </small>
                    </div>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={s.enabled}
                        onChange={(e) =>
                          void save({
                            ...state,
                            staples: state.staples.map((item) =>
                              item.id === s.id
                                ? { ...item, enabled: e.target.checked }
                                : item,
                            ),
                          })
                        }
                      />
                      {t("enabled")}
                    </label>
                    <button
                      className="text"
                      onClick={() =>
                        void save({
                          ...state,
                          staples: state.staples.filter(
                            (item) => item.id !== s.id,
                          ),
                        })
                      }
                    >
                      {t("remove")}
                    </button>
                  </article>
                ))}
                <form
                  className="card inline"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const form = new FormData(e.currentTarget);
                    try {
                      const name = String(form.get("name"));
                      const unit = String(form.get("unit")) as Unit;
                      void save({
                        ...state,
                        staples: [
                          ...state.staples,
                          {
                            id: name.toLocaleLowerCase("fi"),
                            name,
                            unit,
                            amount: parseAmount(
                              String(form.get("amount")),
                              unit,
                            ),
                            everyDays: Number(form.get("days")),
                            lastPurchased: null,
                            enabled: true,
                          },
                        ],
                      });
                    } catch {
                      setError("invalidQuantity");
                    }
                  }}
                >
                  {field(t("name"), <input name="name" required />)}
                  {field(
                    t("amount"),
                    <input name="amount" inputMode="decimal" required />,
                  )}
                  {field(
                    t("unit"),
                    <select name="unit">
                      <option>g</option>
                      <option>ml</option>
                      <option>pcs</option>
                    </select>,
                  )}
                  {field(
                    t("everyDays"),
                    <input
                      name="days"
                      type="number"
                      min="1"
                      max="365"
                      defaultValue="7"
                      required
                    />,
                  )}
                  <button>{t("newStaple")}</button>
                </form>
              </>
            )}
            {page === "basket" && (
              <>
                <div className="section-heading">
                  <h1>{t("basket")}</h1>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => void call("buildBasket")}
                  >
                    {t("buildBasket")}
                  </button>
                </div>
                {snapshot.journal && (
                  <section className="card status">
                    <h2>
                      {t(
                        snapshot.journal.status === "verified"
                          ? "verified"
                          : "partial",
                      )}
                    </h2>
                    <p>{snapshot.journal.review.context.storeName}</p>
                    {snapshot.journal.status === "verified" &&
                      snapshot.journal.review.context.providerId ===
                        "k-ruoka" && (
                        <button
                          disabled={busy}
                          onClick={() => void call("openStoreCart")}
                        >
                          {t("openStoreCart")}
                        </button>
                      )}
                    <p>
                      {t("verifiedLines")}: {snapshot.journal.verified.length} /{" "}
                      {snapshot.journal.review.targets.length}
                    </p>
                    {snapshot.journal.uncertain && (
                      <p>
                        {t("uncertain")}: {snapshot.journal.uncertain}
                      </p>
                    )}
                    {snapshot.journal.status === "partial" && (
                      <button
                        disabled={busy}
                        onClick={() => void call("recover")}
                      >
                        {t("recover")}
                      </button>
                    )}
                  </section>
                )}
                {snapshot.review ? (
                  <section className="card">
                    <h2>{t("reviewTitle")}</h2>
                    <p>{snapshot.review.context.storeName}</p>
                    {snapshot.review.targets.map((target) => (
                      <div className="cart-row" key={target.productId}>
                        <strong>{target.name}</strong>
                        <span>
                          {t("before")}: {target.before} → {t("after")}:{" "}
                          {target.quantity} {target.unit}
                        </span>
                      </div>
                    ))}
                    <p>{t("retained")}</p>
                    <p>
                      {t("total")}: {money(snapshot.review.total)} ·{" "}
                      {t("budget")}: {money(state.household.budget)}
                    </p>
                    {(snapshot.review.context.providerId === "k-ruoka" ||
                      snapshot.review.total > state.household.budget) && (
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={acknowledged}
                          onChange={(e) => setAcknowledged(e.target.checked)}
                        />
                        {t(
                          snapshot.review.context.providerId === "k-ruoka"
                            ? "confirmRealReview"
                            : "confirmBudget",
                        )}
                      </label>
                    )}
                    {state.household.exclusions && (
                      <p>
                        {t("exclusions")}: {state.household.exclusions}
                      </p>
                    )}
                    <button
                      disabled={
                        busy ||
                        ((snapshot.review.context.providerId === "k-ruoka" ||
                          snapshot.review.total > state.household.budget) &&
                          !acknowledged)
                      }
                      onClick={() =>
                        void call("execute", {
                          id: snapshot.review!.id,
                          acknowledged,
                        })
                      }
                    >
                      {t("transfer")}
                    </button>
                  </section>
                ) : (
                  <>
                    {!snapshot.basket.length && <p>{t("noRequirements")}</p>}
                    {snapshot.basket.map((line) => (
                      <article
                        className="card"
                        key={`${line.requirement.id}:${line.requirement.unit}`}
                      >
                        <div className="section-heading">
                          <div>
                            <h2>{line.requirement.name}</h2>
                            <p>
                              {t("required")}: {line.requirement.amount}{" "}
                              {line.requirement.unit}
                            </p>
                          </div>
                          <strong>
                            {line.total === null ? "—" : money(line.total)}
                          </strong>
                        </div>
                        {line.product ? (
                          <p>
                            {line.product.name} · {line.packs}{" "}
                            {t("packs").toLowerCase()} · {t("bought")}:{" "}
                            {line.packs * line.product.packAmount}{" "}
                            {line.product.unit}
                          </p>
                        ) : (
                          <p className="warning">{t("unresolved")}</p>
                        )}
                        <div className="candidates">
                          {line.candidates.map((p) => (
                            <div className="candidate" key={p.id}>
                              <span>{p.name}</span>
                              <small>
                                {p.packAmount} {p.unit}
                              </small>
                              <strong>
                                {p.price === null
                                  ? t("unknown")
                                  : money(p.price)}
                              </strong>
                              <button
                                className="secondary"
                                disabled={
                                  busy || !p.available || p.price === null
                                }
                                onClick={() =>
                                  void call("accept", {
                                    ingredientId: line.requirement.id,
                                    productId: p.id,
                                  })
                                }
                              >
                                {p.available ? t("choose") : t("unavailable")}
                              </button>
                            </div>
                          ))}
                        </div>
                      </article>
                    ))}
                    {!!snapshot.basket.length && (
                      <section className="card summary">
                        <h2>
                          {t("total")}:{" "}
                          {money(
                            snapshot.basket.reduce(
                              (s, l) => s + (l.total ?? 0),
                              0,
                            ),
                          )}
                        </h2>
                        <p>{t("fees")}</p>
                        <button
                          disabled={
                            busy || snapshot.basket.some((l) => !l.product)
                          }
                          onClick={() => void call("prepare")}
                        >
                          {t("prepare")}
                        </button>
                      </section>
                    )}
                  </>
                )}
                <details>
                  <summary>Demo</summary>
                  <div className="actions">
                    <button
                      className="secondary"
                      onClick={() => void call("scenario", "interrupt")}
                    >
                      {t("demoInterrupt")}
                    </button>
                    <button
                      className="secondary"
                      onClick={() => void call("scenario", "price")}
                    >
                      {t("demoPrice")}
                    </button>
                  </div>
                </details>
              </>
            )}
            {page === "settings" && (
              <>
                <h1>{t("settings")}</h1>
                <form
                  className="card form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const data = new FormData(e.currentTarget);
                    void save({
                      ...state,
                      household: {
                        servings: Number(data.get("servings")),
                        budget: Math.round(
                          Number(String(data.get("budget")).replace(",", ".")) *
                            100,
                        ),
                        exclusions: String(data.get("exclusions")),
                      },
                    });
                  }}
                >
                  {field(
                    t("servings"),
                    <input
                      name="servings"
                      type="number"
                      min="1"
                      max="100"
                      defaultValue={state.household.servings}
                      required
                    />,
                  )}
                  {field(
                    t("budget"),
                    <input
                      name="budget"
                      inputMode="decimal"
                      defaultValue={state.household.budget / 100}
                      required
                    />,
                  )}
                  {field(
                    t("exclusions"),
                    <textarea
                      name="exclusions"
                      defaultValue={state.household.exclusions}
                    />,
                  )}
                  <button disabled={busy}>{t("save")}</button>
                </form>
                <section className="card form">
                  {field(
                    t("store"),
                    <select
                      value={state.context.providerId}
                      onChange={(e) =>
                        void save({
                          ...state,
                          context: {
                            ...state.context,
                            providerId: e.target.value,
                            storeName: `${e.target.value === "demo-k" ? "K-Ruoka" : "S-kaupat"} · Helsinki (demo)`,
                          },
                        })
                      }
                    >
                      <option value="demo-k">K-Ruoka (demo)</option>
                      <option value="demo-s">S-kaupat (demo)</option>
                      {state.context.providerId === "k-ruoka" && (
                        <option value="k-ruoka">
                          {state.context.storeName}
                        </option>
                      )}
                    </select>,
                  )}
                  {field(
                    t("pickup") + " / " + t("delivery"),
                    <select
                      value={state.context.fulfillment}
                      onChange={(e) =>
                        void save({
                          ...state,
                          context: {
                            ...state.context,
                            fulfillment: e.target.value as
                              "pickup" | "delivery",
                          },
                        })
                      }
                    >
                      <option value="pickup">{t("pickup")}</option>
                      <option value="delivery">{t("delivery")}</option>
                    </select>,
                  )}
                  <h2>K-Ruoka</h2>
                  <p>{t("realStatus")}</p>
                  <form
                    className="inline"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void call(
                        "searchStores",
                        String(new FormData(e.currentTarget).get("query")),
                      );
                    }}
                  >
                    <label>
                      {t("searchStores")}
                      <input
                        name="query"
                        minLength={2}
                        required
                        placeholder="Helsinki"
                      />
                    </label>
                    <button disabled={busy}>{t("search")}</button>
                  </form>
                  {snapshot.storeResults.map((store) => (
                    <button
                      className="secondary"
                      disabled={busy}
                      key={store.storeId}
                      onClick={() => void save({ ...state, context: store })}
                    >
                      {store.storeName}
                    </button>
                  ))}
                  <div className="actions">
                    <button
                      disabled={busy}
                      onClick={() => void call("loginStore")}
                    >
                      {t("loginStore")}
                    </button>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => void call("checkStoreLogin")}
                    >
                      {t("checkLogin")}
                    </button>
                    <button
                      className="text"
                      disabled={busy}
                      onClick={() => void call("cancelStoreLogin")}
                    >
                      {t("cancel")}
                    </button>
                  </div>
                  <p role="status">
                    {t(
                      snapshot.storeLogin === "signedIn"
                        ? "signedIn"
                        : snapshot.storeLogin === "waiting"
                          ? "waitingLogin"
                          : snapshot.storeLogin === "failed"
                            ? "loginFailed"
                            : "notConnected",
                    )}
                  </p>
                  <p>{t("aiStatus")}</p>
                </section>
                <section className="card">
                  <p>{t("localData")}</p>
                  <div className="actions">
                    <button
                      className="secondary"
                      onClick={() => void call("exportData")}
                    >
                      {t("backup")}
                    </button>
                    <button
                      className="secondary"
                      onClick={() => void call("importData")}
                    >
                      {t("restore")}
                    </button>
                  </div>
                </section>
              </>
            )}
          </main>
        </>
      )}
    </>
  );
}
function RecipeForm({
  recipe,
  t,
  onSave,
  onCancel,
}: {
  recipe: Recipe;
  t: (key: Key) => string;
  onSave: (recipe: Recipe) => void;
  onCancel: () => void;
}) {
  const [rows, setRows] = useState(
    recipe.ingredients.map((i) => ({
      ...i,
      raw: String(i.amount),
      inputUnit: i.unit as Unit | "kg" | "l",
    })),
  );
  const [error, setError] = useState(false);
  return (
    <form
      className="card form"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        try {
          if (!rows.length) throw new Error();
          onSave({
            ...recipe,
            name: String(data.get("name")),
            servings: Number(data.get("servings")),
            instructions: String(data.get("instructions")),
            ingredients: rows.map((row) => ({
              id: row.id,
              name: row.name,
              amount: parseAmount(row.raw, row.inputUnit),
              unit:
                row.inputUnit === "kg"
                  ? "g"
                  : row.inputUnit === "l"
                    ? "ml"
                    : row.inputUnit,
            })),
          });
        } catch {
          setError(true);
        }
      }}
    >
      <label>
        {t("name")}
        <input name="name" defaultValue={recipe.name} required />
      </label>
      <label>
        {t("servings")}
        <input
          name="servings"
          type="number"
          min="1"
          max="100"
          defaultValue={recipe.servings}
          required
        />
      </label>
      <h2>{t("ingredients")}</h2>
      {rows.map((row, index) => (
        <div className="inline" key={index}>
          <label>
            {t("name")}
            <input
              value={row.name}
              required
              onChange={(e) =>
                setRows(
                  rows.map((r, i) =>
                    i === index
                      ? {
                          ...r,
                          name: e.target.value,
                          id:
                            recipe.ingredients[index]?.id ??
                            e.target.value.toLocaleLowerCase("fi"),
                        }
                      : r,
                  ),
                )
              }
            />
          </label>
          <label>
            {t("amount")}
            <input
              inputMode="decimal"
              value={row.raw}
              required
              onChange={(e) =>
                setRows(
                  rows.map((r, i) =>
                    i === index ? { ...r, raw: e.target.value } : r,
                  ),
                )
              }
            />
          </label>
          <label>
            {t("unit")}
            <select
              value={row.inputUnit}
              onChange={(e) =>
                setRows(
                  rows.map((r, i) =>
                    i === index
                      ? {
                          ...r,
                          inputUnit: e.target.value as typeof row.inputUnit,
                        }
                      : r,
                  ),
                )
              }
            >
              {["g", "kg", "ml", "l", "pcs"].map((u) => (
                <option key={u}>{u}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="text"
            onClick={() => setRows(rows.filter((_, i) => i !== index))}
          >
            {t("remove")}
          </button>
        </div>
      ))}
      <button
        type="button"
        className="secondary"
        onClick={() =>
          setRows([
            ...rows,
            {
              id: crypto.randomUUID(),
              name: "",
              amount: 1,
              unit: "g",
              raw: "",
              inputUnit: "g",
            },
          ])
        }
      >
        {t("addIngredient")}
      </button>
      <label>
        {t("instructions")}
        <textarea name="instructions" defaultValue={recipe.instructions} />
      </label>
      {error && <p role="alert">{t("invalidQuantity")}</p>}
      <div className="actions">
        <button>{t("save")}</button>
        <button type="button" className="secondary" onClick={onCancel}>
          {t("cancel")}
        </button>
      </div>
    </form>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
