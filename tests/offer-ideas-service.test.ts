import { expect, test, vi } from "vitest";
import { createFixtureService } from "./fixtures/ai-shopping/environment";
import { ScriptedInferenceProvider } from "./helpers/inference";
import { InferenceSession } from "../src/ai/provider";
import { offerIdeasTask } from "../src/ai/tasks";
import type { OfferSourceResult } from "../src/domain/offers";
import { personalOffer } from "./fixtures/offers";

const ready: OfferSourceResult = {
  providerId: "k-ruoka",
  storeId: "synthetic-store",
  status: "ready",
  accountKey: "k-ruoka:0123456789abcdef",
  offers: [personalOffer],
  truncated: false,
};
async function environment(result: OfferSourceResult = ready) {
  const env = await createFixtureService("k-ruoka", {});
  const retailer = env.service.registry.get("k-ruoka");
  retailer.capabilities.offers = { public: false, personal: true };
  const reader = vi.fn(async () => result);
  retailer.readOffers = reader;
  const provider = new ScriptedInferenceProvider(
    "fake-alternative",
    async () => ({
      text: JSON.stringify({
        ideas: [
          {
            name: "Kahvipannukakku",
            products: [
              {
                offerId: personalOffer.id,
                productId: personalOffer.products[0].id,
              },
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

test("real service validates ideas without changing the saved list, quote, review or cart", async () => {
  const env = await environment();
  const before = env.service.snapshot();
  const result = await env.service.suggestOffers(
    { consent: true },
    env.session,
  );
  expect(result.offerIdeas).toMatchObject({
    status: "ready",
    ideas: [{ name: "Kahvipannukakku" }],
  });
  expect(JSON.stringify(result.offerIdeas)).not.toContain("accountKey");
  expect(JSON.stringify(result.offerIdeas)).not.toContain(ready.accountKey);
  expect(result.state).toEqual(before.state);
  expect(result.basket).toEqual(before.basket);
  expect(result.review).toEqual(before.review);
  expect(result.journal).toEqual(before.journal);
  expect(env.reader).toHaveBeenCalledTimes(2);
  expect(env.provider.calls).toHaveLength(1);
  expect(env.tools).toEqual([]);
});

test.each([
  { ...ready, offers: [] },
  {
    providerId: "k-ruoka",
    storeId: "synthetic-store",
    status: "unsupported",
    reason: "no-discovery-source",
  },
  { providerId: "k-ruoka", storeId: "synthetic-store", status: "signed-out" },
  {
    providerId: "k-ruoka",
    storeId: "synthetic-store",
    status: "error",
    code: "storeBlocked",
  },
] as OfferSourceResult[])(
  "$status source does not discover models or invoke inference",
  async (source) => {
    const env = await environment(source);
    const result = await env.service.suggestOffers(
      { consent: true },
      env.session,
    );
    expect(result.offerIdeas?.status).toBe(
      source.status === "ready" ? "empty" : source.status,
    );
    expect(env.session).not.toHaveBeenCalled();
    expect(env.provider.calls).toHaveLength(0);
  },
);

test.each(["account", "offer", "signed-out"])(
  "a changed %s after inference prevents publication",
  async (change) => {
    const env = await environment();
    env.reader
      .mockImplementationOnce(async () => ready)
      .mockImplementationOnce(async () =>
        change === "signed-out"
          ? {
              providerId: "k-ruoka",
              storeId: "synthetic-store",
              status: "signed-out",
            }
          : {
              ...ready,
              accountKey:
                change === "account"
                  ? "k-ruoka:fedcba9876543210"
                  : ready.accountKey,
              offers: change === "offer" ? [] : ready.offers,
            },
      );
    const before = structuredClone(env.service.state);
    await expect(
      env.service.suggestOffers({ consent: true }, env.session),
    ).rejects.toThrow(change === "offer" ? "contextChanged" : "accountChanged");
    expect(env.service.snapshot().offerIdeas).toMatchObject({
      status: "error",
    });
    expect(env.service.state).toEqual(before);
  },
);

test("active-context change hides stale ideas and consent remains mandatory", async () => {
  const env = await environment();
  await expect(
    env.service.suggestOffers({ consent: false }, env.session),
  ).rejects.toThrow();
  expect(env.reader).not.toHaveBeenCalled();
  await env.service.suggestOffers({ consent: true }, env.session);
  await env.service.save({
    ...env.service.state,
    context: { ...env.service.state.context, storeId: "other" },
  });
  expect(env.service.snapshot().offerIdeas).toBeNull();
});

test("cancellation during inference leaves the saved list unchanged", async () => {
  const env = await environment();
  const before = structuredClone(env.service.state);
  const cancelledSession = async (signal: AbortSignal, maxCalls: number) => {
    const inference = await env.session(signal, maxCalls);
    env.service.cancelOfferIdeas();
    return inference;
  };
  await expect(
    env.service.suggestOffers({ consent: true }, cancelledSession),
  ).rejects.toThrow("aiCancelled");
  expect(env.service.snapshot().offerIdeas).toMatchObject({
    status: "error",
    code: "aiCancelled",
  });
  expect(env.provider.calls).toHaveLength(0);
  expect(env.service.state).toEqual(before);
});
