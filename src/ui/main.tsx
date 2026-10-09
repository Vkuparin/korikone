import React, { useEffect, useRef, useState } from "react";
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
import { en, fi, unitLabel, type Key } from "./i18n";
import "./style.css";
import { Setup } from "./setup";
import { Chains } from "./chains";
import { StorePage, type Chain } from "./store";
import { isLive, liveProviders } from "../stores/provider";
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
    developmentRequests: 0,
    state: initialState(),
    basket: [],
    review: null,
    journal: null,
    storeResults: [],
    storeLogin: "notStarted",
    storeLogins: {},
    comparison: null,
    pickupFee: null,
    ai: { state: "disconnected", email: "", error: null, models: [] },
    draft: null,
  });
  const [page, setPage] = useState<Key>("week");
  const [storeChain, setStoreChain] = useState<Chain | null>(null);
  const checkedLogins = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Recipe | null>(null);
  const [editingStapleId, setEditingStapleId] = useState<string | null>(null);
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
      if (!result.ok && result.error === "aiCancelled") return false;
      if (!result.ok) throw new Error(result.error);
      if (method === "setDevelopmentMode")
        sessionStorage.removeItem("shopping-note");
      setSnapshot((current) => {
        // Language changes run beside queued operations. Their older snapshots
        // must not undo the latest selection in the renderer.
        if (method === "setDevelopmentMode" || (method === "load" && !loaded))
          return result.value;
        return {
          ...result.value,
          state: { ...result.value.state, language: current.state.language },
        };
      });
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
  useEffect(() => {
    if (snapshot.ai.state !== "waiting") return;
    const timer = setInterval(() => {
      void window.korikone.load().then((result) => {
        if (result.ok) setSnapshot(result.value);
      });
    }, 1500);
    return () => clearInterval(timer);
  }, [snapshot.ai.state]);
  // Sign-in state lives only in the main process's memory, so after a launch, and when
  // Asetukset opens, ask each chain with a chosen store whether its saved login still holds.
  useEffect(() => {
    if (!loaded) return;
    if (page !== "settings" && checkedLogins.current) return;
    checkedLogins.current = true;
    const chains = liveProviders.filter(
      (id) =>
        (state.stores[id] || state.context.providerId === id) &&
        snapshot.storeLogins[id] !== "waiting",
    );
    void (async () => {
      for (const id of chains) {
        const result = await window.korikone
          .checkStoreLogin(id)
          .catch(() => null);
        if (result?.ok)
          setSnapshot((current) => ({
            ...current,
            storeLogin: result.value.storeLogin,
            storeLogins: result.value.storeLogins,
          }));
      }
    })();
  }, [loaded, page]);
  // Either chain may be waiting for its login window, not only the active one.
  const waitingChain =
    snapshot.storeLogin === "waiting"
      ? null
      : Object.entries(snapshot.storeLogins).find(
          ([, login]) => login === "waiting",
        )?.[0];
  const waiting = snapshot.storeLogin === "waiting" || !!waitingChain;
  useEffect(() => {
    if (!waiting || busy) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      try {
        const result = await window.korikone.checkStoreLogin(
          waitingChain ?? undefined,
        );
        if (stopped) return;
        if (!result.ok) {
          setError(result.error ?? "storeUnavailable");
          return;
        }
        setSnapshot(result.value);
        if (
          Object.values(result.value.storeLogins).includes("waiting") ||
          result.value.storeLogin === "waiting"
        )
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
  }, [waiting, waitingChain, busy]);
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
              window.dispatchEvent(new Event("korikone:cancel-ai"));
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
                "history",
                "store",
                "settings",
              ] as Key[]
            ).map((key) => (
              <button
                key={key}
                aria-current={
                  page === key || (key === "settings" && page === "staples")
                    ? "page"
                    : undefined
                }
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
                staples={() => setPage("staples")}
                openStore={(chain) => {
                  setStoreChain(chain);
                  setPage("store");
                }}
                view={
                  page === "weekPlan"
                    ? "schedule"
                    : page === "history"
                      ? "history"
                      : "list"
                }
              />
            )}
            {page === "store" && (
              <StorePage
                snapshot={snapshot}
                chain={storeChain}
                setChain={setStoreChain}
                settings={() => setPage("settings")}
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
                <button className="text" onClick={() => setPage("settings")}>
                  ← {t("settings")}
                </button>
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
            {page === "settings" && (
              <>
                <h1>{t("settings")}</h1>
                <section className="card">
                  <h2>{t("staples")}</h2>
                  <p className="muted">{t("staplesHelp")}</p>
                  <button
                    className="secondary"
                    onClick={() => setPage("staples")}
                  >
                    {t("editStaples")}
                  </button>
                </section>
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
                  <h3>{t("chainsTitle")}</h3>
                  <p className="muted">{t("chainsHelp")}</p>
                  <Chains snapshot={snapshot} t={t} busy={busy} call={call} />
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
