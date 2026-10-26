import { useOperationProgress } from "./use-operation-progress";
import { ElapsedSeconds, OperationProgressBody } from "./operation-progress";
import type { OperationProgress } from "../application/operation-progress";
import { terminalOperation } from "../application/operation-progress";
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { IntakeProgress } from "../application/receipt-intake";
import type { Snapshot } from "../application/service";
import type { PlanningRequest } from "../application/coordinator";
import type { AppearanceBootstrap } from "../domain/appearance";
import type {
  PlanningSnapshot,
  PlanningControl,
} from "../application/planning";
import { subscribeAppearance } from "./appearance";
import {
  initialState,
  parseAmount,
  type AppState,
  type Recipe,
  type Unit,
} from "../domain/model";
import { ShoppingWorkspace, type ComposerProgress } from "./shopping";
import { planningActivityPending } from "./planning-status";
import { en, fi, unitLabel, type Key } from "./i18n";
import "./style.css";
import { Setup } from "./setup";
import { ShoppingContext } from "./context";
import { ReceiptIntakeSurface, useReceiptIntake } from "./receipt-intake";
import {
  AdvancedSettings,
  AISettings,
  StoresSettings,
  DataSettings,
} from "./settings-sections";
import { Choice } from "./choice";
import {
  Settings,
  GeneralSettings,
  HouseholdSettings,
  AboutSettings,
  sectionLabels,
} from "./settings";
import type {
  SettingsSection,
  SettingsSectionProps,
} from "./settings-contract";
import { StorePage, type Chain } from "./store";
import { isLive, liveProviders } from "../stores/provider";
declare global {
  interface Window {
    korikone: Record<
      string,
      (
        input?: unknown,
      ) => Promise<{ ok: boolean; value: Snapshot; error?: string }>
    > & {
      getAppearanceBootstrap: () => AppearanceBootstrap;
      commitPlanning: (input: {
        operationId: string;
      }) => Promise<{ ok: boolean; value: Snapshot; error?: string }>;
      planShopping: (
        input: PlanningRequest,
      ) => Promise<{ ok: boolean; value: Snapshot; error?: string }>;
      getOperationProgress: () => Promise<{
        ok: boolean;
        value: OperationProgress | null;
      }>;
      onOperationProgress: (
        callback: (value: OperationProgress) => void,
      ) => () => void;
      onPlanningChange: (
        callback: (value: PlanningSnapshot) => void,
      ) => () => void;
      cancelPlanning: (
        input: PlanningControl,
      ) => Promise<{ ok: boolean; value: Snapshot; error?: string }>;
      invalidatePlanning: (
        input: PlanningControl,
      ) => Promise<{ ok: boolean; value: Snapshot; error?: string }>;
      onAppearanceChange: (
        callback: (value: AppearanceBootstrap) => void,
      ) => () => void;
      onUpdateChange: (
        callback: (value: { version: string; url: string }) => void,
      ) => () => void;
      onReceiptIntake: (
        callback: (value: IntakeProgress) => void,
      ) => () => void;
      onReceiptDrop: (
        callback: (value: {
          ok: boolean;
          value?: Snapshot;
          error?: string;
        }) => void,
      ) => () => void;
      onStoreHistoryChange: (
        callback: (value: { chain: string; canGoBack: boolean }) => void,
      ) => () => void;
      storeHistory: (input: {
        chain: string;
      }) => Promise<{ ok: boolean; value: { canGoBack: boolean } }>;
      getAppInfo: () => Promise<{
        ok: boolean;
        value: { version: string; developmentLocked: boolean };
        error?: string;
      }>;
    };
  }
}
function App() {
  const [snapshot, setSnapshot] = useState<Snapshot>({
    developmentMode: false,
    offerDiscoverySupported: false,
    developmentInsightsReads: 0,
    developmentScenario: "success",
    developmentRequests: 0,
    developmentModel: null,
    developmentModelCatalogueRequests: 0,
    developmentSignInCalls: 0,
    developmentAIProvider: null,
    developmentCatalogueRequests: 0,
    state: initialState(),
    pricingState: "empty",
    basket: [],
    quotedAt: null,
    pricingError: null,
    review: null,
    transferException: null,
    handoffError: null,
    transferBatchKey: "",
    developmentHandoffs: [],
    developmentStoreWrites: 0,
    journal: null,
    storeResults: [],
    contextOptions: null,
    storeLogin: "notStarted",
    storeLogins: {},
    comparison: null,
    pickupFee: null,
    ai: { state: "disconnected", email: "", error: null, models: [] },
    update: null,
    draft: null,
    recipeDraft: null,
    starterIdeas: null,
    offerIdeas: null,
    planning: null,
    edit: null,
    purchaseImport: null,
    receiptEnrichment: null,
    purchaseSignals: [],
    repeat: null,
    editUndoAvailable: false,
    committedIntents: [],
    receiptIntake: null,
    receiptIntakeRunning: null,
    reset: null,
    proposal: { sides: [], quantities: [] },
    merchandise: {
      capabilities: {
        discovery: false,
        variants: "none",
        stock: "none",
        cartWrite: false,
      },
      manual: [],
      statuses: [],
    },
    planningIncomplete: false,
    cheaperProductIds: [],
  });
  const [page, setPage] = useState<Key>("week");
  // Where the shopping list was scrolled when the shopper left it, so the Store view's own
  // "Return to shopping list" brings them back to the same place.
  const listScroll = useRef({ window: 0, panel: 0 });
  const restoreList = useRef(false);
  useEffect(() => {
    if (page !== "week") return;
    const remember = () => {
      listScroll.current = {
        window: window.scrollY,
        panel: document.querySelector(".shopping-panel")?.scrollTop ?? 0,
      };
    };
    if (restoreList.current) {
      restoreList.current = false;
      const saved = { ...listScroll.current };
      requestAnimationFrame(() => {
        window.scrollTo(0, saved.window);
        const panel = document.querySelector(".shopping-panel");
        if (panel) panel.scrollTop = saved.panel;
      });
    }
    window.addEventListener("scroll", remember, true);
    return () => window.removeEventListener("scroll", remember, true);
  }, [page]);
  useEffect(
    () =>
      subscribeAppearance((value) => {
        setSnapshot((current) => ({
          ...current,
          state: { ...current.state, appearance: value.preference },
        }));
      }),
    [],
  );
  const [storeChain, setStoreChain] = useState<Chain | null>(null);
  // A store page stays loaded after leaving the Kauppa view; the navigation says so.
  const [storeOpen, setStoreOpen] = useState(false);
  // During setup there is no navigation, so the store tab is shown over the setup screen.
  const [setupStore, setSetupStore] = useState(false);
  useEffect(() => {
    if (page === "store") setStoreOpen(true);
  }, [page]);
  const checkedLogins = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const operationStatus = useOperationProgress();
  const activeProgress =
    operationStatus.operation && !terminalOperation(operationStatus.operation)
      ? operationStatus.operation
      : null;
  const [busyMethod, setBusyMethod] = useState<string | null>(null);
  const [composerProgress, setComposerProgress] =
    useState<ComposerProgress | null>(null);
  const [error, setError] = useState("");
  const [errorSettings, setErrorSettings] = useState<SettingsSection | null>(
    null,
  );
  const [appVersion, setAppVersion] = useState("");
  const [developmentLocked, setDevelopmentLocked] = useState(false);
  const [settingsSection, setSettingsSection] =
    useState<SettingsSection>("general");
  const [settingsEntry, setSettingsEntry] = useState(0);
  function openSettings(section: SettingsSection = "general") {
    setSettingsEntry((current) => current + 1);
    setSettingsSection(section);
    setPage("settings");
  }
  const [aiRequestLimit, setAIRequestLimit] = useState(false);
  const [editing, setEditing] = useState<Recipe | null>(null);
  // Recipe import: the pasted text, whether its panel is open and whether the draft is unreviewed.
  const [importing, setImporting] = useState(false);
  const [importText, setImportText] = useState("");
  const [importPending, setImportPending] = useState(false);
  const [importedDraft, setImportedDraft] = useState(false);
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
  async function call(
    method: string,
    input?: unknown,
    options?: {
      preserveError?: boolean;
      /** An expected outcome for this call: return false without an alert or error log. */
      quietError?: (code: string) => boolean;
      onSuccess?: (value: Snapshot) => void;
    },
  ) {
    if (method === "setAppearance") {
      try {
        const result = await window.korikone.setAppearance(input);
        if (!result.ok) throw new Error(result.error);
        setSnapshot((current) => ({
          ...current,
          state: {
            ...current.state,
            appearance: result.value.state.appearance,
          },
        }));
        return true;
      } catch (error) {
        setError(error instanceof Error ? error.message : "operationFailed");
        return false;
      }
    }
    setBusy(true);
    setBusyMethod(method);
    if (!options?.preserveError) {
      setError("");
      setErrorSettings(null);
    }
    try {
      const result = await window.korikone[method](input);
      if (method === "suggestOffers" && result.value)
        setSnapshot((current) => ({
          ...current,
          offerIdeas: result.value.offerIdeas,
        }));
      if (
        [
          "generate",
          "planShopping",
          "editList",
          "importRecipe",
          "suggestOffers",
          "suggestStarterIdeas",
        ].includes(method)
      )
        setAIRequestLimit(!result.ok && result.error === "usageLimit");
      if (method === "signOutAI") setAIRequestLimit(false);
      if (!result.ok && result.error === "aiCancelled") return false;
      if (!result.ok) throw new Error(result.error);
      options?.onSuccess?.(result.value);
      if (method === "setDevelopmentMode")
        sessionStorage.removeItem("shopping-note");
      // A store whose sign-in happens in its own tab: show that tab.
      const openStore = (result.value as { openStore?: Chain }).openStore;
      if (openStore) {
        setStoreChain(openStore);
        setStoreOpen(true);
        if (snapshot.state.setupComplete) setPage("store");
        else setSetupStore(true);
      }
      setSnapshot((current) => {
        // Language changes run beside queued operations. Their older snapshots
        // must not undo the latest selection in the renderer.
        if (method === "setDevelopmentMode" || (method === "load" && !loaded))
          return result.value;
        return {
          ...result.value,
          state: {
            ...result.value.state,
            language: current.state.language,
            appearance: ["setAppearance", "importData"].includes(method)
              ? result.value.state.appearance
              : current.state.appearance,
          },
        };
      });
      return true;
    } catch (e) {
      let code = e instanceof Error ? e.message : "operationFailed";
      // The pack-size message for an edit differs from the one shown on a product row.
      if (method === "editList" && code === "packSizeUnknown")
        code = "editPackSizeUnknown";
      if (options?.quietError?.(code)) return false;
      setError((current) =>
        options?.preserveError && current ? current : code,
      );
      // A refused draft, a stale plan or a missing target is not a sign-in problem.
      const notAuthentication = [
        "invalidDraft",
        "draftStale",
        "contextTooLarge",
        "incompleteDraft",
      ].includes(code);
      const retailerFailure = [
        "storeUnavailable",
        "storeBlocked",
        "loginRequired",
        "chooseStore",
        "storeBusy",
        "workerMissing",
        "workerIncompatible",
      ].includes(code);
      const target: SettingsSection | null = retailerFailure
        ? "stores"
        : notAuthentication || code === "offerSelectionExpired"
          ? null
          : /AI$/.test(method) ||
              [
                "generate",
                "planShopping",
                "editList",
                "importRecipe",
                "suggestOffers",
                "suggestStarterIdeas",
                "openAIUsage",
              ].includes(method)
            ? "ai"
            : [
                  "buildBasket",
                  "transferDisplayed",
                  "prepare",
                  "execute",
                  "recover",
                  "forgetTransfer",
                  "openStoreCart",
                  "searchStores",
                  "selectStore",
                  "signInStore",
                  "signOutStore",
                ].includes(method)
              ? "stores"
              : [
                    "exportDiagnostics",
                    "setDevelopmentMode",
                    "developmentScenario",
                    "restartSetup",
                  ].includes(method)
                ? "advanced"
                : [
                      "importReceipt",
                      "importPurchaseReceipt",
                      "importLegacyReceipts",
                      "correctPurchase",
                      "interpretPurchase",
                      "deletePurchase",
                      "enrichPurchase",
                      "setReceiptConsent",
                      "importData",
                      "exportData",
                    ].includes(method)
                  ? "data"
                  : page === "settings"
                    ? settingsSection
                    : null;
      setErrorSettings((current) =>
        options?.preserveError && current ? current : target,
      );
      // The code and the view go to the local error log for the diagnostic export.
      if (method !== "recordError")
        void window.korikone.recordError({ code, view: page }).catch(() => {});
      return false;
    } finally {
      setBusy(false);
      setBusyMethod(null);
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
  // A newer release found after the saved list was already on screen.
  useEffect(
    () =>
      window.korikone.onUpdateChange((update) =>
        setSnapshot((current) => ({ ...current, update })),
      ),
    [],
  );
  useEffect(() => {
    void call("load").then(() => setLoaded(true));
    void window.korikone.getAppInfo().then((result) => {
      if (result.ok) {
        setAppVersion(result.value.version);
        setDevelopmentLocked(result.value.developmentLocked);
      }
    });
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
  // The store tab stays loaded after leaving it, and a sign-in may be waiting there.
  const storeCue = storeOpen || waiting;
  const settingsProps: SettingsSectionProps = {
    snapshot,
    busy,
    call,
    save,
    t,
    storeOpen: storeCue && page !== "store",
    returnToStore: () => setPage("store"),
    changeLanguage,
    editStaples: () => setPage("staples"),
    appVersion,
    aiRequestLimit,
    developmentLocked,
  };
  // Receipts from the picker or a drop. They never go through the busy state, so the shopping
  // composer, drafts and navigation stay usable while files are read.
  // The store site is a native view over the window: a floating progress box would sit under it,
  // so on the Kauppa view progress takes its place in the page above the store frame (B5.11).
  const storeVisible =
    page === "store" || (state.onboarded && !state.setupComplete && setupStore);
  const receiptIntake = useReceiptIntake({
    snapshot,
    suppressed: page === "store",
    apply: (value) =>
      setSnapshot((current) => ({
        ...value,
        state: {
          ...value.state,
          language: current.state.language,
          appearance: current.state.appearance,
        },
      })),
  });
  // Reading the saved list from this computer: no request, search or transfer is running.
  if (!loaded)
    return (
      <main>
        <p role="status" data-startup="opening">
          {t("opening")}
        </p>
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
        <div className="language-control">
          <Choice
            label={t("language")}
            value={state.language}
            options={[
              { value: "fi", label: "Suomi" },
              { value: "en", label: "English" },
            ]}
            onChange={(value) => changeLanguage(value as "fi" | "en")}
          />
        </div>
      </header>
      {snapshot.developmentMode && (
        <div className="demo" data-testid="development-banner">
          {state.onboarded && state.setupComplete ? (
            <button className="text" onClick={() => openSettings("advanced")}>
              {t("developmentMode")}
            </button>
          ) : (
            t("developmentMode")
          )}
        </div>
      )}
      <div className="demo">
        {isLive(state.context.providerId) && !snapshot.developmentMode
          ? `${state.context.storeName} · ${t("liveStore")}`
          : t("demo")}
      </div>
      {snapshot.update && (
        <div className="update-banner" role="status">
          {t("updateAvailable")}: {snapshot.update.version}{" "}
          <button className="text" onClick={() => void call("openRelease")}>
            {state.language === "fi"
              ? "Avaa julkaisusivu"
              : "Open release page"}
          </button>
        </div>
      )}
      {error && (
        <div role="alert" className="error">
          {t(error in en ? (error as Key) : "operationFailed")}
          {errorSettings && state.onboarded && state.setupComplete && (
            <button
              className="text"
              onClick={() => openSettings(errorSettings)}
            >
              {state.language === "fi" ? "Avaa" : "Open"}{" "}
              {t(sectionLabels[errorSettings])}
            </button>
          )}
        </div>
      )}
      {composerProgress &&
      (composerProgress.active || (!busy && composerProgress.finished))
        ? !composerProgress.visible && (
            <div
              className={`progress operation-fallback ${storeVisible ? "in-flow" : ""} ${composerProgress.active ? "" : "operation-finished"}`}
              data-planning-activity={
                composerProgress.active &&
                !composerProgress.cancelling &&
                planningActivityPending(composerProgress.phase)
                  ? "pending"
                  : composerProgress.active
                    ? "settling"
                    : "idle"
              }
            >
              <span
                role="status"
                aria-atomic="true"
                data-operation-status="global"
                data-planning-phase={composerProgress.phase}
              >
                {activeProgress ? (
                  <OperationProgressBody
                    progress={activeProgress}
                    language={state.language}
                    since={activeProgress.startedAt}
                  />
                ) : (
                  composerProgress.label
                )}
              </span>
              {composerProgress.active && (
                <small aria-hidden="true">
                  <ElapsedSeconds since={composerProgress.startedAt} />
                </small>
              )}
              {composerProgress.cancellable && (
                <button
                  className="secondary"
                  disabled={composerProgress.cancelling}
                  onClick={composerProgress.cancel}
                >
                  {t("cancel")}
                </button>
              )}
            </div>
          )
        : operationStatus.visible &&
          activeProgress && (
            <div
              className={`progress operation-fallback ${storeVisible ? "in-flow" : ""}`}
              data-operation-id={activeProgress.id}
            >
              <span
                role="status"
                aria-atomic="true"
                data-operation-status="global"
              >
                <OperationProgressBody
                  progress={activeProgress}
                  language={state.language}
                  since={activeProgress.startedAt}
                  showElapsed
                />
              </span>
              {activeProgress.cancellable && (
                <button
                  className="text"
                  onClick={() =>
                    void window.korikone.cancelOperation({
                      operationId: activeProgress.id,
                    })
                  }
                >
                  {t("cancel")}
                </button>
              )}
            </div>
          )}
      {state.onboarded && !state.setupComplete && setupStore ? (
        <main className="setup">
          <div className="actions">
            <button
              onClick={async () => {
                setSetupStore(false);
                // The shopper may have signed in: ask the chain again.
                const result = await window.korikone
                  .checkStoreLogin(storeChain ?? undefined)
                  .catch(() => null);
                if (result?.ok)
                  setSnapshot((current) => ({
                    ...current,
                    storeLogin: result.value.storeLogin,
                    storeLogins: result.value.storeLogins,
                  }));
              }}
            >
              {t("setupBackToSetup")}
            </button>
          </div>
          <StorePage
            snapshot={snapshot}
            chain={storeChain}
            setChain={setStoreChain}
            settings={() => setSetupStore(false)}
          />
        </main>
      ) : state.onboarded && !state.setupComplete ? (
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
                className={
                  key === "store" && storeCue && page !== "store"
                    ? "store-open"
                    : undefined
                }
                onClick={() => setPage(key)}
              >
                {t(key)}
                {key === "store" && storeCue && page !== "store" && (
                  <small>
                    {(waitingChain ??
                      storeChain ??
                      state.context.providerId) === "k-ruoka"
                      ? "K-Ruoka"
                      : "S-kaupat"}{" "}
                    · {state.language === "fi" ? "palaa" : "return"}
                  </small>
                )}
              </button>
            ))}
          </nav>
          <main className="app-main">
            <ShoppingContext
              settings={() => openSettings("stores")}
              snapshot={snapshot}
              busy={busy}
              setBusy={setBusy}
              apply={(next) =>
                setSnapshot((current) => ({
                  ...next,
                  state: {
                    ...next.state,
                    language: current.state.language,
                    appearance: current.state.appearance,
                  },
                }))
              }
            />
            {page === "history" && (
              <div className="receipt-import-bar">
                <button
                  className="secondary"
                  type="button"
                  disabled={receiptIntake.running}
                  onClick={() => void receiptIntake.pick()}
                >
                  {state.language === "fi" ? "Tuo kuitteja" : "Import receipts"}
                </button>
                <small className="muted">
                  {state.language === "fi"
                    ? "Valitse yksi tai useampi PDF-, TXT- tai CSV-tiedosto tai pudota ne ikkunaan."
                    : "Choose one or more PDF, TXT or CSV files, or drop them on the window."}
                </small>
              </div>
            )}
            <div
              hidden={
                page !== "week" && page !== "weekPlan" && page !== "history"
              }
            >
              <ShoppingWorkspace
                key={String(snapshot.developmentMode)}
                visible={
                  page === "week" || page === "weekPlan" || page === "history"
                }
                onProgress={setComposerProgress}
                operationProgress={activeProgress}
                snapshot={snapshot}
                busy={busy || !!activeProgress}
                call={call}
                save={save}
                settings={openSettings}
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
            </div>
            {page === "store" && (
              <StorePage
                snapshot={snapshot}
                chain={storeChain}
                setChain={setStoreChain}
                settings={() => openSettings("stores")}
                returnToList={() => {
                  restoreList.current = true;
                  setPage("week");
                }}
              />
            )}
            {page === "recipes" && (
              <>
                <div className="section-heading">
                  <h1>{t("recipes")}</h1>
                  <div className="actions">
                    <button
                      className="secondary"
                      disabled={importPending || !!editing}
                      aria-expanded={importing}
                      onClick={() => setImporting(!importing)}
                    >
                      {state.language === "fi"
                        ? "Tuo resepti tekstistä"
                        : "Import recipe from text"}
                    </button>
                    <button
                      onClick={() => {
                        setImportedDraft(false);
                        setEditing({
                          id: crypto.randomUUID(),
                          name: "",
                          servings: 4,
                          ingredients: [],
                          instructions: "",
                        });
                      }}
                    >
                      {t("newRecipe")}
                    </button>
                  </div>
                </div>
                {importing && !editing && (
                  <RecipeImport
                    language={state.language}
                    development={snapshot.developmentMode}
                    connected={snapshot.ai.state === "connected"}
                    text={importText}
                    pending={importPending}
                    onText={setImportText}
                    onCancel={() => {
                      if (importPending) {
                        window.dispatchEvent(new Event("korikone:cancel-ai"));
                        void window.korikone.cancelAI();
                      }
                      setImporting(false);
                    }}
                    onSubmit={async () => {
                      if (importPending || !importText.trim()) return;
                      setImportPending(true);
                      let draft: Recipe | null = null;
                      const ok = await call(
                        "importRecipe",
                        { text: importText.trim(), consent: true },
                        {
                          onSuccess: (value) => {
                            draft = value.recipeDraft;
                          },
                        },
                      );
                      setImportPending(false);
                      if (ok && draft) {
                        setImporting(false);
                        setImportText("");
                        setImportedDraft(true);
                        setEditing(draft);
                      }
                    }}
                  />
                )}
                {editing && importedDraft && (
                  <p className="input-notice" role="status">
                    {state.language === "fi"
                      ? "Tarkista tuotu resepti. Mitään ei tallenneta, ennen kuin painat Tallenna."
                      : "Review the imported recipe. Nothing is saved until you press Save."}
                  </p>
                )}
                {editing ? (
                  <RecipeForm
                    key={editing.id}
                    recipe={editing}
                    t={t}
                    language={state.language}
                    onCancel={() => {
                      setImportedDraft(false);
                      setEditing(null);
                    }}
                    onSave={async (recipe) => {
                      if (
                        await save({
                          ...state,
                          recipes: [
                            ...state.recipes.filter((r) => r.id !== recipe.id),
                            recipe,
                          ],
                        })
                      ) {
                        setImportedDraft(false);
                        setEditing(null);
                      }
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
                <button
                  className="text"
                  onClick={() => openSettings("household")}
                >
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
            <Settings
              entry={settingsEntry}
              visible={page === "settings"}
              activeSection={settingsSection}
              onSectionChange={setSettingsSection}
              t={t}
              sections={{
                general: <GeneralSettings {...settingsProps} />,
                household: <HouseholdSettings {...settingsProps} />,
                about: <AboutSettings {...settingsProps} />,
                advanced: <AdvancedSettings {...settingsProps} />,
                ai: <AISettings {...settingsProps} />,
                stores: <StoresSettings {...settingsProps} />,
                data: <DataSettings {...settingsProps} />,
              }}
            />
          </main>
        </>
      )}
      <ReceiptIntakeSurface
        intake={receiptIntake}
        language={state.language}
        openHistory={() => setPage("history")}
      />
    </>
  );
}
function RecipeImport({
  language,
  development,
  connected,
  text,
  pending,
  onText,
  onCancel,
  onSubmit,
}: {
  language: string;
  development: boolean;
  connected: boolean;
  text: string;
  pending: boolean;
  onText: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const fi = language === "fi";
  const tr = (a: string, b: string) => (fi ? a : b);
  return (
    <form
      className="card form recipe-import"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <label>
        {tr("Liitä resepti tekstinä", "Paste the recipe as text")}
        <textarea
          value={text}
          maxLength={10000}
          rows={8}
          autoFocus
          onChange={(e) => onText(e.target.value)}
        />
      </label>
      <p className="input-notice">
        {development
          ? tr(
              "Kehitystila käyttää paikallista testiaineistoa. Tekstiä ei lähetetä ChatGPT:lle.",
              "Development mode uses local fixtures. The text is not sent to ChatGPT.",
            )
          : connected
            ? tr(
                "Tuo resepti lähettää liitetyn tekstin ChatGPT:lle. Kirjoittaminen ei lähetä mitään. Resepti avautuu tarkistettavaksi, eikä sitä tallenneta automaattisesti.",
                "Import sends the pasted text to ChatGPT. Typing sends nothing. The recipe opens for review and is not saved automatically.",
              )
            : tr(
                "Yhdistä ChatGPT Asetuksissa, jotta voit tuoda reseptin tekstistä. Voit lisätä reseptin myös käsin.",
                "Connect ChatGPT in Settings to import a recipe from text. You can also add it by hand.",
              )}
      </p>
      <div className="actions">
        <button disabled={pending || !text.trim() || !connected}>
          {pending
            ? tr("Tuodaan reseptiä…", "Importing the recipe…")
            : tr("Tuo resepti", "Import recipe")}
        </button>
        <button type="button" className="secondary" onClick={onCancel}>
          {pending
            ? tr("Peruuta tuonti", "Cancel import")
            : tr("Sulje", "Close")}
        </button>
      </div>
    </form>
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
