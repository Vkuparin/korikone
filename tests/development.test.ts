import { test, expect, vi } from "vitest";
import { FixtureAI, aiScenarios } from "../src/ai/fixtures";
import { draftPrompt, validateDraft } from "../src/ai/draft";
import { initialState } from "../src/domain/model";
import { createService } from "../src/application/development";
import { DemoProvider } from "../src/stores/demo";
import { Service } from "../src/application/service";

test("original multi-dish note retains cooked meals, ready food, breakfast and treats", async () => {
  const ai = new FixtureAI();
  await ai.signIn();
  const state = initialState();
  state.household.servings = 2;
  state.staples = [];
  state.receiptText = "Jogurtti 1 kg, Banaani 6 kpl, Suklaa 200 g";
  const note =
    "Nakkikeitto, kanapasta ja pakastepizza. Aamuksi jogurttia ja banaaneja. Herkkuja viikonlopuksi.";
  const prompt = draftPrompt(note, state);
  expect(prompt).toContain(JSON.stringify(state.receiptText));
  const draft = validateDraft(await ai.generate("auto", prompt), state);
  expect(draft.recipes.map((r) => r.kind)).toEqual([
    "meal",
    "meal",
    "breakfast",
    "snack",
  ]);
  expect(draft.items).toEqual([
    { id: "pakastepizza", name: "Pakastepizza", amount: 700, unit: "g" },
  ]);
  expect(draft.meals.every((m) => m.servings === 2)).toBe(true);
  const service = new Service({ get: async () => null, set: async () => {} });
  service.state = state;
  service.draft = draft;
  service.draftRevision = state.revision;
  service.draftNote = note;
  await service.approveDraft();
  await service.buildBasket();
  expect(service.basket).toHaveLength(10);
  expect(
    service.basket.every((line) => line.product && line.total !== null),
  ).toBe(true);
  expect(
    service.basket.find((line) => line.requirement.name === "Peruna")
      ?.requirement.amount,
  ).toBe(400);
});

test("AI fixtures cover valid responses and failure cases without a network request", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    throw new Error("network forbidden");
  });
  try {
    const ai = new FixtureAI();
    const state = initialState();
    state.household.servings = 2;
    await expect(ai.generate("auto", "")).rejects.toThrow("notConnected");
    await ai.signIn();
    const prompt = draftPrompt("pasta, soup, porridge and coffee", state);
    const draft = validateDraft(await ai.generate("auto", prompt), state);
    expect(draft.meals).toHaveLength(3);
    expect(draft.meals.every((m) => m.servings === 2)).toBe(true);
    expect(draft.items[0].name).toBe("Kahvi");
    for (const scenario of aiScenarios.filter(
      (s) =>
        s !== "success" &&
        s !== "delayedSuccess" &&
        s !== "pendingSuccess" &&
        s !== "delayedModels",
    )) {
      ai.setScenario(scenario);
      if (scenario === "invalidOnce" || scenario === "invalidDraft") {
        expect(() => validateDraft("{invalid", state)).toThrow("invalidDraft");
        expect(await ai.generate("auto", prompt)).toBe("{invalid");
        if (scenario === "invalidOnce")
          expect(
            validateDraft(await ai.generate("auto", prompt), state).meals,
          ).toHaveLength(3);
      } else if (scenario === "removedModel") {
        expect(
          validateDraft(await ai.generate("auto", prompt), state).meals,
        ).toHaveLength(3);
      } else
        await expect(ai.generate("auto", prompt)).rejects.toThrow(
          scenario === "delayedFailure"
            ? "aiFailed"
            : scenario === "noSmallModel"
              ? "modelSelectionRequired"
              : scenario === "emptyModels" || scenario === "modelsFailed"
                ? "modelsUnavailable"
                : scenario,
        );
    }
    await ai.signOut();
    expect(ai.status().state).toBe("disconnected");
    await ai.signIn();
    for (const scenario of ["delayedSuccess", "pendingSuccess"] as const) {
      ai.setScenario(scenario);
      const pending = ai.generate("auto", prompt);
      await expect(ai.generate("auto", prompt)).rejects.toThrow("busy");
      ai.cancelRequest();
      await expect(pending).rejects.toThrow();
    }
    ai.setScenario("success");
    expect(
      validateDraft(await ai.generate("auto", prompt), state).meals,
    ).toHaveLength(3);
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    fetch.mockRestore();
  }
});

