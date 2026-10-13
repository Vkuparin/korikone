import {
  candidateSuitability,
  priceAlternatives,
  purchasable,
} from "../domain/matching";
import { packageAmount } from "../domain/package-content";
import { comparePriceAlternative } from "../domain/price-ranking";
import { currentOffer } from "../domain/prices";
import { matchingReasonLabel } from "./matching-reasons";
import { GroupedReview } from "./grouped-review";
import { RowCorrection } from "./row-correction";
import type { PlanningSnapshot } from "../application/planning";
import { planningActivityPending, planningPhaseLabel } from "./planning-status";
import { PlanningPreview, PlanningPreviewFocus } from "./planning-preview";
import React, { useCallback, useEffect, useRef, useState } from "react";
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
import { addGrocery } from "../domain/groceries";
import { editTargets, mealTargetId, rowTargetId } from "../domain/edits";
import { RowFind, type FindResult } from "./row-find";
import type { Unit } from "../domain/model";
import { unitLabel } from "./i18n";
import { ConfirmPanel } from "./confirm";
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

/** One line for the last edit, built from the operations the service applied. */
function editSummary(
  applied: NonNullable<Snapshot["edit"]> extends infer E
    ? E extends { applied: infer A }
      ? A
      : never
    : never,
  fi: boolean,
) {
  return applied
    .map((a) => {
      const unit = editUnit(a.unit, fi);
      switch (a.op) {
        case "addItem":
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
    })
    .join("; ");
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
                : `No price difference: ${price.unknownRows} ${price.unknownRows === 1 ? "row lacks" : "rows lack"} a comparable price.`}
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
}: {
  snapshot: Snapshot;
  language: string;
  busy: boolean;
  call: (method: string, input?: unknown) => Promise<boolean>;
  resubmit: (targetId: string) => void;
}) {
  const fi = language === "fi";
  const tr = (a: string, b: string) => (fi ? a : b);
  const edit = snapshot.edit;
  if (!edit && !snapshot.editUndoAvailable) return null;
  if (!edit) return null;
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
      </section>
    );
  return (
    <section className="edit-outcome" role="status" aria-live="polite">
      <p>
        <strong>
          {edit.status === "undone"
            ? tr("Muutos kumottu: ", "Change undone: ")
            : edit.status === "cleared"
              ? tr("Lista tyhjennetty: ", "List cleared: ")
              : edit.status === "resized"
                ? tr("Talouden koko muutettu: ", "Household size changed: ")
                : tr("Lista päivitetty: ", "List updated: ")}
        </strong>
        {edit.status === "cleared" && !edit.applied.length
          ? tr("kaikki rivit poistettu", "all rows removed")
          : editSummary(edit.applied, fi)}
      </p>
      <EditDetails delta={edit.delta} fi={fi} />
      {snapshot.editUndoAvailable && (
        <button
          className="secondary"
          type="button"
          disabled={busy}
          onClick={() =>
            void call("undoEdit", { revision: snapshot.state.revision })
          }
        >
          {tr("Kumoa", "Undo")}
        </button>
      )}
    </section>
  );
}

