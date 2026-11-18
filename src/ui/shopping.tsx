import {
  ElapsedSeconds,
  OperationProgressBody,
  operationStageLabel,
} from "./operation-progress";
import type { OperationProgress } from "../application/operation-progress";
import { starterThemes, type StarterTheme } from "../domain/starter-ideas";
import { priceAlternatives, purchasable } from "../domain/matching";
import { packageAmount } from "../domain/package-content";
import { comparePriceAlternative } from "../domain/price-ranking";
import { currentOffer } from "../domain/prices";
import { matchingReasonLabel } from "./matching-reasons";
import { GroupedReview } from "./grouped-review";
import { RowCorrection } from "./row-correction";
import type { PlanningSnapshot } from "../application/planning";
import { planningActivityPending, planningPhaseLabel } from "./planning-status";
import { PlanningPreview, PlanningPreviewFocus } from "./planning-preview";
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Snapshot } from "../application/service";
import type { AppState, Product, Requirement } from "../domain/model";
import { ModelSelector } from "./model";
import {
  exclusionTerms,
  requirements,
  priceBreakdown,
  transferableLine,
  approximateCost,
  pieceQuote,
  shoppingList,
} from "../domain/planner";
import { QuickAdd } from "./quick-add";
import {
  editTargets,
  mealTargetId,
  requirementKey,
  rowTargetId,
} from "../domain/edits";
import { RowFind, type FindResult } from "./row-find";
import { MerchandiseRow } from "./merchandise";
import { count, packCount, unitLabel } from "./i18n";
import { ConfirmPanel } from "./confirm";
import { CheckoutButton, type CheckoutOrder } from "./checkout";
import {
  compareSentQuantities,
  editTransferHint,
  requestWithoutRow,
} from "./transfer-summary";
import { earlierListTransfer } from "../domain/changes";
import { RowDetails } from "./details";
import { isLive } from "../stores/provider";
import {
  ComparePanel,
  CompareSummary,
  canCompare,
  compareBlocker,
  feeRange,
} from "./compare";
import { MealCalendarView } from "./calendar";
import { QrExport } from "./qr";
import { OfferIdeas } from "./offer-ideas";
import { HouseholdSizeControl } from "./household-size";
import { useInsights } from "./insights";
import { RecurringSuggestions } from "./suggestions";
import { SpendingChart } from "./spending-chart";
import { LinkReview, transferSignal } from "./purchase-links";
import { RepeatButton, RepeatSummary } from "./repeat";
import type { SettingsSection } from "./settings-contract";

const editUnit = (unit: string | undefined, fi: boolean) =>
  unit === "pcs" ? (fi ? "kpl" : "pcs") : (unit ?? "");

/** Names and amounts come from the committed operations. */
function editChanges(
  applied: NonNullable<Snapshot["edit"]> extends infer E
    ? E extends { applied: infer A }
      ? A
      : never
    : never,
  fi: boolean,
) {
  return applied.map((a) => {
    const unit = editUnit(a.unit, fi);
    switch (a.op) {
      case "addItem":
        if (a.before) return `${a.name}: ${a.before} → ${a.after} ${unit}`;
        return fi
          ? `Lisätty ${a.name}${a.after ? ` (${a.after} ${unit})` : ""}`
          : `Added ${a.name}${a.after ? ` (${a.after} ${unit})` : ""}`;
      case "addMeal":
        return a.before
          ? fi
            ? `${a.name}: ${a.before} → ${a.after} annosta`
            : `${a.name}: ${a.before} → ${a.after} servings`
          : fi
            ? `Lisätty ${a.name}`
            : `Added ${a.name}`;
      case "setItem":
        return a.before
          ? `${a.name}: ${a.before} → ${a.after} ${unit}`
          : fi
            ? `Lisätty ${a.name} (${a.after} ${unit})`
            : `Added ${a.name} (${a.after} ${unit})`;
      case "specifyItem":
      case "setAttribute":
        return `${a.name} → ${a.to}`;
      case "removeItem":
      case "removeMeal":
        return fi ? `Poistettu ${a.name}` : `Removed ${a.name}`;
      case "replaceMeal":
        return fi
          ? `Vaihdettu ${a.name} → ${a.to}`
          : `Replaced ${a.name} with ${a.to}`;
      case "changeServings":
        return fi
          ? `${a.name}: ${a.before} → ${a.after} annosta`
          : `${a.name}: ${a.before} → ${a.after} servings`;
      case "changeQuantity":
        return `${a.name}: ${a.before} → ${a.after} ${unit}`;
      case "markAtHome":
        return a.after
          ? fi
            ? `${a.name} ostetaan`
            : `${a.name} will be bought`
          : fi
            ? `${a.name} on kotona`
            : `${a.name} is at home`;
    }
  });
}

type Delta =
  NonNullable<Snapshot["edit"]> extends infer E
    ? E extends { delta: infer D }
      ? D
      : never
    : never;

/** Concrete changes of one edit from `EditDelta`; prices only where both sides are comparable. */
function EditDetails({ delta, fi }: { delta: Delta; fi: boolean }) {
  const tr = (a: string, b: string) => (fi ? a : b);
  const money = (cents: number) =>
    new Intl.NumberFormat(fi ? "fi-FI" : "en-FI", {
      style: "currency",
      currency: "EUR",
      signDisplay: "exceptZero",
    }).format(cents / 100);
  const priced = (price: Delta["rows"][number]["priceAfter"]) =>
    (price.kind === "known" || price.kind === "estimated") &&
    price.total !== null
      ? ` · ${price.kind === "estimated" ? tr("noin ", "about ") : ""}${new Intl.NumberFormat(
          fi ? "fi-FI" : "en-FI",
          { style: "currency", currency: "EUR" },
        ).format(price.total / 100)}`
      : price.kind === "unknown"
        ? ` · ${tr("hinta puuttuu", "price unknown")}`
        : price.kind === "stale"
          ? ` · ${tr("hinta ei ole ajan tasalla", "price not current")}`
          : "";
  const row = (r: Delta["rows"][number]) => {
    const unit = r.unit === "pcs" ? tr("kpl", "pcs") : r.unit;
    switch (r.change) {
      case "added":
        return `${tr("Lisätty", "Added")} ${r.name}: ${r.after} ${unit}${priced(r.priceAfter)}`;
      case "removed":
        return `${tr("Poistettu", "Removed")} ${r.name} (${r.before} ${unit})`;
      case "quantity":
        return `${r.name}: ${r.before} → ${r.after} ${unit}${priced(r.priceAfter)}`;
      case "atHome":
        return `${r.name} ${tr("on kotona", "is at home")} (${r.before} ${unit})`;
      case "notAtHome":
        return `${r.name} ${tr("ostetaan", "will be bought")}: ${r.after} ${unit}${priced(r.priceAfter)}`;
    }
  };
  const price = delta.price;
  const none = !delta.rows.length && !delta.meals.length;
  return (
    <details className="edit-details">
      <summary>{tr("Muutoksen tiedot", "Change details")}</summary>
      {none ? (
        <p>
          {tr(
            "Ostoslistan rivit eivät muuttuneet.",
            "No shopping list rows changed.",
          )}
        </p>
      ) : (
        <ul>
          {delta.meals.map((m) => (
            <li key={m.mealId}>
              {m.change === "removed"
                ? `${tr("Poistettu", "Removed")} ${m.name}`
                : m.change === "added"
                  ? `${tr("Lisätty", "Added")} ${m.name} (${m.servingsAfter} ${tr("annosta", "servings")})`
                  : m.change === "replaced"
                    ? `${tr("Vaihdettu", "Replaced")} ${m.name} → ${m.to}`
                    : `${m.name}: ${m.servingsBefore} → ${m.servingsAfter} ${tr("annosta", "servings")}`}
            </li>
          ))}
          {delta.rows.map((r) => (
            <li key={r.key}>{row(r)}</li>
          ))}
        </ul>
      )}
      {!!delta.retained.length && (
        <p className="muted">
          {tr("Ennallaan", "Unchanged")}:{" "}
          {delta.retained.map((r) => r.name).join(", ")}
        </p>
      )}
      {!none && (
        <p className="edit-price" data-status={price.status}>
          {price.difference !== null
            ? `${tr("Muuttuneiden rivien hintaero", "Price difference of the changed rows")}${
                price.status === "estimated"
                  ? tr(" (arvio)", " (estimate)")
                  : ""
              }: ${money(price.difference)}`
            : price.status === "incomparable"
              ? tr(
                  "Hintoja ei voi verrata, koska kauppa tai toimitustapa on eri.",
                  "Prices cannot be compared because the store or fulfilment differs.",
                )
              : fi
                ? `Hintaeroa ei voi laskea: ${price.unknownRows} rivin hinta ei ole vertailukelpoinen.`
                : `Price difference unavailable. ${price.unknownRows} ${price.unknownRows === 1 ? "row lacks" : "rows lack"} a comparable price.`}
        </p>
      )}
    </details>
  );
}

/**
 * The outcome of the last edit for the current revision: a one-line summary with Undo, or a
 * clarification whose choices resubmit the instruction with an explicit target.
 */
function EditOutcome({
  snapshot,
  language,
  busy,
  call,
  resubmit,
  children,
}: {
  snapshot: Snapshot;
  language: string;
  busy: boolean;
  call: (method: string, input?: unknown) => Promise<boolean>;
  resubmit: (targetId: string) => void;
  children?: React.ReactNode;
}) {
  const fi = language === "fi";
  const tr = (a: string, b: string) => (fi ? a : b);
  const edit = snapshot.edit;
  const summary = useRef<HTMLParagraphElement>(null);
  if (!edit && !snapshot.editUndoAvailable) return null;
  const undo = snapshot.editUndoAvailable && (
    <div className="edit-undo">
      <button
        className="secondary"
        type="button"
        disabled={busy}
        aria-describedby="edit-undo-help"
        onClick={async () => {
          if (await call("undoEdit", { revision: snapshot.state.revision }))
            requestAnimationFrame(() => summary.current?.focus());
        }}
      >
        {tr("Kumoa", "Undo")}
      </button>
      <small id="edit-undo-help">
        {tr(
          "Palauttaa ostoslistan viimeisintä muutosta edeltävään tilaan.",
          "Restores the shopping list to before the last edit.",
        )}
      </small>
    </div>
  );
  if (!edit) return <section className="edit-outcome">{undo}</section>;
  if (edit.status === "clarification")
    return (
      <section className="edit-outcome" role="status" aria-live="polite">
        {edit.ambiguities.map((ambiguity) => (
          <div key={ambiguity.phrase}>
            <p>
              {tr("Mitä tarkoitat: ", "Which one do you mean: ")}
              <strong>{ambiguity.phrase}</strong>
            </p>
            <div className="edit-choices">
              {ambiguity.candidates.map((candidate) => (
                <button
                  key={candidate.targetId}
                  className="secondary"
                  type="button"
                  disabled={busy}
                  onClick={() => resubmit(candidate.targetId)}
                >
                  {candidate.name} ·{" "}
                  {candidate.targetId.startsWith("meal:")
                    ? fi
                      ? `${candidate.detail} annosta`
                      : `${candidate.detail} servings`
                    : candidate.detail.replace(/ pcs$/, fi ? " kpl" : " pcs")}
                </button>
              ))}
            </div>
          </div>
        ))}
        {edit.unsupported.length > 0 && (
          <p className="muted">
            {tr(
              "Tätä ei voi muokata ohjeella: ",
              "Cannot be edited by instruction: ",
            )}
            {edit.unsupported.join(", ")}
          </p>
        )}
        <p className="muted">
          {tr("Lista ei muuttunut.", "The list did not change.")}
        </p>
        {undo}
      </section>
    );
  const changes = editChanges(edit.applied, fi);
  return (
    <section className="edit-outcome" role="status" aria-live="polite">
      <p id="shopping-edit-result" ref={summary} tabIndex={-1}>
        <strong>
          {edit.status === "undone"
            ? tr("Muutos kumottu: ", "Change undone: ")
            : edit.status === "cleared"
              ? tr("Lista tyhjennetty: ", "List cleared: ")
              : edit.status === "resized"
                ? tr("Talouden koko muutettu: ", "Household size changed: ")
                : tr("Lista päivitetty: ", "List updated: ")}
        </strong>
        {edit.status === "undone"
          ? tr(
              "Edellinen ostoslista on palautettu.",
              "Your previous shopping list is restored.",
            )
          : edit.status === "cleared" && !edit.applied.length
            ? tr("kaikki rivit poistettu", "all rows removed")
            : changes.length > 1
              ? count(
                  changes.length,
                  fi,
                  ["muutos", "muutosta"],
                  ["change", "changes"],
                )
              : changes[0]}
      </p>
      {changes.length > 1 && (
        <ul className="edit-changes">
          {changes.map((change, index) => (
            <li key={index}>{change}</li>
          ))}
        </ul>
      )}
      {edit.status === "applied" && !!edit.unsupported?.length && (
        <p className="muted">
          {tr(
            "Tätä osaa ei tehty, kirjoita se tarvittaessa toisin: ",
            "This part was not done; rephrase it if needed: ",
          )}
          {edit.unsupported.join(", ")}
        </p>
      )}
      {undo}
      <EditDetails key={edit.revision} delta={edit.delta} fi={fi} />
      {children}
    </section>
  );
}

