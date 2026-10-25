import { starterThemeSchema } from "../domain/starter-ideas";
import {
  suggestStarterMeals,
  starterIdeasLimits,
  type StarterIdeas,
} from "../ai/starter-ideas";
import { lineMerchandiseStatus } from "../domain/matching";
import {
  noMerchandise,
  writesMerchandise,
  type ManualHandoff,
} from "../domain/merchandise";
import {
  METRICS_KEY,
  METRICS_LIMIT,
  operationMetricSchema,
  readMetrics,
  unresolvedReason,
  type OperationMetric,
  type OperationCounters,
} from "./metrics";
import { z } from "zod";
import {
  packageAmount,
  needsPackageCount,
  stockCubeName,
} from "../domain/package-content";
import { priceBasisSchema, rankProductPrices } from "../domain/price-ranking";
import {
  initialState,
  contextSchema,
  stateSchema,
  unitSchema,
  type AppState,
  type BasketLine,
  type Journal,
  type Product,
  type Review,
  type StoreContext,
  type Recipe,
  type Requirement,
} from "../domain/model";
import {
  requirements,
  exclusionTerms,
  applyPackSizes,
  transferableLine,
} from "../domain/planner";
import {
  ProviderRegistry,
  isLive,
  liveProviders,
  type FeeRange,
  type StoreProvider,
} from "../stores/provider";
import { compareBaskets, type Comparison } from "../domain/compare";
import { storeKey } from "../domain/changes";
import {
  ERROR_KEY,
  ERROR_LIMIT,
  errorLogSchema,
  type ErrorEntry,
} from "./errors";
import {
  PRICE_KEY,
  limitPrices,
  priceObservationsSchema,
  recordPrices,
  cheaperThanUsual,
  type PriceObservation,
} from "../domain/prices";
import { DemoProvider } from "../stores/demo";
import {
  matchRequirement,
  selectableCandidate,
  matchingPolicy,
  requirementQueryHints,
} from "../domain/matching";
import {
  rememberCategoryPreferenceSchema,
  editCategoryPreferenceSchema,
  forgetCategoryPreferenceSchema,
  resetCategoryPreferencesSchema,
  type CategoryPreference,
} from "../domain/preferences";
import { searchCandidates } from "../stores/candidates";
import {
  correctRowSchema,
  correctionKey,
  clearRowCorrections,
} from "../domain/corrections";
import {
  assertWritable,
  createReview,
  resumeReview,
  transfer,
} from "./transfer";
import type { AIStatus } from "../ai/connection";
import type { MealDraft } from "../ai/draft";
import { appearanceSchema } from "../domain/appearance";
import { pricingKey, restoredQuote, persistedQuoteSchema } from "./quotes";
import { PlanningLifecycle } from "./planning";
import { mapIntentResults } from "../domain/intents";
import { applyEditIntent, applyEdits } from "../domain/edits";
import { editDelta } from "../domain/edit-delta";
import { interpretEdit } from "../ai/edit";
import type { InferenceSession } from "../ai/provider";
import {
  suggestOfferIdeas,
  offerIdeaLimits,
  offerIdeaFacts,
} from "../ai/offers";
import { inferenceAppError } from "../ai/adapter-errors";
import { collectOffers } from "./offers";
import type { OfferIdeasView } from "./offer-ideas";
import {
  EDIT_UNDO_KEY,
  describeAmbiguities,
  editListRequestSchema,
  localEditRequestSchema,
  changedAlso,
  clearListRequestSchema,
  householdScaling,
  householdSizeRequestSchema,
  restoredPlan,
  editUndoSchema,
  editedPlan,
  undoEditRequestSchema,
  type EditStatus,
  type EditUndo,
} from "./edits";
import { PurchaseStore, type ReceiptImport } from "./purchases";
import {
  observationsApply,
  observedSummaries,
  purchaseAliases,
  purchaseStatistics,
  readMemory,
  recurrenceSuggestions,
  type Memory,
} from "../domain/memory";
import {
  actualPurchases,
  confirmedTransfers,
  decideLink,
  linkCandidates,
  linkStrong,
  sameGrocery,
} from "../domain/purchase-links";
import { repeatPlan, repeatResult, type RepeatResult } from "../domain/repeat";
import {
  ReceiptImportCoordinator,
  enrichPurchaseRequestSchema,
  receiptConsentActionSchema,
  type ReceiptAI,
  type ReceiptEnrichmentStatus,
} from "./receipt-import";
import {
  ReceiptIntake,
  type IntakeFile,
  type IntakeProgress,
  type IntakeResult,
} from "./receipt-intake";
import { sGroupStore } from "../receipts/parsers/s-group";
import { kGroupStore } from "../receipts/parsers/k-group";
import { purchaseLedgerSchema } from "../domain/purchases";
import {
  coordinatePlanning,
  planningRequestSchema,
  type PlanningDependencies,
  type PlanningResult,
} from "./coordinator";
export interface Storage {
  get(key: string): Promise<any>;
  set(key: string, value: unknown): Promise<any>;
  setMany?(entries: { key: string; value: unknown }[]): Promise<any>;
}
export class Service {
  private metricWrites: Promise<void> = Promise.resolve();
  async operationMetrics() {
    try {
      return readMetrics(await this.db.get(METRICS_KEY));
    } catch {
      return [];
    }
  }
  async recordOperation(input: unknown) {
    const parsed = operationMetricSchema.safeParse(input);
    if (!parsed.success) return;
    const write = this.metricWrites.then(async () => {
      const saved = await this.operationMetrics();
      await this.db.set(
        METRICS_KEY,
        [...saved, parsed.data].slice(-METRICS_LIMIT),
      );
    });
    // Telemetry storage must never fail an application operation.
    this.metricWrites = write.catch(() => {});
    await this.metricWrites;
  }
  async measureOperation<T>(
    kind: OperationMetric["kind"],
    operation: (counters: OperationCounters) => Promise<T>,
  ): Promise<T> {
    const started = performance.now();
    const counters: OperationCounters = {
      aiCalls: 0,
      repairCalls: 0,
      payloadCharacters: 0,
      searches: 0,
      resolverCalls: 0,
      unresolved: {},
    };
    let outcome: OperationMetric["outcome"] = "success";
    try {
      return await operation(counters);
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      outcome =
        code === "aiCancelled" ||
        code === "cancelled" ||
        (error instanceof Error && error.name === "AbortError")
          ? "cancelled"
          : code === "draftStale"
            ? "obsolete"
            : "failed";
      const reason =
        code === "invalidDraft"
          ? "invalid-output"
          : code === "incomplete" || code === "incompleteDraft"
            ? "incomplete"
            : kind === "pricing" && counters.searches > 0
              ? error instanceof z.ZodError
                ? "normalization"
                : "search-error"
              : undefined;
      if (reason)
        counters.unresolved[reason] = (counters.unresolved[reason] ?? 0) + 1;
      throw error;
    } finally {
      await this.recordOperation({
        ...counters,
        kind,
        outcome,
        latencyMs: Math.min(
          600_000,
          Math.max(0, Math.round(performance.now() - started)),
        ),
      });
    }
  }