/** One operation's feedback, shared by the composer and its off-screen fallback. */
export type ComposerProgress = {
  active: boolean;
  finished: boolean;
  visible: boolean;
  label: string;
  elapsed: number;
  phase: string;
  cancellable: boolean;
  cancelling: boolean;
  cancel: () => void;
};

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
}: {
  snapshot: Snapshot;
  busy: boolean;
  call: (
    method: string,
    input?: unknown,
    options?: {
      preserveError?: boolean;
      onSuccess?: (value: Snapshot) => void;
    },
  ) => Promise<boolean>;
  save: (state: AppState) => Promise<boolean>;
  settings: (section?: SettingsSection) => void;
  staples: () => void;
  openStore: (chain: "k-ruoka" | "s-kaupat") => void;
  view?: "list" | "schedule" | "history";
  visible?: boolean;
  onProgress?: (progress: ComposerProgress | null) => void;
}) {
  const state = snapshot.state;
  const all = requirements(state, new Date(), true);
  const fi = state.language === "fi";
  const tr = (a: string, b: string) => (fi ? a : b);
  const [note, setNote] = useState(
    () => sessionStorage.getItem("shopping-note") ?? state.note,
  );
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
  const { insights, refresh: refreshInsights } = useInsights(snapshot);
  const [groceryError, setGroceryError] = useState(false);
  const [undo, setUndo] = useState<Record<string, string>>({});
  const [reviewRows, setReviewRows] = useState<Requirement[] | null>(null);
  const reviewOpener = useRef<HTMLButtonElement>(null);
  const listHeading = useRef<HTMLHeadingElement>(null);
  const closeReview = () => {
    setReviewRows(null);
    requestAnimationFrame(() =>
      (reviewOpener.current ?? listHeading.current)?.focus(),
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
  const setInstruction = (value: string) => {
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
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [transferFailed, setTransferFailed] = useState(false);
  // The refused-draft cause comes from the last planning event: a failed call returns no snapshot.
  const failureCause =
    livePlanning?.failureCause ?? snapshot.planning?.failureCause ?? null;
  // Seconds since the update started: honest activity when the provider returns only a whole reply.
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!working && !editWorking) {
      setElapsed(0);
      return;
    }
    const started = Date.now();
    const timer = setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [working, editWorking]);
  const editRunning = useRef(false);
  const targets = editTargets(state, new Date());
  const focusName =
    focusTarget === null
      ? null
      : (targets.rows.find((row) => row.targetId === focusTarget)?.name ??
        targets.meals.find((meal) => meal.targetId === focusTarget)?.name ??
        null);
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
  const [confirming, setConfirming] = useState(
    !!snapshot.journal &&
      (snapshot.journal.status === "partial" ||
        snapshot.journal.batchKey === snapshot.transferBatchKey),
  );
  const [transferring, setTransferring] = useState(false);
  // The list row whose details are open.
  const [opened, setOpened] = useState<string | null>(null);
  // The list column is as tall as the window below its current top, so the total and
  // transfer bar at its bottom stays in view however far the page is scrolled.
  useEffect(() => {
    const fit = () => {
      const el = panel.current;
      if (!el) return;
      if (window.matchMedia("(max-width: 900px)").matches) {
        el.style.maxHeight = "";
        el.dataset.flow = "true";
        return;
      }
      const top = Math.max(el.getBoundingClientRect().top, 12);
      const available = window.innerHeight - top - 12;
      const normalFlow = (footer.current?.offsetHeight ?? 0) + 180 > available;
      el.dataset.flow = String(normalFlow);
      el.style.maxHeight = normalFlow ? "" : `${available}px`;
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
  const changeNote = (value: string) => {
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
        },
        {
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
          ...(focus &&
          [...targets.rows, ...targets.meals].some(
            (target) => target.targetId === focus,
          )
            ? { focusTargetId: focus }
            : {}),
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
      else if (!clarification) {
        setInstruction("");
        setFocusTarget(null);
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
      setProgressVisible(
        box.height > 0 &&
          box.width > 0 &&
          box.top >= Math.max(0, headerBottom) &&
          box.bottom <= innerHeight &&
          box.left >= 0 &&
          box.right <= innerWidth,
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
  const progressFinished =
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
  const progressPhase = editWorking
    ? "editing"
    : (livePlanning?.phase ?? (working ? "starting" : "idle"));
  const progressLabel = editWorking
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
      elapsed,
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
    elapsed,
    progressPhase,
    progressCancellable,
    progressCancelling,
    cancelProgress,
  ]);
  useEffect(() => () => onProgress?.(null), [onProgress]);
  // The unsent replacement draft survives a detour to the current list.
  const savedDraft = useRef("");
  const newListButton = useRef<HTMLButtonElement>(null);
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
    setConfirmingNewList(false);
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
    changeNote("");
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
    setTransferFailed(false);
    setQrOpen(false);
    setConfirmingClear(false);
    setLivePlanning(null);
    setShowSavedDuringPlanning(false);
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
  /** Unsent composer text that clearing the list would discard. */
  const unsentText = composingEdit
    ? instruction.trim().length > 0
    : note.trim().length > 0 && note !== state.note;
  async function clearList() {
    setConfirmingClear(false);
    const applied = await call("clearList", { revision: state.revision });
    if (!applied) return;
    changeNote("");
    setInstruction("");
    setFocusTarget(null);
    setNewList(false);
    savedDraft.current = "";
    requestAnimationFrame(() => noteElement.current?.focus());
  }
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
  const rows = requirements(state);
  const unmatchedRequests = snapshot.committedIntents.filter(
    (intent) =>
      intent.status !== "resolved" &&
      (intent.intent.unresolvedReason !== null ||
        intent.reason === "missing-requirement"),
  );
  const money = (cents: number) =>
    new Intl.NumberFormat(fi ? "fi-FI" : "en-FI", {
      style: "currency",
      currency: "EUR",
    }).format(cents / 100);
  const total = snapshot.basket.reduce(
    (sum, line) => sum + (line.total ?? 0),
    0,
  );
  const prices = priceBreakdown(snapshot.basket);
  const estimated = snapshot.basket.filter(
    (line) => line.approximate && line.total !== null,
  );
  const transferable = snapshot.basket.filter(transferableLine).length;
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
        {insights && (
          <SpendingChart
            insights={insights}
            budget={state.household.budget}
            language={state.language}
          />
        )}
        {insights && (
          <LinkReview
            insights={insights}
            snapshot={snapshot}
            busy={busy}
            call={call}
            refresh={refreshInsights}
          />
        )}
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
              <p className="muted transfer-signal">
                {(() => {
                  const signal = transferSignal(snapshot, h.id);
                  return signal === "confirmed"
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
                })()}
              </p>
              <p>
                {h.note ||
                  h.meals
                    .map(
                      (m) =>
                        state.recipes.find((r) => r.id === m.recipeId)?.name,
                    )
                    .join(", ")}
              </p>
              <RepeatButton
                snapshot={snapshot}
                historyId={h.id}
                hasList={all.length > 0}
                busy={busy}
                call={call}
              />{" "}
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
        <h1>
          {tr("Mitä tällä viikolla syödään?", "What shall we eat this week?")}
        </h1>
        <RepeatSummary snapshot={snapshot} />
        {!all.length && !!state.listHistory.length && (
          <p className="repeat-last">
            <RepeatButton
              snapshot={snapshot}
              historyId={state.listHistory[0].id}
              hasList={false}
              busy={busy}
              call={call}
              label={tr(
                "Toista viimeksi kauppaan siirretty lista",
                "Repeat the list last transferred to the store",
              )}
            />
          </p>
        )}
        {!groups.length && !state.extras.length && (
          <p className="muted">
            {tr(
              "Kirjoita kuin jääkaapin oven lappuun. Ruoat, raaka-aineet tai toiveet.",
              "Write a note: meals, groceries or ideas for the week.",
            )}
          </p>
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
                onClick={() => {
                  setResetFailed(false);
                  setConfirmingNewList(true);
                }}
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
              onClick={() => {
                setResetFailed(false);
                setConfirmingNewList(true);
              }}
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
                setConfirmingNewList(false);
                requestAnimationFrame(() => newListButton.current?.focus());
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
              onClick={() => {
                setConfirmingNewList(false);
                requestAnimationFrame(() => newListButton.current?.focus());
              }}
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
            <label className="sr-only" htmlFor="shopping-note">
              {tr("Mitä haluaisit valmistaa?", "What would you like to cook?")}
            </label>
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
              <button
                className="chip store-chip"
                onClick={() => settings("stores")}
              >
                {state.context.storeName}
              </button>
            </div>
            <ModelSelector
              snapshot={snapshot}
              busy={busy}
              call={call}
              settings={() => settings("ai")}
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
                <span>{progressLabel}</span>
              </span>
              {progressActive && (
                <small
                  className={`muted note-elapsed ${!progressVisible ? "offscreen-progress" : ""}`}
                  aria-hidden="true"
                >
                  {elapsed} s
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
        <EditOutcome
          snapshot={snapshot}
          language={state.language}
          busy={busy || working || editWorking}
          call={call}
          resubmit={(targetId) => {
            setFocusTarget(targetId);
            void applyEdit(instruction, targetId);
          }}
        />
        <OfferIdeas
          snapshot={snapshot}
          busy={busy || working || editWorking}
          call={call}
          canAppend={(name) => note.trimEnd().length + name.length + 1 <= 10000}
          append={(name) => {
            setNewListDraft(true);
            changeNote(`${note.trimEnd()}${note.trim() ? "\n" : ""}${name}`);
            requestAnimationFrame(() => noteElement.current?.focus());
          }}
        />
        {updateFailed && !working && failureCause && !composingEdit && (
          <p className="muted" role="status" data-testid="failure-cause">
            {tr(
              "Tekoälyn vastaus ei läpäissyt tarkistusta",
              "The reply did not pass validation",
            )}
            {": "}
            {{
              json: tr(
                "vastaus ei ollut luettavaa JSONia",
                "the reply was not readable JSON",
              ),
              shape: tr(
                "vastauksen rakenne oli väärä",
                "the reply had the wrong structure",
              ),
              "recipe-id": tr(
                "reseptin tunniste oli virheellinen",
                "a recipe ID was invalid",
              ),
              "recipe-reference": tr(
                "ateria viittasi tuntemattomaan reseptiin",
                "a meal referred to an unknown recipe",
              ),
              classification: tr(
                "ryhmittely oli virheellinen",
                "a classification was invalid",
              ),
              "intents-missing": tr(
                "pyyntöjen luettelo puuttui",
                "the request list was missing",
              ),
              "intent-span": tr(
                "pyynnön kohta muistiinpanossa ei täsmännyt",
                "a request did not match the note",
              ),
              "intent-quantity": tr(
                "määrä oli virheellinen",
                "a quantity was invalid",
              ),
              "intent-target": tr(
                "pyyntö viittasi puuttuvaan riviin",
                "a request pointed at a missing row",
              ),
              "intent-coverage": tr(
                "kaikkia pyyntöjä ei ollut katettu",
                "not every request was covered",
              ),
              "assumed-side": tr(
                "ehdotettu lisuke ei sopinut pyyntöön",
                "a suggested side did not fit the request",
              ),
            }[failureCause.reason] ?? ""}
            {failureCause.path ? ` (${failureCause.path})` : ""}
            {". "}
            {tr(
              "Muistiinpanosi säilyi. Voit yrittää uudelleen tai muokata sitä.",
              "Your note was kept. You can try again or edit it.",
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
          {snapshot.developmentMode ? (
            tr(
              "Kehitystila käyttää paikallista testiaineistoa. Muistiinpanoa tai kuitteja ei lähetetä ChatGPT:lle.",
              "Development mode uses local fixtures. Your note and receipts are not sent to ChatGPT.",
            )
          ) : snapshot.ai.state === "connected" ? (
            composingEdit ? (
              tr(
                "Taio muutokset lähettää muutosohjeen, nykyisen listan ja talouden toiveet ChatGPT:lle.",
                "Update my shopping list sends your instruction, current list and household preferences to ChatGPT.",
              )
            ) : (
              tr(
                "Taio ostoslista lähettää muistiinpanon, siihen liittyvät reseptit ja talouden toiveet ChatGPT:lle.",
                "Create my shopping list sends your note, relevant recipes and household preferences to ChatGPT.",
              )
            )
          ) : (
            <>
              <span>
                {tr(
                  "Yhdistä ChatGPT, jotta muistiinpano muuttuu listaksi. Voit myös lisätä reseptejä ja tuotteita käsin.",
                  "Connect ChatGPT to turn your note into a list, or add recipes and groceries manually.",
                )}
              </span>{" "}
              <button className="text" onClick={() => settings("ai")}>
                {tr("Yhdistä", "Connect")}
              </button>
            </>
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
            <button
              className="secondary clear-list"
              disabled={busy || working || (!all.length && !state.note.trim())}
              onClick={() =>
                unsentText ? setConfirmingClear(true) : void clearList()
              }
            >
              {tr("Tyhjennä lista", "Clear list")}
            </button>
            <details className="list-menu">
              <summary aria-label={tr("Listan toiminnot", "List actions")}>
                ···
              </summary>
              <button className="text" onClick={() => void call("exportList")}>
                {tr("Tallenna tekstinä", "Save as text")}
              </button>
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
            </details>
          </div>
          {confirmingClear && (
            <div className="composer-confirm" role="alertdialog">
              <p>
                {tr(
                  "Kirjoittamasi keskeneräinen teksti hylätään, kun lista tyhjennetään. Tyhjennys voidaan kumota, mutta teksti ei palaa.",
                  "The unsent text you wrote is discarded when the list is cleared. Clearing can be undone, but the text will not come back.",
                )}
              </p>
              <button type="button" onClick={() => void clearList()}>
                {tr("Tyhjennä lista", "Clear list")}
              </button>
              <button
                className="secondary"
                type="button"
                autoFocus
                onClick={() => setConfirmingClear(false)}
              >
                {tr("Säilytä lista", "Keep the list")}
              </button>
            </div>
          )}
          {!all.length && (
            <p className="muted list-empty-note" role="status">
              {tr(
                "Lista on tyhjä. Lisää tuote, kirjoita uusi lista tai kumoa tyhjennys. Vakiotuotteet palaavat, kun päivität hinnat tai teet uuden listan.",
                "The list is empty. Add an item, write a new list or undo the clearing. Recurring items return when you update prices or make a new list.",
              )}
            </p>
          )}
          <form
            className="quick-add"
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const data = new FormData(form);
              try {
                const next = addGrocery(
                  state,
                  String(data.get("item")),
                  String(data.get("amount")),
                  String(data.get("unit")) as Unit | "kg" | "l",
                );
                setGroceryError(false);
                void save(next).then((ok) => {
                  if (ok) form.reset();
                });
              } catch {
                setGroceryError(true);
              }
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
              inputMode="decimal"
              defaultValue="1"
              required
            />
            <select
              name="unit"
              aria-label={tr("Tuotteen yksikkö", "Grocery unit")}
            >
              <option value="pcs">{tr("kpl", "pcs")}</option>
              <option value="g">g</option>
              <option value="kg">kg</option>
              <option value="ml">ml</option>
              <option value="l">l</option>
            </select>
            <button
              disabled={busy}
              aria-label={tr("Lisää tuote listaan", "Add grocery to list")}
            >
              +
            </button>
          </form>
          {groceryError && (
            <p role="alert">
              {tr(
                "Anna positiivinen määrä. Kilot ja litrat voivat sisältää enintään kolme desimaalia; grammat, millilitrat ja kappaleet ovat kokonaislukuja.",
                "Enter a positive amount. Kilograms and litres accept up to three decimal places; grams, millilitres and pieces must be whole numbers.",
              )}
            </p>
          )}
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
          {(missing.length > 0 || reviewRows !== null) && (
            <button
              ref={reviewOpener}
              type="button"
              className="text"
              aria-expanded={reviewRows !== null}
              aria-controls="optional-product-review"
              disabled={busy}
              onClick={() =>
                reviewRows
                  ? closeReview()
                  : setReviewRows(structuredClone(missing))
              }
            >
              {tr("Tarkista ratkaisemattomat rivit", "Review unresolved rows")}{" "}
              · {missing.length}
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
              />
            </div>
          )}
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
                      l.requirement.id === r.id &&
                      l.requirement.unit === r.unit,
                  );
                  const home = state.skipped.includes(key);
                  const step =
                    line?.product && !line.approximate
                      ? (packageAmount(line.product, r.unit) ?? 1) *
                        line.product.increment
                      : r.unit === "pcs"
                        ? 1
                        : 100;
                  const count =
                    line?.product && !line.approximate ? line.packs : r.amount;
                  // One shared eligibility filter and sort for the chosen price basis.
                  const best =
                    line?.product && line.total !== null
                      ? priceAlternatives(
                          r,
                          line.product,
                          line.candidates.filter((p) => purchasable(r, p)),
                          {
                            context: state.context,
                            preferences: state.categoryPreferences,
                            exclusions: exclusionTerms(
                              state.household.exclusions,
                            ),
                            productPreference: state.productPreference,
                            priceBasis: state.priceBasis,
                            sourceNote: state.note,
                            accepted: state.accepted[r.id] ?? [],
                          },
                        )[0]
                      : undefined;
                  const comparison =
                    best && line?.product
                      ? comparePriceAlternative(
                          r,
                          line.product,
                          best,
                          state.priceBasis,
                        )
                      : null;
                  const cheaper =
                    best && comparison ? { product: best, comparison } : null;
                  return (
                    <div
                      className={`grocery-row ${home ? "at-home" : ""} ${!home && (!line?.product || line.total === null) ? "unresolved" : ""} ${selected && r.sources.includes(selected) ? "highlighted" : ""}`}
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
                          line.matching.status !== "resolved" && (
                            <p className="warning">
                              {matchingReasonLabel(
                                line.matching.reason,
                                state.language,
                              )}
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
                        <small className="row-amount">
                          {r.amount} {unitLabel(r.unit, state.language)}
                        </small>
                        <button
                          className="text edit-with-instruction"
                          aria-label={`${tr("Muokkaa ohjeella", "Edit with instruction")}: ${r.name}`}
                          disabled={busy || working || editWorking}
                          onClick={() => editWithInstruction(rowTargetId(key))}
                        >
                          {tr("Muokkaa ohjeella", "Edit with instruction")}
                        </button>
                        {!home && !line?.product && (
                          <small className="warning">
                            {tr("Tuote puuttuu", "Needs a product")}
                          </small>
                        )}
                        {!home && !line?.product && (
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
                        <small>
                          {line?.product && !line.approximate
                            ? tr(
                                count === 1 ? "pakkaus" : "pakkausta",
                                count === 1 ? "pack" : "packs",
                              )
                            : unitLabel(r.unit, state.language)}
                        </small>
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
                  "Näitä pyyntöjä ei ole hinnoiteltu:",
                  "These requests are not priced:",
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
                {missing.length || snapshot.planningIncomplete
                  ? tr(
                      "Tunnettujen hintojen välisumma",
                      "Subtotal of known prices",
                    )
                  : tr("Arvio yhteensä", "Estimated total")}
              </span>
              <strong>
                {snapshot.quotedAt || !rows.length
                  ? estimated.length
                    ? `${money(prices.exact)} + ${tr("noin ", "about ")}${money(prices.approximate)}`
                    : money(total)
                  : tr("Ei hinnoiteltu", "Not priced")}
              </strong>
            </div>
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
                )}
              </p>
            ) : (
              rows.length > 0 && (
                <button
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
            {!confirming && !!rows.length && (
              <div
                className="transfer-summary"
                role="group"
                aria-label={tr("Ennen siirtoa", "Before the transfer")}
              >
                <p>
                  <strong>
                    {transferable}{" "}
                    {tr("tuotetta siirretään", "products will be sent")}
                  </strong>
                  {" · "}
                  {snapshot.basket
                    .filter(transferableLine)
                    .reduce((n, line) => n + line.packs, 0)}{" "}
                  {tr("pakkausta", "packs")}
                  {missing.length > 0 &&
                    ` · ${missing.length} ${tr("riviä jää pois (ei tuotetta)", "rows are left out (no product)")}`}
                </p>
                {missing.length > 0 && (
                  <p className="muted">
                    {missing
                      .slice(0, 6)
                      .map((r) => r.name)
                      .join(", ")}
                    {missing.length > 6 ? "…" : ""}
                  </p>
                )}
                {(prices.exact > 0 || estimated.length > 0) && (
                  <p className="muted">
                    {tr("Arvio", "Estimate")} {money(total)}
                    {state.household.budget > 0 &&
                      ` · ${tr("budjetti", "budget")} ${money(state.household.budget)}`}
                  </p>
                )}
                {state.household.budget > 0 &&
                  total > state.household.budget && (
                    <p role="status" className="warning">
                      {tr(
                        "Lista ylittää viikkobudjetin. Siirto ei vaadi erillistä vahvistusta.",
                        "The list is over the weekly budget. The transfer needs no separate confirmation.",
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
              </div>
            )}
            {!confirming && (
              <button
                className="transfer-button"
                disabled={busy || !rows.length || !transferable}
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
                {state.context.providerId === "s-kaupat" ? (
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
                <span>
                  {" "}
                  · {transferable} {tr("tuotetta", "products")}
                </span>
                {prices.exact > 0 && (
                  <span className="transfer-total">
                    {" "}
                    · {money(prices.exact)}
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
