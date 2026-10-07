import { z } from "zod";
import {
  initialState,
  stateSchema,
  type AppState,
  type BasketLine,
  type Journal,
  type Review,
} from "../domain/model";
import { requirements, match } from "../domain/planner";
import { ProviderRegistry } from "../stores/provider";
import { DemoProvider } from "../stores/demo";
import { createReview, resumeReview, transfer } from "./transfer";
export interface Storage {
  get(key: string): Promise<any>;
  set(key: string, value: unknown): Promise<any>;
}
export class Service {
  state = initialState();
  registry = new ProviderRegistry();
  basket: BasketLine[] = [];
  journal: Journal | null = null;
  review: Review | null = null;
  busy = false;
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
    for (const id of ["demo-k", "demo-s"]) {
      const carts = await this.db.get(id);
      if (carts) (this.registry.get(id) as DemoProvider).carts = new Map(carts);
    }
  }
  snapshot() {
    return {
      state: this.state,
      basket: this.basket,
      journal: this.journal,
      review: this.review,
    };
  }
  async save(input: unknown) {
    if (this.busy) throw new Error("busy");
    const next = stateSchema.parse(input);
    for (const meal of next.meals)
      if (!next.recipes.some((r) => r.id === meal.recipeId))
        throw new Error("missingRecipe");
    const oldWithoutLanguage = { ...this.state, language: next.language };
    const changed = JSON.stringify(oldWithoutLanguage) !== JSON.stringify(next);
    if (changed) {
      next.revision = this.state.revision + 1;
      this.basket = [];
      this.review = null;
    }
    await this.db.set("state", next);
    this.state = next;
    return this.snapshot();
  }
  async buildBasket() {
    if (this.busy) throw new Error("busy");
    this.review = null;
    const context = this.state.context;
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
      result.push(match(requirement, products, accepted));
    }
    this.basket = result;
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
    this.state.accepted[
      `${context.providerId}:${context.storeId}:${ingredientId}`
    ] = [productId];
    this.state.revision++;
    this.review = null;
    await this.db.set("state", this.state);
    return this.buildBasket();
  }
  async prepare() {
    if (this.busy) throw new Error("busy");
    this.review = await createReview(
      this.registry.get(this.state.context.providerId),
      this.state.context,
      this.state.revision,
      this.basket,
    );
    return this.snapshot();
  }
  async execute(id: unknown) {
    if (this.busy) throw new Error("busy");
    if (
      typeof id !== "string" ||
      !this.review ||
      this.review.id !== id ||
      this.review.revision !== this.state.revision
    )
      throw new Error("reviewRequired");
    this.busy = true;
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
      await this.db.set("journal", journal);
      // Each journal write must finish before the next retailer operation.
      this.journal = await transfer(provider, journal, async (j) => {
        await this.db.set("journal", j);
        if (provider instanceof DemoProvider)
          await this.db.set(provider.id, [...provider.carts]);
      });
      await this.db.set("journal", this.journal);
      if (provider instanceof DemoProvider)
        await this.db.set(provider.id, [...provider.carts]);
      return this.snapshot();
    } finally {
      this.busy = false;
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