test("development profiles isolate state and transfer journals and never call live providers", async () => {
  const entries = new Map<string, unknown>();
  const db = {
    get: async (key: string) => structuredClone(entries.get(key)),
    set: async (key: string, value: unknown) => {
      entries.set(key, structuredClone(value));
    },
  };
  const providers = ["k-ruoka", "s-kaupat"].map((id) => {
    const provider = new DemoProvider(id);
    for (const method of [
      "searchStores",
      "searchProducts",
      "getCart",
      "setQuantity",
    ] as const)
      vi.spyOn(provider, method).mockRejectedValue(new Error("live forbidden"));
    return provider;
  });
  const live = await createService(db, false, providers);
  await live.save({ ...live.state, note: "Live note" });
  const dev = await createService(db, true, providers);
  const ai = new FixtureAI();
  await ai.signIn();
  dev.draft = validateDraft(
    await ai.generate(
      "auto",
      draftPrompt("pasta, soup, porridge, coffee and frozen pizza", dev.state),
    ),
    dev.state,
  );
  dev.draftRevision = dev.state.revision;
  dev.draftNote = "Fixture note";
  await dev.approveDraft();
  for (const id of ["k-ruoka", "s-kaupat"]) {
    const [context] = await dev.registry.get(id).searchStores("Helsinki");
    await dev.save({
      ...dev.state,
      context,
      note: "Fixture note",
    });
    await dev.buildBasket();
    expect(dev.basket.length).toBeGreaterThan(7);
    expect(dev.basket.every((line) => line.product)).toBe(true);
    await dev.prepare();
    await dev.execute({ id: dev.review!.id, acknowledged: true });
    expect(dev.journal!.status).toBe("verified");
  }
  const restarted = await createService(db, true, providers);
  expect(restarted.journal!.status).toBe("verified");
  expect(
    (
      await restarted.registry.get("s-kaupat").getCart(restarted.state.context)
    ).lines.some((l) => l.productId === "pasta" && l.quantity === 2),
  ).toBe(true);
  const restored = await createService(db, false, providers);
  expect(restored.state.note).toBe("Live note");
  expect(restored.journal).toBeFalsy();
  for (const provider of providers) {
    expect(provider.searchStores).not.toHaveBeenCalled();
    expect(provider.searchProducts).not.toHaveBeenCalled();
    expect(provider.getCart).not.toHaveBeenCalled();
    expect(provider.setQuantity).not.toHaveBeenCalled();
  }
});

