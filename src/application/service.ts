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
} from "../domain/model";
import {
  requirements,
  exclusionTerms,
  applyPackSizes,
} from "../domain/planner";
import {
  ProviderRegistry,
  isLive,
  liveProviders,
  type FeeRange,
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
import { createReview, resumeReview, transfer } from "./transfer";
import type { AIStatus } from "../ai/connection";
import type { MealDraft } from "../ai/draft";
import { appearanceSchema } from "../domain/appearance";
import { pricingKey, restoredQuote } from "./quotes";
export interface Storage {
  get(key: string): Promise<any>;
  set(key: string, value: unknown): Promise<any>;
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
  developmentAIProvider: string | null = null;
  state = initialState();
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
    const result = this.stateWrites.then(operation);
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
  constructor(private db: Storage) {
    this.registry.register(new DemoProvider("demo-k"));
    this.registry.register(new DemoProvider("demo-s"));
  }
  /** Adds the prices just read to the saved price history. A storage failure never stops pricing. */
  private recordPrices(products: Product[]) {
    return this.writeState(async () => {
      const saved = priceObservationsSchema.safeParse(
        (await this.db.get(PRICE_KEY)) ?? [],
      );
      await this.db.set(
        PRICE_KEY,
        recordPrices(saved.success ? saved.data : [], products),
      );
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
  /** The backup file: the saved state plus the price history, which earlier releases ignore. */
  async exportBackup() {
    return { ...this.state, priceHistory: await this.priceHistory() };
  }
  /** Replaces the state and, when the file carries one, the price history. */
  async importBackup(raw: unknown) {
    const next = stateSchema.parse(raw);
    const prices =
      raw && typeof raw === "object" && "priceHistory" in raw
        ? priceObservationsSchema.parse(raw.priceHistory)
        : null;
    const saved = await this.writeState(() =>
      this.saveState({ ...next, revision: this.state.revision }, true),
    );
    if (prices)
      await this.writeState(() => this.db.set(PRICE_KEY, limitPrices(prices)));
    return saved;
  }
  async init() {
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
      this.basket = quote.basket;
      this.pickupFee = quote.pickupFee;
      this.quotedAt = quote.quotedAt;
    }
  }
  snapshot() {
    return {
      developmentMode: this.developmentMode,
      developmentScenario: this.developmentScenario,
      developmentRequests: this.developmentRequests,
      developmentModel: this.developmentModel,
      developmentModelCatalogueRequests: this.developmentModelCatalogueRequests,
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
      basket: this.basket,
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
    };
  }
  private async saveState(input: unknown, allowCategoryPreferences = false) {
    if (this.busy || this.transferPending) throw new Error("busy");
    const next = stateSchema.parse(input);
    if (
      !allowCategoryPreferences &&
      JSON.stringify(next.categoryPreferences) !==
        JSON.stringify(this.state.categoryPreferences)
    )
      throw new Error("preferenceActionRequired");
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
    };
    const changed =
      JSON.stringify(previousShoppingState) !== JSON.stringify(next);
    if (changed) {
      next.revision = this.state.revision + 1;
    }
    const pricingChanged = pricingKey(next) !== pricingKey(this.state);
    await this.db.set("state", next);
    this.state = next;
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
  async save(input: unknown) {
    return this.writeState(() => this.saveState(input));
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
          { ...this.state, categoryPreferences: rules, accepted },
          true,
        );
      }),
    );
  }
  async rememberCategoryPreference(input: unknown) {
    const { revision, requirementKey, productId, preference } =
      rememberCategoryPreferenceSchema.parse(input);
    return this.changeCategoryPreferences(revision, (state) => {
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
    });
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
    const result = await this.save({
      ...this.state,
      recipes: [...this.state.recipes, ...this.draft.recipes],
      meals: this.draft.meals.map((m) => ({ ...m, id: crypto.randomUUID() })),
      extras: this.draft.items,
      note: this.draftNote,
      assumptions: this.draft.notes,
      quantities: {},
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
    return this.save({
      ...this.state,
      history: this.archived(this.state),
      meals: [],
      skipped: [],
      note: "",
      assumptions: "",
      extras: [],
      removed: [],
      quantities: {},
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
    return this.save({
      ...this.state,
      meals: meals.map((m) => ({ ...m, id: crypto.randomUUID() })),
      note: "",
      assumptions: "",
      extras: [],
      removed: [],
      skipped: [],
      quantities: {},
    });
  }
  async confirmPurchase() {
    if (this.busy || this.journal?.status !== "verified")
      throw new Error("reviewRequired");
    const run = this.journal.review.id;
    const order = (await this.db.get(`ordered-${run}`)) ?? {
      confirmedAt: new Date().toISOString(),
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
  async refreshAfterChange(operation: () => Promise<unknown>) {
    const key = pricingKey(this.state);
    await operation();
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
  /** Prices the current list at a store, reading only: nothing saved, reviewed or journalled. */
  private async price(
    context: StoreContext,
    state = this.state,
  ): Promise<BasketLine[]> {
    return this.measureOperation("pricing", async (metrics) => {
      const provider = this.registry.get(context.providerId);
      const result = [];
      for (const requirement of requirements(state)) {
        const accepted =
          state.accepted[
            `${context.providerId}:${context.storeId}:${requirement.id}`
          ] ?? [];
        const options = {
          accepted,
          preferences: state.categoryPreferences,
          exclusions: exclusionTerms(state.household.exclusions),
          productPreference: state.productPreference,
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
        result.push(matchRequirement(requirement, products, options));
        const line = result[result.length - 1];
        if (!line.product || line.total === null) {
          const reason = unresolvedReason(line, products);
          metrics.unresolved[reason] = (metrics.unresolved[reason] ?? 0) + 1;
        }
      }
      return result;
    });
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
          (!p.packAmount || productId in this.state.packSizes),
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
    return this.refreshAfterChange(() =>
      this.save({
        ...this.state,
        accepted: {
          ...this.state.accepted,
          [`${context.providerId}:${context.storeId}:${ingredientId}`]: [
            productId,
          ],
        },
      }),
    );
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
  async prepare(input?: unknown) {
    if (this.busy) throw new Error("busy");
    if (this.journal?.status === "partial") throw new Error("recoverFirst");
    const { allowMissing } = z
      .object({ allowMissing: z.boolean().default(false) })
      .parse(input ?? {});
    const unresolved = this.basket.filter(
      (line) => !line.product || line.total === null,
    );
    this.review = await createReview(
      this.registry.get(this.state.context.providerId),
      this.state.context,
      this.state.revision,
      allowMissing
        ? this.basket.filter((line) => line.product && line.total !== null)
        : this.basket,
      this.state.packSizes,
      {
        exclusions: exclusionTerms(this.state.household.exclusions),
        preferences: this.state.categoryPreferences,
      },
    );
    this.review.unresolved = unresolved.map((line) => line.requirement);
    return this.snapshot();
  }
  /** The initial click approves exactly the quoted batch, never a newly priced substitute. */
  private batchKey() {
    return JSON.stringify({
      context: this.state.context,
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
        ],
        line.packs,
        line.total,
      ]),
    });
  }
  async transferDisplayed(input: unknown) {
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
      try {
        await this.prepare({ allowMissing: true });
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !["priceChanged", "unresolved"].includes(error.message)
        )
          throw error;
        this.transferException = error.message;
        return this.snapshot();
      }
      if (
        revision !== this.state.revision ||
        quotedAt !== this.quotedAt ||
        batchKey !== this.batchKey()
      ) {
        this.review = null;
        throw new Error("draftStale");
      }
      const review = this.review!;
      if (
        review.unresolved?.length ||
        review.total > this.state.household.budget ||
        review.targets.some((target) => target.before > 0)
      ) {
        this.transferException = "acknowledgeReview";
        return this.snapshot();
      }
      return await this.execute({ id: review.id, acknowledged: false });
    } finally {
      this.transferPending = false;
    }
  }
  async execute(input: unknown) {
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
    return this.snapshot();
  }
  async scenario(value: unknown) {
    if (this.busy) throw new Error("busy");
    const scenario = z
      .enum(["interrupt", "price", "catalogue", "context"])
      .parse(value);
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
