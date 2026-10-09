import { z } from "zod";
import {
  initialState,
  stateSchema,
  type AppState,
  type BasketLine,
  type Journal,
  type Review,
  type StoreContext,
} from "../domain/model";
import {
  requirements,
  match,
  exclusionTerms,
  relevant,
} from "../domain/planner";
import {
  ProviderRegistry,
  isLive,
  liveProviders,
  type FeeRange,
} from "../stores/provider";
import { compareBaskets, type Comparison } from "../domain/compare";
import { DemoProvider } from "../stores/demo";
import { createReview, resumeReview, transfer } from "./transfer";
import type { AIStatus } from "../ai/chatgpt";
import type { MealDraft } from "../ai/draft";
export interface Storage {
  get(key: string): Promise<any>;
  set(key: string, value: unknown): Promise<any>;
}
export class Service {
  developmentMode = false;
  developmentScenario = "success";
  developmentRequests = 0;
  state = initialState();
  registry = new ProviderRegistry();
  basket: BasketLine[] = [];
  journal: Journal | null = null;
  review: Review | null = null;
  busy = false;
  ai: AIStatus = { state: "disconnected", email: "", error: null, models: [] };
  draft: MealDraft | null = null;
  draftRevision: number | null = null;
  draftNote = "";
  storeResults: StoreContext[] = [];
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
  async setLanguage(input: unknown) {
    const language = z.enum(["fi", "en"]).parse(input);
    return this.writeState(async () => {
      const next = { ...this.state, language };
      await this.db.set("state", next);
      this.state = next;
      return this.snapshot();
    });
  }
  constructor(private db: Storage) {
    this.registry.register(new DemoProvider("demo-k"));
    this.registry.register(new DemoProvider("demo-s"));
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
  }
  snapshot() {
    return {
      developmentMode: this.developmentMode,
      developmentScenario: this.developmentScenario,
      developmentRequests: this.developmentRequests,
      state: this.state,
      basket: this.basket,
      journal: this.journal,
      review: this.review,
      storeResults: this.storeResults,
      storeLogin:
        this.storeLogins[this.state.context.providerId] ?? "notStarted",
      storeLogins: { ...this.storeLogins },
      comparison: this.comparison,
      pickupFee: this.pickupFee,
      ai: this.ai,
      draft: this.draft,
    };
  }
  async save(input: unknown) {
    return this.writeState(async () => {
      if (this.busy) throw new Error("busy");
      const next = stateSchema.parse(input);
      this.registry.get(next.context.providerId);
      if (next.revision !== this.state.revision) throw new Error("draftStale");
      next.language = this.state.language;
      for (const meal of next.meals)
        if (!next.recipes.some((r) => r.id === meal.recipeId))
          throw new Error("missingRecipe");
      const oldWithoutLanguage = { ...this.state, language: next.language };
      const changed =
        JSON.stringify(oldWithoutLanguage) !== JSON.stringify(next);
      if (changed) {
        next.revision = this.state.revision + 1;
      }
      await this.db.set("state", next);
      this.state = next;
      if (changed) {
        this.basket = [];
        this.review = null;
        this.comparison = null;
      }
      return this.snapshot();
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
    if (this.busy) throw new Error("busy");
    this.review = null;
    this.basket = await this.price(this.state.context);
    this.pickupFee = await this.readFee(this.state.context);
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
  private async price(context: StoreContext): Promise<BasketLine[]> {
    const provider = this.registry.get(context.providerId);
    const result = [];
    for (const requirement of requirements(this.state)) {
      const products = await provider.searchProducts(
        context,
        requirement.name,
        requirement.id,
      );
      const accepted =
        this.state.accepted[
          `${context.providerId}:${context.storeId}:${requirement.id}`
        ] ?? [];
      const exclusions = exclusionTerms(this.state.household.exclusions);
      const available = products.filter(
        (p) =>
          p.available &&
          p.price !== null &&
          p.unit === requirement.unit &&
          p.packAmount > 0 &&
          !exclusions.some((term) =>
            p.name.toLocaleLowerCase("fi").includes(term),
          ),
      );
      const storeBrand = (name: string) =>
        /\b(pirkka|k-menu|k menu|rainbow|xtra|coop|kotimaista)\b/i.test(name);
      // Automatic choice only among products that are the ingredient itself;
      // the shopper can still accept any other candidate by hand.
      // Demo catalogues match by ingredient ID only, so they skip this check.
      const fitting = isLive(context.providerId)
        ? available.filter((p) => relevant(p.name, requirement.name))
        : available;
      const preferred = fitting.filter((p) =>
        this.state.productPreference === "storeBrand"
          ? storeBrand(p.name)
          : this.state.productPreference === "avoidStoreBrand"
            ? !storeBrand(p.name)
            : true,
      );
      const auto = (preferred.length ? preferred : fitting).map((p) => p.id);
      const selected = accepted.filter((id) =>
        available.some((p) => p.id === id),
      );
      result.push(
        match(
          requirement,
          products,
          selected.length ? selected : auto,
          exclusions,
        ),
      );
    }
    return result;
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
    const lines = this.basket.length ? this.basket : await this.price(active);
    const otherLines = await this.price(other);
    const fees = {
      a: await this.readFee(active),
      b: await this.readFee(other),
    };
    // A list edited meanwhile makes the comparison stale; show none rather than a wrong one.
    if (this.state.revision !== revision || this.state.context !== active)
      throw new Error("draftStale");
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
  async accept(input: unknown) {
    if (this.busy) throw new Error("busy");
    const { ingredientId, productId } = z
      .object({ ingredientId: z.string(), productId: z.string() })
      .parse(input);
    const line = this.basket.find((l) => l.requirement.id === ingredientId);
    if (
      !line?.candidates.some(
        (p) => p.id === productId && p.available && p.price !== null,
      )
    )
      throw new Error("unresolved");
    const context = this.state.context;
    await this.save({
      ...this.state,
      accepted: {
        ...this.state.accepted,
        [`${context.providerId}:${context.storeId}:${ingredientId}`]: [
          productId,
        ],
      },
    });
    return this.buildBasket();
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
    await this.save({ ...this.state, skipped: [...this.state.skipped, key] });
    return this.buildBasket();
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
    );
    this.review.unresolved = unresolved.map((line) => line.requirement);
    return this.snapshot();
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
    if (
      (this.review.total > this.state.household.budget ||
        isLive(this.review.context.providerId)) &&
      !acknowledged
    )
      throw new Error("acknowledgeReview");
    this.busy = true;
    this.controller = new AbortController();
    try {
      const provider = this.registry.get(this.review.context.providerId);
      const journal: Journal = {
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
    );
    this.review.revision = this.state.revision;
    this.review.unresolved = this.journal.review.unresolved;
    return this.snapshot();
  }
  async scenario(value: unknown) {
    if (this.busy) throw new Error("busy");
    const scenario = z.enum(["interrupt", "price"]).parse(value);
    const provider = this.registry.get(this.state.context.providerId);
    if (!(provider instanceof DemoProvider)) throw new Error("unsupported");
    if (scenario === "interrupt") provider.failAfter = provider.writes + 1;
    else provider.priceChange = !provider.priceChange;
    return this.snapshot();
  }
}
export type Snapshot = ReturnType<Service["snapshot"]>;
