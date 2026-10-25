import { expect, test } from "vitest";
import { createFixtureService } from "./fixtures/ai-shopping/environment";
import { personalOffer } from "./fixtures/offers";
import { ScriptedInferenceProvider } from "./helpers/inference";
import { InferenceSession } from "../src/ai/provider";
import { inferenceTasks } from "../src/ai/tasks";
import { Service } from "../src/application/service";
import type { OfferSourceResult } from "../src/domain/offers";
import { SKaupatProvider } from "../src/stores/s-kaupat";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { OfferIdeas } from "../src/ui/offer-ideas";

const offeredId = "2000000000011";
const name = "Synteettinen tomaattimurska 400 g";
async function environment(available = true, native = false) {
  const env = await createFixtureService("k-ruoka", {
    "*": [
      { id: offeredId, name, price: 2.99, available },
      { id: "2000000000028", name: "Tomaattimurska 400 g", price: 0.01 },
      { id: "2000000000035", name: "Pasta 400 g", price: 1.2 },
    ],
  });
  let source: OfferSourceResult = {
    providerId: "k-ruoka",
    storeId: "synthetic-store",
    status: "ready",
    accountKey: "k-ruoka:0123456789abcdef",
    offers: [
      {
        ...personalOffer,
        products: [{ id: offeredId, name, available: true }],
      },
    ],
    truncated: false,
  };
  const retailer = env.service.registry.get("k-ruoka");
  retailer.capabilities.offers = { public: false, personal: true };
  retailer.readOffers = async () => source;
  const ideaProvider = new ScriptedInferenceProvider(
    "alternative",
    async () => ({
      completion: "complete",
      text: JSON.stringify({
        ideas: [
          {
            name: "Tomaattipasta",
            products: [{ offerId: personalOffer.id, productId: offeredId }],
          },
        ],
      }),
    }),
  );
  ideaProvider.models[0].capabilities.tasks = inferenceTasks;
  const view = await env.service.suggestOffers(
    { consent: true },
    async (signal, maxCalls) =>
      new InferenceSession(
        ideaProvider,
        ideaProvider.models[0],
        { maxCalls, maxOutputCharacters: 12000, timeoutMs: 1000 },
        signal,
      ),
  );
  if (view.offerIdeas?.status !== "ready")
    throw new Error("Missing idea fixture");
  const ideaId = view.offerIdeas.ideas[0].id;
  const reply = {
    recipes: [
      {
        id: "pasta",
        name: "Tomaattipasta",
        servings: 4,
        kind: "meal",
        ingredients: [
          {
            id: "tomato",
            name: "Tomaattimurska",
            amount: 400,
            unit: "g",
            ...(native ? { classification: null } : {}),
          },
          {
            id: "pasta",
            name: "Pasta",
            amount: 400,
            unit: "g",
            ...(native ? { classification: null } : {}),
          },
        ],
        instructions: "Keitä pasta ja lisää tomaattimurska.",
      },
    ],
    meals: [{ recipeId: "pasta", servings: 4, day: 0, leftovers: false }],
    items: [],
    notes: "",
    sides: [],
    intents: [
      {
        id: "meal",
        kind: "meal",
        label: "Tomaattipasta",
        evidence: { start: 0, end: 13, quote: "Tomaattipasta" },
        provenance: "explicit-note",
        quantity: null,
        mealIndex: 0,
        itemIndex: null,
        unresolvedReason: null,
      },
    ],
    offerUses: [{ productId: offeredId, ingredientName: "Tomaattimurska" }],
  };
  let duringPlanning: (() => void) | undefined;
  const provider = new ScriptedInferenceProvider(
    "alternative",
    async (request) => {
      expect(request.prompt).toContain(offeredId);
      expect(request.prompt).not.toContain("0123456789abcdef");
      duringPlanning?.();
      return { completion: "complete", text: JSON.stringify(reply) };
    },
  );
  provider.models[0].capabilities.tasks = inferenceTasks;
  provider.models[0].capabilities.outputModes = [
    native ? "json-schema" : "text",
  ];
  const plan = () =>
    env.service.planShopping(
      { prompt: "Tomaattipasta", consent: true, offerIdeaIds: [ideaId] },
      async (run) => run.bindInference(provider, provider.models[0]),
    );
  return {
    ...env,
    duringPlanning: (callback: () => void) => {
      duringPlanning = callback;
    },
    plan,
    provider,
    reply,
    setSource: (next: OfferSourceResult) => {
      source = next;
    },
    source,
  };
}

