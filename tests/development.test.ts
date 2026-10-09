import { test, expect, vi } from "vitest";
import { FixtureAI, aiScenarios } from "../src/ai/fixtures";
import { draftPrompt, validateDraft } from "../src/ai/draft";
import { initialState } from "../src/domain/model";
import { createService } from "../src/application/development";
import { DemoProvider } from "../src/stores/demo";

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
      (s) => s !== "success" && s !== "delayedSuccess",
    )) {
      ai.setScenario(scenario);
      if (scenario === "invalidOnce" || scenario === "invalidDraft") {
        expect(() => validateDraft("{invalid", state)).toThrow("invalidDraft");
        expect(await ai.generate("auto", prompt)).toBe("{invalid");
        if (scenario === "invalidOnce")
          expect(
            validateDraft(await ai.generate("auto", prompt), state).meals,
          ).toHaveLength(3);
      } else
        await expect(ai.generate("auto", prompt)).rejects.toThrow(scenario);
    }
    await ai.signOut();
    expect(ai.status().state).toBe("disconnected");
    await ai.signIn();
    ai.setScenario("delayedSuccess");
    const pending = ai.generate("auto", prompt);
    await expect(ai.generate("auto", prompt)).rejects.toThrow("busy");
    ai.cancelRequest();
    await expect(pending).rejects.toThrow();
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