test("the live acceptance note picks the ingredient itself among store look-alikes", async () => {
  const entries = new Map<string, unknown>();
  const dev = await createService(
    {
      get: async (key) => structuredClone(entries.get(key)),
      set: async (key, value) => void entries.set(key, structuredClone(value)),
    },
    true,
    [new DemoProvider("k-ruoka"), new DemoProvider("s-kaupat")],
  );
  const provider = dev.registry.get("s-kaupat");
  const [context] = await provider.searchStores("Helsinki");
  await dev.save({ ...dev.state, context, staples: [] });
  // The store answers with compounds, variants and ready meals, as the live search did.
  const found = async (query: string, id: string) =>
    (await provider.searchProducts(context, query, id)).map((p) => p.id);
  expect(await found("Sipuli", "onion")).toEqual(["onion", "garlic"]);
  expect(await found("Mustapippuri", "pepper")).toContain("lemon-pepper");
  expect(await found("Jauheliha", "mince")).toContain("mince-chicken");
  expect(await found("MakaronI", "macaroni")).toContain("macaroni-meal");
  const ai = new FixtureAI();
  await ai.signIn();
  dev.draft = validateDraft(
    await ai.generate("auto", draftPrompt("Makaronilaatikko", dev.state)),
    dev.state,
  );
  dev.draftRevision = dev.state.revision;
  dev.draftNote = "Makaronilaatikko";
  await dev.approveDraft();
  await dev.buildBasket();
  expect(
    Object.fromEntries(
      dev.basket.map((l) => [l.requirement.name, l.product?.id ?? null]),
    ),
  ).toEqual({
    Makaroni: "macaroni",
    Jauheliha: "mince",
    Sipuli: "onion",
    Maito: "milk",
    Kananmuna: "egg",
    Suola: "salt",
    Mustapippuri: "pepper",
  });
  const eggs = dev.basket.find((l) => l.requirement.name === "Kananmuna")!;
  expect([eggs.packs, eggs.product!.packAmount]).toEqual([1, 10]);
  // Look-alikes stay available for the shopper to choose by hand.
  expect(
    dev.basket
      .find((l) => l.requirement.name === "Sipuli")!
      .candidates.map((p) => p.id),
  ).toEqual(["onion", "garlic"]);
  await dev.prepare();
  expect(dev.review!.baseline.accountName).toBe("Testi");
  expect(dev.review!.baseline.accountName).not.toBe(
    dev.review!.baseline.accountId,
  );
});

test("switching chains with a list in progress keeps the list and each chain's product choices", async () => {
  const entries = new Map<string, unknown>();
  const db = {
    get: async (key: string) => structuredClone(entries.get(key)),
    set: async (key: string, value: unknown) => {
      entries.set(key, structuredClone(value));
    },
  };
  const service = await createService(db, true, [
    new DemoProvider("k-ruoka"),
    new DemoProvider("s-kaupat"),
  ]);
  const [kStore] = await service.registry.get("k-ruoka").searchStores("x");
  const [sStore] = await service.registry.get("s-kaupat").searchStores("x");
  service.storeLogins = { "k-ruoka": "signedIn", "s-kaupat": "signedIn" };
  await service.save({
    ...service.state,
    meals: [],
    staples: [],
    extras: [{ id: "jauheliha", name: "Jauheliha", amount: 400, unit: "g" }],
    context: kStore,
  });
  await service.buildBasket();
  expect(service.basket[0].product?.id).toBe("mince");
  await service.accept({
    ingredientId: "jauheliha",
    productId: "mince-chicken",
  });
  expect(service.basket[0].product?.id).toBe("mince-chicken");

  await service.save({ ...service.state, context: sStore });
  expect(service.state.extras.map((e) => e.id)).toEqual(["jauheliha"]);
  await service.buildBasket();
  // The other chain makes its own choice and prices at its own store.
  expect(service.basket[0].product).toMatchObject({
    id: "mince",
    providerId: "s-kaupat",
  });

  await service.save({
    ...service.state,
    context: service.state.stores["k-ruoka"],
  });
  await service.buildBasket();
  expect(service.basket[0].product).toMatchObject({
    id: "mince-chicken",
    providerId: "k-ruoka",
  });
  expect(service.snapshot().storeLogins).toEqual({
    "k-ruoka": "signedIn",
    "s-kaupat": "signedIn",
  });
  expect(Object.keys(service.state.stores).sort()).toEqual([
    "demo-k",
    "k-ruoka",
    "s-kaupat",
  ]);
});