  developmentMode = false;
  developmentScenario = "success";
  developmentRequests = 0;
  developmentModel: string | null = null;
  developmentModelCatalogueRequests = 0;
  developmentSignInCalls = 0;
  developmentAIProvider: string | null = null;
  state = initialState();
  planning = new PlanningLifecycle(() => this.state);
  private readyPlanning: PlanningResult | null = null;
  private commitUncertain = false;
  starterIdeas: StarterIdeas | null = null;
  async suggestStarterIdeas(
    input: unknown,
    session: (maxCalls: number) => Promise<InferenceSession>,
  ) {
    const { theme } = z
      .object({ theme: starterThemeSchema, consent: z.literal(true) })
      .strict()
      .parse(input);
    if (this.busy || this.transferPending) throw new Error("busy");
    const state = structuredClone(this.state);
    const avoid = [
      ...(this.starterIdeas?.names ?? []),
      ...state.meals.map(
        (m) => state.recipes.find((r) => r.id === m.recipeId)?.name ?? "",
      ),
    ]
      .filter(Boolean)
      .slice(0, 40);
    return this.measureOperation("interpretation", async (metrics) => {
      let inference: InferenceSession | null = null;
      try {
        inference = await session(starterIdeasLimits.calls);
        const names = await suggestStarterMeals(inference, theme, state, avoid);
        if (
          this.state.revision !== state.revision ||
          this.state.language !== state.language
        )
          throw new Error("draftStale");
        this.starterIdeas = { theme, names };
        return this.snapshot();
      } finally {
        metrics.aiCalls = inference?.callCount ?? 0;
        metrics.repairCalls = Math.max(0, (inference?.callCount ?? 0) - 1);
        metrics.payloadCharacters = inference?.payloadCharacters ?? 0;
      }
    });
  }
  async planShopping(input: unknown, session: PlanningDependencies["session"]) {
    if (this.commitUncertain) throw new Error("commitUnknown");
    if (this.busy || this.transferPending) throw new Error("busy");
    const request = planningRequestSchema.parse(input);
    const run = this.planning.start(request.prompt);
    this.readyPlanning = null;
    this.draft = null;
    this.draftRevision = null;
    return this.measureOperation("planning", async (metrics) => {
      const inference: {
        session: Awaited<ReturnType<PlanningDependencies["session"]>> | null;
      } = { session: null };
      let resolverBase: number | null = null;
      try {
        const result = await coordinatePlanning(run, {
          session: async (operation) => {
            inference.session = await session(operation);
            return inference.session;
          },
          provider: this.registry.get(run.sourceState().context.providerId),
          resolverEnabled: run.sourceState().resolverEnabled,
          // Read fresh for this request only when it asks for the usual: a deleted purchase,
          // interpretation or preference is already gone from this read.
          observedSummaries: observationsApply(request.prompt)
            ? observedSummaries(await this.memory())
            : [],
          onResolverStart: (calls) => {
            resolverBase = calls;
          },
        });
        run.assertCurrent();
        this.readyPlanning = structuredClone(result);
        for (const line of result.lines) {
          if (!line.product || line.total === null) {
            const reason = unresolvedReason(line, line.candidates);
            metrics.unresolved[reason] = (metrics.unresolved[reason] ?? 0) + 1;
          }
        }
        const missingRequests = result.intents.filter(
          (intent) => intent.intent.unresolvedReason !== null,
        ).length;
        if (missingRequests)
          metrics.unresolved["missing-request"] = missingRequests;
        return this.snapshot();
      } catch (error) {
        run.fail(error);
        throw error;
      } finally {
        const preview = run.snapshot();
        metrics.aiCalls = inference.session?.callCount ?? 0;
        metrics.payloadCharacters = inference.session?.payloadCharacters ?? 0;
        metrics.searches = preview.counters.searches;
        metrics.resolverCalls =
          resolverBase === null ? 0 : metrics.aiCalls - resolverBase;
        metrics.repairCalls = Math.max(
          0,
          (resolverBase ?? metrics.aiCalls) - 1,
        );
      }
    });
  }
  /** Internal commit handoff only. A stale or non-ready operation cannot expose the retained result. */
  planningResult(operationId: string): PlanningResult {
    const snapshot = this.planning.snapshot();
    if (
      !this.readyPlanning ||
      snapshot?.operationId !== operationId ||
      snapshot.phase !== "ready"
    )
      throw new Error("planningStale");
    return structuredClone(this.readyPlanning);
  }
  /** Commit accepts only the owned operation ID; state/prices/coverage come from the private result. */
  async commitPlanning(input: unknown) {
    const { operationId } = z
      .object({ operationId: z.uuid() })
      .strict()
      .parse(input);
    return this.writeState(async () => {
      if (this.busy || this.transferPending) throw new Error("busy");
      const run = this.planning.currentReady(operationId);
      const result = this.planningResult(operationId);
      try {
        if (!this.db.setMany) throw new Error("storageFailed");
        const next = stateSchema.parse({
          ...result.state,
          revision: this.state.revision + 1,
          appearance: this.state.appearance,
          calendar: this.state.calendar,
          language: this.state.language,
          history: this.archived(this.state),
        });
        const wanted = requirements(next);
        if (JSON.stringify(wanted) !== JSON.stringify(result.requirements))
          throw new Error("draftStale");
        const lines = new Map(
          result.lines.map((line) => [
            `${line.requirement.id}:${line.requirement.unit}`,
            line,
          ]),
        );
        const basket = wanted.map((requirement) => {
          const key = `${requirement.id}:${requirement.unit}`;
          const line = lines.get(key);
          if (line) return line;
          if (
            !result.coverage.some(
              (row) =>
                row.requirementKey === key && row.status === "bounded-out",
            )
          )
            throw new Error("invalidDraft");
          const missing = matchRequirement(requirement, [], {
            context: next.context,
            sourceNote: next.note,
          });
          missing.matching!.reason = "bounded-out";
          return missing;
        });
        const quote = persistedQuoteSchema.parse({
          operationId,
          key: pricingKey(next),
          context: next.context,
          basket,
          quotedAt: new Date().toISOString(),
          pickupFee: null,
        });
        if (!restoredQuote(quote, next)) throw new Error("invalidDraft");
        const previousState = await this.db.get("state");
        const previousQuote = await this.db.get("last-quote");
        const previousPrices = await this.db.get(PRICE_KEY);
        const validPrices = priceObservationsSchema.safeParse(
          previousPrices ?? [],
        );
        const observedPrices = recordPrices(
          validPrices.success ? validPrices.data : [],
          basket.flatMap((line) => line.candidates),
        );
        run.beginCommit(next);
        try {
          await this.db.setMany([
            { key: "state", value: next },
            { key: "last-quote", value: quote },
            { key: PRICE_KEY, value: observedPrices },
          ]);
        } catch (writeError) {
          let storedState: unknown, storedQuote: unknown, storedPrices: unknown;
          try {
            storedState = await this.db.get("state");
            storedQuote = await this.db.get("last-quote");
            storedPrices = await this.db.get(PRICE_KEY);
          } catch {
            this.commitUncertain = true;
            throw new Error("commitUnknown");
          }
          const confirmed = persistedQuoteSchema.safeParse(storedQuote);
          if (
            !confirmed.success ||
            confirmed.data.operationId !== operationId ||
            JSON.stringify(storedState) !== JSON.stringify(next) ||
            JSON.stringify(confirmed.data) !== JSON.stringify(quote) ||
            JSON.stringify(storedPrices) !== JSON.stringify(observedPrices)
          ) {
            if (
              JSON.stringify(storedState) === JSON.stringify(previousState) &&
              JSON.stringify(storedQuote) === JSON.stringify(previousQuote) &&
              JSON.stringify(storedPrices) === JSON.stringify(previousPrices)
            )
              throw writeError;
            this.commitUncertain = true;
            throw new Error("commitUnknown");
          }
          // The atomic pair is durable despite a lost acknowledgement; no write is retried.
        }
        this.state = next;
        this.observedPrices = observedPrices;
        this.basket = quote.basket;
        this.quotedAt = quote.quotedAt;
        this.pickupFee = quote.pickupFee;
        this.pricingError = null;
        this.review = null;
        this.comparison = null;
        this.transferException = null;
        this.readyPlanning = null;
        run.committed();
        return this.snapshot();
      } catch (error) {
        run.commitFailed();
        this.readyPlanning = null;
        throw error;
      }
    });
  }
  registry = new ProviderRegistry();
  basket: BasketLine[] = [];
  quotedAt: string | null = null;
  pricingError: string | null = null;
  journal: Journal | null = null;
  review: Review | null = null;
  busy = false;
  private transferPending = false;
  transferException: string | null = null;
  handoffError: string | null = null;
  developmentHandoffs: string[] = [];
  /** A newer release found by the daily update check; shown as a link, never downloaded. */
  update: { version: string; url: string } | null = null;
  ai: AIStatus = { state: "disconnected", email: "", error: null, models: [] };
  draft: MealDraft | null = null;
  recipeDraft: Recipe | null = null;
  private offerIdeas: OfferIdeasView | null = null;
  private offerIdeasContext = "";
  private offerIdeasController: AbortController | null = null;
  cancelOfferIdeas() {
    this.offerIdeasController?.abort();
    if (this.offerIdeasController)
      this.offerIdeas = { status: "error", code: "aiCancelled" };
  }
  async suggestOffers(
    input: unknown,
    session: (
      signal: AbortSignal,
      maxCalls: number,
    ) => Promise<InferenceSession>,
  ) {
    z.object({ consent: z.literal(true) })
      .strict()
      .parse(input);
    if (this.busy || this.transferPending || this.offerIdeasController)
      throw new Error("busy");
    const context = { ...this.state.context };
    const key = JSON.stringify(context);
    const controller = new AbortController();
    this.offerIdeasController = controller;
    this.offerIdeasContext = key;
    this.offerIdeas = { status: "loading" };
    const current = () => key === JSON.stringify(this.state.context);
    return this.measureOperation("offer-ideas", async (metrics) => {
      let inference: InferenceSession | null = null;
      try {
        const result = await collectOffers(
          this.registry.get(context.providerId),
          context,
          { signal: controller.signal, isCurrent: current },
        );
        if (result.status !== "ready") {
          this.offerIdeas =
            result.status === "error"
              ? {
                  status: "error",
                  code:
                    result.code === "cancelled" ? "aiCancelled" : result.code,
                }
              : { status: result.status };
        } else if (!result.offers.length) {
          this.offerIdeas = { status: "empty" };
        } else {
          inference = await session(controller.signal, offerIdeaLimits.calls);
          const ideas = await suggestOfferIdeas(
            inference,
            result.offers,
            this.state.language,
          );
          if (controller.signal.aborted) throw new Error("aiCancelled");
          if (!current()) throw new Error("contextChanged");
          // Recheck the private account and the referenced facts after inference latency.
          const fresh = await collectOffers(
            this.registry.get(context.providerId),
            context,
            { signal: controller.signal, isCurrent: current },
          );
          if (fresh.status !== "ready")
            throw new Error(
              fresh.status === "error"
                ? fresh.code
                : fresh.status === "signed-out"
                  ? "accountChanged"
                  : "storeUnavailable",
            );
          if (fresh.accountKey !== result.accountKey)
            throw new Error("accountChanged");
          const facts = new Map(
            offerIdeaFacts(fresh.offers).map((p) => [
              `${p.offerId}:${p.productId}`,
              p,
            ]),
          );
          if (
            ideas.some((idea) =>
              idea.products.some(
                (p) =>
                  JSON.stringify(facts.get(`${p.offerId}:${p.productId}`)) !==
                  JSON.stringify(p),
              ),
            )
          )
            throw new Error("contextChanged");
          this.offerIdeas = {
            status: "ready",
            ideas,
            truncated: result.truncated,
          };
        }
        return this.snapshot();
      } catch (error) {
        const safe = inferenceAppError(error);
        const code = controller.signal.aborted
          ? "aiCancelled"
          : !current()
            ? "contextChanged"
            : [
                  "notConnected",
                  "usageLimit",
                  "aiCancelled",
                  "accountChanged",
                  "modelUnavailable",
                  "modelsUnavailable",
                  "permissionMissing",
                  "storeUnavailable",
                  "storeBlocked",
                  "contextChanged",
                ].includes(safe.message)
              ? safe.message
              : "invalidDraft";
        this.offerIdeas = { status: "error", code };
        throw new Error(code);
      } finally {
        metrics.aiCalls = inference?.callCount ?? 0;
        metrics.repairCalls = Math.max(0, metrics.aiCalls - 1);
        metrics.payloadCharacters = inference?.payloadCharacters ?? 0;
        this.offerIdeasController = null;
      }
    });
  }
  draftRevision: number | null = null;
  draftNote = "";
  storeResults: StoreContext[] = [];
  contextOptions: {
    context: StoreContext;
    fulfillments: StoreContext["fulfillment"][];
  } | null = null;
  storeLogins: Record<string, string> = {};
  /** The last store comparison for the current list revision; never saved. */
  comparison: {
    revision: number;
    other: StoreContext;
    lines: BasketLine[];
    result: Comparison;
    fees: { a: FeeRange | null; b: FeeRange | null };
  } | null = null;
  /** Pickup fee range at the active store, when the store reports one. */
  pickupFee: FeeRange | null = null;
  private fees = new Map<string, { at: number; fee: FeeRange | null }>();
  controller: AbortController | null = null;
  private stateWrites: Promise<void> = Promise.resolve();
  private writeState<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.stateWrites.then(() => {
      if (this.commitUncertain) throw new Error("commitUnknown");
      return operation();
    });
    this.stateWrites = result.then(
      () => {},
      () => {},
    );
    return result;
  }
  /**
   * Development mode stands in for the stores' saved logins: a fixture sign-in is kept in the
   * profile, so a restart behaves like the real stores, which stay signed in between launches.
   */
  async fixtureLogin(chain: string, signedIn?: boolean) {
    const saved = ((await this.db.get("fixtureLogins")) ?? {}) as Record<
      string,
      boolean
    >;
    if (signedIn !== undefined)
      await this.db.set("fixtureLogins", { ...saved, [chain]: signedIn });
    return signedIn ?? !!saved[chain];
  }
  async setLanguage(input: unknown) {
    const language = z.enum(["fi", "en"]).parse(input);
    return this.writeState(async () => {
      const next = { ...this.state, language };
      await this.db.set("state", next);
      this.state = next;
      return this.snapshot();
    });
  }
  /**
   * Saves the free receipt text only if the saved text is still the one the edit started from.
   * An import or another save in between is `receiptTextStale`, so a stale editor can never
   * overwrite newer text silently. The shopping list, its revision and approval are untouched.
   */
  async setReceiptText(input: unknown) {
    const { text, base } = z
      .object({
        text: z.string().max(50_000),
        base: z.string().max(50_000),
      })
      .strict()
      .parse(input);
    return this.writeState(async () => {
      if (this.state.receiptText !== base) throw new Error("receiptTextStale");
      const next = { ...this.state, receiptText: text };
      await this.db.set("state", next);
      this.state = next;
      return this.snapshot();
    });
  }
  async setAIModel(input: unknown) {
    const aiModel = z.string().min(1).max(200).parse(input);
    return this.writeState(async () => {
      const next = { ...this.state, aiModel };
      await this.db.set("state", next);
      this.state = next;
      return this.snapshot();
    });
  }
  async setAppearance(input: unknown) {
    const appearance = appearanceSchema.parse(input);
    return this.writeState(async () => {
      const next = { ...this.state, appearance };
      await this.db.set("state", next);
      this.state = next;
      return this.snapshot();
    });
  }
  /** Purchase evidence lives beside the state, never inside it. */
  readonly purchases: PurchaseStore;
  readonly receipts: ReceiptImportCoordinator;
  /** Counts of the last purchase import; no receipt or order content. */
  purchaseImport:
    | { source: "orders"; added: number; updated: number; duplicate: number }
    | ({ source: "receipt" } & ReceiptImport)
    | {
        source: "legacy";
        added: number;
        updated: number;
        duplicate: number;
        /** Parts of the old text that are not a supported receipt; they stay saved as text. */
        unsupported: number;
      }
    | null = null;
  /**
   * Imports one receipt text into the purchase ledger. Local only: no AI request, catalogue
   * search or retailer call, and the shopping list, quote and revision are untouched.
   */
  async importReceiptText(input: unknown, ai: ReceiptAI | null = null) {
    const { text, format, keepOriginal, ocrPages } = z
      .object({
        text: z.string().min(1).max(50_000),
        format: z.enum(["pdf", "txt", "csv"]),
        keepOriginal: z.boolean().default(false),
        ocrPages: z.array(z.number().int().min(1).max(100)).max(100).optional(),
      })
      .strict()
      .parse(input);
    this.receiptEnrichment = null;
    const result = await this.receipts.import(text, format, {
      keepOriginal,
      ocrPages,
      ai,
    });
    this.purchaseImport = { source: "receipt", ...result.receipt };
    this.receiptEnrichment = result.enrichment;
    await this.confirmFromEvidence();
    return this.snapshot();
  }
  /** Outcome of the last enrichment step, as counts and a code. */
  receiptEnrichment: ReceiptEnrichmentStatus | null = null;
  /** Result of the last multi-file import: per-file outcomes, counts and the optional request. */
  receiptIntake: IntakeResult | null = null;
  private intakeRun: {
    operationId: string;
    controller: AbortController;
  } | null = null;
  /**
   * One import action over files the main process has checked. It runs beside planning, edits
   * and transfers and changes none of them: it reads no list, quote or store. Local saves come
   * first and stay whatever happens to the optional request. One action at a time.
   */
  async importReceiptFiles(
    files: IntakeFile[],
    options: {
      keepOriginal?: boolean;
      ai?: ReceiptAI | null;
      onProgress?: (progress: IntakeProgress) => void;
    } = {},
  ) {
    if (this.intakeRun) throw new Error("receiptIntakeBusy");
    if (!files.length) return this.snapshot();
    const run = {
      operationId: crypto.randomUUID(),
      controller: new AbortController(),
    };
    this.intakeRun = run;
    try {
      this.receiptIntake = await new ReceiptIntake(this.receipts).run(files, {
        operationId: run.operationId,
        keepOriginal: options.keepOriginal,
        ai: options.ai,
        signal: run.controller.signal,
        onProgress: options.onProgress,
      });
    } finally {
      this.intakeRun = null;
    }
    return this.snapshot();
  }
  /** Cancels the named import only. Files already saved stay saved. */
  cancelReceiptIntake(input: unknown) {
    const { operationId } = z
      .object({ operationId: z.uuid() })
      .strict()
      .parse(input);
    if (this.intakeRun?.operationId !== operationId)
      throw new Error("receiptIntakeStale");
    this.intakeRun.controller.abort();
    return this.snapshot();
  }
  /** The signal of the running import, for the one request it may make. */
  receiptIntakeSignal() {
    return this.intakeRun?.controller.signal;
  }
  /**
   * The answer to the invitation of the last import: enable for future imports, just this
   * import, or not now. The first two interpret that import's purchases in this same action.
   */
  async receiptConsentAction(input: unknown, ai: ReceiptAI | null) {
    const action = receiptConsentActionSchema.parse(input);
    const last = this.receiptIntake;
    if (
      !last?.invitation ||
      last.invitation.providerId !== action.providerId ||
      action.eventIds.some((id) => !last.eventIds.includes(id))
    )
      throw new Error("receiptIntakeStale");
    const enrichment = await this.receipts.consentAction(action, ai);
    this.receiptIntake = { ...last, invitation: null, enrichment };
    return this.snapshot();
  }
  /** Lets newly imported purchases confirm the transfers they belong to. */
  async applyPurchaseEvidence() {
    await this.confirmFromEvidence();
    return this.snapshot();
  }
  /** One explicit enrichment action for one purchase: at most one AI request, facts untouched. */
  async enrichPurchase(input: unknown, ai: ReceiptAI | null) {
    const { eventId, consent } = enrichPurchaseRequestSchema.parse(input);
    this.receiptEnrichment = await this.receipts.enrich(eventId, ai, consent);
    return this.snapshot();
  }
  async setReceiptConsent(input: unknown) {
    await this.receipts.setConsent(input);
    return this.snapshot();
  }
  async correctPurchase(input: unknown) {
    await this.receipts.correct(input);
    return this.snapshot();
  }
  async interpretPurchase(input: unknown) {
    await this.receipts.interpret(input);
    return this.snapshot();
  }
  async deletePurchase(input: unknown) {
    await this.purchases.delete(input);
    return this.snapshot();
  }
  /** The one read over preferences, purchases and transfers; recomputed on every call. */
  async memory(): Promise<Memory> {
    return readMemory(this.state, await this.purchases.ledger());
  }
  /** Derived, read-only views for History, suggestions and spending. Nothing here is saved. */
  async purchaseInsights(now = new Date()) {
    const ledger = await this.purchases.ledger();
    const memory = readMemory(this.state, ledger);
    return {
      ...purchaseAliases(memory),
      statistics: purchaseStatistics(memory, now),
      suggestions: recurrenceSuggestions(memory, now, {
        dismissed: ledger.dismissedSuggestions,
        existing: this.state.staples.map((s) => s.name),
      }),
      observedSummaries: observedSummaries(memory),
      actualPurchases: actualPurchases(ledger),
      transfers: memory.transfers,
      linkReview: linkCandidates(ledger, memory.transfers).filter(
        (c) => c.strength === "review",
      ),
      confirmedTransfers: confirmedTransfers(ledger).map(
        ({ transferId, eventId, by, purchasedAt }) => ({
          transferId,
          eventId,
          by,
          purchasedAt,
        }),
      ),
    };
  }
  async dismissSuggestion(input: unknown) {
    const { key } = z
      .object({ key: z.string().min(1).max(300) })
      .strict()
      .parse(input);
    await this.purchases.serialize(async () => {
      const ledger = await this.purchases.ledger();
      await this.purchases.write({
        ...ledger,
        dismissedSuggestions: [
          ...ledger.dismissedSuggestions.filter((d) => d.key !== key),
          { key, at: new Date().toISOString() },
        ].slice(-500),
      });
    });
    return this.snapshot();
  }
  /** The shopper's answer to a review candidate; a confirmed transfer then counts as purchased. */
  async decidePurchaseLink(input: unknown) {
    const { candidate, same } = z
      .object({
        candidate: z.discriminatedUnion("kind", [
          z
            .object({
              kind: z.literal("purchase"),
              eventIds: z.tuple([z.string().min(1), z.string().min(1)]),
            })
            .strict(),
          z
            .object({
              kind: z.literal("transfer"),
              transferId: z.string().min(1),
              eventId: z.string().min(1),
            })
            .strict(),
        ]),
        same: z.boolean(),
      })
      .strict()
      .parse(input);
    await this.purchases.serialize(async () =>
      this.purchases.write(
        decideLink(await this.purchases.ledger(), candidate, same),
      ),
    );
    await this.confirmFromEvidence();
    return this.snapshot();
  }
  /** What purchase evidence says about verified transfers after the last import or decision. */
  purchaseSignals: {
    transferId: string;
    eventId: string;
    /** `confirmed`: strong evidence or the shopper linked it. `review`: weaker, nothing changed. */
    strength: "confirmed" | "review";
  }[] = [];
  /**
   * Links new evidence by the strong rules and lets a linked completed purchase confirm its
   * transfer exactly once, advancing recurring items the purchase actually contains. A weak
   * match, a pending or cancelled order and an unlinked transfer confirm nothing.
   */
  private async confirmFromEvidence() {
    const linked = await this.purchases.serialize(async () => {
      const ledger = await this.purchases.ledger();
      const transfers = readMemory(this.state, ledger).transfers;
      const result = linkStrong(ledger, transfers);
      if (result.linked) await this.purchases.write(result.ledger);
      return result;
    });
    const confirmed = confirmedTransfers(linked.ledger);
    for (const transfer of confirmed) {
      if (await this.db.get(`ordered-${transfer.transferId}`)) continue;
      const confirmedAt = transfer.purchasedAt ?? new Date().toISOString();
      await this.db.set(`ordered-${transfer.transferId}`, {
        confirmedAt,
        by: "evidence",
        eventId: transfer.eventId,
      });
      const bought = (name: string) =>
        transfer.labels.some((label) => sameGrocery(name, label));
      if (
        this.state.staples.some(
          (s) =>
            bought(s.name) &&
            (!s.lastPurchased || s.lastPurchased < confirmedAt),
        ) &&
        !this.busy &&
        !this.transferPending
      )
        await this.save({
          ...this.state,
          staples: this.state.staples.map((s) =>
            bought(s.name) &&
            (!s.lastPurchased || s.lastPurchased < confirmedAt)
              ? { ...s, lastPurchased: confirmedAt }
              : s,
          ),
        });
    }
    this.purchaseSignals = [
      ...confirmed.map(({ transferId, eventId }) => ({
        transferId,
        eventId,
        strength: "confirmed" as const,
      })),
      ...linked.review.flatMap((c) =>
        c.kind === "transfer"
          ? [
              {
                transferId: c.transferId,
                eventId: c.eventId,
                strength: "review" as const,
              },
            ]
          : [],
      ),
    ];
  }
  /** Result of the last Repeat: what was reused and what could not be. Shown for its revision only. */
  repeat: RepeatResult | null = null;
  /**
   * Starts a new list from a verified transfer in history: its meals, recipes, groceries and row
   * choices, priced fresh at the selected store. No AI request and no retailer write; the transfer
   * of the repeated list needs its own approval as any list does.
   */
  async repeatList(input: unknown) {
    const { historyId, revision } = z
      .object({
        historyId: z.string().min(1),
        revision: z.number().int().nonnegative(),
      })
      .strict()
      .parse(input);
    return this.writeState(async () => {
      this.assertNoProvisionalTransfer();
      if (this.busy || this.transferPending) throw new Error("busy");
      if (revision !== this.state.revision) throw new Error("draftStale");
      const entry = this.state.listHistory.find((h) => h.id === historyId);
      if (!entry) throw new Error("historyMissing");
      const plan = repeatPlan(this.state, entry);
      const next = stateSchema.parse({
        ...this.state,
        ...plan.state,
        ...clearRowCorrections(this.state),
        requestIntents: [],
        history: this.archived(this.state),
        revision: this.state.revision + 1,
      });
      this.busy = true;
      try {
        const context = next.context;
        const basket = await this.price(context, next);
        const pickupFee = basket.length ? await this.readFee(context) : null;
        const quote = restoredQuote(
          persistedQuoteSchema.parse({
            key: pricingKey(next),
            context,
            basket,
            quotedAt: new Date().toISOString(),
            pickupFee,
          }),
          next,
        );
        if (!quote) throw new Error("draftStale");
        const saved = priceObservationsSchema.safeParse(
          (await this.db.get(PRICE_KEY)) ?? [],
        );
        const observedPrices = recordPrices(
          saved.success ? saved.data : [],
          basket.flatMap((line) => line.candidates),
        );
        await this.writeAtomically([
          { key: "state", value: next },
          {
            key: "last-quote",
            value: {
              key: quote.key,
              context: quote.context,
              basket: quote.basket,
              pickupFee: quote.pickupFee,
              quotedAt: quote.quotedAt,
            },
          },
          { key: PRICE_KEY, value: observedPrices },
        ]);
        this.planning.invalidateFor(next);
        this.state = next;
        this.observedPrices = observedPrices;
        this.basket = quote.basket;
        this.quotedAt = quote.quotedAt;
        this.pickupFee = quote.pickupFee;
        this.pricingError = null;
        this.review = null;
        this.comparison = null;
        this.transferException = null;
        this.repeat = repeatResult(next, entry, plan, quote.basket);
        return this.snapshot();
      } finally {
        this.busy = false;
      }
    });
  }
  /** The receipt screens' data; read on request, never part of the ordinary snapshot. */
  purchaseView() {
    return this.receipts.view(this.state.receiptText);
  }
  /**
   * The explicit import of the text saved by earlier releases. It is cut where a supported shop
   * name starts a row; each part that parses becomes a purchase and leaves the saved text, and
   * every other part stays there unchanged. Nothing is dated or bought by guesswork.
   */
  async importLegacyReceipts() {
    if (this.busy || this.transferPending) throw new Error("busy");
    const revision = this.state.revision;
    const parts: string[] = [];
    for (const line of this.state.receiptText.split("\n")) {
      if (
        !parts.length ||
        sGroupStore.test(line.trim()) ||
        kGroupStore.test(line.trim())
      )
        parts.push(line);
      else parts[parts.length - 1] += `\n${line}`;
    }
    const summary = { added: 0, updated: 0, duplicate: 0, unsupported: 0 };
    const kept: string[] = [];
    for (const part of parts) {
      if (!part.trim()) continue;
      const result = await this.purchases.importReceipt(part, "txt");
      summary[result.outcome]++;
      if (result.outcome === "unsupported") kept.push(part);
    }
    if (revision !== this.state.revision) throw new Error("draftStale");
    const receiptText = kept.join("\n").trim();
    if (receiptText !== this.state.receiptText)
      await this.save({ ...this.state, receiptText });
    this.purchaseImport = { source: "legacy", ...summary };
    await this.confirmFromEvidence();
    return this.snapshot();
  }
  /**
   * Reads the signed-in S-kaupat account's orders and keeps them as purchase evidence. Read-only
   * at the retailer: no cart, list, order or payment call, and no AI request.
   */
  async importOrders() {
    if (this.busy || this.transferPending) throw new Error("busy");
    const provider = this.registry
      .all()
      .find(
        (p) =>
          ["s-kaupat", "demo-s"].includes(p.id) &&
          p.capabilities.orderHistory &&
          (p.id === this.state.context.providerId || p.id === "s-kaupat"),
      );
    if (!provider?.orderHistory) throw new Error("ordersUnavailable");
    if (isLive(provider.id) && this.storeLogins[provider.id] !== "signedIn")
      throw new Error("ordersUnavailable");
    const orders = await provider.orderHistory(50);
    this.purchaseImport = {
      source: "orders",
      ...(await this.purchases.importOrders(orders, "s-group")),
    };
    await this.confirmFromEvidence();
    return this.snapshot();
  }
  constructor(private db: Storage) {
    this.purchases = new PurchaseStore(db);
    this.receipts = new ReceiptImportCoordinator(this.purchases);
    this.registry.register(new DemoProvider("demo-k"));
    this.registry.register(new DemoProvider("demo-s"));
  }
  private observedPrices: PriceObservation[] = [];
  /** Adds the prices just read to the saved price history. A storage failure never stops pricing. */
  private recordPrices(products: Product[]) {
    return this.writeState(async () => {
      const saved = priceObservationsSchema.safeParse(
        (await this.db.get(PRICE_KEY)) ?? [],
      );
      const next = recordPrices(saved.success ? saved.data : [], products);
      await this.db.set(PRICE_KEY, next);
      this.observedPrices = next;
    }).catch(() => {});
  }
  /** The last 50 errors the shopper saw: a code, the time and the view. Nothing else is kept. */
  async recordError(input: unknown) {
    const { code, view } = z
      .object({ code: z.string().max(100), view: z.string().max(100) })
      .parse(input);
    const entry = {
      // Codes are short identifiers; anything else could carry text from a product or a note.
      code: /^[a-zA-Z]{1,40}$/.test(code) ? code : "operationFailed",
      time: new Date().toISOString(),
      view: /^[a-zA-Z]{1,20}$/.test(view) ? view : "unknown",
    };
    await this.writeState(async () => {
      const saved = await this.errorLog();
      await this.db.set(ERROR_KEY, [...saved, entry].slice(-ERROR_LIMIT));
    });
    return this.snapshot();
  }
  async errorLog(): Promise<ErrorEntry[]> {
    const saved = errorLogSchema.safeParse(
      (await this.db.get(ERROR_KEY)) ?? [],
    );
    return saved.success ? saved.data : [];
  }
  async priceHistory(): Promise<PriceObservation[]> {
    const saved = priceObservationsSchema.safeParse(
      (await this.db.get(PRICE_KEY)) ?? [],
    );
    return saved.success ? saved.data : [];
  }
  /**
   * The backup file: the saved state plus the price history and sanitized purchase records, which
   * earlier releases ignore. Retained receipt originals are included only on request.
   */
  async exportBackup(options: { includeOriginals?: boolean } = {}) {
    return {
      ...this.state,
      priceHistory: await this.priceHistory(),
      ...(await this.purchases.backup(options.includeOriginals === true)),
    };
  }
  /** Replaces the state and, when the file carries one, the price history. */
  async importBackup(raw: unknown) {
    const next = stateSchema.parse(raw);
    // Validate purchase records before anything is replaced; an old backup has none.
    if (raw && typeof raw === "object" && "purchases" in raw)
      purchaseLedgerSchema.parse(raw.purchases);
    const prices =
      raw && typeof raw === "object" && "priceHistory" in raw
        ? priceObservationsSchema.parse(raw.priceHistory)
        : null;
    await this.writeState(() =>
      this.saveState({ ...next, revision: this.state.revision }, true),
    );
    if (prices)
      await this.writeState(() => this.db.set(PRICE_KEY, limitPrices(prices)));
    this.observedPrices = await this.priceHistory();
    await this.purchases.restore(raw);
    return this.snapshot();
  }
  async init() {
    this.observedPrices = await this.priceHistory();
    const state = await this.db.get("state");
    if (state) this.state = stateSchema.parse(state);
    this.journal = await this.db.get("journal");
    if (this.journal?.status === "transferring") {
      this.journal.status = "partial";
      this.journal.error = "interrupted";
      await this.db.set("journal", this.journal);
    }
    for (const id of [
      "demo-k",
      "demo-s",
      ...(this.developmentMode ? ["k-ruoka", "s-kaupat"] : []),
    ]) {
      const carts = await this.db.get(id);
      if (carts) (this.registry.get(id) as DemoProvider).carts = new Map(carts);
    }
    const quote = restoredQuote(await this.db.get("last-quote"), this.state);
    if (quote) {
      this.basket = quote.basket.map((line) => ({
        ...line,
        candidates: rankProductPrices(
          line.requirement,
          line.candidates,
          this.state.priceBasis,
        ),
      }));
      this.pickupFee = quote.pickupFee;
      this.quotedAt = quote.quotedAt;
    }
    // An undo snapshot belongs to one revision; any later list change leaves it unusable.
    const undo = editUndoSchema.safeParse(await this.db.get(EDIT_UNDO_KEY));
    if (undo.success && undo.data.revision === this.state.revision) {
      this.undo = undo.data;
      this.edit = {
        status: "applied",
        revision: undo.data.revision,
        applied: undo.data.applied,
        delta: undo.data.delta,
      };
    }
  }
  /** Non-food rows that have a product and are not written to the store basket (F22.7). */
  private manualHandoff(): ManualHandoff[] {
    if (
      writesMerchandise(
        this.registry.get(this.state.context.providerId).capabilities
          .merchandise,
      )
    )
      return [];
    return this.basket.flatMap((line) =>
      line.requirement.merchandise && line.product && transferableLine(line)
        ? [
            {
              requirementKey: `${line.requirement.id}:${line.requirement.unit}`,
              name: line.requirement.name,
              productId: line.product.id,
              productName: line.product.name,
              packs: line.packs,
              total: line.total,
              reason: "unsupported-write" as const,
            },
          ]
        : [],
    );
  }
  private merchandiseView() {
    const capabilities =
      this.registry.get(this.state.context.providerId).capabilities
        .merchandise ?? noMerchandise;
    return {
      capabilities,
      /** Non-food rows with a product that no transfer sends; the shopper adds them. */
      manual: this.manualHandoff(),
      statuses: this.basket.flatMap((line) => {
        const status = lineMerchandiseStatus(line, capabilities);
        return status
          ? [
              {
                requirementKey: `${line.requirement.id}:${line.requirement.unit}`,
                status,
              },
            ]
          : [];
      }),
    };
  }
  snapshot() {
    const committedIntents = this.state.requestIntents.length
      ? mapIntentResults(
          this.state.requestIntents,
          requirements(this.state),
          this.basket,
          {
            complete: this.quotedAt !== null,
            settledKeys: [...this.state.skipped, ...this.state.removed],
          },
        )
      : [];
    return {
      developmentMode: this.developmentMode,
      developmentScenario: this.developmentScenario,
      developmentRequests: this.developmentRequests,
      developmentModel: this.developmentModel,
      developmentModelCatalogueRequests: this.developmentModelCatalogueRequests,
      developmentSignInCalls: this.developmentSignInCalls,
      developmentAIProvider: this.developmentAIProvider,
      developmentCatalogueRequests: this.developmentMode
        ? this.registry
            .all()
            .reduce(
              (sum, provider) =>
                sum +
                (provider instanceof DemoProvider
                  ? provider.searchRequests
                  : 0),
              0,
            )
        : 0,
      state: this.state,
      // empty: nothing to buy. quoted: prices are shown. failed: the last read failed.
      // unpriced: rows exist and nothing has been read for them; only the shopper starts that.
      pricingState: !requirements(this.state).length
        ? ("empty" as const)
        : this.quotedAt !== null
          ? ("quoted" as const)
          : this.pricingError
            ? ("failed" as const)
            : ("unpriced" as const),
      basket: this.basket,
      cheaperProductIds: this.basket.flatMap((line) =>
        line.product && cheaperThanUsual(line.product, this.observedPrices)
          ? [line.product.id]
          : [],
      ),
      quotedAt: this.quotedAt,
      pricingError: this.pricingError,
      journal: this.journal,
      review: this.review,
      transferException: this.transferException,
      handoffError: this.handoffError,
      transferBatchKey: this.batchKey(),
      developmentHandoffs: this.developmentHandoffs,
      developmentStoreWrites: this.developmentMode
        ? this.registry
            .all()
            .reduce(
              (sum, provider) =>
                sum + (provider instanceof DemoProvider ? provider.writes : 0),
              0,
            )
        : 0,
      storeResults: this.storeResults,
      contextOptions: this.contextOptions,
      storeLogin:
        this.storeLogins[this.state.context.providerId] ?? "notStarted",
      storeLogins: { ...this.storeLogins },
      comparison: this.comparison,
      pickupFee: this.pickupFee,
      ai: this.ai,
      update: this.update,
      draft: this.draft,
      recipeDraft: this.recipeDraft,
      starterIdeas: this.starterIdeas,
      offerIdeas:
        this.offerIdeasContext === JSON.stringify(this.state.context)
          ? this.offerIdeas
          : null,
      planning: this.planning.snapshot(),
      purchaseImport: this.purchaseImport,
      receiptEnrichment: this.receiptEnrichment,
      receiptIntake: this.receiptIntake,
      receiptIntakeRunning: this.intakeRun?.operationId ?? null,
      purchaseSignals: this.purchaseSignals,
      // A Repeat describes the revision it created only.
      repeat:
        this.repeat?.revision === this.state.revision ? this.repeat : null,
      // Both describe one revision only, so neither survives another list change.
      edit: this.edit?.revision === this.state.revision ? this.edit : null,
      editUndoAvailable: this.undo?.revision === this.state.revision,
      committedIntents,
      // Set by New list until the list changes again. `at` identifies the reset, so the screen
      // can drop everything it still shows of the earlier list exactly once.
      reset: this.reset?.revision === this.state.revision ? this.reset : null,
      // What the planner assumed for the current list, so it can be shown and changed: sides
      // added to dishes named alone, and amounts chosen for groceries named without one.
      proposal: {
        sides: this.state.meals.flatMap((meal) => {
          const recipe = this.state.recipes.find((r) => r.id === meal.recipeId);
          return recipe?.assumedSide
            ? [
                {
                  mealId: meal.id,
                  recipeId: recipe.id,
                  dish: recipe.name,
                  side: recipe.assumedSide,
                },
              ]
            : [];
        }),
        quantities: this.state.requestIntents.flatMap(
          ({ intent, requirementKeys }) =>
            intent.quantity?.provenance === "assumed" &&
            requirementKeys.length === 1 &&
            !this.state.removed.includes(requirementKeys[0])
              ? [
                  {
                    requirementKey: requirementKeys[0],
                    label: intent.label,
                    amount: intent.quantity.amount!,
                    unit: intent.quantity.unit!,
                  },
                ]
              : [],
        ),
      },
      // What the selected store can do for non-food rows, and the one statement each such row
      // supports (F22.6). Read from the quote only: no request is made to produce it.
      merchandise: this.merchandiseView(),
      planningIncomplete: committedIntents.some(
        (intent) => intent.status !== "resolved",
      ),
    };
  }
  private async saveState(input: unknown, allowCategoryPreferences = false) {
    if (this.busy || this.transferPending) throw new Error("busy");
    const next = this.validateSaveInput(input, allowCategoryPreferences);
    this.registry.get(next.context.providerId);
    if (next.revision !== this.state.revision) throw new Error("draftStale");
    next.language = this.state.language;
    for (const meal of next.meals)
      if (!next.recipes.some((r) => r.id === meal.recipeId))
        throw new Error("missingRecipe");
    // Scheduling is independent of the shopping list and its current approval.
    const previousShoppingState = {
      ...this.state,
      language: next.language,
      calendar: next.calendar,
      aiModel: next.aiModel,
      appearance: next.appearance,
      priceBasis: next.priceBasis,
      reviewBeforeTransfer: next.reviewBeforeTransfer,
    };
    const changed =
      JSON.stringify(previousShoppingState) !== JSON.stringify(next);
    if (changed) next.revision = this.state.revision + 1;
    const pricingChanged = pricingKey(next) !== pricingKey(this.state);
    const priceBasisChanged = next.priceBasis !== this.state.priceBasis;
    await this.db.set("state", next);
    this.state = next;
    if (priceBasisChanged) {
      // Alternatives are ranked by the chosen basis; any other save leaves the quote untouched.
      this.basket = this.basket.map((line) => ({
        ...line,
        candidates: rankProductPrices(
          line.requirement,
          line.candidates,
          next.priceBasis,
        ),
      }));
      this.planning.invalidate();
      this.readyPlanning = null;
    }
    if (changed) {
      this.review = null;
      this.comparison = null;
    }
    if (pricingChanged) {
      this.basket = [];
      this.pickupFee = null;
      this.quotedAt = null;
      this.pricingError = null;
    }
    return this.snapshot();
  }
  /** Read-only prequeue validation shares the ordinary save's intent/consent rules. */
  validateSaveInput(
    input: unknown,
    allowCategoryPreferences = false,
  ): AppState {
    if (
      !allowCategoryPreferences &&
      input &&
      typeof input === "object" &&
      (JSON.stringify((input as AppState).correctionHolds ?? []) !==
        JSON.stringify(this.state.correctionHolds) ||
        JSON.stringify((input as AppState).correctionChoices ?? []) !==
          JSON.stringify(this.state.correctionChoices))
    )
      throw new Error("correctionActionRequired");
    if (
      !allowCategoryPreferences &&
      input &&
      typeof input === "object" &&
      JSON.stringify((input as AppState).requestIntents ?? []) !==
        JSON.stringify(this.state.requestIntents)
    )
      throw new Error("intentActionRequired");
    const next = stateSchema.parse(
      input &&
        typeof input === "object" &&
        "note" in input &&
        input.note !== this.state.note &&
        !allowCategoryPreferences
        ? { ...input, requestIntents: [], ...clearRowCorrections(this.state) }
        : input,
    );
    if (
      !allowCategoryPreferences &&
      JSON.stringify(next.categoryPreferences) !==
        JSON.stringify(this.state.categoryPreferences)
    )
      throw new Error("preferenceActionRequired");
    return next;
  }
  async save(input: unknown) {
    return this.writeState(() => this.saveState(input));
  }
  /** Local setting only: current selections and approval stay fixed until explicit repricing. */
  async setPriceBasis(input: unknown) {
    const { priceBasis } = z
      .object({ priceBasis: priceBasisSchema })
      .strict()
      .parse(input);
    return this.writeState(() => this.saveState({ ...this.state, priceBasis }));
  }
  private saveNewList(state: AppState) {
    return this.writeState(() =>
      this.saveState(
        {
          ...state,
          requestIntents: [],
          recurringPaused: false,
          ...clearRowCorrections(this.state),
        },
        true,
      ),
    );
  }
  /** Memory changes are explicit, revision-bound operations; ordinary save cannot write them. */
  private changeCategoryPreferences(
    revision: number,
    change: (state: AppState) => {
      rules: CategoryPreference[];
      affected: string[];
      chosen?: { key: string; id: string };
    },
  ) {
    return this.refreshAfterChange(() =>
      this.writeState(async () => {
        if (this.busy || this.transferPending) throw new Error("busy");
        if (revision !== this.state.revision) throw new Error("draftStale");
        const { rules, affected, chosen } = change(this.state);
        const ids = requirements(this.state)
          .filter((r) => affected.includes(matchingPolicy(r).category ?? ""))
          .map((r) => r.id);
        const accepted = Object.fromEntries(
          Object.entries(this.state.accepted).filter(
            ([key]) => !ids.some((id) => key.endsWith(`:${id}`)),
          ),
        );
        if (chosen) accepted[chosen.key] = [chosen.id];
        return this.saveState(
          {
            ...this.state,
            categoryPreferences: rules,
            accepted,
            correctionHolds: chosen
              ? this.state.correctionHolds.filter(
                  (key) => !key.startsWith(`${chosen.key}:`),
                )
              : this.state.correctionHolds,
            correctionChoices: this.state.correctionChoices.filter(
              (key) => !ids.some((id) => key.endsWith(`:${id}`)),
            ),
          },
          true,
        );
      }),
    );
  }
  async rememberCategoryPreference(input: unknown) {
    const { revision, requirementKey, productId, preference } =
      rememberCategoryPreferenceSchema.parse(input);
    return this.changeCategoryPreferences(revision, (state) =>
      this.rememberedCategoryChange(
        state,
        requirementKey,
        productId,
        preference,
      ),
    );
  }
  private rememberedCategoryChange(
    state: AppState,
    requirementKey: string,
    productId: string,
    preference: CategoryPreference,
  ) {
    const line = this.basket.find(
      (l) => `${l.requirement.id}:${l.requirement.unit}` === requirementKey,
    );
    const product = line?.candidates.find((p) => p.id === productId);
    if (
      !line ||
      !product ||
      matchingPolicy(line.requirement).category !== preference.category ||
      !preference.qualifiers.every((q) =>
        product.evidence?.qualifiers.some(
          (fact) => fact.kind === q.kind && fact.value === q.value,
        ),
      ) ||
      !selectableCandidate(line.requirement, product, {
        preference,
        accepted: [productId],
        context: state.context,
        exclusions: exclusionTerms(state.household.exclusions),
      })
    )
      throw new Error("unresolved");
    return {
      rules: [
        ...state.categoryPreferences.filter(
          (p) => p.category !== preference.category,
        ),
        preference,
      ].sort((a, b) => a.category.localeCompare(b.category)),
      affected: [preference.category],
      chosen: {
        key: `${state.context.providerId}:${state.context.storeId}:${line.requirement.id}`,
        id: productId,
      },
    };
  }
  async editCategoryPreference(input: unknown) {
    const { revision, preference } = editCategoryPreferenceSchema.parse(input);
    return this.changeCategoryPreferences(revision, (state) => {
      if (
        !state.categoryPreferences.some(
          (p) => p.category === preference.category,
        )
      )
        throw new Error("preferenceMissing");
      return {
        rules: state.categoryPreferences.map((p) =>
          p.category === preference.category ? preference : p,
        ),
        affected: [preference.category],
      };
    });
  }
  async forgetCategoryPreference(input: unknown) {
    const { revision, category } = forgetCategoryPreferenceSchema.parse(input);
    return this.changeCategoryPreferences(revision, (state) => ({
      rules: state.categoryPreferences.filter((p) => p.category !== category),
      affected: state.categoryPreferences.some((p) => p.category === category)
        ? [category]
        : [],
    }));
  }
  async resetCategoryPreferences(input: unknown) {
    const { revision } = resetCategoryPreferencesSchema.parse(input);
    return this.changeCategoryPreferences(revision, (state) => ({
      rules: [],
      affected: state.categoryPreferences.map((p) => p.category),
    }));
  }
  private knownContext(input: unknown): StoreContext {
    const requested = contextSchema.parse(input);
    this.registry.get(requested.providerId);
    const known = [
      this.state.context,
      ...Object.values(this.state.stores),
      ...this.storeResults,
    ].find(
      (context) =>
        context.providerId === requested.providerId &&
        context.storeId === requested.storeId,
    );
    if (!known) throw new Error("storeUnavailable");
    return { ...known, fulfillment: requested.fulfillment };
  }
  private async supportedFulfillments(context: StoreContext) {
    const provider = this.registry.get(context.providerId);
    return z
      .array(z.enum(["pickup", "delivery"]))
      .parse(
        provider.fulfillments
          ? await provider.fulfillments(context)
          : ["pickup"],
      );
  }
  /** Opening a selector reads capabilities only; it never prices or interprets the note. */
  async getContextOptions(input?: unknown) {
    if (this.busy) throw new Error("busy");
    const revision = this.state.revision;
    const context = this.knownContext(input ?? this.state.context);
    const fulfillments = await this.supportedFulfillments(context);
    if (this.busy || revision !== this.state.revision)
      throw new Error("draftStale");
    this.contextOptions = { context, fulfillments };
    return this.snapshot();
  }
  /** Confirm a known store/fulfillment after pricing succeeds, before publishing any change. */
  async changeContext(input: unknown) {
    const requested = z
      .object({
        context: contextSchema,
        revision: z.number().int().nonnegative(),
      })
      .parse(input);
    if (this.busy) throw new Error("busy");
    return this.writeState(async () => {
      if (this.busy) throw new Error("busy");
      if (requested.revision !== this.state.revision)
        throw new Error("draftStale");
      const context = this.knownContext(requested.context);
      if (JSON.stringify(context) === JSON.stringify(this.state.context))
        return this.snapshot();
      this.busy = true;
      try {
        if (
          !(await this.supportedFulfillments(context)).includes(
            context.fulfillment,
          )
        )
          throw new Error("fulfillmentUnavailable");
        const next = stateSchema.parse({
          ...this.state,
          context,
          revision: this.state.revision + 1,
        });
        // A list that has never been priced is not searched just because its store changed.
        if (this.quotedAt === null) {
          await this.db.set("state", next);
          this.state = next;
          this.review = null;
          this.comparison = null;
          this.contextOptions = null;
          this.basket = [];
          this.pickupFee = null;
          this.pricingError = null;
          return this.snapshot();
        }
        const basket = await this.price(context, next);
        this.fees.delete(`${context.providerId}:${context.storeId}`);
        const pickupFee = basket.length ? await this.readFee(context) : null;
        await this.db.set("state", next);
        this.state = next;
        this.review = null;
        this.comparison = null;
        this.contextOptions = null;
        this.basket = [];
        this.pickupFee = null;
        this.quotedAt = null;
        this.pricingError = null;
        try {
          return await this.storeQuote(
            pricingKey(next),
            context,
            basket,
            pickupFee,
          );
        } catch {
          // The context is saved, but its cache is not durable. Return it honestly as unpriced.
          this.pricingError = "storageFailed";
          return this.snapshot();
        }
      } finally {
        this.busy = false;
      }
    });
  }
  async approveDraft() {
    if (!this.draft || this.draftRevision !== this.state.revision)
      throw new Error("draftStale");
    const result = await this.saveNewList({
      ...this.state,
      recipes: [...this.state.recipes, ...this.draft.recipes],
      meals: this.draft.meals.map((m) => ({ ...m, id: crypto.randomUUID() })),
      extras: this.draft.items,
      note: this.draftNote,
      assumptions: this.draft.notes,
      quantities: {},
      correctionHolds: [],
      removed: [],
      skipped: [],
    });
    this.draft = null;
    this.draftRevision = null;
    return { ...result, draft: null };
  }
  /** Keeps the current meals as the latest earlier week, skipping an identical copy. */
  private archived(state: AppState, at = new Date().toISOString()) {
    if (!state.meals.length) return state.history;
    const plan = (meals: AppState["meals"]) =>
      JSON.stringify(meals.map(({ id: _id, ...rest }) => rest));
    if (state.history[0] && plan(state.history[0].meals) === plan(state.meals))
      return state.history;
    return [{ savedAt: at, meals: state.meals }, ...state.history].slice(0, 12);
  }
  async newWeek() {
    if (this.busy) throw new Error("busy");
    return this.saveNewList({
      ...this.state,
      history: this.archived(this.state),
      meals: [],
      skipped: [],
      note: "",
      assumptions: "",
      extras: [],
      removed: [],
      quantities: {},
      correctionHolds: [],
      staples: this.state.staples.map((item) => ({ ...item, enabled: false })),
    });
  }
  async reuseWeek() {
    if (this.busy) throw new Error("busy");
    const last = this.state.history[0];
    if (!last) throw new Error("noEarlierWeek");
    const meals = last.meals.filter((m) =>
      this.state.recipes.some((r) => r.id === m.recipeId),
    );
    return this.saveNewList({
      ...this.state,
      meals: meals.map((m) => ({ ...m, id: crypto.randomUUID() })),
      note: "",
      assumptions: "",
      extras: [],
      removed: [],
      skipped: [],
      quantities: {},
      correctionHolds: [],
    });
  }
  async confirmPurchase() {
    if (this.busy || this.journal?.status !== "verified")
      throw new Error("reviewRequired");
    const run = this.journal.review.id;
    // An earlier confirmation, by the shopper or by purchase evidence, is kept as it is.
    const order = (await this.db.get(`ordered-${run}`)) ?? {
      confirmedAt: new Date().toISOString(),
      by: "manual",
    };
    const purchased = new Set(
      this.journal.review.quotes.map((line) => line.requirement.id),
    );
    const next = {
      ...this.state,
      history: this.archived(this.state, order.confirmedAt),
      staples: this.state.staples.map((item) =>
        purchased.has(item.id)
          ? { ...item, lastPurchased: order.confirmedAt }
          : item,
      ),
    };
    await this.db.set(`ordered-${run}`, order);
    await this.save(next);
    return this.snapshot();
  }
  /**
   * The shopper's explicit price update. Recurring items paused by Clear list join the list
   * again here, as a new revision, before prices are read.
   */
  async updatePrices() {
    if (this.busy || this.transferPending) throw new Error("busy");
    if (this.state.recurringPaused)
      await this.writeState(async () => {
        const next = stateSchema.parse({
          ...this.state,
          recurringPaused: false,
          revision: this.state.revision + 1,
        });
        await this.db.set("state", next);
        this.planning.invalidateFor(next);
        this.state = next;
        this.review = null;
      });
    return this.buildBasket();
  }
  async buildBasket() {
    if (this.busy || this.transferPending) throw new Error("busy");
    this.transferException = null;
    this.review = null;
    const context = this.state.context;
    const key = pricingKey(this.state);
    const basket = await this.price(context);
    await this.recordPrices(basket.flatMap((line) => line.candidates));
    const pickupFee = basket.length ? await this.readFee(context) : null;
    return this.retainQuote(key, context, basket, pickupFee);
  }
  private retainQuote(
    key: string,
    context: StoreContext,
    basket: BasketLine[],
    pickupFee: FeeRange | null,
  ) {
    return this.writeState(() =>
      this.storeQuote(key, context, basket, pickupFee),
    );
  }
  private async storeQuote(
    key: string,
    context: StoreContext,
    basket: BasketLine[],
    pickupFee: FeeRange | null,
  ) {
    if (key !== pricingKey(this.state)) throw new Error("draftStale");
    const quotedAt = new Date().toISOString();
    await this.db.set("last-quote", {
      key,
      context,
      basket,
      pickupFee,
      quotedAt,
    });
    this.basket = basket;
    this.pickupFee = pickupFee;
    this.quotedAt = quotedAt;
    this.pricingError = null;
    return this.snapshot();
  }
  /** Explicit list operations refresh incompatible quotes; opening a view never calls this. */
  async refreshAfterChange(
    operation: () => Promise<unknown>,
    options: { explicit?: boolean } = {},
  ) {
    const key = pricingKey(this.state);
    const before = this.state.context;
    const hadQuote = this.quotedAt !== null;
    await operation();
    // Choosing or connecting a store is not a request for prices. A list that was never priced
    // stays unpriced through it, until the shopper asks; a priced list follows its store.
    const storeOnly =
      key !== pricingKey(this.state) &&
      key === pricingKey({ ...this.state, context: before });
    if (storeOnly && !hadQuote && !options.explicit) return this.snapshot();
    if (key !== pricingKey(this.state)) {
      try {
        return await this.buildBasket();
      } catch (error) {
        // The list operation was already saved; show that list with unpriced rows.
        this.pricingError =
          error instanceof Error && /^[a-zA-Z]+$/.test(error.message)
            ? error.message
            : "operationFailed";
      }
    }
    return this.snapshot();
  }
  /** Fees change with the time of day, so a reading is reused for 15 minutes at most. A failed read is unknown. */
  private async readFee(context: StoreContext) {
    if (context.fulfillment !== "pickup") return null;
    const provider = this.registry.get(context.providerId);
    if (!provider.pickupFee) return null;
    const key = `${context.providerId}:${context.storeId}`;
    const cached = this.fees.get(key);
    if (cached && Date.now() - cached.at < 15 * 60_000) return cached.fee;
    const fee = await provider.pickupFee(context).catch(() => null);
    this.fees.set(key, { at: Date.now(), fee });
    return fee;
  }
  /** Read-only catalogue pricing for a supplied local plan; does not install a quote or save AppState. */
  async price(
    context: StoreContext,
    state = this.state,
  ): Promise<BasketLine[]> {
    return this.measureOperation("pricing", async (metrics) => {
      const provider = this.registry.get(context.providerId);
      const result = [];
      for (const requirement of requirements(state))
        result.push(
          await this.quoteRequirement(
            provider,
            context,
            state,
            requirement,
            metrics,
          ),
        );
      return result;
    });
  }
  /** One requirement's bounded catalogue read and local match. */
  private async quoteRequirement(
    provider: StoreProvider,
    context: StoreContext,
    state: AppState,
    requirement: Requirement,
    metrics: OperationCounters,
  ): Promise<BasketLine> {
    const accepted =
      state.accepted[
        `${context.providerId}:${context.storeId}:${requirement.id}`
      ] ?? [];
    const options = {
      accepted,
      preferences: state.categoryPreferences,
      holds: state.correctionHolds,
      exclusions: exclusionTerms(state.household.exclusions),
      productPreference: state.productPreference,
      priceBasis: state.priceBasis,
      context,
    };
    const products = applyPackSizes(
      await searchCandidates(provider, context, requirement, {
        queryHints: requirementQueryHints(requirement, options),
        onSearch: () => {
          metrics.searches++;
        },
        isHit: (product) =>
          selectableCandidate(
            requirement,
            applyPackSizes([product], state.packSizes)[0],
            options,
          ),
      }),
      state.packSizes,
    );
    const line = matchRequirement(requirement, products, options);
    if (!line.product || line.total === null) {
      const reason = unresolvedReason(line, products);
      metrics.unresolved[reason] = (metrics.unresolved[reason] ?? 0) + 1;
    }
    return line;
  }
  /**
   * Prices the list at the other chain's remembered store too, without changing either account,
   * the saved state, the review or the journal. Both chains must be signed in with a store chosen.
   */
  async compareStores() {
    if (this.busy) throw new Error("busy");
    const active = this.state.context;
    const otherId = liveProviders.find((id) => id !== active.providerId);
    const other = otherId ? this.state.stores[otherId] : undefined;
    if (
      !isLive(active.providerId) ||
      !other ||
      this.storeLogins[active.providerId] !== "signedIn" ||
      this.storeLogins[other.providerId] !== "signedIn"
    )
      throw new Error("compareUnavailable");
    const revision = this.state.revision;
    const hasQuote = this.quotedAt !== null;
    const key = pricingKey(this.state);
    const lines = hasQuote ? this.basket : await this.price(active);
    const otherLines = await this.price(other);
    const fees = {
      a: await this.readFee(active),
      b: await this.readFee(other),
    };
    // A list edited meanwhile makes the comparison stale; show none rather than a wrong one.
    if (this.state.revision !== revision || this.state.context !== active)
      throw new Error("draftStale");
    if (!hasQuote) await this.retainQuote(key, active, lines, fees.a);
    this.basket = lines;
    this.pickupFee = fees.a;
    this.comparison = {
      revision,
      other,
      lines: otherLines,
      result: compareBaskets(lines, otherLines),
      fees,
    };
    return this.snapshot();
  }
  /**
   * Saves the pack size the shopper read from the shelf or the product page for a product whose
   * label the store does not state, then prices the list again.
   */
  async setPackSize(input: unknown) {
    if (this.busy) throw new Error("busy");
    const { productId, amount, unit } = z
      .object({
        productId: z.string().min(1),
        amount: z.number().int().positive().max(1_000_000),
        unit: unitSchema,
      })
      .parse(input);
    const known = this.basket.some((l) =>
      l.candidates.some(
        (p) =>
          p.id === productId &&
          (!p.packAmount ||
            productId in this.state.packSizes ||
            needsPackageCount(p, l.requirement.unit)) &&
          (!(stockCubeName(p.name) && l.requirement.unit === "pcs") ||
            unit === "pcs"),
      ),
    );
    if (!known) throw new Error("unresolved");
    await this.save({
      ...this.state,
      packSizes: { ...this.state.packSizes, [productId]: { amount, unit } },
    });
    return this.buildBasket();
  }
  async accept(input: unknown) {
    if (this.busy) throw new Error("busy");
    const { ingredientId, productId } = z
      .object({ ingredientId: z.string(), productId: z.string() })
      .parse(input);
    const line = this.basket.find((l) => l.requirement.id === ingredientId);
    if (
      !line?.candidates.some(
        (p) =>
          p.id === productId &&
          selectableCandidate(line.requirement, p, {
            accepted: [productId],
            preferences: this.state.categoryPreferences,
            context: this.state.context,
            exclusions: exclusionTerms(this.state.household.exclusions),
          }),
      )
    )
      throw new Error("unresolved");
    const context = this.state.context;
    const chosen = () => ({
      ...this.state,
      correctionHolds: this.state.correctionHolds.filter(
        (key) => key !== correctionKey(context, line!.requirement),
      ),
      accepted: {
        ...this.state.accepted,
        [`${context.providerId}:${context.storeId}:${ingredientId}`]: [
          productId,
        ],
      },
    });
    // Without a quote there is nothing to reuse, and without an all-or-nothing write the row
    // and its quote cannot be saved together: the choice is then saved and priced as before.
    if (this.quotedAt === null || !this.db.setMany)
      return this.refreshAfterChange(() =>
        this.writeState(() => this.saveState(chosen(), true)),
      );
    // The product was read for this row with the quote on screen, so only this row changes:
    // it is matched again from its own candidates and every other row keeps its line. Nothing is
    // searched. Current prices are still checked before anything is sent to the store.
    return this.writeState(async () => {
      this.assertNoProvisionalTransfer();
      if (this.busy || this.transferPending) throw new Error("busy");
      const next = stateSchema.parse({
        ...chosen(),
        revision: this.state.revision + 1,
      });
      const rowKey = `${line!.requirement.id}:${line!.requirement.unit}`;
      const rows = new Map(
        this.basket.map((l) => [
          `${l.requirement.id}:${l.requirement.unit}`,
          l,
        ]),
      );
      const basket = requirements(next).map((requirement) => {
        const key = `${requirement.id}:${requirement.unit}`;
        const previous = rows.get(key);
        if (!previous) throw new Error("draftStale");
        if (key !== rowKey) return structuredClone(previous);
        return matchRequirement(
          requirement,
          applyPackSizes(previous.candidates, next.packSizes),
          {
            context: next.context,
            sourceNote: next.note,
            preferences: next.categoryPreferences,
            holds: next.correctionHolds,
            accepted: [productId],
            exclusions: exclusionTerms(next.household.exclusions),
            productPreference: next.productPreference,
            priceBasis: next.priceBasis,
          },
        );
      });
      const quote = restoredQuote(
        persistedQuoteSchema.parse({
          key: pricingKey(next),
          context: next.context,
          quotedAt: this.quotedAt,
          pickupFee: this.pickupFee,
          basket,
        }),
        next,
      );
      if (!quote) throw new Error("draftStale");
      await this.writeAtomically([
        { key: "state", value: next },
        {
          key: "last-quote",
          value: {
            key: quote.key,
            context: quote.context,
            basket: quote.basket,
            pickupFee: quote.pickupFee,
            quotedAt: quote.quotedAt,
          },
        },
      ]);
      this.planning.invalidateFor(next);
      this.state = next;
      this.basket = quote.basket;
      this.review = null;
      this.comparison = null;
      this.transferException = null;
      this.pricingError = null;
      return this.snapshot();
    });
  }
  /** Explicit correction changes a retained row, never a retailer cart or inference task. */
  async correctRow(input: unknown) {
    const correction = correctRowSchema.parse(input);
    return this.measureOperation("correction", async (metrics) => {
      metrics.corrections = { [correction.reason]: 1 };
      return this.writeState(async () => {
        this.assertNoProvisionalTransfer();
        if (this.busy || this.transferPending) throw new Error("busy");
        if (correction.revision !== this.state.revision || !this.quotedAt)
          throw new Error("draftStale");
        const line = this.basket.find(
          (l) =>
            `${l.requirement.id}:${l.requirement.unit}` ===
            correction.requirementKey,
        );
        if (!line) throw new Error("unresolved");
        const next = structuredClone(this.state);
        const rowKey = correctionKey(next.context, line.requirement);
        const acceptedKey = `${next.context.providerId}:${next.context.storeId}:${line.requirement.id}`;
        const affected = new Set([correction.requirementKey]);
        if (correction.reason === "wrong-quantity") {
          next.quantities[correction.requirementKey] = correction.amount;
        } else {
          const product =
            correction.replacementProductId === null
              ? null
              : line.candidates.find(
                  (p) => p.id === correction.replacementProductId,
                );
          if (correction.replacementProductId !== null && !product)
            throw new Error("unresolved");
          if (correction.remember && product) {
            const change = this.rememberedCategoryChange(
              next,
              correction.requirementKey,
              product.id,
              correction.remember,
            );
            next.categoryPreferences = change.rules;
            for (const requirement of requirements(next)) {
              const category = matchingPolicy(requirement).category;
              if (!category || !change.affected.includes(category)) continue;
              affected.add(`${requirement.id}:${requirement.unit}`);
              delete next.accepted[
                `${next.context.providerId}:${next.context.storeId}:${requirement.id}`
              ];
            }
          }
          delete next.accepted[acceptedKey];
          next.correctionChoices = next.correctionChoices.filter(
            (key) => key !== acceptedKey,
          );
          const supported =
            product &&
            selectableCandidate(line.requirement, product, {
              accepted: [product.id],
              preferences: next.categoryPreferences,
              context: next.context,
              sourceNote: next.note,
              exclusions: exclusionTerms(next.household.exclusions),
            });
          next.correctionHolds = next.correctionHolds.filter(
            (key) => key !== rowKey,
          );
          if (supported) {
            next.accepted[acceptedKey] = [product.id];
            if (!correction.remember) next.correctionChoices.push(acceptedKey);
          } else next.correctionHolds.push(rowKey);
        }
        next.revision++;
        const validated = stateSchema.parse(next);
        const oldRows = new Map(
          this.basket.map((l) => [
            `${l.requirement.id}:${l.requirement.unit}`,
            l,
          ]),
        );
        const basket = requirements(validated).map((requirement) => {
          const key = `${requirement.id}:${requirement.unit}`;
          const previous = oldRows.get(key);
          if (!previous) throw new Error("draftStale");
          if (!affected.has(key)) return structuredClone(previous);
          return matchRequirement(
            requirement,
            applyPackSizes(previous.candidates, validated.packSizes),
            {
              context: validated.context,
              sourceNote: validated.note,
              preferences: validated.categoryPreferences,
              holds: validated.correctionHolds,
              accepted:
                validated.accepted[
                  `${validated.context.providerId}:${validated.context.storeId}:${requirement.id}`
                ] ?? [],
              exclusions: exclusionTerms(validated.household.exclusions),
              productPreference: validated.productPreference,
              priceBasis: validated.priceBasis,
            },
          );
        });
        const quote = persistedQuoteSchema.parse({
          key: pricingKey(validated),
          context: validated.context,
          quotedAt: this.quotedAt,
          pickupFee: this.pickupFee,
          basket,
        });
        if (!restoredQuote(quote, validated)) throw new Error("draftStale");
        if (!this.db.setMany) throw new Error("storageFailed");
        const priorState = await this.db.get("state");
        const priorQuote = await this.db.get("last-quote");
        try {
          await this.db.setMany([
            { key: "state", value: validated },
            { key: "last-quote", value: quote },
          ]);
        } catch (error) {
          let storedState: unknown, storedQuote: unknown;
          try {
            storedState = await this.db.get("state");
            storedQuote = await this.db.get("last-quote");
          } catch {
            this.commitUncertain = true;
            throw new Error("commitUnknown");
          }
          if (
            JSON.stringify(storedState) !== JSON.stringify(validated) ||
            JSON.stringify(storedQuote) !== JSON.stringify(quote)
          ) {
            if (
              JSON.stringify(storedState) === JSON.stringify(priorState) &&
              JSON.stringify(storedQuote) === JSON.stringify(priorQuote)
            )
              throw error;
            this.commitUncertain = true;
            throw new Error("commitUnknown");
          }
        }
        this.planning.invalidateFor(validated);
        this.state = validated;
        this.basket = basket;
        this.review = null;
        this.comparison = null;
        this.pricingError = null;
        return this.snapshot();
      });
    });
  }
  /** The last edit outcome; shown only for the revision it belongs to. */
  edit: EditStatus | null = null;
  private undo: EditUndo | null = null;
  /** All entries are durable together, or none is; an unreadable outcome blocks further writes. */
  private async writeAtomically(entries: { key: string; value: unknown }[]) {
    if (!this.db.setMany) throw new Error("storageFailed");
    const same = (a: unknown, b: unknown) =>
      JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
    const prior: unknown[] = [];
    for (const entry of entries) prior.push(await this.db.get(entry.key));
    try {
      await this.db.setMany(entries);
    } catch (error) {
      const stored: unknown[] = [];
      try {
        for (const entry of entries) stored.push(await this.db.get(entry.key));
      } catch {
        this.commitUncertain = true;
        throw new Error("commitUnknown");
      }
      // Durable despite a lost acknowledgement; no write is retried.
      if (entries.every((entry, i) => same(stored[i], entry.value))) return;
      if (entries.every((_, i) => same(stored[i], prior[i]))) throw error;
      this.commitUncertain = true;
      throw new Error("commitUnknown");
    }
  }
  /**
   * Interprets one instruction against the current list and applies it atomically. Clarification,
   * failure, cancellation and a stale revision leave the saved list, quote and undo untouched.
   */
  async editList(input: unknown, session: () => Promise<InferenceSession>) {
    if (this.commitUncertain) throw new Error("commitUnknown");
    const { revision, instruction, focusTargetId } =
      editListRequestSchema.parse(input);
    this.assertNoProvisionalTransfer();
    if (this.busy || this.transferPending) throw new Error("busy");
    if (revision !== this.state.revision) throw new Error("draftStale");
    const source = structuredClone(this.state);
    const now = new Date();
    return this.measureOperation("edit", async (metrics) => {
      let inference: InferenceSession | null = null;
      try {
        inference = await session();
        const intent = await interpretEdit(
          inference,
          { instruction, ...(focusTargetId ? { focusTargetId } : {}) },
          source,
          now,
        );
        return await this.writeState(async () => {
          this.assertNoProvisionalTransfer();
          if (this.busy || this.transferPending) throw new Error("busy");
          if (source.revision !== this.state.revision)
            throw new Error("draftStale");
          const base = this.state;
          const quoted = this.quotedAt !== null;
          const key = (r: { id: string; unit: string }) => `${r.id}:${r.unit}`;
          const outcome = applyEditIntent(base, intent, {
            now,
            // A pack count means packs of the product the shopper currently sees on that row.
            packSizes: Object.fromEntries(
              (quoted ? this.basket : []).flatMap((line) =>
                line.product &&
                !line.approximate &&
                !line.product.pieceOrdering &&
                Number.isSafeInteger(
                  packageAmount(line.product, line.requirement.unit),
                ) &&
                packageAmount(line.product, line.requirement.unit)! > 0
                  ? [
                      [
                        key(line.requirement),
                        {
                          amount: packageAmount(
                            line.product,
                            line.requirement.unit,
                          )!,
                          unit: line.requirement.unit,
                        },
                      ],
                    ]
                  : [],
              ),
            ),
          });
          if (outcome.status === "clarification") {
            this.edit = {
              status: "clarification",
              revision: base.revision,
              ambiguities: describeAmbiguities(base, outcome.ambiguities, now),
              unsupported: outcome.unsupported,
            };
            return this.snapshot();
          }
          const next = stateSchema.parse({
            ...outcome.result.state,
            revision: base.revision + 1,
          });
          const context = next.context;
          const provider = this.registry.get(context.providerId);
          this.busy = true;
          try {
            const previous = new Map(
              (quoted ? this.basket : []).map((line) => [
                key(line.requirement),
                line,
              ]),
            );
            const changed = new Set(outcome.result.changedKeys);
            const searched: Product[] = [];
            let reused = 0;
            const lines: BasketLine[] = [];
            for (const requirement of requirements(next)) {
              const old = previous.get(key(requirement));
              if (old && !changed.has(key(requirement))) {
                reused++;
                lines.push({ ...structuredClone(old), requirement });
                continue;
              }
              const line = await this.quoteRequirement(
                provider,
                context,
                next,
                requirement,
                metrics,
              );
              searched.push(...line.candidates);
              lines.push(line);
            }
            const quotedAt = new Date().toISOString();
            // Retained rows keep their own reading time, so the quote stays as old as its oldest row.
            let quote = restoredQuote(
              persistedQuoteSchema.parse({
                key: pricingKey(next),
                context,
                basket: lines,
                quotedAt: reused && this.quotedAt ? this.quotedAt : quotedAt,
                pickupFee: reused
                  ? this.pickupFee
                  : lines.length
                    ? await this.readFee(context)
                    : null,
              }),
              next,
            );
            if (!quote && reused) {
              // A retained row no longer verifies against the edited plan: read everything again.
              const fresh: BasketLine[] = [];
              for (const requirement of requirements(next)) {
                fresh.push(
                  await this.quoteRequirement(
                    provider,
                    context,
                    next,
                    requirement,
                    metrics,
                  ),
                );
                searched.push(...fresh.at(-1)!.candidates);
              }
              quote = restoredQuote(
                persistedQuoteSchema.parse({
                  key: pricingKey(next),
                  context,
                  basket: fresh,
                  quotedAt,
                  pickupFee: fresh.length ? await this.readFee(context) : null,
                }),
                next,
              );
            }
            if (!quote) throw new Error("draftStale");
            const delta = editDelta(
              { state: base, basket: this.basket, quoted },
              { state: next, basket: quote.basket, quoted: true },
              now,
            );
            const undo = editUndoSchema.parse({
              version: 1,
              revision: next.revision,
              plan: editedPlan(base),
              also: changedAlso(base, next),
              quote: quoted
                ? {
                    key: pricingKey(base),
                    context: base.context,
                    basket: this.basket,
                    quotedAt: this.quotedAt,
                    pickupFee: this.pickupFee,
                  }
                : null,
              applied: outcome.result.applied,
              delta,
            });
            const saved = priceObservationsSchema.safeParse(
              (await this.db.get(PRICE_KEY)) ?? [],
            );
            const observedPrices = recordPrices(
              saved.success ? saved.data : [],
              searched,
            );
            await this.writeAtomically([
              { key: "state", value: next },
              {
                key: "last-quote",
                value: {
                  key: quote.key,
                  context: quote.context,
                  basket: quote.basket,
                  pickupFee: quote.pickupFee,
                  quotedAt: quote.quotedAt,
                },
              },
              { key: EDIT_UNDO_KEY, value: undo },
              { key: PRICE_KEY, value: observedPrices },
            ]);
            this.planning.invalidateFor(next);
            this.state = next;
            this.observedPrices = observedPrices;
            this.basket = quote.basket;
            this.quotedAt = quote.quotedAt;
            this.pickupFee = quote.pickupFee;
            this.pricingError = null;
            this.review = null;
            this.comparison = null;
            this.transferException = null;
            this.undo = undo;
            this.edit = {
              status: "applied",
              revision: next.revision,
              applied: undo.applied,
              delta,
            };
            return this.snapshot();
          } finally {
            this.busy = false;
          }
        });
      } finally {
        metrics.aiCalls = inference?.callCount ?? 0;
        metrics.repairCalls = Math.max(0, metrics.aiCalls - 1);
        metrics.payloadCharacters = inference?.payloadCharacters ?? 0;
      }
    });
  }
  /**
   * Applies edits that need no interpretation, using only the retained quote: a removed row or
   * dish, changed servings or quantity, or a row marked at home. Rows that did not change keep
   * their quoted line; rows whose amount changed are matched again from the products already
   * read. Nothing is searched: a row with no retained products stays unpriced until the shopper
   * asks for prices. No AI request and no retailer write.
   */
  async editLocally(input: unknown) {
    const { revision, operations } = localEditRequestSchema.parse(input);
    return this.writeState(async () => {
      this.assertLocalChange(revision);
      const now = new Date();
      const {
        state: edited,
        applied,
        changedKeys,
      } = applyEdits(
        this.state,
        { version: 1, revision, operations },
        { now, packSizes: this.quotedPackSizes() },
      );
      return this.commitLocal(edited, { applied, changedKeys, now });
    });
  }
  /**
   * Empties the current list: meals, extra items, the request text and the row choices made for
   * it. Recipes, history, purchases, settings, preferences and the recurring items themselves
   * stay. Recurring items add nothing to the cleared list until the next explicit price update
   * or new list. One local Undo restores the list and its quote. Nothing already sent to a
   * store is reversed, and no AI, catalogue or retailer call is made.
   */
  async clearList(input: unknown) {
    const { revision } = clearListRequestSchema.parse(input);
    return this.writeState(async () => {
      this.assertLocalChange(revision);
      const base = this.state;
      const now = new Date();
      const rows = requirements(base, now);
      // An already empty list has nothing to clear and nothing to undo.
      if (
        !rows.length &&
        !base.meals.length &&
        !base.extras.length &&
        !base.note &&
        !base.assumptions
      )
        return this.snapshot();
      const name = (recipeId: string) =>
        base.recipes.find((r) => r.id === recipeId)?.name ?? recipeId;
      return this.commitLocal(
        {
          ...base,
          meals: [],
          extras: [],
          skipped: [],
          removed: [],
          quantities: {},
          specifications: {},
          requestIntents: [],
          calendar: {},
          note: "",
          assumptions: "",
          recurringPaused: true,
        },
        {
          applied: base.meals.slice(0, 100).map((meal) => ({
            op: "removeMeal" as const,
            targetId: `meal:${meal.id}`,
            name: name(meal.recipeId),
            before: meal.servings,
            after: 0,
          })),
          status: "cleared",
          now,
        },
      );
    });
  }
  /**
   * New list: a complete, confirmed reset of the current shopping workspace. Unlike Clear list
   * it has no Undo and leaves no edit summary: meals, direct items, the request text and its
   * interpretation, row choices, the week plan's links to these meals, prices, comparison, any
   * unfinished planning run and any shown review all go. Recipes, earlier weeks, list history,
   * purchases, settings, the store, the household and the store's own basket stay, and so does
   * the transfer record. Recurring items add nothing until a new list is generated or prices
   * are updated. Local only: no AI, catalogue or retailer call.
   */
  async resetList(input: unknown) {
    const { revision } = clearListRequestSchema.parse(input);
    return this.writeState(async () => {
      if (this.commitUncertain) throw new Error("commitUnknown");
      // A write to the store in flight owns its evidence; the reset waits for it.
      if (
        this.transferPending ||
        (this.busy &&
          !!this.journal &&
          ["ready", "transferring"].includes(this.journal.status))
      )
        throw new Error("transferInProgress");
      if (this.busy) throw new Error("busy");
      if (revision !== this.state.revision) throw new Error("draftStale");
      const base = this.state;
      const calendar = Object.fromEntries(
        Object.entries(base.calendar).flatMap(([date, day]) =>
          day.leftovers ? [[date, { mealIds: [], leftovers: true }]] : [],
        ),
      );
      const cleared = stateSchema.parse({
        ...base,
        history: this.archived(base),
        meals: [],
        extras: [],
        skipped: [],
        removed: [],
        quantities: {},
        requestIntents: [],
        calendar,
        note: "",
        assumptions: "",
        recurringPaused: true,
        ...clearRowCorrections(base),
      });
      const changed = JSON.stringify(cleared) !== JSON.stringify(base);
      const next = changed
        ? stateSchema.parse({ ...cleared, revision: base.revision + 1 })
        : base;
      await this.writeAtomically([
        ...(changed ? [{ key: "state", value: next }] : []),
        { key: "last-quote", value: null },
        { key: EDIT_UNDO_KEY, value: null },
      ]);
      // An unfinished planning run is forgotten: its preview goes and a late reply finds no run.
      // Commits run in this same write queue, so none can be in progress here.
      this.planning.discard();
      this.state = next;
      this.basket = [];
      this.quotedAt = null;
      this.pickupFee = null;
      this.pricingError = null;
      this.review = null;
      this.comparison = null;
      this.transferException = null;
      this.undo = null;
      this.edit = null;
      this.repeat = null;
      this.draft = null;
      this.draftRevision = null;
      this.readyPlanning = null;
      this.reset = { revision: next.revision, at: new Date().toISOString() };
      return this.snapshot();
    });
  }
  /** The latest New list reset, while the list is still at the revision it produced. */
  private reset: { revision: number; at: string } | null = null;
  /** What `setHouseholdSize` would do to the current meals. Reads only; changes nothing. */
  previewHouseholdSize(input: unknown) {
    const { servings } = householdSizeRequestSchema
      .pick({ servings: true })
      .parse(input);
    return householdScaling(this.state, servings);
  }
  /**
   * Saves a new household size and scales the current meals that were planned for the old one.
   * A meal planned for another number of servings keeps it, a row quantity the shopper set
   * stays as set, and extra items, recipes and exclusions are untouched. Prices are recomputed
   * from the retained quote like any local edit; one local Undo restores size, meals and quote.
   */
  async setHouseholdSize(input: unknown) {
    const { revision, servings } = householdSizeRequestSchema.parse(input);
    return this.writeState(async () => {
      this.assertLocalChange(revision);
      const base = this.state;
      const scaling = householdScaling(base, servings);
      if (scaling.from === servings) return this.snapshot();
      const scaled = new Set(scaling.scaled.map((meal) => meal.mealId));
      return this.commitLocal(
        {
          ...base,
          household: { ...base.household, servings },
          meals: base.meals.map((meal) =>
            scaled.has(meal.id) ? { ...meal, servings } : meal,
          ),
        },
        {
          applied: scaling.scaled.slice(0, 100).map((meal) => ({
            op: "changeServings" as const,
            targetId: `meal:${meal.mealId}`,
            name: meal.name,
            before: meal.before,
            after: meal.after,
          })),
          status: "resized",
          now: new Date(),
        },
      );
    });
  }
  private assertLocalChange(revision: number) {
    this.assertNoProvisionalTransfer();
    if (this.busy || this.transferPending) throw new Error("busy");
    if (revision !== this.state.revision) throw new Error("draftStale");
  }
  /**
   * Saves a locally changed plan as the next revision with its undo snapshot, keeping what the
   * retained quote still proves. Call inside `writeState`.
   */
  private async commitLocal(
    edited: AppState,
    change: {
      applied: EditUndo["applied"];
      changedKeys?: string[];
      status?: "applied" | "cleared" | "resized";
      now: Date;
    },
  ) {
    const base = this.state;
    const { applied, now } = change;
    const quoted = this.quotedAt !== null;
    const key = (r: { id: string; unit: string }) => `${r.id}:${r.unit}`;
    const next = stateSchema.parse({
      ...edited,
      revision: base.revision + 1,
    });
    const wanted = requirements(next, now);
    const amounts = new Map(
      requirements(base, now).map((r) => [key(r), r.amount]),
    );
    const changedKeys =
      change.changedKeys ??
      wanted.filter((r) => amounts.get(key(r)) !== r.amount).map(key);
    let quote: ReturnType<typeof restoredQuote> = null;
    if (quoted) {
      const previous = new Map(
        this.basket.map((line) => [key(line.requirement), line]),
      );
      const changed = new Set(changedKeys);
      const options = (requirement: Requirement) => ({
        context: next.context,
        sourceNote: next.note,
        preferences: next.categoryPreferences,
        holds: next.correctionHolds,
        accepted:
          next.accepted[
            `${next.context.providerId}:${next.context.storeId}:${requirement.id}`
          ] ?? [],
        exclusions: exclusionTerms(next.household.exclusions),
        productPreference: next.productPreference,
        priceBasis: next.priceBasis,
      });
      const lines = wanted.map((requirement) => {
        const old = previous.get(key(requirement));
        if (!old) {
          // Nothing was ever read for this row; it is shown as not yet searched.
          const unsearched = matchRequirement(requirement, [], {
            context: next.context,
            sourceNote: next.note,
          });
          unsearched.matching!.reason = "bounded-out";
          return unsearched;
        }
        return changed.has(key(requirement))
          ? matchRequirement(
              requirement,
              applyPackSizes(old.candidates, next.packSizes),
              options(requirement),
            )
          : { ...structuredClone(old), requirement };
      });
      // The edited quote must verify like any restored quote; otherwise the list is unpriced.
      quote = restoredQuote(
        persistedQuoteSchema.parse({
          key: pricingKey(next),
          context: next.context,
          basket: lines,
          quotedAt: this.quotedAt,
          pickupFee: lines.length ? this.pickupFee : null,
        }),
        next,
      );
    }
    const delta = editDelta(
      { state: base, basket: this.basket, quoted },
      { state: next, basket: quote?.basket ?? [], quoted: quote !== null },
      now,
    );
    const undo = editUndoSchema.parse({
      version: 1,
      revision: next.revision,
      plan: editedPlan(base),
      also: changedAlso(base, next),
      quote: quoted
        ? {
            key: pricingKey(base),
            context: base.context,
            basket: this.basket,
            quotedAt: this.quotedAt,
            pickupFee: this.pickupFee,
          }
        : null,
      applied,
      delta,
    });
    await this.writeAtomically([
      { key: "state", value: next },
      ...(quote
        ? [
            {
              key: "last-quote",
              value: {
                key: quote.key,
                context: quote.context,
                basket: quote.basket,
                pickupFee: quote.pickupFee,
                quotedAt: quote.quotedAt,
              },
            },
          ]
        : []),
      { key: EDIT_UNDO_KEY, value: undo },
    ]);
    this.planning.invalidateFor(next);
    this.state = next;
    this.basket = quote?.basket ?? [];
    this.quotedAt = quote?.quotedAt ?? null;
    this.pickupFee = quote?.pickupFee ?? null;
    this.pricingError = null;
    this.review = null;
    this.comparison = null;
    this.transferException = null;
    this.undo = undo;
    this.edit = {
      status: change.status ?? "applied",
      revision: next.revision,
      applied,
      delta,
    };
    return this.snapshot();
  }
  /** Pack sizes of the products currently quoted, for edits that count packs. */
  private quotedPackSizes() {
    return Object.fromEntries(
      (this.quotedAt !== null ? this.basket : []).flatMap((line) =>
        line.product &&
        !line.approximate &&
        !line.product.pieceOrdering &&
        Number.isSafeInteger(
          packageAmount(line.product, line.requirement.unit),
        ) &&
        packageAmount(line.product, line.requirement.unit)! > 0
          ? [
              [
                `${line.requirement.id}:${line.requirement.unit}`,
                {
                  amount: packageAmount(line.product, line.requirement.unit)!,
                  unit: line.requirement.unit,
                },
              ],
            ]
          : [],
      ),
    );
  }
  /**
   * Restores the plan from before the last edit as a new revision. Local only: no AI, catalogue
   * or retailer call, and nothing already transferred to a retailer is reversed.
   */
  async undoEdit(input: unknown) {
    const { revision } = undoEditRequestSchema.parse(input);
    return this.writeState(async () => {
      this.assertNoProvisionalTransfer();
      if (this.busy || this.transferPending) throw new Error("busy");
      if (revision !== this.state.revision) throw new Error("draftStale");
      const undo = this.undo;
      if (!undo || undo.revision !== this.state.revision)
        throw new Error("undoUnavailable");
      const next = stateSchema.parse({
        ...restoredPlan(this.state, undo),
        revision: this.state.revision + 1,
      });
      // The earlier quote returns only if it still verifies; otherwise prices need a refresh.
      const quote = undo.quote
        ? restoredQuote(structuredClone(undo.quote), next)
        : null;
      const delta = editDelta(
        {
          state: this.state,
          basket: this.basket,
          quoted: this.quotedAt !== null,
        },
        { state: next, basket: quote?.basket ?? [], quoted: quote !== null },
      );
      await this.writeAtomically([
        { key: "state", value: next },
        ...(quote
          ? [
              {
                key: "last-quote",
                value: {
                  key: quote.key,
                  context: quote.context,
                  basket: quote.basket,
                  pickupFee: quote.pickupFee,
                  quotedAt: quote.quotedAt,
                },
              },
            ]
          : []),
        { key: EDIT_UNDO_KEY, value: null },
      ]);
      this.planning.invalidateFor(next);
      this.state = next;
      this.basket = quote?.basket ?? [];
      this.quotedAt = quote?.quotedAt ?? null;
      this.pickupFee = quote?.pickupFee ?? null;
      this.pricingError = null;
      this.review = null;
      this.comparison = null;
      this.transferException = null;
      this.undo = null;
      this.edit = {
        status: "undone",
        revision: next.revision,
        applied: [],
        delta,
      };
      return this.snapshot();
    });
  }
  /** "Already have this" from the basket: skip the requirement and rematch. */
  async omit(input: unknown) {
    if (this.busy) throw new Error("busy");
    const key = z.string().min(1).max(200).parse(input);
    if (
      !this.basket.some(
        (l) => `${l.requirement.id}:${l.requirement.unit}` === key,
      )
    )
      throw new Error("unresolved");
    return this.refreshAfterChange(() =>
      this.save({ ...this.state, skipped: [...this.state.skipped, key] }),
    );
  }
  assertNoProvisionalTransfer() {
    if (this.commitUncertain) throw new Error("commitUnknown");
    const operation = this.planning.snapshot();
    if (
      operation &&
      !["committed", "failed", "cancelled", "obsolete"].includes(
        operation.phase,
      )
    )
      throw new Error("planningPending");
  }
  async prepare(input?: unknown) {
    this.assertNoProvisionalTransfer();
    if (this.busy) throw new Error("busy");
    if (this.journal?.status === "partial") throw new Error("recoverFirst");
    // `reconcilePrices` is set by the one-click path only; a review asked for directly still
    // stops on a changed price.
    const { allowMissing, reconcilePrices } = z
      .object({
        allowMissing: z.boolean().default(false),
        reconcilePrices: z.boolean().default(false),
      })
      .parse(input ?? {});
    // A non-food row is sent only where a basket write is verified for such products. One that
    // has a product is handed to the shopper; it is neither sent nor reported as missing.
    const manual = this.manualHandoff();
    const handed = new Set(manual.map((m) => m.requirementKey));
    const writable = (line: BasketLine) =>
      transferableLine(line) &&
      !handed.has(`${line.requirement.id}:${line.requirement.unit}`) &&
      (!line.requirement.merchandise ||
        writesMerchandise(
          this.registry.get(this.state.context.providerId).capabilities
            .merchandise,
        ));
    const unresolved = this.basket.filter(
      (line) =>
        !writable(line) &&
        !handed.has(`${line.requirement.id}:${line.requirement.unit}`),
    );
    const unresolvedIntents = this.snapshot().committedIntents.filter(
      (intent) => intent.status !== "resolved",
    );
    if (unresolvedIntents.length && !allowMissing)
      throw new Error("unresolved");
    // Nothing on the list may be sent, and the reason is the hand-off, not a missing product.
    if (manual.length && !this.basket.some(writable) && !unresolved.length)
      throw new Error("manualOnly");
    this.review = await createReview(
      this.registry.get(this.state.context.providerId),
      this.state.context,
      this.state.revision,
      allowMissing
        ? this.basket.filter(writable)
        : this.basket.filter(
            (line) =>
              !handed.has(`${line.requirement.id}:${line.requirement.unit}`),
          ),
      this.state.packSizes,
      {
        exclusions: exclusionTerms(this.state.household.exclusions),
        preferences: this.state.categoryPreferences,
      },
      reconcilePrices,
    );
    this.review.unresolved = unresolved.map((line) => line.requirement);
    this.review.unresolvedIntents = unresolvedIntents;
    if (manual.length) this.review.manual = manual;
    if (this.review.priceChanges?.length)
      await this.reconcileQuote(this.review);
    return this.snapshot();
  }
  /**
   * The store's current prices for the same products and quantities replace the quoted ones, so
   * the list, its total and the transfer record all show what will actually be charged.
   */
  private async reconcileQuote(review: Review) {
    const key = (line: BasketLine) =>
      `${line.requirement.id}:${line.requirement.unit}`;
    const fresh = new Map(review.quotes.map((line) => [key(line), line]));
    // A saved quote is verified by recomputing each row from its candidates, so the candidate
    // carries the new price too. If another candidate would now rank first, the row keeps only
    // the product that was sent; the next price update reads the alternatives again.
    const reconciled = (only: boolean) =>
      this.basket.map((line) => {
        const current = fresh.get(key(line));
        if (!current?.product || current.total === line.total) return line;
        return {
          ...line,
          product: current.product,
          total: current.total,
          candidates: only
            ? [current.product]
            : line.candidates.map((p) =>
                p.id === current.product!.id ? current.product! : p,
              ),
        };
      });
    for (const only of [false, true]) {
      const quote = restoredQuote(
        persistedQuoteSchema.parse({
          key: pricingKey(this.state),
          context: this.state.context,
          basket: reconciled(only),
          pickupFee: this.pickupFee,
          quotedAt: this.quotedAt,
        }),
        this.state,
      );
      if (
        !quote ||
        quote.basket.some(
          (line) =>
            fresh.has(key(line)) && line.total !== fresh.get(key(line))!.total,
        )
      )
        continue;
      await this.db.set("last-quote", {
        key: quote.key,
        context: quote.context,
        basket: quote.basket,
        pickupFee: quote.pickupFee,
        quotedAt: quote.quotedAt,
      });
      this.basket = quote.basket;
      return;
    }
    // The reconciled rows cannot be verified as a saved quote: show them now, save nothing.
    this.basket = reconciled(true);
  }
  /** What a transfer click authorizes: store, products, packs and quantities, not their prices. */
  private bindingKey() {
    return JSON.stringify({
      context: this.state.context,
      lines: this.basket.map((line) => [
        line.requirement,
        line.product && [
          line.product.id,
          line.product.packAmount,
          line.product.unit,
          line.product.nativeUnit,
          line.product.increment,
          line.product.pieceOrdering ?? null,
          line.product.packageContent ?? null,
        ],
        line.packs,
      ]),
    });
  }
  /** Saves whether the transfer button first shows the review. Never changes the list or quote. */
  async setReviewBeforeTransfer(input: unknown) {
    const { enabled } = z
      .object({ enabled: z.boolean() })
      .strict()
      .parse(input);
    return this.writeState(async () => {
      if (this.busy || this.transferPending) throw new Error("busy");
      const next = stateSchema.parse({
        ...this.state,
        reviewBeforeTransfer: enabled,
      });
      await this.db.set("state", next);
      this.state = next;
      return this.snapshot();
    });
  }
  /** The initial click approves exactly the quoted batch, never a newly priced substitute. */
  private batchKey() {
    return JSON.stringify({
      context: this.state.context,
      ...(this.state.requestIntents.length
        ? { requestIntents: this.state.requestIntents }
        : {}),
      lines: this.basket.map((line) => [
        line.requirement,
        line.product && [
          line.product.id,
          line.product.price,
          line.product.deposit,
          line.product.packAmount,
          line.product.unit,
          line.product.nativeUnit,
          line.product.increment,
          ...(line.product.pieceOrdering
            ? [line.product.pieceOrdering, line.product.cataloguePricing]
            : []),
          ...(line.product.packageContent ? [line.product.packageContent] : []),
        ],
        line.packs,
        line.total,
      ]),
    });
  }
  async transferDisplayed(input: unknown) {
    this.assertNoProvisionalTransfer();
    const { revision, quotedAt, batchKey } = z
      .object({
        revision: z.number().int(),
        quotedAt: z.string(),
        batchKey: z.string(),
      })
      .parse(input);
    if (this.busy || this.transferPending) throw new Error("busy");
    if (
      revision !== this.state.revision ||
      quotedAt !== this.quotedAt ||
      batchKey !== this.batchKey()
    )
      throw new Error("draftStale");
    this.transferPending = true;
    this.transferException = null;
    this.review = null;
    try {
      if (this.journal?.status === "partial") {
        this.transferException = "recoverFirst";
        return this.snapshot();
      }
      if (
        this.journal?.status === "verified" &&
        this.journal.batchKey === this.batchKey()
      ) {
        const cart = await this.registry
          .get(this.state.context.providerId)
          .getCart(this.state.context);
        if (cart.accountId !== this.journal.review.baseline.accountId)
          throw new Error("accountChanged");
        return this.snapshot();
      }
      const binding = this.bindingKey();
      try {
        await this.prepare({ allowMissing: true, reconcilePrices: true });
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !["priceChanged", "unresolved", "manualOnly"].includes(error.message)
        )
          throw error;
        this.transferException = error.message;
        return this.snapshot();
      }
      // The click authorized these products and quantities at this store. A changed price is
      // reconciled and shown; anything else that moved is a stale request.
      if (
        revision !== this.state.revision ||
        quotedAt !== this.quotedAt ||
        binding !== this.bindingKey()
      ) {
        this.review = null;
        throw new Error("draftStale");
      }
      const review = this.review!;
      // Only a shopper who asked for it sees the review first. Otherwise rows left out, a budget
      // warning and items already in the store basket were shown with the button and need no
      // second approval.
      if (this.state.reviewBeforeTransfer) {
        this.transferException = "acknowledgeReview";
        return this.snapshot();
      }
      return await this.execute({ id: review.id, acknowledged: true }, true);
    } finally {
      this.transferPending = false;
    }
  }
  /** `sameClick` is set only by the one-click path, straight after its own review. */
  async execute(input: unknown, sameClick = false) {
    this.assertNoProvisionalTransfer();
    const { id, acknowledged } = z
      .object({ id: z.string(), acknowledged: z.boolean() })
      .parse(input);
    if (this.busy) throw new Error("busy");
    if (
      typeof id !== "string" ||
      !this.review ||
      this.review.id !== id ||
      this.review.revision !== this.state.revision
    )
      throw new Error("reviewRequired");
    // Confirming is the approval; only a budget overrun needs to be accepted explicitly.
    // Changed prices or packs already stop the review in createReview.
    if (this.review.total > this.state.household.budget && !acknowledged)
      throw new Error("acknowledgeReview");
    this.busy = true;
    this.controller = new AbortController();
    try {
      const provider = this.registry.get(this.review.context.providerId);
      // Checked before the journal is written, so a refused review leaves no transfer record.
      assertWritable(provider, this.review.quotes);
      const journal: Journal = {
        batchKey:
          this.journal?.status === "partial"
            ? this.journal.batchKey
            : this.batchKey(),
        review: this.review,
        status: "ready",
        verified: [],
        uncertain: null,
        error: null,
      };
      this.review = null;
      this.journal = journal;
      await this.db.set("journal", journal);
      // Each journal write must finish before the next retailer operation.
      this.journal = await transfer(
        provider,
        journal,
        async (j) => {
          this.journal = j;
          await this.db.set("journal", j);
          if (provider instanceof DemoProvider)
            await this.db.set(provider.id, [...provider.carts]);
        },
        this.controller.signal,
        this.state.packSizes,
        {
          exclusions: exclusionTerms(this.state.household.exclusions),
          preferences: this.state.categoryPreferences,
        },
        sameClick,
      );
      await this.db.set("journal", this.journal);
      if (provider instanceof DemoProvider)
        await this.db.set(provider.id, [...provider.carts]);
      if (this.journal.status === "verified") {
        await this.writeState(async () => {
          const next = {
            ...this.state,
            listHistory: [
              {
                id: this.journal!.review.id,
                date: new Date().toISOString(),
                note: this.state.note,
                meals: structuredClone(this.state.meals),
                recipes: structuredClone(
                  this.state.recipes.filter((r) =>
                    this.state.meals.some((m) => m.recipeId === r.id),
                  ),
                ),
                extras: structuredClone(this.state.extras),
                skipped: [...this.state.skipped],
                removed: [...this.state.removed],
                quantities: { ...this.state.quantities },
                storeKey: storeKey(this.journal!.review.context),
                transferred: this.journal!.review.targets.map((t) => ({
                  productId: t.productId,
                  name: t.name,
                  quantity: t.quantity - t.before,
                  unit: t.unit,
                  price:
                    t.quantity > t.before
                      ? Math.round(t.price / (t.quantity - t.before))
                      : 0,
                })),
                prices: Object.fromEntries(
                  this.journal!.review.quotes.flatMap((line) =>
                    line.product &&
                    this.journal!.review.targets.some(
                      (t) => t.productId === line.product!.id,
                    ) &&
                    line.product.price !== null
                      ? [[line.product.id, line.product.price]]
                      : [],
                  ),
                ),
              },
              ...this.state.listHistory.filter(
                (h) => h.id !== this.journal!.review.id,
              ),
            ].slice(0, 52),
          };
          await this.db.set("state", next);
          this.state = next;
        });
      }
      return this.snapshot();
    } finally {
      this.busy = false;
      this.controller = null;
    }
  }
  async recover() {
    if (this.busy || !this.journal || this.journal.status !== "partial")
      throw new Error("reviewRequired");
    if (
      JSON.stringify(this.state.context) !==
      JSON.stringify(this.journal.review.context)
    )
      throw new Error("contextChanged");
    this.review = await resumeReview(
      this.registry.get(this.journal.review.context.providerId),
      this.journal,
      this.state.packSizes,
      {
        exclusions: exclusionTerms(this.state.household.exclusions),
        preferences: this.state.categoryPreferences,
      },
    );
    this.review.revision = this.state.revision;
    this.review.unresolved = this.journal.review.unresolved;
    this.review.unresolvedIntents = this.journal.review.unresolvedIntents;
    if (this.journal.review.manual)
      this.review.manual = this.journal.review.manual;
    return this.snapshot();
  }
  async scenario(value: unknown) {
    if (this.busy) throw new Error("busy");
    const scenario = z
      .enum(["interrupt", "price", "catalogue", "context", "history"])
      .parse(value);
    if (scenario === "history") {
      // The weekly order sequence belongs to the S-kaupat stand-ins, whichever store is active.
      for (const id of ["s-kaupat", "demo-s"]) {
        let stand: unknown = null;
        try {
          stand = this.registry.get(id);
        } catch {
          // This profile has no such stand-in.
        }
        if (stand instanceof DemoProvider)
          stand.weeklyHistory = !stand.weeklyHistory;
      }
      return this.snapshot();
    }
    const provider = this.registry.get(this.state.context.providerId);
    if (!(provider instanceof DemoProvider)) throw new Error("unsupported");
    if (scenario === "interrupt") provider.failAfter = provider.writes + 1;
    else if (scenario === "price") provider.priceChange = !provider.priceChange;
    else if (scenario === "catalogue")
      provider.failSearch = !provider.failSearch;
    else provider.failContext = !provider.failContext;
    return this.snapshot();
  }
}
export type Snapshot = ReturnType<Service["snapshot"]>;