test.each([false, true])(
  "selected offer products survive commit, cached quote and repricing (native=%s)",
  async (native) => {
    const env = await environment(true, native);
    const planned = await env.plan();
    expect(env.provider.calls).toHaveLength(1);
    await env.service.commitPlanning({
      operationId: planned.planning!.operationId,
    });
    const tomato = env.service.basket.find(
      (line) => line.requirement.name === "Tomaattimurska",
    )!;
    expect(tomato.product?.id).toBe(offeredId);
    expect(tomato.total).toBe(299); // Actual catalogue price, never the conditional bundle price.
    const reopened = new Service(env.storage);
    reopened.developmentMode = true;
    await reopened.init();
    expect(reopened.state.offerBindings).toEqual(
      env.service.state.offerBindings,
    );
    expect(
      reopened.basket.find((line) => line.requirement.name === "Tomaattimurska")
        ?.product?.id,
    ).toBe(offeredId);
    await env.service.buildBasket();
    expect(
      env.service.basket.find(
        (line) => line.requirement.name === "Tomaattimurska",
      )?.product?.id,
    ).toBe(offeredId);
    expect(env.tools.some((tool) => /add|write|create/.test(tool))).toBe(false);
  },
);

test("an unavailable offer product stays unresolved instead of choosing the cheaper substitute", async () => {
  const env = await environment(false);
  const planned = await env.plan();
  await env.service.commitPlanning({
    operationId: planned.planning!.operationId,
  });
  const tomato = env.service.basket.find(
    (line) => line.requirement.name === "Tomaattimurska",
  )!;
  expect(tomato.product).toBeNull();
  expect(tomato.total).toBeNull();
});

test("missing offer ingredients fail the bounded repair without changing the saved list", async () => {
  const env = await environment();
  const before = structuredClone(env.service.state);
  env.reply.offerUses = [];
  await expect(env.plan()).rejects.toThrow("invalidDraft");
  expect(env.provider.calls).toHaveLength(2);
  expect(env.service.state).toEqual(before);
});

test("changed account or expired selected offer stops before model use", async () => {
  for (const expired of [false, true]) {
    const env = await environment();
    if (env.source.status !== "ready") throw new Error("Expected ready");
    env.setSource(
      expired
        ? {
            ...env.source,
            offers: env.source.offers.map((offer) => ({
              ...offer,
              validUntil: "2020-01-01",
            })),
          }
        : { ...env.source, accountKey: "k-ruoka:fedcba9876543210" },
    );
    await expect(env.plan()).rejects.toThrow("offerSelectionExpired");
    expect(env.provider.calls).toHaveLength(0);
  }
});

test("offer selections do not override household exclusions", async () => {
  const env = await environment();
  await env.service.save({
    ...env.service.state,
    household: { ...env.service.state.household, exclusions: "tomaatti" },
  });
  const planned = await env.plan();
  await env.service.commitPlanning({
    operationId: planned.planning!.operationId,
  });
  expect(
    env.service.basket.find(
      (line) => line.requirement.name === "Tomaattimurska",
    )?.product,
  ).toBeNull();
});

test("expiry during planning is rechecked before a plan can become ready", async () => {
  const env = await environment();
  const before = structuredClone(env.service.state);
  if (env.source.status !== "ready") throw new Error("Expected ready");
  const expired = {
    ...env.source,
    offers: env.source.offers.map((offer) => ({
      ...offer,
      validUntil: "2020-01-01",
    })),
  };
  env.duringPlanning(() => env.setSource(expired));
  await expect(env.plan()).rejects.toThrow("offerSelectionExpired");
  expect(env.service.state).toEqual(before);
  expect(env.provider.calls).toHaveLength(1);
});

test("a new list clears product bindings from the previous list", async () => {
  const env = await environment();
  const planned = await env.plan();
  await env.service.commitPlanning({
    operationId: planned.planning!.operationId,
  });
  await env.service.newWeek();
  expect(env.service.state.offerBindings).toEqual({});
});

test.each(["loginRequired", "storeBlocked"])(
  "known retailer error %s survives planning without an AI reconnect",
  async (code) => {
    const env = await environment();
    const before = structuredClone(env.service.state);
    env.service.registry.get("k-ruoka").searchProducts = async () => {
      throw new Error(code);
    };
    await expect(env.plan()).rejects.toThrow(code);
    expect(env.provider.calls).toHaveLength(1);
    expect(env.service.state).toEqual(before);
  },
);

test("the actual S-kaupat adapter advertises unsupported discovery without calling its tools", async () => {
  const env = await createFixtureService("s-kaupat", {});
  expect(env.service.registry.get("s-kaupat")).toBeInstanceOf(SKaupatProvider);
  expect(env.service.snapshot().offerDiscoverySupported).toBe(false);
  expect(
    (
      await env.service.suggestOffers({ consent: true }, async () => {
        throw new Error("Unexpected model request");
      })
    ).offerIdeas?.status,
  ).toBe("unsupported");
  expect(env.tools).toEqual([]);
  const html = renderToStaticMarkup(
    createElement(OfferIdeas, {
      snapshot: env.service.snapshot(),
      busy: false,
      call: async () => undefined,
      append: () => {},
      canAppend: () => true,
    }),
  );
  expect(html).toContain("disabled");
  expect(html).toMatch(/not yet supported|ei vielä tueta/);
});