test("comparing stores prices the list at the other chain without changing anything", async () => {
  const entries = new Map<string, unknown>();
  const db = {
    get: async (key: string) => structuredClone(entries.get(key)),
    set: async (key: string, value: unknown) => {
      entries.set(key, structuredClone(value));
    },
  };
  const k = new DemoProvider("k-ruoka");
  const s = new DemoProvider("s-kaupat");
  const service = await createService(db, true, [k, s]);
  const [kStore] = await k.searchStores();
  const [sStore] = await s.searchStores();
  await service.save({
    ...service.state,
    meals: [],
    staples: [],
    extras: [
      { id: "jauheliha", name: "Jauheliha", amount: 400, unit: "g" },
      { id: "milk", name: "Maito", amount: 1000, unit: "ml" },
    ],
    context: sStore,
  });
  await service.save({ ...service.state, context: kStore });
  await expect(service.compareStores()).rejects.toThrow("compareUnavailable");
  service.storeLogins = { "k-ruoka": "signedIn", "s-kaupat": "signedIn" };
  await service.buildBasket();
  await service.accept({
    ingredientId: "jauheliha",
    productId: "mince-chicken",
  });
  const writes = [
    vi.spyOn(k, "setQuantity"),
    vi.spyOn(s, "setQuantity"),
    vi.spyOn(k, "getCart"),
    vi.spyOn(s, "getCart"),
  ];
  const before = JSON.stringify(service.state);
  const saved = JSON.stringify(entries.get("development:state"));
  const result = await service.compareStores();
  expect(JSON.stringify(service.state)).toBe(before);
  expect(JSON.stringify(entries.get("development:state"))).toBe(saved);
  expect(service.review).toBeNull();
  expect(service.journal ?? null).toBeNull();
  expect(entries.has("development:journal")).toBe(false);
  for (const spy of writes) expect(spy).not.toHaveBeenCalled();
  const comparison = result.comparison!;
  expect(comparison.other.providerId).toBe("s-kaupat");
  // K-Ruoka keeps the shopper's chicken mince; S-kaupat makes its own automatic choice.
  expect(comparison.lines.map((l) => l.product?.id)).toEqual(["mince", "milk"]);
  expect(comparison.result.common.rows).toBe(2);
  expect(comparison.result.cheaper).toBe("a");
  // Only S-kaupat reports a pickup fee; K-Ruoka's stays unknown.
  expect(comparison.fees).toEqual({ a: null, b: { min: 390, max: 590 } });
  await service.save({ ...service.state, context: sStore });
  await service.buildBasket();
  expect(service.snapshot().pickupFee).toEqual({ min: 390, max: 590 });
  await service.save({
    ...service.state,
    context: { ...sStore, fulfillment: "delivery" },
  });
  await service.buildBasket();
  expect(service.snapshot().pickupFee).toBeNull();
  await service.save({ ...service.state, context: kStore });
  await service.compareStores();
  // Any list change drops the comparison rather than leaving a stale one.
  await service.save({
    ...service.state,
    extras: service.state.extras.slice(1),
  });
  expect(service.snapshot().comparison).toBeNull();
});

test("confirming is the approval for a live store unless the budget is exceeded", async () => {
  const entries = new Map<string, unknown>();
  const db = {
    get: async (key: string) => structuredClone(entries.get(key)),
    set: async (key: string, value: unknown) => {
      entries.set(key, structuredClone(value));
    },
  };
  const s = new DemoProvider("s-kaupat");
  const service = await createService(db, true, [s]);
  const [store] = await s.searchStores();
  await service.save({
    ...service.state,
    meals: [],
    staples: [],
    extras: [{ id: "milk", name: "Maito", amount: 1000, unit: "ml" }],
    context: store,
    household: { ...service.state.household, budget: 10000 },
  });
  await service.buildBasket();
  await service.prepare();
  const done = await service.execute({
    id: service.review!.id,
    acknowledged: false,
  });
  expect(done.journal!.status).toBe("verified");
  await service.save({
    ...service.state,
    household: { ...service.state.household, budget: 100 },
  });
  await service.buildBasket();
  await service.prepare();
  await expect(
    service.execute({ id: service.review!.id, acknowledged: false }),
  ).rejects.toThrow("acknowledgeReview");
});
