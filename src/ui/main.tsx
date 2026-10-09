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
import { ShoppingWorkspace } from "./shopping";
import { en, fi, packCount, unitLabel, type Key } from "./i18n";
import "./style.css";
import { Setup } from "./setup";
import { isLive } from "../stores/provider";
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
    developmentMode: false,
    developmentScenario: "success",
    state: initialState(),
    basket: [],
    review: null,
    journal: null,
    storeResults: [],
    storeLogin: "notStarted",
    ai: { state: "disconnected", email: "", error: null, models: [] },
    draft: null,
  });
  const [page, setPage] = useState<Key>("week");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Recipe | null>(null);
  const [editingStapleId, setEditingStapleId] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  useEffect(() => setAcknowledged(false), [snapshot.review?.id]);
  const state = snapshot.state;
  const editingStaple = state.staples.find(
    (item) => item.id === editingStapleId,
  );
  const t = (key: Key) => (state.language === "fi" ? fi : en)[key];
  const u = (unit: string) => unitLabel(unit, state.language);
  const money = (cents: number) =>
    new Intl.NumberFormat(state.language === "fi" ? "fi-FI" : "en-FI", {
      style: "currency",
      currency: "EUR",
    }).format(cents / 100);
  async function call(method: string, input?: unknown) {
    setBusy(true);
    setError("");
    try {
      const result = await window.korikone[method](input);
      if (!result.ok) throw new Error(result.error);
      if (method === "setDevelopmentMode")
        sessionStorage.removeItem("shopping-note");
      setSnapshot(result.value);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "operationFailed");
      return false;
    } finally {
      setBusy(false);
    }
  }
  const unitPrice = (cents: number, amount: number, unit: Unit) =>
    unit === "pcs"
      ? `${money(cents / amount)} / ${t("perPiece")}`
      : `${money(Math.round((cents * 1000) / amount))} / ${unit === "g" ? "kg" : "l"}`;
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
  useEffect(() => {
    if (snapshot.ai.state !== "waiting") return;
    const timer = setInterval(() => {
      void window.korikone.load().then((result) => {
        if (result.ok) setSnapshot(result.value);
      });
    }, 1500);
    return () => clearInterval(timer);
  }, [snapshot.ai.state]);
  useEffect(() => {
    if (snapshot.storeLogin !== "waiting" || busy) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      try {
        const result = await window.korikone.checkStoreLogin();
        if (stopped) return;
        if (!result.ok) {
          setError(result.error ?? "storeUnavailable");
          return;
        }
        setSnapshot(result.value);
        if (result.value.storeLogin === "waiting")
          timer = setTimeout(check, 2500);
      } catch {
        if (!stopped) setError("storeUnavailable");
      }
    };
    timer = setTimeout(check, 2500);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [snapshot.storeLogin, busy]);
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
      <div className="window-bar">▧ Korikone</div>
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
      {snapshot.developmentMode && (
        <div className="demo" data-testid="development-banner">
          {t("developmentMode")}
        </div>
      )}
      <div className="demo">
        {isLive(state.context.providerId) && !snapshot.developmentMode
          ? `${state.context.storeName} · ${t("liveStore")}`
          : t("demo")}
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
            onClick={() => {
              void window.korikone.cancelTransfer();
              void window.korikone.cancelAI();
            }}
          >
            {t("cancel")}
          </button>
        </div>
      )}
      {state.onboarded && !state.setupComplete ? (
        <Setup
          snapshot={snapshot}
          t={t}
          busy={busy}
          call={call}
          finish={() =>
            save({
              ...state,
              setupComplete: true,
              staples: state.meals.length
                ? state.staples
                : state.staples.map((s) => ({ ...s, enabled: false })),
            })
          }
        />
      ) : !state.onboarded ? (
        <main className="welcome">
          <div className="eyebrow">KORIKONE / 01</div>
          <h1>{t("welcome")}</h1>
          <p>{t("intro")}</p>
          <div className="actions">
            <button
              disabled={busy}
              onClick={() =>
                void save({ ...state, onboarded: true, setupComplete: false })
              }
            >
              {t("setupStart")}
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                void save({
                  ...state,
                  onboarded: true,
                  setupComplete: true,
                  note: "Tomaattipasta ja peruna-porkkanakeitto. Kahvia.",
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
              onClick={() =>
                void save({
                  ...state,
                  onboarded: true,
                  setupComplete: true,
                  staples: state.staples.map((s) => ({ ...s, enabled: false })),
                })
              }
            >
              {t("manual")}
            </button>
          </div>
        </main>
      ) : (
        <>
          <nav>
            {(
              [
                "week",
                "weekPlan",
                "recipes",
                "staples",
                "history",
                "basket",
                "settings",
              ] as Key[]
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
          <main className="app-main">
            <div className="context">
              <span>{state.context.storeName}</span>
              <span>{t(state.context.fulfillment)}</span>
            </div>
            {(page === "week" || page === "weekPlan" || page === "history") && (
              <ShoppingWorkspace
                key={`${page}:${snapshot.developmentMode}`}
                snapshot={snapshot}
                busy={busy}
                call={call}
                save={save}
                settings={() => setPage("settings")}
                review={() => setPage("basket")}
                view={
                  page === "weekPlan"
                    ? "schedule"
                    : page === "history"
                      ? "history"
                      : "list"
                }
              />
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
                    language={state.language}
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
                              {i.name} · {i.amount} {u(i.unit)}
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
                        {s.amount} {u(s.unit)} · {t("everyDays")}: {s.everyDays}
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
                      disabled={busy}
                      onClick={() => setEditingStapleId(s.id)}
                    >
                      {t("edit")}
                    </button>
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
                  key={editingStaple?.id ?? "new-staple"}
                  className="card inline"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const form = new FormData(e.currentTarget);
                    try {
                      const name = String(form.get("name"));
                      const unit = String(form.get("unit")) as Unit;
                      const item = {
                        id:
                          editingStaple?.id ??
                          name.trim().toLocaleLowerCase("fi"),
                        name,
                        unit,
                        amount: parseAmount(String(form.get("amount")), unit),
                        everyDays: Number(form.get("days")),
                        lastPurchased: editingStaple?.lastPurchased ?? null,
                        enabled: editingStaple?.enabled ?? true,
                      };
                      if (
                        !editingStaple &&
                        state.staples.some((s) => s.id === item.id)
                      ) {
                        setError("duplicateStaple");
                        return;
                      }
                      if (
                        await save({
                          ...state,
                          staples: editingStaple
                            ? state.staples.map((s) =>
                                s.id === item.id ? item : s,
                              )
                            : [...state.staples, item],
                        })
                      )
                        setEditingStapleId(null);
                    } catch {
                      setError("invalidQuantity");
                    }
                  }}
                >
                  {field(
                    t("name"),
                    <input
                      name="name"
                      defaultValue={editingStaple?.name ?? ""}
                      required
                    />,
                  )}
                  {field(
                    t("amount"),
                    <input
                      name="amount"
                      inputMode="decimal"
                      defaultValue={editingStaple?.amount ?? ""}
                      required
                    />,
                  )}
                  {field(
                    t("unit"),
                    <select
                      name="unit"
                      aria-label={t("unit")}
                      defaultValue={editingStaple?.unit ?? "g"}
                    >
                      <option>g</option>
                      <option>ml</option>
                      <option value="pcs">{u("pcs")}</option>
                    </select>,
                  )}
                  {field(
                    t("everyDays"),
                    <input
                      name="days"
                      type="number"
                      min="1"
                      max="365"
                      defaultValue={editingStaple?.everyDays ?? 7}
                      required
                    />,
                  )}
                  <button disabled={busy}>
                    {t(editingStaple ? "save" : "newStaple")}
                  </button>
                  {editingStaple && (
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setEditingStapleId(null)}
                    >
                      {t("cancel")}
                    </button>
                  )}
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
                    {snapshot.journal.status === "verified" && (
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => void call("confirmPurchase")}
                      >
                        {t("ordered")}
                      </button>
                    )}
                    {snapshot.journal.status === "verified" &&
                      isLive(snapshot.journal.review.context.providerId) && (
                        <button
                          disabled={busy}
                          onClick={() => void call("openStoreCart")}
                        >
                          {t("openStoreCart")}
                        </button>
                      )}
                    {snapshot.journal.status === "verified" &&
                      snapshot.journal.review.context.providerId ===
                        "s-kaupat" && <p>{t("sKaupatHandoff")}</p>}
                    <p>
                      {t("verifiedLines")}: {snapshot.journal.verified.length} /{" "}
                      {snapshot.journal.review.targets.length}
                    </p>
                    {!!snapshot.journal.review.unresolved?.length && (
                      <div className="warning">
                        <h3>
                          {state.language === "fi"
                            ? "Nämä jäivät ostoskorin ulkopuolelle"
                            : "These items were not transferred"}
                        </h3>
                        <ul>
                          {snapshot.journal.review.unresolved.map((item) => (
                            <li key={`${item.id}:${item.unit}`}>
                              {item.name} · {item.amount} {u(item.unit)}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <button
                      className="secondary"
                      onClick={() => setPage("week")}
                    >
                      {state.language === "fi"
                        ? "Takaisin listaan"
                        : "Back to list"}
                    </button>
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
                    {!!snapshot.review.unresolved?.length && (
                      <div className="warning">
                        <h3>
                          {state.language === "fi"
                            ? "Tuote puuttuu: ei siirretä"
                            : "No product selected: excluded from transfer"}
                        </h3>
                        <ul>
                          {snapshot.review.unresolved.map((item) => (
                            <li key={`${item.id}:${item.unit}`}>
                              {item.name} · {item.amount} {u(item.unit)}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {isLive(snapshot.review.context.providerId) && (
                      <p>
                        {t("account")}:{" "}
                        {snapshot.review.baseline.accountName || t("signedIn")}
                      </p>
                    )}
                    {snapshot.review.context.providerId === "s-kaupat" && (
                      <p>{t("sKaupatListInfo")}</p>
                    )}
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
                    <ul>
                      {snapshot.review.baseline.lines
                        .filter(
                          (line) =>
                            !snapshot.review!.targets.some(
                              (target) => target.productId === line.productId,
                            ),
                        )
                        .map((line) => (
                          <li key={line.productId}>
                            {line.name} · {line.quantity} {u(line.unit)}
                          </li>
                        ))}
                    </ul>
                    <p>
                      {t("total")}: {money(snapshot.review.total)} ·{" "}
                      {t("budget")}: {money(state.household.budget)}
                    </p>
                    {(isLive(snapshot.review.context.providerId) ||
                      snapshot.review.total > state.household.budget) && (
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={acknowledged}
                          onChange={(e) => setAcknowledged(e.target.checked)}
                        />
                        {t(
                          isLive(snapshot.review.context.providerId)
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
                        ((isLive(snapshot.review.context.providerId) ||
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
                    {[...snapshot.basket]
                      .sort((a, b) => Number(!!a.product) - Number(!!b.product))
                      .map((line) => {
                        const key = `${line.requirement.id}:${line.requirement.unit}`;
                        const bought = line.product
                          ? line.packs * line.product.packAmount
                          : 0;
                        return (
                          <article
                            className={`card${line.product ? "" : " attention"}`}
                            key={key}
                          >
                            <div className="section-heading">
                              <div>
                                <h2>{line.requirement.name}</h2>
                                <p>
                                  {t("required")}: {line.requirement.amount}{" "}
                                  {u(line.requirement.unit)}
                                </p>
                              </div>
                              <strong>
                                {line.total === null ? "—" : money(line.total)}
                              </strong>
                            </div>
                            {line.product ? (
                              <>
                                <p>
                                  {line.product.name} ·{" "}
                                  {packCount(line.packs, state.language)} ·{" "}
                                  {t("bought")}: {bought} {u(line.product.unit)}
                                  {bought > line.requirement.amount &&
                                    ` · ${t("surplus")}: ${bought - line.requirement.amount} ${u(line.product.unit)}`}
                                </p>
                                <p className="muted">
                                  {t(
                                    line.candidates.filter(
                                      (p) => p.available && p.price !== null,
                                    ).length > 1
                                      ? "reasonCheapest"
                                      : "reasonAccepted",
                                  )}
                                </p>
                              </>
                            ) : (
                              <p className="warning" role="status">
                                {t(
                                  line.candidates.length
                                    ? "unresolved"
                                    : "noCandidates",
                                )}
                              </p>
                            )}
                            <div className="candidates">
                              {line.candidates.map((p) => (
                                <div className="candidate" key={p.id}>
                                  <span>{p.name}</span>
                                  <small>
                                    {p.packAmount} {u(p.unit)}
                                    {p.price !== null &&
                                      p.packAmount > 0 &&
                                      ` · ${unitPrice(p.price, p.packAmount, p.unit)}`}
                                    {p.deposit > 0 &&
                                      ` · ${t("deposit")} ${money(p.deposit)}`}
                                  </small>
                                  <strong>
                                    {p.price === null
                                      ? t("unknown")
                                      : money(p.price)}
                                  </strong>
                                  <button
                                    className="secondary"
                                    disabled={
                                      busy ||
                                      !p.available ||
                                      p.price === null ||
                                      p.id === line.product?.id
                                    }
                                    onClick={() =>
                                      void call("accept", {
                                        ingredientId: line.requirement.id,
                                        productId: p.id,
                                      })
                                    }
                                  >
                                    {p.id === line.product?.id
                                      ? t("chosen")
                                      : p.available
                                        ? t("choose")
                                        : p.available === false
                                          ? t("unavailable")
                                          : t("stockUnknown")}
                                  </button>
                                </div>
                              ))}
                            </div>
                            {!!line.excluded && (
                              <p className="muted">
                                {t("excludedProducts")}: {line.excluded}
                              </p>
                            )}
                            <button
                              className="text"
                              disabled={busy}
                              onClick={() => void call("omit", key)}
                            >
                              {t("alreadyHave")}
                            </button>
                          </article>
                        );
                      })}
                    {!!snapshot.basket.length && (
                      <section className="card summary">
                        {snapshot.basket.some((l) => !l.product) && (
                          <p className="warning" role="status">
                            {t("needsAttention")}:{" "}
                            {snapshot.basket.filter((l) => !l.product).length}
                          </p>
                        )}
                        <p>
                          {t("goods")}:{" "}
                          {money(
                            snapshot.basket.reduce(
                              (s, l) =>
                                s +
                                (l.product ? l.packs * l.product.price! : 0),
                              0,
                            ),
                          )}
                        </p>
                        <p>
                          {t("deposits")}:{" "}
                          {money(
                            snapshot.basket.reduce(
                              (s, l) =>
                                s +
                                (l.product ? l.packs * l.product.deposit : 0),
                              0,
                            ),
                          )}
                        </p>
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
                <section className="card">
                  <label>
                    <input
                      type="checkbox"
                      checked={snapshot.developmentMode}
                      disabled={busy}
                      onChange={(e) =>
                        void call("setDevelopmentMode", e.target.checked)
                      }
                    />
                    {t("developmentMode")}
                  </label>
                  <p>{t("developmentModeInfo")}</p>
                  {snapshot.developmentMode && (
                    <label>
                      {t("developmentScenario")}
                      <select
                        value={snapshot.developmentScenario}
                        disabled={busy}
                        onChange={(e) =>
                          void call("developmentScenario", e.target.value)
                        }
                      >
                        {[
                          "success",
                          "delayedSuccess",
                          "invalidOnce",
                          "invalidDraft",
                          "usageLimit",
                          "incompleteDraft",
                          "aiFailed",
                        ].map((value) => (
                          <option key={value} value={value}>
                            {value}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </section>
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
                  <p className="muted">{t("exclusionsHelp")}</p>
                  <button disabled={busy}>{t("save")}</button>
                </form>
                <section className="card form">
                  <details>
                    <summary>{t("advancedSettings")}</summary>
                    {field(
                      t("store"),
                      <select
                        aria-label={t("store")}
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
                        {isLive(state.context.providerId) && (
                          <option value={state.context.providerId}>
                            {state.context.storeName}
                          </option>
                        )}
                      </select>,
                    )}
                    {field(
                      t("pickup") + " / " + t("delivery"),
                      <select
                        value={state.context.fulfillment}
                        disabled={isLive(state.context.providerId)}
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
                  </details>
                  <h2>{t("storeConnection")}</h2>
                  {isLive(state.context.providerId) && (
                    <p>
                      <strong>{state.context.storeName}</strong>
                    </p>
                  )}
                  <p>K-Ruoka: {t("realStatus")}</p>
                  <p>S-kaupat: {t("sKaupatStatus")}</p>
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
                    {state.context.providerId === "s-kaupat" &&
                      snapshot.storeLogin === "signedIn" && (
                        <button
                          className="text"
                          disabled={busy}
                          onClick={() => void call("logoutStore")}
                        >
                          {t("logoutStore")}
                        </button>
                      )}
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
                  <h2>ChatGPT</h2>
                  <p>{t("aiConnectionInfo")}</p>
                  <p role="status">
                    {t(
                      snapshot.ai.state === "connected"
                        ? "signedIn"
                        : snapshot.ai.state === "waiting"
                          ? "waitingAI"
                          : snapshot.ai.state === "permissionMissing"
                            ? "permissionMissing"
                            : "notConnected",
                    )}
                    {snapshot.ai.email ? ` · ${snapshot.ai.email}` : ""}
                  </p>
                  {snapshot.ai.error && (
                    <p role="alert">
                      {t(
                        snapshot.ai.error in en
                          ? (snapshot.ai.error as Key)
                          : "authFailed",
                      )}
                    </p>
                  )}
                  <div className="actions">
                    <button
                      disabled={busy || snapshot.ai.state === "waiting"}
                      onClick={() => void call("signInAI")}
                    >
                      Continue with ChatGPT
                    </button>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => void call("signOutAI")}
                    >
                      {t("signOut")}
                    </button>
                    <button
                      className="secondary"
                      onClick={() => void call("usageAI")}
                    >
                      {t("manageUsage")}
                    </button>
                    {snapshot.ai.state === "waiting" && (
                      <button
                        className="text"
                        onClick={() => void call("cancelAI")}
                      >
                        {t("cancel")}
                      </button>
                    )}
                  </div>
                </section>
                <section className="card form">
                  <h2>
                    {state.language === "fi"
                      ? "Aiemmat kuitit"
                      : "Previous receipts"}
                  </h2>
                  <p>
                    {state.language === "fi"
                      ? "Tuo PDF-kuitti, teksti- tai CSV-tiedosto tai liitä ostosrivit alle. PDF:n teksti luetaan paikallisesti. Tietoja käytetään seuraavissa ChatGPT-ehdotuksissa. Skannattu PDF tarvitsee tekstintunnistuksen (OCR)."
                      : "Import a PDF, text or CSV receipt, or paste purchase lines below. PDF text is extracted locally. These inform future ChatGPT suggestions. Scanned PDFs need OCR."}
                  </p>
                  <button
                    disabled={busy}
                    onClick={() => void call("importReceipt")}
                  >
                    {state.language === "fi"
                      ? "Tuo kuitti (PDF, teksti tai CSV)"
                      : "Import receipt (PDF, text or CSV)"}
                  </button>
                  <form
                    key={state.receiptText}
                    onSubmit={(e) => {
                      e.preventDefault();
                      void save({
                        ...state,
                        receiptText: String(
                          new FormData(e.currentTarget).get("receipts"),
                        ),
                      });
                    }}
                  >
                    <label>
                      {state.language === "fi"
                        ? "Kuittien ostosrivit"
                        : "Receipt purchase lines"}
                      <textarea
                        name="receipts"
                        defaultValue={state.receiptText}
                        maxLength={50000}
                      />
                    </label>
                    <button disabled={busy}>{t("save")}</button>
                  </form>
                </section>
                <details className="card">
                  <summary>{t("dataManagement")}</summary>
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
                    <button
                      className="text"
                      onClick={() => void call("exportDiagnostics")}
                    >
                      {t("diagnostics")}
                    </button>
                  </div>
                </details>
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
  language,
  onSave,
  onCancel,
}: {
  recipe: Recipe;
  t: (key: Key) => string;
  language: string;
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
  const u = (unit: string) => unitLabel(unit, language);
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
              {["g", "kg", "ml", "l", "pcs"].map((unit) => (
                <option key={unit} value={unit}>
                  {u(unit)}
                </option>
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