/** One operation's feedback, shared by the composer and its off-screen fallback. */
export type ComposerProgress = {
  active: boolean;
  finished: boolean;
  visible: boolean;
  label: string;
  /** When the running operation started, or null; viewers tick the elapsed time themselves. */
  startedAt: number | null;
  phase: string;
  cancellable: boolean;
  cancelling: boolean;
  cancel: () => void;
};

function HistoryProducts({
  products,
  label,
}: {
  products: AppState["listHistory"][number]["transferred"];
  label: string;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <details onToggle={(event) => setExpanded(event.currentTarget.open)}>
      <summary>
        {label} · {products.length}
      </summary>
      {expanded && (
        <ul>
          {products.map((item) => (
            <li key={item.productId}>
              {item.name} × {item.quantity}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

export function ShoppingWorkspace({
  snapshot,
  busy,
  call,
  save,
  settings,
  staples,
  openStore,
  view = "list",
  visible = true,
  onProgress,
  operationProgress,
  historyActions,
  historyRequest,
  order,
  openList,
  openOrderHistory,
}: {
  snapshot: Snapshot;
  busy: boolean;
  call: (
    method: string,
    input?: unknown,
    options?: {
      preserveError?: boolean;
      quietError?: (code: string) => boolean;
      onSuccess?: (value: Snapshot) => void;
    },
  ) => Promise<boolean>;
  save: (state: AppState) => Promise<boolean>;
  settings: (section?: SettingsSection) => void;
  staples: () => void;
  openStore: (chain: "k-ruoka" | "s-kaupat") => void;
  order?: CheckoutOrder;
  openList: () => void;
  openOrderHistory: (id: string) => void;
  view?: "list" | "schedule" | "history";
  visible?: boolean;
  onProgress?: (progress: ComposerProgress | null) => void;
  operationProgress?: OperationProgress | null;
  /** Shown under the History heading, such as the receipt import (B6.7). */
  historyActions?: React.ReactNode;
  historyRequest?: { id: string };
}) {
  const state = snapshot.state;
  const [historySearch, setHistorySearch] = useState("");
  const [historyLimit, setHistoryLimit] = useState(8);
  useLayoutEffect(() => {
    if (!historyRequest) return;
    setHistorySearch("");
    setHistoryLimit(
      Math.max(
        8,
        state.listHistory.findIndex((entry) => entry.id === historyRequest.id) +
          1,
      ),
    );
    // Only a direct jump resets the shopper's History controls.
  }, [historyRequest]);
  const all = requirements(state, new Date(), true);
  const fi = state.language === "fi";
  const tr = (a: string, b: string) => (fi ? a : b);
  const [note, setNote] = useState(
    () => sessionStorage.getItem("shopping-note") ?? state.note,
  );
  const offerContext = `${state.context.providerId}:${state.context.storeId}`;
  const [offerSelection, setOfferSelection] = useState<{
    context: string;
    ideas: { id: string; name: string }[];
  }>(() => {
    try {
      const saved = JSON.parse(
        sessionStorage.getItem("shopping-offer-selection") ?? "null",
      );
      if (
        saved &&
        typeof saved.context === "string" &&
        Array.isArray(saved.ideas) &&
        saved.ideas.length <= 4 &&
        saved.ideas.every(
          (idea: { id?: unknown; name?: unknown }) =>
            typeof idea.id === "string" && typeof idea.name === "string",
        )
      )
        return saved;
    } catch {
      /* Ignore malformed local draft metadata. */
    }
    return { context: offerContext, ideas: [] };
  });
  const offerIdeas =
    offerSelection.context === offerContext ? offerSelection.ideas : [];
  const setOfferIdeas = (
    update:
      | { id: string; name: string }[]
      | ((
          current: { id: string; name: string }[],
        ) => { id: string; name: string }[]),
  ) =>
    setOfferSelection((current) => ({
      context: offerContext,
      ideas:
        typeof update === "function"
          ? update(current.context === offerContext ? current.ideas : [])
          : update,
    }));
  useEffect(() => {
    sessionStorage.setItem(
      "shopping-offer-selection",
      JSON.stringify(offerSelection),
    );
  }, [offerSelection]);
  const [working, setWorking] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [updateFailed, setUpdateFailed] = useState(false);
  const [livePlanning, setLivePlanning] = useState<PlanningSnapshot | null>(
    null,
  );
  const noteElement = useRef<HTMLTextAreaElement>(null);
  const requestInFlight = useRef(false);
  const stopRequested = useRef(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const { insights, refresh: refreshInsights } = useInsights(
    snapshot,
    visible && view !== "schedule",
  );
  const [undo, setUndo] = useState<Record<string, string>>({});
  const [reviewRows, setReviewRows] = useState<Requirement[] | null>(null);
  const reviewOpener = useRef<HTMLButtonElement | null>(null);
  const transferButton = useRef<HTMLButtonElement>(null);
  const priceButton = useRef<HTMLButtonElement>(null);
  const listHeading = useRef<HTMLHeadingElement>(null);
  const closeReview = () => {
    setReviewRows(null);
    requestAnimationFrame(() =>
      (reviewOpener.current?.isConnected
        ? reviewOpener.current
        : listHeading.current
      )?.focus(),
    );
  };
  const currentNote = useRef(note);
  const planningOperation = useRef<string | null>(null);
  const cancelSent = useRef<string | null>(null);
  const [showSavedDuringPlanning, setShowSavedDuringPlanning] = useState(false);
  // The composer edits the saved list in place. "New list" is the explicit replacement
  // draft; the saved list stays until its commit succeeds.
  const hasList = all.length > 0 || state.meals.length > 0;
  const [newListDraft, setNewListDraft] = useState(
    () => sessionStorage.getItem("shopping-new-list") === "1",
  );
  const setNewList = (value: boolean) => {
    try {
      if (value) sessionStorage.setItem("shopping-new-list", "1");
      else sessionStorage.removeItem("shopping-new-list");
    } catch {
      // Session storage is a convenience; the draft still works without it.
    }
    setNewListDraft(value);
  };
  const composingEdit = hasList && !newListDraft;
  const [instruction, setInstructionValue] = useState(
    () => sessionStorage.getItem("shopping-edit-instruction") ?? "",
  );
  const currentInstruction = useRef(instruction);
  const setInstruction = (value: string) => {
    currentInstruction.current = value;
    try {
      sessionStorage.setItem("shopping-edit-instruction", value);
    } catch {
      // Same as above.
    }
    setInstructionValue(value);
  };
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const [editWorking, setEditWorking] = useState(false);
  const [editFailed, setEditFailed] = useState(false);
  const [editCancelled, setEditCancelled] = useState(false);
  const [confirmingNewList, setConfirmingNewList] = useState(false);
  const [transferFailed, setTransferFailed] = useState(false);
  // The refused-draft cause comes from the last planning event: a failed call returns no snapshot.
  const failureCause =
    livePlanning?.failureCause ?? snapshot.planning?.failureCause ?? null;
  // Seconds since the update started: honest activity when the provider returns only a whole reply.
  // Only the start is state here: a per-second tick would re-render the whole workspace and,
  // through onProgress, the app root (B5.10).
  const [startedAt, setStartedAt] = useState<number | null>(null);
  useEffect(() => {
    setStartedAt(working || editWorking ? Date.now() : null);
  }, [working, editWorking]);
  const editRunning = useRef(false);
  function targetName(id: string | null) {
    if (!id) return null;
    const { rows, meals } = editTargets(state);
    return (
      rows.find((row) => row.targetId === id)?.name ??
      meals.find((meal) => meal.targetId === id)?.name ??
      null
    );
  }
  const focusName = targetName(focusTarget);
  useEffect(() => {
    if (!hasList && newListDraft) setNewList(false);
  }, [hasList]);
  // A note typed before the list existed stays visible as the replacement draft.
  useEffect(() => {
    if (hasList && !newListDraft && note.trim() && note !== state.note)
      setNewList(true);
  }, [hasList]);
  useEffect(
    () =>
      window.korikone.onPlanningChange((value) => {
        if (running.current || planningOperation.current === value.operationId)
          setLivePlanning(value);
        if (
          !["committed", "failed", "cancelled", "obsolete"].includes(
            value.phase,
          )
        ) {
          planningOperation.current = value.operationId;
          if (
            running.current &&
            value.source.note !== currentNote.current.trim()
          ) {
            stopRequested.current = true;
            void window.korikone.invalidatePlanning({
              operationId: value.operationId,
              reason: "note-changed",
            });
          } else if (
            running.current &&
            stopRequested.current &&
            value.phase !== "committing" &&
            cancelSent.current !== value.operationId
          ) {
            cancelSent.current = value.operationId;
            void window.korikone.cancelPlanning({
              operationId: value.operationId,
            });
          }
        } else if (planningOperation.current === value.operationId)
          planningOperation.current = null;
      }),
    [],
  );
  const panel = useRef<HTMLElement>(null);
  const footer = useRef<HTMLDivElement>(null);
  const [comparing, setComparing] = useState(false);
  const sameVerifiedBatch =
    snapshot.journal?.status === "verified" &&
    !snapshot.journal.listClosed &&
    snapshot.journal.batchKey === snapshot.transferBatchKey;
  const [showConfirmation, setConfirming] = useState(
    sameVerifiedBatch || snapshot.journal?.status === "partial",
  );
  const confirming =
    showConfirmation &&
    (sameVerifiedBatch ||
      snapshot.journal?.status === "partial" ||
      !!snapshot.review ||
      snapshot.transferException === "priceChanged" ||
      snapshot.transferException === "unresolved" ||
      snapshot.transferException === "manualOnly");
  const [transferring, setTransferring] = useState(false);
  // The list row whose details are open.
  const [opened, setOpened] = useState<string | null>(null);
  // The list column is as tall as the window below its current top, so the total and
  // transfer bar at its bottom stays in view however far the page is scrolled.
  useEffect(() => {
    const fit = () => {
      const el = panel.current;
      if (!el) return;
      const before = el.dataset.flow;
      if (window.matchMedia("(max-width: 900px)").matches) {
        el.style.maxHeight = "";
        el.dataset.flow = "true";
      } else {
        const top = Math.max(el.getBoundingClientRect().top, 12);
        const available = window.innerHeight - top - 12;
        const normalFlow =
          (footer.current?.offsetHeight ?? 0) + 180 > available;
        el.dataset.flow = String(normalFlow);
        el.style.maxHeight = normalFlow ? "" : `${available}px`;
      }
      // Switching between the scrolling rows and page flow changes how tall the rows are, which
      // can leave a focused control in the list out of view; bring it back (B6.2).
      const focused = document.activeElement;
      if (
        before !== undefined &&
        before !== el.dataset.flow &&
        focused instanceof HTMLElement &&
        el.contains(focused)
      )
        focused.scrollIntoView({ block: "nearest" });
    };
    fit();
    window.addEventListener("scroll", fit, { passive: true });
    window.addEventListener("resize", fit);
    const observer = new ResizeObserver(fit);
    if (footer.current) observer.observe(footer.current);
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", fit);
      window.removeEventListener("resize", fit);
    };
  }, [view, all.length > 0, confirming]);
  const active = useRef(true);
  const running = useRef(false);
  const savedNote = useRef(state.note);
  useEffect(() => {
    active.current = true;
    const stop = () => {
      if (!running.current || !requestInFlight.current) return;
      stopRequested.current = true;
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
  }, [state.note]);
  const [starterWorking, setStarterWorking] = useState(false);
  const lastStarter = useRef<{ before: string; inserted: string } | null>(null);
  const chooseStarter = async (theme: StarterTheme) => {
    if (busy || starterWorking) return;
    const previous = noteElement.current?.value ?? "";
    const wasEdit = composingEdit;
    setStarterWorking(true);
    try {
      await call(
        "suggestStarterIdeas",
        { theme, consent: true },
        {
          onSuccess: (value) => {
            if (!active.current || noteElement.current?.value !== previous)
              return;
            const names = value.starterIdeas?.names.join(", ");
            if (!names) return;
            const suggested = names;
            const before =
              previous === lastStarter.current?.inserted
                ? lastStarter.current.before
                : previous.trim();
            const next = [before, suggested].filter(Boolean).join("\n");
            lastStarter.current = { before, inserted: next };
            if (wasEdit) {
              setFocusTarget(null);
              setInstruction(next);
            } else changeNote(next);
            requestAnimationFrame(() => noteElement.current?.focus());
          },
        },
      );
    } finally {
      setStarterWorking(false);
    }
  };
  const changeNote = (value: string) => {
    setOfferIdeas((current) =>
      current.filter((idea) => value.includes(idea.name)),
    );
    if (
      running.current &&
      planningOperation.current &&
      value !== currentNote.current
    ) {
      stopRequested.current = true;
      void window.korikone.invalidatePlanning({
        operationId: planningOperation.current,
        reason: "note-changed",
      });
    }
    setCancelled(false);
    setUpdateFailed(false);
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
    const requested = note.trim();
    running.current = true;
    stopRequested.current = false;
    setCancelled(false);
    setUpdateFailed(false);
    setLivePlanning(null);
    setShowSavedDuringPlanning(false);
    planningOperation.current = null;
    cancelSent.current = null;
    setWorking(true);
    setRequesting(true);
    requestInFlight.current = true;
    try {
      let operationId: string | null = null;
      const planned = await call(
        "planShopping",
        {
          prompt: requested,
          consent: true,
          offerIdeaIds: offerIdeas
            .filter((idea) => requested.includes(idea.name))
            .map((idea) => idea.id),
        },
        {
          // Editing the note stops the run on purpose: that is not an error to show.
          quietError: (code) => code === "draftStale" && stopRequested.current,
          onSuccess: (value) => {
            operationId = value.planning?.operationId ?? null;
          },
        },
      );
      setRequesting(false);
      requestInFlight.current = false;
      if (planned && operationId) {
        if (
          !stopRequested.current &&
          active.current &&
          currentNote.current.trim() === requested
        )
          if (await call("commitPlanning", { operationId })) {
            savedDraft.current = "";
            if (active.current) setNewList(false);
          } else if (active.current) setUpdateFailed(true);
      } else if (!stopRequested.current && active.current)
        setUpdateFailed(true);
    } finally {
      running.current = false;
      requestInFlight.current = false;
      if (active.current) {
        setWorking(false);
        setRequesting(false);
      }
    }
  }
  async function applyEdit(text: string, focus: string | null) {
    const requested = text.trim();
    if (
      editRunning.current ||
      running.current ||
      busy ||
      !requested ||
      snapshot.ai.state !== "connected"
    )
      return;
    const submittedFrom = document.activeElement;
    editRunning.current = true;
    setEditWorking(true);
    setEditFailed(false);
    setEditCancelled(false);
    try {
      let clarification = false;
      const ok = await call(
        "editList",
        {
          revision: state.revision,
          instruction: requested,
          ...(targetName(focus) !== null ? { focusTargetId: focus } : {}),
          consent: true,
        },
        {
          onSuccess: (value) => {
            clarification = value.edit?.status === "clarification";
          },
        },
      );
      if (!active.current) return;
      if (!ok) setEditFailed(true);
      // Text typed while the edit ran is a new instruction: keep it.
      else if (
        !clarification &&
        currentInstruction.current.trim() === requested
      ) {
        setInstruction("");
        setFocusTarget(null);
        requestAnimationFrame(() => {
          if (
            document.activeElement === submittedFrom ||
            document.activeElement === document.body
          )
            document.getElementById("shopping-edit-result")?.focus();
        });
      }
    } finally {
      editRunning.current = false;
      if (active.current) setEditWorking(false);
    }
  }
  /**
   * The explicit Find product action on an unresolved row: one edit request that carries the
   * row as context. Nothing runs while the shopper types and nothing is remembered.
   */
  async function findForRow(key: string, wording: string): Promise<FindResult> {
    if (editRunning.current || running.current || busy) return "failed";
    editRunning.current = true;
    setEditWorking(true);
    setEditFailed(false);
    setEditCancelled(false);
    const found = { outcome: "failed" as FindResult };
    try {
      const ok = await call(
        "editList",
        {
          revision: state.revision,
          instruction: wording.trim(),
          focusTargetId: rowTargetId(key),
          consent: true,
        },
        {
          onSuccess: (value) => {
            const line = value.basket.find(
              (l) => `${l.requirement.id}:${l.requirement.unit}` === key,
            );
            found.outcome =
              value.edit?.status === "clarification"
                ? "none"
                : line?.product
                  ? "resolved"
                  : line && line.candidates.length > 0
                    ? "options"
                    : "none";
          },
        },
      );
      if (!ok) found.outcome = "failed";
    } finally {
      editRunning.current = false;
      if (active.current) setEditWorking(false);
    }
    const outcome = found.outcome;
    if (active.current) {
      if (outcome === "options") setOpened(key);
      if (outcome === "resolved" || outcome === "options")
        requestAnimationFrame(() =>
          document
            .querySelector<HTMLElement>(
              `[data-row-key="${CSS.escape(key)}"] .row-name`,
            )
            ?.focus(),
        );
    }
    return outcome;
  }
  const progressAnchor = useRef<HTMLDivElement>(null);
  const [progressVisible, setProgressVisible] = useState(false);
  useEffect(() => {
    const element = progressAnchor.current;
    const check = () => {
      if (!element || !visible || view !== "list") {
        setProgressVisible(false);
        return;
      }
      const box = element.getBoundingClientRect();
      const header = document.querySelector("header")?.getBoundingClientRect();
      const headerBottom =
        header && box.left < header.right && box.right > header.left
          ? header.bottom
          : 0;
      // One pixel of slack: a fractional height scrolled to the window edge still counts as shown.
      setProgressVisible(
        box.height > 0 &&
          box.width > 0 &&
          box.top >= Math.max(0, headerBottom) - 1 &&
          box.bottom <= innerHeight + 1 &&
          box.left >= -1 &&
          box.right <= innerWidth + 1,
      );
    };
    const intersection = new IntersectionObserver(check, { threshold: [0, 1] });
    const resize = new ResizeObserver(check);
    if (element) {
      intersection.observe(element);
      resize.observe(element);
    }
    window.addEventListener("scroll", check, true);
    window.addEventListener("resize", check);
    check();
    return () => {
      intersection.disconnect();
      resize.disconnect();
      window.removeEventListener("scroll", check, true);
      window.removeEventListener("resize", check);
    };
  }, [view, visible]);
  const progressActive = working || editWorking;
  const progressCancelling =
    (working && cancelled) || (editWorking && editCancelled);
  const progressCancellable =
    (requesting && livePlanning?.phase !== "committing") || editWorking;
  const rawProgressFinished =
    cancelled ||
    updateFailed ||
    editFailed ||
    editCancelled ||
    !!(
      livePlanning &&
      ["committed", "failed", "cancelled", "obsolete"].includes(
        livePlanning.phase,
      )
    );
  const [completionVisible, setCompletionVisible] = useState(false);
  useEffect(() => {
    if (!rawProgressFinished || progressActive) {
      setCompletionVisible(false);
      return;
    }
    setCompletionVisible(true);
    const timer = setTimeout(() => setCompletionVisible(false), 4000);
    return () => clearTimeout(timer);
  }, [rawProgressFinished, progressActive]);
  const progressFinished = rawProgressFinished && completionVisible;
  const progressPhase = editWorking
    ? "editing"
    : (livePlanning?.phase ?? (working ? "starting" : "idle"));
  const progressLabel =
    (working || editWorking) && operationProgress
      ? operationStageLabel(operationProgress, state.language)
      : editWorking
        ? editCancelled
          ? tr("Peruutetaan muutosta…", "Cancelling the change…")
          : tr("Muokataan listaa…", "Editing the list…")
        : working
          ? cancelled
            ? tr("Peruutetaan listan päivitystä…", "Cancelling list update…")
            : livePlanning
              ? planningPhaseLabel(livePlanning.phase, state.language)
              : tr("Aloitetaan listan päivitystä…", "Starting list update…")
          : editCancelled
            ? tr(
                "Muutos peruutettu. Aiempi lista säilyy.",
                "Change cancelled. Your previous list is retained.",
              )
            : composingEdit && editFailed
              ? tr("Listaa ei muutettu", "The list was not changed")
              : cancelled
                ? tr(
                    "Listan päivitys peruutettu. Aiempi lista säilyy.",
                    "List update cancelled. Your previous list is retained.",
                  )
                : updateFailed
                  ? planningPhaseLabel("failed", state.language)
                  : livePlanning &&
                      ["committed", "obsolete"].includes(livePlanning.phase)
                    ? planningPhaseLabel(livePlanning.phase, state.language)
                    : snapshot.ai.state !== "connected"
                      ? tr(
                          "Listan päivitys vaatii ChatGPT-yhteyden.",
                          "Connect ChatGPT to update the list.",
                        )
                      : tr(
                          "Ctrl + Enter päivittää listan",
                          "Ctrl + Enter to update the list",
                        );
  const cancelProgressRef = useRef(() => {});
  cancelProgressRef.current = () => {
    if (!progressCancellable || progressCancelling) return;
    window.dispatchEvent(new Event("korikone:cancel-ai"));
    if (editWorking) {
      setEditCancelled(true);
      void window.korikone.cancelAI();
    } else {
      stopRequested.current = true;
      setCancelled(true);
      const operationId = planningOperation.current;
      if (operationId) {
        cancelSent.current = operationId;
        void window.korikone.cancelPlanning({ operationId });
      } else void window.korikone.cancelAI();
    }
    if (progressVisible) noteElement.current?.focus({ preventScroll: true });
  };
  const cancelProgress = useCallback(() => cancelProgressRef.current(), []);
  useEffect(() => {
    onProgress?.({
      active: progressActive,
      finished: progressFinished,
      visible: progressVisible,
      label: progressLabel,
      startedAt,
      phase: progressPhase,
      cancellable: progressCancellable,
      cancelling: progressCancelling,
      cancel: cancelProgress,
    });
  }, [
    onProgress,
    progressActive,
    progressFinished,
    progressVisible,
    progressLabel,
    startedAt,
    progressPhase,
    progressCancellable,
    progressCancelling,
    cancelProgress,
  ]);
  useEffect(() => () => onProgress?.(null), [onProgress]);
  // The unsent replacement draft survives a detour to the current list.
  const savedDraft = useRef("");
  const newListButton = useRef<HTMLButtonElement>(null);
  // Clear list opens the same New list confirmation (B6.11); focus goes back where it came from.
  const clearListButton = useRef<HTMLButtonElement>(null);
  const listMenu = useRef<HTMLDetailsElement>(null);
  const confirmOpener = useRef<HTMLElement | null>(null);
  const newListFromHistory = useRef<string | null>(null);
  const openNewList = (opener: HTMLElement | null) => {
    confirmOpener.current = opener;
    setResetFailed(false);
    setConfirmingNewList(true);
  };
  const closeNewList = () => {
    setConfirmingNewList(false);
    if (newListFromHistory.current) {
      openOrderHistory(newListFromHistory.current);
      newListFromHistory.current = null;
      return;
    }
    requestAnimationFrame(() =>
      (confirmOpener.current ?? newListButton.current)?.focus(),
    );
  };
  const [resetFailed, setResetFailed] = useState(false);
  /**
   * The confirmed New list: a durable local reset of the whole workspace (`resetList`), then
   * every piece of screen state that belonged to the earlier list is dropped. On failure the
   * dialog stays open with the prior workspace untouched.
   */
  async function resetEverything() {
    setResetFailed(false);
    const applied = await call("resetList", { revision: state.revision });
    if (!applied) {
      setResetFailed(true);
      return;
    }
    showFreshList("");
  }
  function showFreshList(savedNote: string) {
    setConfirmingNewList(false);
    newListFromHistory.current = null;
    try {
      for (const key of [
        "shopping-note",
        "shopping-new-list",
        "shopping-edit-instruction",
      ])
        sessionStorage.removeItem(key);
    } catch {
      // Session storage is a convenience.
    }
    changeNote(savedNote);
    currentInstruction.current = "";
    setInstructionValue("");
    setFocusTarget(null);
    setNewListDraft(false);
    savedDraft.current = "";
    setSelected(null);
    setOpened(null);
    setReviewRows(null);
    setUndo({});
    setComparing(false);
    setConfirming(false);
    setUpdateFailed(false);
    setCancelled(false);
    setEditFailed(false);
    setEditCancelled(false);
    setTransferFailed(false);
    setQrOpen(false);
    setLivePlanning(null);
    setShowSavedDuringPlanning(false);
    openList();
    requestAnimationFrame(() => noteElement.current?.focus());
  }
  const leaveNewList = () => {
    savedDraft.current = note;
    changeNote(state.note);
    setNewList(false);
  };
  const backToCurrentList = () => {
    leaveNewList();
    requestAnimationFrame(() => noteElement.current?.focus());
  };
  /** Opens the composer on one row or meal. Nothing is sent until the shopper presses Update. */
  const editWithInstruction = (targetId: string) => {
    if (!composingEdit) leaveNewList();
    setConfirmingNewList(false);
    setEditFailed(false);
    setFocusTarget(targetId);
    requestAnimationFrame(() => {
      noteElement.current?.focus({ preventScroll: true });
      noteElement.current?.scrollIntoView?.({ block: "nearest" });
    });
  };
  const homeKeys = new Set(state.skipped);
  const rows = all.filter((row) => !homeKeys.has(requirementKey(row)));
  const changeQuantity = (row: Requirement, amount: number) =>
    call("editLocally", {
      revision: state.revision,
      operations: [
        {
          op: "changeQuantity",
          rowKey: requirementKey(row),
          quantity: { kind: "amount", amount, unit: row.unit },
        },
      ],
    });
  const unmatchedRequests = snapshot.committedIntents.filter(requestWithoutRow);
  const currency = useMemo(
    () =>
      new Intl.NumberFormat(fi ? "fi-FI" : "en-FI", {
        style: "currency",
        currency: "EUR",
      }),
    [fi],
  );
  const money = (cents: number) => currency.format(cents / 100);
  // B7.3: a hand-added grocery whose products are sold in another unit takes one pack on the
  // shopper's click, with that product chosen. Nothing changes until then.
  const packOfferRow = (row: Requirement) =>
    row.sources.length > 0 && row.sources.every((s) => s === "extra");
  const takePack = (row: Requirement, offer: Product) =>
    save({
      ...state,
      extras: [
        ...state.extras.filter(
          (item) =>
            item.id !== row.id ||
            (item.unit !== row.unit && item.unit !== offer.unit),
        ),
        {
          ...state.extras.find(
            (item) => item.id === row.id && item.unit === row.unit,
          )!,
          // One pack, added to any amount already listed in the pack's unit.
          amount:
            offer.packAmount +
            (state.extras.find(
              (item) => item.id === row.id && item.unit === offer.unit,
            )?.amount ?? 0),
          unit: offer.unit,
        },
      ],
      accepted: {
        ...state.accepted,
        [`${state.context.providerId}:${state.context.storeId}:${row.id}`]: [
          offer.id,
        ],
      },
    });
  const quotesByKey = useMemo(() => {
    const exclusions = exclusionTerms(state.household.exclusions);
    return new Map(
      snapshot.basket.map((line) => {
        const r = line.requirement;
        const best =
          line.product && line.total !== null
            ? priceAlternatives(
                r,
                line.product,
                line.candidates.filter((p) => purchasable(r, p)),
                {
                  context: state.context,
                  preferences: state.categoryPreferences,
                  exclusions,
                  productPreference: state.productPreference,
                  priceBasis: state.priceBasis,
                  sourceNote: state.note,
                  accepted: state.accepted[r.id] ?? [],
                },
              )[0]
            : undefined;
        const comparison =
          best && line.product
            ? comparePriceAlternative(r, line.product, best, state.priceBasis)
            : null;
        return [
          requirementKey(r),
          {
            line,
            cheaper: best && comparison ? { product: best, comparison } : null,
          },
        ] as const;
      }),
    );
  }, [snapshot.basket, state]);
  const total = snapshot.basket.reduce(
    (sum, line) => sum + (line.total ?? 0),
    0,
  );
  const prices = priceBreakdown(snapshot.basket);
  const estimated = snapshot.basket.filter(
    (line) => line.approximate && line.total !== null,
  );
  const { sendable, transferPrices, unverified } = useMemo(() => {
    const manualKeys = new Set(
      snapshot.merchandise.manual.map((item) => item.requirementKey),
    );
    const sendable = [];
    const unverified = [];
    for (const line of snapshot.basket) {
      if (!line.product || manualKeys.has(requirementKey(line.requirement)))
        continue;
      if (transferableLine(line)) sendable.push(line);
      else unverified.push(line.requirement.name);
    }
    return { sendable, transferPrices: priceBreakdown(sendable), unverified };
  }, [snapshot.basket, snapshot.merchandise.manual]);
  const followUp = useMemo(() => {
    const previous = earlierListTransfer(snapshot.journal, state.context);
    return previous ? compareSentQuantities(sendable, previous.listSent) : null;
  }, [snapshot.journal, state.context, sendable]);
  const additions = followUp?.additions;
  const basketDifference = () => {
    if (
      order?.placed ||
      (!snapshot.quotedAt && rows.length) ||
      !followUp?.excess.length ||
      !snapshot.journal
    )
      return null;
    const { review } = snapshot.journal;
    const names = new Map(
      state.listHistory
        .flatMap((entry) =>
          entry.transferred.map((item) => [item.productId, item.name] as const),
        )
        .reverse(),
    );
    for (const line of review.quotes) {
      if (line.product) names.set(line.product.id, line.product.name);
    }
    return (
      <div className="basket-difference">
        <p className="warning">
          {tr(
            "Kaupassa voi olla ylimääräisiä pakkauksia aiemmasta siirrosta. Tarkista ja poista ne tarvittaessa.",
            "The store basket may still contain these extra packs from an earlier transfer. Check the basket and remove any you no longer want.",
          )}
        </p>
        <ul>
          {followUp.excess.map(({ productId, packs }) => (
            <li key={productId}>
              {names.get(productId) ?? productId} ·{" "}
              {packCount(packs, state.language)}
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => void call("openStoreCart")}
        >
          {tr("Avaa kaupan ostoskori", "Open store basket")}
        </button>
      </div>
    );
  };
  const missing = snapshot.quotedAt
    ? rows.filter((r) => !quotesByKey.get(requirementKey(r))?.line.product)
    : [];
  const leftOut = [
    ...missing.map((r) => r.name),
    ...unverified,
    ...unmatchedRequests.map((result) => result.intent.label),
  ];
  const openReview = (opener: HTMLButtonElement) => {
    reviewOpener.current = opener;
    setReviewRows(missing);
    if (reviewRows) document.getElementById("grouped-review-heading")?.focus();
  };
  const editHandoff = () => {
    if (
      snapshot.edit?.status !== "applied" &&
      snapshot.edit?.status !== "undone"
    )
      return null;
    const { target, text } = editTransferHint({
      fi,
      rows: rows.length,
      ready: sendable.length,
      quoted: !!snapshot.quotedAt,
      needsLogin:
        isLive(state.context.providerId) && snapshot.storeLogin !== "signedIn",
      transferStatus:
        snapshot.journal?.status === "partial"
          ? "partial"
          : sameVerifiedBatch
            ? "sent"
            : confirming
              ? "review"
              : null,
      additionalPacks: additions?.reduce(
        (total, item) => total + item.packs,
        0,
      ),
      omitted: leftOut,
      manual: snapshot.merchandise.manual.map((item) => item.productName),
      hasMissingProducts: missing.length > 0,
    });
    const destinations = {
      status: [
        tr("Näytä siirron tiedot", "View transfer details"),
        () => footer.current?.focus(),
      ],
      composer: [
        tr("Jatka ostoslistaa", "Continue editing"),
        () => noteElement.current?.focus(),
      ],
      prices: [
        tr("Siirry hintahakuun", "Go to price lookup"),
        () => priceButton.current?.focus(),
      ],
      review: [
        tr("Tarkista puuttuvat tuotteet", "Review missing products"),
        openReview,
      ],
      settings: [
        tr("Avaa kauppojen asetukset", "Open store settings"),
        () => settings("stores"),
      ],
      list: [
        tr("Tarkista ostoslista", "Review shopping list"),
        () => listHeading.current?.focus(),
      ],
      transfer: [
        tr("Siirry listan siirtoon", "Go to store transfer"),
        () => transferButton.current?.focus(),
      ],
    } as const;
    const [label, go] = destinations[target];
    return (
      <div className="edit-handoff">
        <p>{text}</p>
        <button
          type="button"
          className="text"
          disabled={busy || working || editWorking || transferring}
          onClick={(event) => go(event.currentTarget)}
        >
          {label}
        </button>
      </div>
    );
  };
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
  const repeatButton = (
    entry: AppState["listHistory"][number],
    latest = false,
  ) => (
    <RepeatButton
      key={entry.id}
      entry={entry}
      snapshot={snapshot}
      latest={latest}
      replacing={hasList || !!note.trim() || !!instruction.trim()}
      busy={busy || working || editWorking || transferring}
      repeat={(rowKeys) =>
        call(
          "repeatList",
          { historyId: entry.id, revision: state.revision, rowKeys },
          {
            onSuccess: (result) => showFreshList(result.state.note),
          },
        )
      }
    />
  );
  if (view === "history") {
    const query = historySearch.trim().toLocaleLowerCase(state.language);
    const matches = query
      ? state.listHistory.filter((entry) =>
          [
            entry.storeName ?? entry.storeKey,
            ...entry.transferred.map((item) => item.name),
            ...(entry.sentGroceries ?? entry.extras).map((item) => item.name),
          ].some((label) =>
            label.toLocaleLowerCase(state.language).includes(query),
          ),
        )
      : state.listHistory;
    return (
      <section>
        <h1>{tr("Historia", "History")}</h1>
        {historyActions}
        <p>
          {tr(
            "Kauppaan siirretyt ostoslistat ja tehdyiksi merkityt tilaukset.",
            "Shopping lists sent to the store and orders you marked as placed.",
          )}
        </p>
        {state.listHistory.length > 0 && (
          <label className="history-search">
            {tr("Etsi kaupalla tai tuotteella", "Search by store or grocery")}
            <input
              type="search"
              value={historySearch}
              onChange={(event) => {
                setHistorySearch(event.target.value);
                setHistoryLimit(8);
              }}
            />
          </label>
        )}
        {!!query && !matches.length && (
          <p role="status">
            {tr("Hakua vastaavia listoja ei löytynyt.", "No matching lists.")}
          </p>
        )}
        <div className="order-history">
          {matches.slice(0, historyLimit).map((h) => (
            <article
              className="card"
              key={h.id}
              aria-labelledby={`order-history-${h.id}`}
            >
              <h2
                id={`order-history-${h.id}`}
                tabIndex={-1}
                aria-describedby={`order-status-${h.id}`}
              >
                {h.storeName && `${h.storeName} · `}
                {new Date(h.date).toLocaleString(fi ? "fi-FI" : "en-FI", {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
              </h2>
              <p
                id={`order-status-${h.id}`}
                className={`transfer-signal ${h.orderPlacedAt ? "placed-order" : "muted"}`}
              >
                {h.orderPlacedAt &&
                  tr("Tilaus merkitty tehdyksi", "Order marked as placed")}
                {(() => {
                  const signal = transferSignal(snapshot, h.id);
                  if (h.orderPlacedAt && !signal) return null;
                  const description =
                    signal === "confirmed"
                      ? tr(
                          "Siirto vahvistettu ostetuksi kuitilla tai tilauksella",
                          "Transfer confirmed as bought by a receipt or order",
                        )
                      : signal === "review"
                        ? tr(
                            "Mahdollinen osto odottaa vahvistustasi",
                            "A possible purchase is waiting for your answer",
                          )
                        : tr(
                            "Siirto kauppaan, ei vielä vahvistettu ostos",
                            "Transfer to the store, not a confirmed purchase",
                          );
                  return h.orderPlacedAt ? ` · ${description}` : description;
                })()}
              </p>
              <p>
                {h.note ||
                  h.meals
                    .map(
                      (m) =>
                        (
                          h.recipes.find((r) => r.id === m.recipeId) ??
                          state.recipes.find((r) => r.id === m.recipeId)
                        )?.name,
                    )
                    .join(", ")}
              </p>
              {h.transferred.length > 0 && (
                <HistoryProducts
                  products={h.transferred}
                  label={tr("Siirretyt tuotteet", "Transferred products")}
                />
              )}
              <div className="actions">
                {!h.orderPlacedAt && order?.historyId === h.id && (
                  <CheckoutButton order={order} language={state.language} />
                )}
                {h.orderPlacedAt && order?.historyId === h.id && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      newListFromHistory.current = h.id;
                      openNewList(null);
                      openList();
                    }}
                  >
                    {tr(
                      "Aloita seuraava ostoslista",
                      "Start the next shopping list",
                    )}
                  </button>
                )}
                {repeatButton(h)}
              </div>
            </article>
          ))}
        </div>
        {matches.length > historyLimit && (
          <button
            type="button"
            className="secondary history-more"
            onClick={() => setHistoryLimit(historyLimit + 8)}
          >
            {tr("Näytä lisää listoja", "Show more lists")}
          </button>
        )}
        {!state.listHistory.length && (
          <p>
            {tr(
              "Siirretyt listat näkyvät tässä.",
              "Transferred lists will appear here.",
            )}
          </p>
        )}
        {insights && (
          <>
            <LinkReview
              insights={insights}
              snapshot={snapshot}
              busy={busy}
              call={call}
              refresh={refreshInsights}
            />
            <SpendingChart
              insights={insights}
              budget={state.household.budget}
              language={state.language}
            />
          </>
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
  }
  if (view === "schedule")
    return (
      <MealCalendarView
        state={state}
        busy={busy}
        save={save}
        copy={() => call("copyWeek")}
      />
    );
  return (
    <div className="shopping-workspace">
      <section className="planning-pane">
        {all.length > 0 && (
          <button
            type="button"
            className="secondary compact-list-jump"
            onClick={() => listHeading.current?.focus()}
          >
            {tr("Ostoslista", "Shopping list")} ·{" "}
            {count(all.length, fi, ["tuote", "tuotetta"], ["item", "items"])}
          </button>
        )}
        <h1>
          {tr("Mitä tällä viikolla syödään?", "What shall we eat this week?")}
        </h1>
        <RepeatSummary
          snapshot={snapshot}
          adjust={() => listHeading.current?.focus()}
        />
        {!hasList && !!state.listHistory.length && (
          <div className="actions repeat-last">
            {repeatButton(state.listHistory[0], true)}
          </div>
        )}
        {composingEdit &&
          !working &&
          !focusTarget &&
          !instruction &&
          snapshot.planning?.phase === "committed" && (
            <div className="generated-list-link">
              <span role="status">
                {tr("Ostoslista luotu", "Shopping list created")}
                {leftOut.length > 0 &&
                  ` · ${count(leftOut.length, fi, ["ostos jää pois siirrosta", "ostosta jää pois siirrosta"], ["item left out of transfer", "items left out of transfer"])}`}
              </span>
              <button
                type="button"
                className="text"
                onClick={() => listHeading.current?.focus()}
              >
                {tr("Näytä ostoslista", "View shopping list")}
              </button>
            </div>
          )}
        {hasList && (
          <div
            className="composer-mode"
            data-mode={composingEdit ? "edit" : "new"}
          >
            <label className="composer-label" htmlFor="shopping-note">
              {composingEdit
                ? tr("Muokkaa nykyistä listaa", "Edit current list")
                : tr("Uusi lista", "New list")}
            </label>
            {composingEdit ? (
              <button
                ref={newListButton}
                className="secondary"
                type="button"
                disabled={busy || working || editWorking || transferring}
                onClick={() => openNewList(newListButton.current)}
              >
                {tr("Uusi lista", "New list")}
              </button>
            ) : (
              <button
                className="secondary"
                type="button"
                disabled={busy || working}
                onClick={backToCurrentList}
              >
                {tr("Takaisin nykyiseen listaan", "Back to the current list")}
              </button>
            )}
          </div>
        )}
        {!hasList && (note.trim() || instruction.trim()) && (
          <div className="composer-mode" data-mode="create">
            <span />
            <button
              ref={newListButton}
              className="secondary"
              type="button"
              disabled={busy || working || editWorking || transferring}
              onClick={() => openNewList(newListButton.current)}
            >
              {tr("Uusi lista", "New list")}
            </button>
          </div>
        )}
        {hasList && !composingEdit && (
          <p className="muted composer-hint">
            {tr(
              "Nykyinen lista säilyy, kunnes uusi lista on valmis.",
              "The current list stays until the new list is ready.",
            )}
          </p>
        )}
        {confirmingNewList && (
          <div
            className="composer-confirm"
            role="alertdialog"
            aria-labelledby="new-list-confirm"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                closeNewList();
              }
            }}
          >
            <p id="new-list-confirm">
              {tr(
                "Uusi lista tyhjentää nykyisen listan, aterioiden tulkinnan ja muistiinpanon sekä kirjoittamasi keskeneräisen tekstin. Reseptit, historia ja asetukset säilyvät. Tätä ei voi kumota.",
                "A new list clears the current list, the meal interpretation, the note and any text you have not sent. Recipes, history and settings are kept. This cannot be undone.",
              )}
            </p>
            {resetFailed && (
              <p role="alert" className="transfer-error">
                {tr(
                  "Listaa ei voitu tyhjentää. Nykyinen lista säilyi ennallaan.",
                  "The list could not be cleared. The current list is unchanged.",
                )}
              </p>
            )}
            <button
              type="button"
              disabled={busy || transferring}
              onClick={() => void resetEverything()}
            >
              {tr("Aloita uusi lista", "Start new list")}
            </button>
            <button
              className="secondary"
              type="button"
              autoFocus
              onClick={closeNewList}
            >
              {tr("Peruuta", "Cancel")}
            </button>
          </div>
        )}
        {composingEdit && focusName !== null && (
          <p className="composer-focus">
            <span className="chip">
              {tr("Kohde", "About")}: {focusName}
            </span>
            <button
              className="text"
              type="button"
              onClick={() => setFocusTarget(null)}
            >
              {tr("Poista kohde", "Clear target")}
            </button>
          </p>
        )}
        <div
          className={`note-box ${progressActive && progressVisible ? "is-working" : ""}`}
        >
          {!hasList && (
            <label className="first-note-label" htmlFor="shopping-note">
              {tr("Mitä haluaisit valmistaa?", "What would you like to cook?")}
            </label>
          )}
          {!(composingEdit ? instruction : note) &&
            !focusTarget &&
            !progressActive && (
              <div className="note-examples">
                <button
                  type="button"
                  className="text"
                  onClick={() => {
                    if (composingEdit)
                      setInstruction(tr("Lisää 1 l maitoa", "Add 1 l of milk"));
                    else
                      changeNote(
                        tr(
                          "Tomaattipasta, 500 g kahvia",
                          "Tomato pasta, 500 g coffee",
                        ),
                      );
                    noteElement.current?.focus();
                  }}
                >
                  {composingEdit
                    ? tr("Kokeile esimerkkimuutosta", "Try an example edit")
                    : tr("Kokeile esimerkkitoivetta", "Try an example note")}
                </button>
                {!hasList && (
                  <button
                    type="button"
                    className="text"
                    onClick={() =>
                      document.getElementById("quick-add-item")?.focus()
                    }
                  >
                    {tr("Lisää tuote käsin", "Add a grocery by hand")}
                  </button>
                )}
              </div>
            )}
          <textarea
            ref={noteElement}
            id="shopping-note"
            aria-describedby={
              !composingEdit && note !== state.note
                ? "note-update-help note-unapplied"
                : "note-update-help"
            }
            value={composingEdit ? instruction : note}
            maxLength={composingEdit ? 2000 : 10000}
            placeholder={
              composingEdit
                ? tr(
                    "Esim. lisää maitoa ja vaihda pasta nakkikeittoon",
                    "E.g. add milk and replace the pasta with sausage soup",
                  )
                : tr(
                    "Nakkikeitto, kanapasta ja pakastepizza. Aamuksi jogurttia ja banaaneja. Jotain herkkuja viikonlopuksi…",
                    "Sausage soup, chicken pasta and frozen pizza. Yoghurt and bananas for breakfast. Some weekend treats…",
                  )
            }
            onChange={(e) => {
              if (composingEdit) {
                setEditFailed(false);
                setEditCancelled(false);
                setInstruction(e.target.value);
              } else changeNote(e.target.value);
            }}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                e.preventDefault();
                if (composingEdit) void applyEdit(instruction, focusTarget);
                else void update();
              } else if (e.key === "Escape" && composingEdit && focusTarget) {
                e.preventDefault();
                setFocusTarget(null);
              }
            }}
          />
          <div className="note-footer">
            <div className="note-context">
              <HouseholdSizeControl
                snapshot={snapshot}
                busy={busy || working || editWorking}
                call={call}
                openSettings={() => settings("household")}
              />
              <time
                className="shopping-date"
                dateTime={new Date().toISOString()}
              >
                {tr("Tänään", "Today")} ·{" "}
                {new Date().toLocaleDateString(fi ? "fi-FI" : "en-FI", {
                  day: "numeric",
                  month: "long",
                })}
              </time>
            </div>
            <ModelSelector
              snapshot={snapshot}
              busy={busy}
              call={call}
              settings={() => settings("ai")}
              connect={() => {
                noteElement.current?.focus({ preventScroll: true });
                void call("signInAI");
              }}
            />
            <div className="note-actions" ref={progressAnchor}>
              <span
                id="note-update-help"
                className={`note-status ${(progressActive || progressFinished) && !progressVisible ? "offscreen-progress" : ""}`}
                role={progressVisible ? "status" : undefined}
                aria-hidden={
                  (progressActive || progressFinished) && !progressVisible
                    ? true
                    : undefined
                }
                aria-atomic="true"
                data-operation-status={
                  progressActive || progressFinished ? "composer" : undefined
                }
                data-planning-phase={progressPhase}
                data-planning-activity={
                  progressActive &&
                  !progressCancelling &&
                  planningActivityPending(progressPhase)
                    ? "pending"
                    : progressActive
                      ? "settling"
                      : "idle"
                }
              >
                <span className="planning-activity" aria-hidden="true" />
                {progressActive && operationProgress ? (
                  <OperationProgressBody
                    progress={operationProgress}
                    language={state.language}
                    since={startedAt}
                  />
                ) : (
                  <span>{progressLabel}</span>
                )}
              </span>
              {progressActive && (
                <small
                  className={`muted note-elapsed ${!progressVisible ? "offscreen-progress" : ""}`}
                  aria-hidden="true"
                >
                  <ElapsedSeconds since={startedAt} />
                </small>
              )}
              {progressCancellable && (
                <button
                  className={`secondary ${!progressVisible ? "offscreen-progress" : ""}`}
                  onClick={cancelProgress}
                  disabled={progressCancelling}
                  aria-hidden={!progressVisible ? true : undefined}
                >
                  {editWorking
                    ? tr("Peruuta muutos", "Cancel change")
                    : tr("Peruuta listan päivitys", "Cancel list update")}
                </button>
              )}
              <button
                className="update-note"
                aria-busy={working || editWorking}
                data-pending={working || editWorking}
                disabled={
                  busy ||
                  working ||
                  editWorking ||
                  !(composingEdit ? instruction : note).trim() ||
                  snapshot.ai.state !== "connected"
                }
                onClick={() => {
                  noteElement.current?.focus({ preventScroll: true });
                  if (composingEdit) void applyEdit(instruction, focusTarget);
                  else void update();
                }}
              >
                <span className="update-note-symbol" aria-hidden="true">
                  {working || editWorking ? "…" : "✦"}
                </span>
                <span>
                  {composingEdit
                    ? tr("Taio muutokset", "Update my shopping list")
                    : tr("Taio ostoslista", "Create my shopping list")}
                </span>
              </button>
            </div>
          </div>
        </div>
        {/* What the planner assumed or could not do, right under the request that caused it. */}
        {state.assumptions && (
          <p className="input-notice">{state.assumptions}</p>
        )}
        <EditOutcome
          snapshot={snapshot}
          language={state.language}
          busy={busy || working || editWorking}
          call={call}
          resubmit={(targetId) => {
            setFocusTarget(targetId);
            void applyEdit(instruction, targetId);
          }}
        >
          {editHandoff()}
        </EditOutcome>
        {basketDifference()}
        <OfferIdeas
          snapshot={snapshot}
          busy={busy || working || editWorking}
          call={call}
          canAppend={(name) =>
            (offerIdeas.length < 4 ||
              offerIdeas.some((idea) => idea.name === name)) &&
            note.trimEnd().length + name.length + 1 <= 10000
          }
          append={(idea) => {
            setNewListDraft(true);
            setOfferIdeas((current) => [
              ...current.filter(
                (item) => item.id !== idea.id && item.name !== idea.name,
              ),
              { id: idea.id, name: idea.name },
            ]);
            if (!note.includes(idea.name))
              changeNote(
                `${note.trimEnd()}${note.trim() ? "\n" : ""}${idea.name}`,
              );
            requestAnimationFrame(() => noteElement.current?.focus());
          }}
        />
        {offerIdeas.some((idea) => note.includes(idea.name)) && (
          <p role="status">
            {tr(
              "Tarjoustuotteet valittu listan luontiin.",
              "Offer products selected for list creation.",
            )}{" "}
            <button
              type="button"
              className="secondary"
              onClick={() => setOfferIdeas([])}
            >
              {tr("Poista tarjousvalinnat", "Clear offer selections")}
            </button>
          </p>
        )}
        {updateFailed && !working && failureCause && !composingEdit && (
          <p className="muted" role="status" data-testid="failure-cause">
            {tr(
              "Listan luominen ei onnistunut. Muistiinpanosi ja aiempi listasi säilyivät. Paina Taio ostoslista yrittääksesi uudelleen.",
              "We couldn't create the list. Your note and previous list were kept. Press Create my shopping list to try again.",
            )}
          </p>
        )}
        {!composingEdit && note !== state.note && (
          <p id="note-unapplied" className="muted" role="status">
            {tr(
              "Muistiinpanoa ei ole päivitetty listaan",
              "Note changes have not been applied to the list",
            )}
          </p>
        )}
        <p className="input-notice">
          {snapshot.developmentMode
            ? tr(
                "Kehitystila käyttää paikallista testiaineistoa. Muistiinpanoa tai kuitteja ei lähetetä ChatGPT:lle.",
                "Development mode uses local fixtures. Your note and receipts are not sent to ChatGPT.",
              )
            : snapshot.ai.state === "connected"
              ? composingEdit
                ? tr(
                    "Taio muutokset lähettää muutosohjeen, nykyisen listan ja talouden toiveet ChatGPT:lle.",
                    "Update my shopping list sends your instruction, current list and household preferences to ChatGPT.",
                  )
                : tr(
                    "Taio ostoslista lähettää muistiinpanon, siihen liittyvät reseptit ja talouden toiveet ChatGPT:lle.",
                    "Create my shopping list sends your note, relevant recipes and household preferences to ChatGPT.",
                  )
              : tr(
                  "Voit kirjoittaa muistiinpanon ennen kirjautumista. Lähetä se, kun olet valmis.",
                  "You can write your note before signing in. Submit it when you’re ready.",
                )}
        </p>
        {working &&
          !["failed", "cancelled", "obsolete", "committed"].includes(
            livePlanning?.phase ?? "discovering",
          ) && (
            <PlanningPreviewFocus
              onReleaseFocus={() =>
                noteElement.current?.focus({ preventScroll: true })
              }
            >
              <div
                className="planning-view-controls"
                role="group"
                aria-label={tr("Päivityksen näkymä", "Update view")}
              >
                <button
                  type="button"
                  aria-pressed={!showSavedDuringPlanning}
                  onClick={() => setShowSavedDuringPlanning(false)}
                >
                  {tr("Muodostuva lista", "List in progress")}
                </button>
                <button
                  type="button"
                  aria-pressed={showSavedDuringPlanning}
                  onClick={() => setShowSavedDuringPlanning(true)}
                >
                  {tr("Tallennettu lista", "Saved list")}
                </button>
              </div>
              <div hidden={showSavedDuringPlanning}>
                <PlanningPreview
                  planning={livePlanning}
                  language={state.language}
                />
              </div>
            </PlanningPreviewFocus>
          )}
        <div hidden={working && !showSavedDuringPlanning}>
          {!groups.length && (
            <section className="starter-ideas">
              <h2>{tr("Ideoita alkuun", "Ideas to start with")}</h2>
              <p className="muted">
                {tr(
                  "Valitse aihe: tekoäly ehdottaa uusia ruokia muistiinpanoon. Taio niistä ostoslista, kun olet valmis.",
                  "Choose a theme: AI suggests fresh dishes in your note. Create the shopping list when you are ready.",
                )}
              </p>
              {starterThemes.map((idea) => (
                <button
                  className="chip"
                  key={idea.id}
                  type="button"
                  disabled={
                    busy || starterWorking || snapshot.ai.state !== "connected"
                  }
                  onClick={() => void chooseStarter(idea.id)}
                >
                  {fi ? idea.fi : idea.en}
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
                        {selected === recipe.name && (
                          <small className="meal-selection">
                            {tr(
                              "Ainekset korostettu",
                              "Ingredients highlighted",
                            )}
                          </small>
                        )}
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
                          {count(
                            meal.servings,
                            fi,
                            ["annos", "annosta"],
                            ["portion", "portions"],
                          )}
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
                      <div className="meal-actions">
                        <button
                          className="text edit-with-instruction"
                          aria-label={`${tr("Muokkaa ohjeella", "Edit with instruction")}: ${recipe.name}`}
                          disabled={busy || working || editWorking}
                          onClick={() =>
                            editWithInstruction(mealTargetId(meal.id))
                          }
                        >
                          {tr("Muokkaa ohjeella", "Edit with instruction")}
                        </button>
                        <button
                          className="text remove-meal"
                          disabled={busy}
                          onClick={() =>
                            // Local: the other rows keep their prices and nothing is searched.
                            void call("editLocally", {
                              revision: state.revision,
                              operations: [
                                { op: "removeMeal", mealId: meal.id },
                              ],
                            })
                          }
                        >
                          {tr("Poista", "Remove")}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </>
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
                {tr(
                  "Lisää resepti ostoslistaan",
                  "Add recipe to shopping list",
                )}
              </button>
            </form>
          </details>
          {(!!state.staples.length || !!insights?.suggestions.length) && (
            <section className="forgotten card">
              <div className="section-heading compact">
                <h2>{tr("Unohtuiko jotain?", "Forgot anything?")}</h2>
                <button className="text" onClick={staples}>
                  {tr("Muokkaa vakiotuotteita", "Edit regular items")}
                </button>
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
              {insights && (
                <RecurringSuggestions
                  snapshot={snapshot}
                  suggestions={insights.suggestions}
                  busy={busy}
                  save={save}
                  call={call}
                  refresh={refreshInsights}
                />
              )}
              {!!state.staples.length &&
                state.staples.every((s) => rows.some((r) => r.id === s.id)) && (
                  <small>
                    {tr(
                      "Vakio-ostokset ovat jo listalla.",
                      "Your regular items are already on the list.",
                    )}
                  </small>
                )}
            </section>
          )}
        </div>
      </section>
      <aside
        className="shopping-panel"
        ref={panel}
        hidden={working && !showSavedDuringPlanning}
      >
        <div className="shopping-rows">
          {working && (
            <p className="saved-list-status">
              {tr(
                "Tallennettu lista näkyy päivityksen ajan. Hinnat ovat edellisestä hausta.",
                "Your saved list stays visible during the update. Prices are from the previous lookup.",
              )}
            </p>
          )}
          <div className="section-heading compact">
            <h2 ref={listHeading} tabIndex={-1}>
              {tr("Ostoslista", "Shopping list")}{" "}
              <span className="muted">· {all.length}</span>
            </h2>
            {composingEdit && (
              <button
                type="button"
                className="text finish-in-composer"
                aria-label={tr(
                  "Viimeistele lista tekoälykentässä",
                  "Finish the list in the AI field",
                )}
                onClick={() => {
                  setFocusTarget(null);
                  noteElement.current?.focus();
                }}
              >
                {tr("Viimeistele tekoälyllä", "Finish with AI")}
              </button>
            )}
            {/* B7.1: the list's less frequent actions share one menu, so the rows start higher. */}
            <details className="list-menu" ref={listMenu}>
              <summary aria-label={tr("Listan toiminnot", "List actions")}>
                ···
              </summary>
              <div className="list-menu-items">
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
                      {tr(
                        "Edullisin, merkistä riippumatta",
                        "Cheapest, any brand",
                      )}
                    </option>
                    <option value="storeBrand">
                      {tr("Suosi kaupan merkkejä", "Prefer store brands")}
                    </option>
                    <option value="avoidStoreBrand">
                      {tr("Vältä kaupan merkkejä", "Avoid store brands")}
                    </option>
                  </select>
                </label>
                <button
                  className="text"
                  disabled={busy || !rows.length}
                  onClick={() => void call("buildBasket")}
                >
                  {tr(
                    "Päivitä tuotteet ja hinnat",
                    "Refresh products and prices",
                  )}
                </button>
                <button
                  className="text"
                  onClick={() => void call("exportList")}
                >
                  {tr("Tallenna tekstinä", "Save as text")}
                </button>
                <button
                  ref={clearListButton}
                  className="text clear-list"
                  disabled={
                    busy ||
                    working ||
                    editWorking ||
                    transferring ||
                    (!all.length && !state.note.trim())
                  }
                  onClick={() => {
                    // Focus returns to the menu, which stays in place when the panel closes.
                    if (listMenu.current) listMenu.current.open = false;
                    openNewList(
                      listMenu.current?.querySelector("summary") ??
                        clearListButton.current,
                    );
                  }}
                >
                  {tr("Tyhjennä lista", "Clear list")}
                </button>
              </div>
            </details>
          </div>
          {/* Right after clearing, one note with the way back; a list that was never filled shows
              only the empty state below (B6.6). */}
          {!all.length && snapshot.edit?.status === "cleared" && (
            <p className="muted list-empty-note" role="status">
              {tr(
                "Lista on tyhjä. Lisää tuote, kirjoita uusi lista tai kumoa tyhjennys. Vakiotuotteet palaavat, kun päivität hinnat tai teet uuden listan.",
                "The list is empty. Add an item, write a new list or undo the clearing. Recurring items return when you update prices or make a new list.",
              )}
            </p>
          )}
          <QuickAdd
            state={state}
            busy={busy}
            save={save}
            showTransfer={
              additions && !sameVerifiedBatch
                ? () => (transferButton.current ?? footer.current)?.focus()
                : undefined
            }
          />
          {(missing.length > 0 || reviewRows !== null) && (
            <button
              type="button"
              className="text"
              aria-expanded={reviewRows !== null}
              aria-controls="optional-product-review"
              disabled={busy}
              onClick={(event) =>
                reviewRows ? closeReview() : openReview(event.currentTarget)
              }
            >
              {tr("Valitse puuttuvat tuotteet", "Choose missing products")} ·{" "}
              {missing.length}
            </button>
          )}
          {reviewRows && (
            <div id="optional-product-review">
              <GroupedReview
                snapshot={snapshot}
                requirements={reviewRows}
                busy={busy}
                money={money}
                call={call}
                close={closeReview}
                editRow={(key) => {
                  setReviewRows(null);
                  editWithInstruction(rowTargetId(key));
                }}
                backToTransfer={
                  !confirming && sendable.length > 0
                    ? () => {
                        setReviewRows(null);
                        requestAnimationFrame(() =>
                          transferButton.current?.focus(),
                        );
                      }
                    : undefined
                }
              />
            </div>
          )}
          {!all.length && snapshot.edit?.status !== "cleared" && (
            <div className="empty-list">
              <span aria-hidden="true">☷</span>
              <h3>{tr("Lista täyttyy tähän", "Your list will appear here")}</h3>
              <p>
                {tr(
                  "Lisää tuote nimellä tai kirjoita ostostoiveesi muistiinpanoon.",
                  "Add a grocery by name or write what you need in the shopping note.",
                )}
              </p>
            </div>
          )}
          {all.length > 0 &&
            (snapshot.proposal.sides.length > 0 ||
              snapshot.proposal.quantities.length > 0) && (
              <section
                className="proposal-assumptions"
                aria-label={tr("Mitä oletin", "What I assumed")}
              >
                <h3>{tr("Mitä oletin", "What I assumed")}</h3>
                <ul>
                  {snapshot.proposal.sides.map((side) => (
                    <li key={side.mealId}>
                      <span>
                        {tr(
                          `${side.dish}: lisukkeeksi ${side.side}`,
                          `${side.dish}: with ${side.side} on the side`,
                        )}
                      </span>
                      <button
                        className="text"
                        type="button"
                        disabled={busy || working || editWorking}
                        aria-label={`${tr("Muuta lisuketta", "Change the side")}: ${side.dish}`}
                        onClick={() =>
                          editWithInstruction(mealTargetId(side.mealId))
                        }
                      >
                        {tr("Muuta lisuketta", "Change the side")}
                      </button>
                    </li>
                  ))}
                  {snapshot.proposal.quantities.map((assumed) => {
                    const line = quotesByKey.get(assumed.requirementKey)?.line;
                    return (
                      <li key={assumed.requirementKey}>
                        <span>
                          {assumed.label}: {tr("oletin", "assumed")}{" "}
                          {assumed.amount}{" "}
                          {unitLabel(assumed.unit, state.language)}
                          {" → "}
                          {line?.product
                            ? `${line.product.name}${line.total !== null ? ` · ${money(line.total)}` : ""}`
                            : tr("tuote puuttuu", "no product yet")}
                        </span>
                        <button
                          className="text"
                          type="button"
                          disabled={busy || !line}
                          aria-label={`${tr("Näytä tuotteet", "Show products")}: ${assumed.label}`}
                          onClick={() => setOpened(assumed.requirementKey)}
                        >
                          {tr("Näytä tuotteet", "Show products")}
                        </button>
                        <button
                          className="text"
                          type="button"
                          disabled={busy || working || editWorking}
                          aria-label={`${tr("Muuta määrää", "Change the amount")}: ${assumed.label}`}
                          onClick={() =>
                            editWithInstruction(
                              rowTargetId(assumed.requirementKey),
                            )
                          }
                        >
                          {tr("Muuta määrää", "Change the amount")}
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <p className="muted">
                  {tr(
                    "Oletukset koskevat vain tätä listaa. Mitään ei tallenneta tuleville listoille ilman erillistä valintaasi.",
                    "Assumptions apply to this list only. Nothing is saved for future lists unless you choose to remember it.",
                  )}
                </p>
              </section>
            )}
          {categories.map((cat) => (
            <section className="grocery-category" key={cat}>
              <h3>{cat}</h3>
              {all
                .filter((r) => category(r.name) === cat)
                .map((r) => {
                  const key = requirementKey(r);
                  const quote = quotesByKey.get(key);
                  const line = quote?.line;
                  const cheaper = quote?.cheaper;
                  const home = homeKeys.has(key);
                  const merchandiseIntent =
                    line?.requirement.merchandise ?? r.merchandise ?? null;
                  const step =
                    line?.product && !line.approximate
                      ? (packageAmount(line.product, r.unit) ?? 1) *
                        line.product.increment
                      : r.unit === "pcs"
                        ? 1
                        : 100;
                  const count =
                    line?.product && !line.approximate ? line.packs : r.amount;
                  return (
                    <div
                      className={`grocery-row ${home ? "at-home" : ""} ${snapshot.quotedAt && !home && (!line?.product || line.total === null) ? "unresolved" : ""} ${selected && r.sources.includes(selected) ? "highlighted" : ""}`}
                      key={key}
                      data-row-key={key}
                    >
                      <button
                        className="home-button"
                        aria-label={`${tr("Löytyy kotoa", "Already at home")}: ${r.name}`}
                        aria-pressed={home}
                        aria-describedby={`home-help-${key}`}
                        title={
                          home
                            ? tr(
                                "Löytyy kotoa, joten tätä ei siirretä kauppaan. Paina uudelleen, niin tuote palaa siirrettäviin.",
                                "Already at home, so it is not transferred. Press again to include it.",
                              )
                            : tr(
                                "Merkitse kotona olevaksi: tuotetta ei siirretä kauppaan.",
                                "Mark as already at home: it is left out of the transfer.",
                              )
                        }
                        disabled={busy}
                        onClick={() =>
                          // Marking at home needs no search; bringing a row back does.
                          void (home
                            ? save({
                                ...state,
                                skipped: state.skipped.filter((k) => k !== key),
                              })
                            : call("editLocally", {
                                revision: state.revision,
                                operations: [
                                  {
                                    op: "markAtHome",
                                    rowKey: key,
                                    atHome: true,
                                  },
                                ],
                              }))
                        }
                      >
                        ⌂
                      </button>
                      <div className="grocery-description">
                        <small
                          id={`home-help-${key}`}
                          className="home-help muted"
                          role="note"
                        >
                          {home
                            ? tr(
                                "Löytyy kotoa, joten tätä ei siirretä kauppaan. Paina ⌂ uudelleen, niin tuote palaa siirrettäviin.",
                                "Already at home, so it is not transferred. Press ⌂ again to include it.",
                              )
                            : tr(
                                "Merkitse kotona olevaksi: tuotetta ei siirretä kauppaan. Merkintä ei ole osto eikä muuta kaupan koria.",
                                "Mark as already at home: it is left out of the transfer. This is not a purchase and does not change the store basket.",
                              )}
                        </small>
                        {line?.matching &&
                          line.matching.status !== "resolved" &&
                          !(line.packOffer && packOfferRow(r)) && (
                            <p className="warning">
                              {matchingReasonLabel(
                                line.matching.reason,
                                state.language,
                              )}
                            </p>
                          )}
                        {line?.packOffer &&
                          !line.product &&
                          !home &&
                          packOfferRow(r) && (
                            <p className="pack-offer">
                              <span className="muted">
                                {tr(
                                  `Määrä ${r.amount} ${unitLabel(r.unit, state.language)} ei sovi kaupan pakkauksiin.`,
                                  `${r.amount} ${unitLabel(r.unit, state.language)} does not fit the store's packs.`,
                                )}
                              </span>{" "}
                              <button
                                type="button"
                                className="secondary"
                                disabled={busy}
                                onClick={() =>
                                  void takePack(r, line.packOffer!)
                                }
                              >
                                {tr("Ota 1 pakkaus", "Take 1 pack")}:{" "}
                                {line.packOffer.name} ·{" "}
                                {money(line.packOffer.price ?? 0)}
                              </button>
                            </p>
                          )}
                        {line ? (
                          <button
                            className="row-name"
                            aria-expanded={opened === key}
                            onClick={() =>
                              setOpened(opened === key ? null : key)
                            }
                          >
                            {line.product?.name ?? r.name}
                          </button>
                        ) : (
                          <strong>{r.name}</strong>
                        )}
                        {line?.product && pieceQuote(r, line.product) && (
                          <small className="piece-order-summary">
                            {tr("Tilataan", "Order")} {line.packs}{" "}
                            {unitLabel("pcs", state.language)} ·{" "}
                            {tr("paino noin", "weight about")}{" "}
                            {Math.round(
                              pieceQuote(r, line.product)!.weightGrams,
                            )}{" "}
                            g
                          </small>
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
                        {/* B7.1: only a known purchase date gets a line. */}
                        {r.sources.includes("staple") &&
                          state.staples.find((s) => s.id === r.id)
                            ?.lastPurchased && (
                            <small>
                              {tr("Viimeksi ostettu", "Last purchased")}:{" "}
                              {new Date(
                                state.staples.find((s) => s.id === r.id)!
                                  .lastPurchased!,
                              ).toLocaleDateString(fi ? "fi-FI" : "en-FI")}
                            </small>
                          )}
                        <small className="row-source">
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
                        <small className="row-amount">
                          {r.amount} {unitLabel(r.unit, state.language)}
                        </small>
                        {snapshot.quotedAt && !home && !line?.product && (
                          <small className="warning">
                            {tr("Tuote puuttuu", "Needs a product")}
                          </small>
                        )}
                        {!home && merchandiseIntent && (
                          <MerchandiseRow
                            language={state.language}
                            intent={merchandiseIntent}
                            status={
                              snapshot.merchandise.statuses.find(
                                (s) => s.requirementKey === key,
                              )?.status ?? null
                            }
                            evidence={line?.product?.merchandise ?? null}
                            capabilities={snapshot.merchandise.capabilities}
                            busy={busy || working || editWorking}
                            canOpenStore={isLive(state.context.providerId)}
                            openStore={() =>
                              openStore?.(
                                state.context.providerId === "s-kaupat"
                                  ? "s-kaupat"
                                  : "k-ruoka",
                              )
                            }
                            answer={(kind, value) =>
                              call("editList", {
                                revision: state.revision,
                                instruction: `${
                                  {
                                    size: tr("koko", "size"),
                                    colour: tr("väri", "colour"),
                                    model: tr("malli", "model"),
                                    material: tr("materiaali", "material"),
                                    spec: tr("tarkenne", "spec"),
                                  }[kind]
                                } ${value}`,
                                focusTargetId: rowTargetId(key),
                                consent: true,
                              })
                            }
                          />
                        )}
                        {snapshot.quotedAt &&
                          !home &&
                          !line?.product &&
                          !merchandiseIntent && (
                            <RowFind
                              language={state.language}
                              name={r.name}
                              amountLabel={`${r.amount} ${unitLabel(r.unit, state.language)}`}
                              busy={busy || working || editWorking}
                              aiConnected={snapshot.ai.state === "connected"}
                              find={(wording) => findForRow(key, wording)}
                            />
                          )}
                      </div>
                      {/* B7.1: the amount sits beside the dish line, the text actions on one line
                          under it. */}
                      <div
                        className="quantity-control"
                        role="group"
                        aria-label={tr(
                          `Määrä: ${r.name}`,
                          `Quantity: ${r.name}`,
                        )}
                      >
                        <button
                          aria-label={`${tr("Vähennä", "Decrease")}: ${r.name}`}
                          disabled={busy || r.amount <= step}
                          onClick={() =>
                            void changeQuantity(r, r.amount - step)
                          }
                        >
                          −
                        </button>
                        <output aria-live="polite" aria-atomic="true">
                          <span>{count}</span>{" "}
                          <small
                            className={
                              line?.product && !line.approximate
                                ? "pack-word"
                                : undefined
                            }
                          >
                            {line?.product && !line.approximate
                              ? tr(
                                  count === 1 ? "pakkaus" : "pakkausta",
                                  count === 1 ? "pack" : "packs",
                                )
                              : unitLabel(r.unit, state.language)}
                          </small>
                        </output>
                        <button
                          aria-label={`${tr("Lisää", "Increase")}: ${r.name}`}
                          disabled={busy || r.amount + step > 10_000_000}
                          onClick={() =>
                            void changeQuantity(r, r.amount + step)
                          }
                        >
                          +
                        </button>
                      </div>
                      <div className="row-actions">
                        <button
                          className="text edit-with-instruction"
                          aria-label={`${tr("Muokkaa ohjeella", "Edit with instruction")}: ${r.name}`}
                          disabled={busy || working || editWorking}
                          onClick={() => editWithInstruction(rowTargetId(key))}
                        >
                          {tr("Muokkaa ohjeella", "Edit with instruction")}
                        </button>
                        {line && !home && (
                          <RowCorrection
                            snapshot={snapshot}
                            line={line}
                            busy={busy}
                            correct={async (input) => {
                              const applied = await call("correctRow", input);
                              if (!applied)
                                await call("load", undefined, {
                                  preserveError: true,
                                });
                              return applied;
                            }}
                          />
                        )}
                      </div>
                      <strong className="row-price">
                        {home
                          ? tr("kotona", "at home")
                          : line?.total != null
                            ? `${line.approximate ? tr("noin ", "about ") : ""}${money(line.total)}`
                            : tr("Hinta puuttuu", "Price unknown")}
                      </strong>
                      {!home && line?.product && (
                        <span className="row-price-badges">
                          {currentOffer(line.product) && (
                            <small>{tr("Tarjous", "Offer")}</small>
                          )}
                          {snapshot.cheaperProductIds.includes(
                            line.product.id,
                          ) && (
                            <small>
                              {tr(
                                "Halvempi kuin yleensä",
                                "Cheaper than usual",
                              )}
                            </small>
                          )}
                        </span>
                      )}
                      <button
                        className="delete-row"
                        aria-label={`${tr("Poista", "Remove")}: ${r.name}`}
                        disabled={busy}
                        onClick={() =>
                          void call("editLocally", {
                            revision: state.revision,
                            operations: [{ op: "removeItem", rowKey: key }],
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
                          {cheaper.comparison.payableDelta < 0
                            ? `${tr("Edullisempi vaihtoehto", "Cheaper option")} ${money(-cheaper.comparison.payableDelta)}`
                            : tr(
                                "Edullisempi yksikköhinta",
                                "Lower unit price",
                              )}
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
                          remember={async (input) => {
                            const applied = await call(
                              "rememberCategoryPreference",
                              input,
                            );
                            if (!applied)
                              await call("load", undefined, {
                                preserveError: true,
                              });
                            return applied;
                          }}
                          cheaper={!home && cheaper ? cheaper : null}
                          confirmPack={(p, amount, unit) =>
                            void call("setPackSize", {
                              productId: p.id,
                              amount,
                              unit,
                            })
                          }
                          choose={async (p) => {
                            const previous = line.product?.id;
                            const applied = await call("accept", {
                              ingredientId: r.id,
                              productId: p.id,
                            });
                            // The list of alternatives closes only once the choice has been
                            // applied; a failure keeps it open beside the error.
                            if (!applied) return;
                            if (previous) setUndo({ ...undo, [key]: previous });
                            setOpened(null);
                            requestAnimationFrame(() =>
                              document
                                .querySelector<HTMLElement>(
                                  `[data-row-key="${CSS.escape(key)}"] .row-name`,
                                )
                                ?.focus(),
                            );
                          }}
                        />
                      )}
                    </div>
                  );
                })}
            </section>
          ))}
          {unmatchedRequests.length > 0 && (
            <section
              className="warning"
              aria-label={tr("Ratkaisemattomat pyynnöt", "Unresolved requests")}
            >
              <p>
                {tr(
                  "Näille pyynnöille ei löytynyt siirrettävää tuotetta. Lisää ne tarvittaessa itse kaupassa.",
                  "These requests have no product to transfer. Add them at the store if you still need them.",
                )}
              </p>
              <ul>
                {unmatchedRequests.map((result) => (
                  <li key={result.intent.id}>{result.intent.label}</li>
                ))}
              </ul>
            </section>
          )}
          {all.length > 0 && (
            <div className="list-footer">
              {state.skipped.length > 0 && (
                <small>
                  {count(
                    state.skipped.length,
                    fi,
                    ["tuote kotona, ei mukana", "tuotetta kotona, ei mukana"],
                    ["item at home, excluded", "items at home, excluded"],
                  )}
                </small>
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
                <button
                  className="secondary"
                  disabled={busy || !rows.length}
                  aria-expanded={qrOpen}
                  onClick={() => setQrOpen(!qrOpen)}
                >
                  {qrOpen
                    ? tr("Piilota QR-koodi", "Hide QR code")
                    : tr("Näytä QR-koodi", "Show QR code")}
                </button>
              </div>
              {qrOpen && !!rows.length && (
                <QrExport text={shoppingList(state)} fi={fi} />
              )}
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
          )}
        </div>
        {/* Separate from scrolling rows so focused controls cannot be covered. */}
        {(all.length > 0 ||
          confirming ||
          snapshot.journal?.status === "partial") && (
          <div
            ref={footer}
            tabIndex={-1}
            className="shopping-total"
            role="region"
            aria-label={tr("Yhteensä ja siirto", "Total and transfer")}
          >
            {confirming && (
              <ConfirmPanel
                order={order}
                snapshot={snapshot}
                busy={busy}
                call={call}
                money={money}
                onClose={() => setConfirming(false)}
                onAddItem={() =>
                  document.getElementById("quick-add-item")?.focus()
                }
                onRecover={() => void call("recover")}
                onOpenStore={openStore}
              />
            )}
            {!confirming && snapshot.journal?.status === "partial" && (
              <p className="warning" role="status">
                {tr(
                  "Edellinen siirto keskeytyi.",
                  "The last transfer stopped.",
                )}{" "}
                <button className="text" onClick={() => setConfirming(true)}>
                  {tr("Tarkista", "Check it")}
                </button>
              </p>
            )}
            <div className="total-line">
              <span>
                <span>
                  {missing.length || snapshot.planningIncomplete
                    ? tr(
                        "Tunnettujen hintojen välisumma",
                        "Subtotal of known prices",
                      )
                    : tr("Arvio yhteensä", "Estimated total")}
                </span>
                {/* B7.1: the budget sits under the label, so the price time keeps one line. */}
                {snapshot.quotedAt &&
                  state.household.budget > 0 &&
                  (prices.exact > 0 || estimated.length > 0) && (
                    <small className="total-budget">
                      {tr("budjetti", "budget")} {money(state.household.budget)}
                    </small>
                  )}
              </span>
              <strong>
                {snapshot.quotedAt || !rows.length
                  ? estimated.length
                    ? `${money(prices.exact)} + ${tr("noin ", "about ")}${money(prices.approximate)}`
                    : money(total)
                  : tr("Ei hinnoiteltu", "Not priced")}
              </strong>
            </div>
            {snapshot.pricingError && (
              <p className="warning" role="alert">
                {tr(
                  "Tuotteiden ja hintojen haku epäonnistui. Yritä uudelleen.",
                  "Could not retrieve products and prices. Try again.",
                )}
                <button className="text" onClick={() => settings("stores")}>
                  {tr("Avaa kauppojen asetukset", "Open store settings")}
                </button>
              </p>
            )}
            {snapshot.quotedAt ? (
              <p className="muted">
                {tr("Viimeksi haetut hinnat", "Last quoted prices")} ·{" "}
                {new Date(snapshot.quotedAt).toLocaleString(
                  fi ? "fi-FI" : "en-FI",
                  { dateStyle: "short", timeStyle: "short" },
                )}
              </p>
            ) : (
              rows.length > 0 && (
                <button
                  ref={priceButton}
                  className="secondary"
                  disabled={busy}
                  onClick={() => void call("buildBasket")}
                >
                  {tr("Hae tuotteet ja hinnat", "Get products and prices")}
                </button>
              )
            )}
            {(() => {
              // Say what the comparison still needs instead of hiding it.
              const blocker = compareBlocker(snapshot);
              return (
                blocker && (
                  <p className="compare-hint">
                    <button className="text" onClick={() => settings("stores")}>
                      {blocker.need === "store"
                        ? tr(
                            `Vertailu: valitse kauppa ketjulle ${blocker.chain}`,
                            `Compare: choose a ${blocker.chain} store`,
                          )
                        : tr(
                            `Vertailu: kirjaudu sisään ketjuun ${blocker.chain}`,
                            `Compare: sign in to ${blocker.chain}`,
                          )}
                    </button>
                  </p>
                )
              );
            })()}
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
            {!confirming && snapshot.quotedAt && !!rows.length && (
              <>
                {/* B7.1: one line says what is sent; the details open on request, so the
                    transfer button stays in view. */}
                <details
                  className="transfer-summary"
                  role="group"
                  aria-label={tr("Ennen siirtoa", "Before the transfer")}
                >
                  <summary>
                    {additions && sendable.length > 0 ? (
                      additions.length > 0 ? (
                        <>
                          <strong>
                            {tr(
                              "Lisäykset edellisen siirron jälkeen",
                              "Added since the last transfer",
                            )}
                          </strong>
                          {" · "}
                          {additions
                            .map((item) => `${item.name} × ${item.packs}`)
                            .join(", ")}
                        </>
                      ) : (
                        tr(
                          "Listan tuotemäärät eivät ole kasvaneet edellisestä siirrosta.",
                          "No additional quantities on this list since the last transfer.",
                        )
                      )
                    ) : sendable.length > 0 ? (
                      <>
                        <strong>
                          {count(
                            sendable.length,
                            fi,
                            ["tuote siirretään", "tuotetta siirretään"],
                            ["product will be sent", "products will be sent"],
                          )}
                        </strong>
                        {" · "}
                        {packCount(
                          sendable.reduce((n, line) => n + line.packs, 0),
                          state.language,
                        )}
                      </>
                    ) : (
                      <strong>
                        {tr(
                          "Ei siirrettäviä tuotteita",
                          "No products ready to transfer",
                        )}
                      </strong>
                    )}
                    {leftOut.length > 0 &&
                      ` · ${leftOut.length} ${tr("jää pois", "left out")}`}
                    {snapshot.merchandise.manual.length > 0 &&
                      ` · ${snapshot.merchandise.manual.length} ${tr("lisätään itse kaupassa", "to add at the store")}`}
                  </summary>
                  {estimated.length > 0 && (
                    <p className="muted">
                      {tr(
                        "Punnittavien tuotteiden hinnat ovat arvioita. Lopullinen paino ja hinta vahvistuvat kaupassa.",
                        "Weighed prices are estimates. Final weight and price are confirmed by the store.",
                      )}
                      {estimated.some((line) => !transferableLine(line)) &&
                        tr(
                          " Lisää kaupassa itse tuotteet, joiden kappalemäärää ei voida varmistaa.",
                          " Add products in the store yourself when their piece quantity cannot be verified.",
                        )}
                    </p>
                  )}
                  {additions && sendable.length > 0 && (
                    <>
                      {!!followUp?.previouslySent.length && (
                        <details>
                          <summary>
                            {tr(
                              "Siirretty aiemmin tältä listalta",
                              "Previously sent from this list",
                            )}{" "}
                            · {followUp.previouslySent.length}
                          </summary>
                          <ul>
                            {followUp.previouslySent.map((item) => (
                              <li key={item.productId}>
                                {item.name} × {item.packs}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                      {!sameVerifiedBatch && (
                        <p className="muted">
                          {tr(
                            "Kaupassa jäljellä olevat aiemmin siirretyt pakkaukset lasketaan mukaan. Korikone lisää vain puuttuvan määrän.",
                            "Packs from your previous transfer count toward this list if they’re still at the store. Korikone adds the remaining quantity.",
                          )}
                        </p>
                      )}
                    </>
                  )}
                  {leftOut.length > 0 && (
                    <p className="transfer-omissions">
                      <strong>
                        {tr("Jää pois siirrosta", "Left out of transfer")}
                      </strong>
                      {" · "}
                      {leftOut.join(", ")}
                    </p>
                  )}
                  {snapshot.merchandise.manual.length > 0 && (
                    <p>
                      <strong>
                        {tr("Lisää itse kaupassa", "Add at the store")}
                      </strong>
                      {" · "}
                      {snapshot.merchandise.manual
                        .map((item) => item.productName)
                        .join(", ")}
                    </p>
                  )}
                </details>
                {missing.length > 0 && (
                  <button
                    type="button"
                    className="text"
                    disabled={busy}
                    onClick={(event) => openReview(event.currentTarget)}
                  >
                    {tr("Tarkista tuotevaihtoehdot", "Review product options")}
                  </button>
                )}
                {state.household.budget > 0 &&
                  total > state.household.budget && (
                    <p role="status" className="warning">
                      {tr(
                        "Lista ylittää viikkobudjetin.",
                        "The list is over the weekly budget.",
                      )}
                    </p>
                  )}
                {transferFailed && (
                  <p role="alert" className="transfer-error">
                    {tr(
                      "Siirto ei valmistunut. Katso ilmoitus ja yritä uudelleen.",
                      "The transfer did not finish. Read the notice and try again.",
                    )}
                  </p>
                )}
              </>
            )}
            {!confirming && !!snapshot.quotedAt && sendable.length > 0 && (
              <button
                ref={transferButton}
                className="transfer-button"
                disabled={busy || !rows.length}
                onClick={async () => {
                  // An interrupted transfer is shown for recovery instead of a new review.
                  setTransferring(true);
                  setTransferFailed(false);
                  try {
                    if (
                      snapshot.journal?.status === "partial" ||
                      (await call("transferDisplayed", {
                        revision: state.revision,
                        quotedAt: snapshot.quotedAt,
                        batchKey: snapshot.transferBatchKey,
                        expectedAdditions: additions?.map(
                          ({ productId, packs }) => ({ productId, packs }),
                        ),
                      }))
                    )
                      setConfirming(true);
                    else setTransferFailed(true);
                  } finally {
                    setTransferring(false);
                  }
                }}
              >
                {transferring && (
                  <span role="status">
                    {tr(
                      "Tarkistetaan ja siirretään…",
                      "Checking and transferring…",
                    )}{" "}
                  </span>
                )}
                {sameVerifiedBatch ? (
                  isLive(state.context.providerId) ? (
                    tr("Avaa kauppa uudelleen", "Reopen store")
                  ) : (
                    tr("Näytä siirron tulos", "View transfer result")
                  )
                ) : additions ? (
                  state.reviewBeforeTransfer ? (
                    tr("Tarkista lisäykset", "Review additions")
                  ) : additions.length > 0 ? (
                    tr(
                      "Siirrä lisäykset kauppaan",
                      "Send additions to the store",
                    )
                  ) : (
                    tr(
                      "Täydennä puuttuvat määrät kauppaan",
                      "Top up missing quantities at the store",
                    )
                  )
                ) : state.reviewBeforeTransfer ? (
                  tr("Tarkista siirto", "Review transfer")
                ) : state.context.providerId === "s-kaupat" ? (
                  tr(
                    "Siirrä ja avaa S-kaupat-lista",
                    "Transfer and open S-kaupat list",
                  )
                ) : (
                  <>
                    {tr("Siirrä ja avaa", "Transfer and open")}{" "}
                    {state.context.providerId === "k-ruoka"
                      ? "K-Ruoan"
                      : tr("kaupan", "store")}{" "}
                    {tr("ostoskori", "basket")}
                  </>
                )}
                {!additions && !sameVerifiedBatch && (
                  <span>
                    {" "}
                    ·{" "}
                    {count(
                      sendable.length,
                      fi,
                      ["tuote", "tuotetta"],
                      ["product", "products"],
                    )}
                  </span>
                )}
                {!additions &&
                  !sameVerifiedBatch &&
                  (transferPrices.exact > 0 ||
                    transferPrices.approximate > 0) && (
                    <span className="transfer-total">
                      {" "}
                      ·{" "}
                      {transferPrices.approximate > 0 && tr("noin ", "about ")}
                      {money(transferPrices.exact + transferPrices.approximate)}
                    </span>
                  )}
              </button>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}
