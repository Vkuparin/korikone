import type { AIStatus } from "./connection";
import { initialState } from "../domain/model";
import { chooseModel } from "./models";
import { setTimeout as delay } from "node:timers/promises";
import { mealFixtures } from "./meal-fixtures";

import { aiScenarios } from "./scenarios";
export { aiScenarios } from "./scenarios";

/** Local responses exercise the same validation and approval path as live AI. */
export class FixtureAI {
  scenario: (typeof aiScenarios)[number] = "success";
  private signedIn = false;
  private calls = 0;
  lastModel: string | null = null;
  catalogueRequests = 0;
  get requestCount() {
    return this.calls;
  }
  private request: AbortController | null = null;
  private get catalogue() {
    if (this.scenario === "emptyModels") return [];
    if (this.scenario === "noSmallModel")
      return [{ slug: "fixture-large", name: "Local large model" }];
    return [
      { slug: "fixture-mini", name: "Local mini model" },
      ...(this.scenario === "removedModel"
        ? []
        : [
            {
              slug: "fixture-large",
              name: "Local large model with a very long display name for layout checks",
            },
          ]),
    ];
  }
  async init() {}
  status(): AIStatus {
    return {
      state: this.signedIn ? "connected" : "disconnected",
      email: this.signedIn ? "fixture@korikone.local" : "",
      error: null,
      models: this.signedIn ? this.catalogue : [],
    };
  }
  async signIn() {
    this.signedIn = true;
  }
  async signOut() {
    this.cancelRequest();
    this.signedIn = false;
  }
  cancel() {}
  cancelRequest() {
    this.request?.abort();
  }
  async models(signal?: AbortSignal) {
    if (!this.signedIn) throw new Error("notConnected");
    this.catalogueRequests++;
    if (this.scenario === "delayedModels")
      await delay(2500, undefined, { signal });
    if (this.scenario === "modelsFailed") throw new Error("modelsUnavailable");
    return this.catalogue;
  }
  setScenario(scenario: (typeof aiScenarios)[number]) {
    this.scenario = scenario;
    this.calls = 0;
    this.catalogueRequests = 0;
    this.lastModel = null;
  }
  async generatePinned(model: string, input: string, signal: AbortSignal) {
    return this.generate(model, input, { signal, pinned: true });
  }
  async generate(
    model: string,
    input: string,
    options?: { signal?: AbortSignal; pinned?: boolean },
  ) {
    if (this.request) throw new Error("busy");
    const controller = new AbortController();
    const cancel = () => controller.abort();
    options?.signal?.addEventListener("abort", cancel, { once: true });
    if (options?.signal?.aborted) controller.abort();
    this.request = controller;
    try {
      return await this.respond(
        model,
        input,
        controller.signal,
        !!options?.pinned,
      );
    } finally {
      options?.signal?.removeEventListener("abort", cancel);
      this.request = null;
    }
  }
  private async respond(
    model: string,
    input: string,
    signal: AbortSignal,
    pinned = false,
  ) {
    if (!this.signedIn) throw new Error("notConnected");
    if (pinned && !this.catalogue.some((m) => m.slug === model))
      throw new Error("modelUnavailable");
    this.lastModel = pinned
      ? model
      : chooseModel(await this.models(signal), model);
    signal.throwIfAborted();
    this.calls++;
    if (
      this.scenario === "invalidDraft" ||
      (this.scenario === "invalidOnce" && this.calls === 1)
    )
      return "{invalid";
    if (
      this.scenario === "delayedSuccess" ||
      this.scenario === "delayedFailure"
    )
      await delay(2500, undefined, { signal });
    if (this.scenario === "delayedFailure") throw new Error("aiFailed");
    if (this.scenario === "pendingSuccess")
      await delay(60000, undefined, { signal });
    if (
      this.scenario !== "success" &&
      this.scenario !== "delayedSuccess" &&
      this.scenario !== "pendingSuccess" &&
      this.scenario !== "delayedModels" &&
      this.scenario !== "invalidOnce" &&
      !["noSmallModel", "removedModel"].includes(this.scenario)
    )
      throw new Error(this.scenario);
    const recipeText = input.match(/Recipe text: ("(?:[^"\\]|\\.)*")/)?.[1];
    if (recipeText) {
      const request = JSON.parse(recipeText).toLocaleLowerCase("fi");
      const recipe =
        mealFixtures.find((fixture) => fixture.pattern.test(request))?.recipe ??
        initialState().recipes[0];
      return JSON.stringify(structuredClone(recipe));
    }
    const note = input.match(/User note: ("(?:[^"\\]|\\.)*")/)?.[1];
    const request = note ? JSON.parse(note).toLocaleLowerCase("fi") : "";
    const servings = Number(
      input.match(/Household: .*?"servings":(\d+)/)?.[1] ?? 4,
    );
    const recipes = initialState().recipes.filter((r) =>
      r.id === "pasta"
        ? /pasta/.test(request) && !/kanapasta|chicken pasta/.test(request)
        : r.id === "soup"
          ? /keitto|soup/.test(request) &&
            !/nakkikeitto|sausage soup/.test(request)
          : /puuro|porridge/.test(request),
    );
    recipes.push(
      ...mealFixtures
        .filter((f) => f.pattern.test(request))
        .map((f) => structuredClone(f.recipe)),
    );
    const items = initialState()
      .staples.filter(() => /kahvi|coffee/.test(request))
      .map(({ id, name, amount, unit }) => ({ id, name, amount, unit }));
    if (/pakastepizza|frozen pizza/.test(request))
      items.push({ id: "pizza", name: "Pakastepizza", amount: 700, unit: "g" });
    if (!recipes.length && !items.length)
      recipes.push(initialState().recipes[0]);
    return JSON.stringify({
      recipes,
      meals: recipes.map((r, day) => ({
        recipeId: r.id,
        day,
        servings,
        leftovers: false,
      })),
      items,
      notes: "Development mode: local fixture response.",
    });
  }
}
