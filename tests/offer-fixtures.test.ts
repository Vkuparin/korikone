import { expect, test, vi } from "vitest";
import { createFixtureService } from "./fixtures/ai-shopping/environment";
import { ScriptedInferenceProvider } from "./helpers/inference";
import { InferenceSession } from "../src/ai/provider";
import { offerIdeasTask } from "../src/ai/tasks";
import { collectOffers } from "../src/application/offers";
import { DemoProvider } from "../src/stores/demo";
import { offerSourceScenarios } from "../src/ai/scenarios";

type Scenario = DemoProvider["offerScenario"];
const reads = (scenario: Scenario) => {
  const provider = new DemoProvider("k-ruoka");
  provider.offerScenario = scenario;
  provider.capabilities.offers = { public: true, personal: true };
  return provider;
};
const context = {
  providerId: "k-ruoka",
  storeId: "synthetic-store",
  storeName: "Synthetic store",
  fulfillment: "pickup" as const,
};

test("every development offers scenario maps to one source behaviour", () => {
  expect(Object.values(offerSourceScenarios).sort()).toEqual(
    [
      "empty",
      "error",
      "exhausted",
      "expired",
      "mixed",
      "personal",
      "signedOut",
      "unsupported",
    ].sort(),
  );
});

test.each([
  ["empty", "ready", 0],
  ["expired", "ready", 0],
  ["exhausted", "ready", 0],
  ["unsupported", "unsupported", 0],
  ["signedOut", "signed-out", 0],
  ["error", "error", 0],
  ["success", "ready", 1],
  ["personal", "ready", 1],
  ["mixed", "ready", 1],
] as const)(
  "the %s source collects as %s with %i current offers through the shared collector",
  async (scenario, status, current) => {
    const result = await collectOffers(reads(scenario), context);
    expect(result.status).toBe(status);
    if (result.status === "ready") expect(result.offers).toHaveLength(current);
  },
);

test("expired, exhausted and unavailable offers never reach the facts a model sees", async () => {
  const result = await collectOffers(reads("mixed"), context);
  expect(result.status).toBe("ready");
  if (result.status !== "ready") return;
  const ids = result.offers.map((offer) => offer.id);
  expect(ids).not.toContain("synthetic-expired-offer");
  expect(ids).not.toContain("synthetic-exhausted-offer");
  expect(ids).not.toContain("synthetic-unavailable-offer");
  expect(ids).toEqual(["synthetic-tomato-offer"]);
});

async function environment(scenario: Scenario) {
  const env = await createFixtureService("k-ruoka", {});
  const retailer = env.service.registry.get("k-ruoka");
  retailer.capabilities.offers = { public: true, personal: true };
  const source = reads(scenario);
  const reader = vi.fn((c: typeof context) => source.readOffers(c));
  retailer.readOffers = reader as typeof retailer.readOffers;
  const provider = new ScriptedInferenceProvider(
    "fake-alternative",
    async () => ({
      text: JSON.stringify({
        ideas: [
          {
            name: "Tomaattipasta",
            products: [
              { offerId: "synthetic-tomato-offer", productId: "2000000000011" },
            ],
          },
        ],
      }),
      completion: "complete",
    }),
  );
  provider.models[0].capabilities.tasks.push(offerIdeasTask);
  const session = vi.fn(
    async (signal: AbortSignal, maxCalls: number) =>
      new InferenceSession(
        provider,
        provider.models[0],
        { maxCalls, maxOutputCharacters: 12000, timeoutMs: 1000 },
        signal,
      ),
  );
  return { ...env, reader, provider, session };
}

test.each([
  ["expired", "empty"],
  ["exhausted", "empty"],
  ["empty", "empty"],
  ["unsupported", "unsupported"],
  ["signedOut", "signed-out"],
  ["error", "error"],
] as const)(
  "the %s source reports %s, makes no AI request and leaves the list, quote and cart unchanged",
  async (scenario, expected) => {
    const env = await environment(scenario);
    const before = env.service.snapshot();
    const result = await env.service.suggestOffers(
      { consent: true },
      env.session,
    );
    expect(result.offerIdeas?.status).toBe(expected);
    expect(env.session).not.toHaveBeenCalled();
    expect(env.provider.calls).toHaveLength(0);
    // Discovery reads stay within the two-read bound and never touch the cart.
    expect(env.reader.mock.calls.length).toBeLessThanOrEqual(2);
    expect(env.tools).toEqual([]);
    expect(result.state).toEqual(before.state);
    expect(result.basket).toEqual(before.basket);
    expect(result.review).toEqual(before.review);
    expect(result.journal).toEqual(before.journal);
  },
);

test("a mixed source sends one inference request about the current offer only", async () => {
  const env = await environment("mixed");
  const before = env.service.snapshot();
  const result = await env.service.suggestOffers(
    { consent: true },
    env.session,
  );
  expect(result.offerIdeas).toMatchObject({
    status: "ready",
    ideas: [{ name: "Tomaattipasta" }],
  });
  expect(env.provider.calls).toHaveLength(1);
  const prompt = JSON.stringify(env.provider.calls[0]);
  expect(prompt).not.toContain("synthetic-expired-offer");
  expect(prompt).not.toContain("synthetic-exhausted-offer");
  expect(prompt).not.toContain("synthetic-unavailable-offer");
  expect(env.reader.mock.calls.length).toBeLessThanOrEqual(2);
  expect(result.state).toEqual(before.state);
  expect(result.basket).toEqual(before.basket);
  expect(env.tools).toEqual([]);
});
