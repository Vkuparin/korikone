import { expect, test } from "vitest";
import { InferenceError, InferenceSession } from "../src/ai/provider";
import {
  offerIdeaFacts,
  suggestOfferIdeas,
  validateOfferIdeas,
} from "../src/ai/offers";
import { offerIdeasTask } from "../src/ai/tasks";
import { ScriptedInferenceProvider } from "./helpers/inference";
import { personalOffer } from "./fixtures/offers";

const now = () => new Date("2026-10-12T10:00:00Z");
const output = {
  ideas: [
    {
      name: "Kahvipannukakku",
      products: [
        { offerId: personalOffer.id, productId: personalOffer.products[0].id },
      ],
    },
  ],
};
function setup(reply: () => Promise<string>, native = false, maxCalls = 2) {
  const provider = new ScriptedInferenceProvider(
    "fake-alternative",
    async () => ({ text: await reply(), completion: "complete" }),
  );
  provider.models[0].capabilities.tasks.push(offerIdeasTask);
  if (native)
    provider.models[0].capabilities.outputModes = ["text", "json-schema"];
  const controller = new AbortController();
  const session = new InferenceSession(
    provider,
    provider.models[0],
    { maxCalls, timeoutMs: 1000, maxOutputCharacters: 12000 },
    controller.signal,
  );
  return { provider, session, controller };
}

test.each([false, true])(
  "alternative provider validates %s native/text output and derives factual conditions",
  async (native) => {
    const { provider, session } = setup(
      async () => JSON.stringify(output),
      native,
    );
    const ideas = await suggestOfferIdeas(session, [personalOffer], "fi", now);
    expect(ideas).toEqual([
      {
        id: expect.any(String),
        name: "Kahvipannukakku",
        products: [
          {
            offerId: personalOffer.id,
            productId: personalOffer.products[0].id,
            name: personalOffer.products[0].name,
            price: personalOffer.price,
            validUntil: personalOffer.validUntil,
            remainingRedemptions: 2,
            eligibility: "conditional",
            conditions: personalOffer.conditions,
          },
        ],
      },
    ]);
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]).toMatchObject({
      task: offerIdeasTask,
      model: { providerId: "fake-alternative" },
      maxOutputCharacters: 12000,
      output: { mode: native ? "json-schema" : "text" },
    });
    const prompt = provider.calls[0].prompt;
    expect(prompt).not.toContain("normalPrice");
    expect(prompt).not.toContain("accountKey");
    expect(prompt).not.toContain(personalOffer.title);
  },
);

test("allowlist contains available products only and preserves bundle prices without division", () => {
  const source = {
    ...personalOffer,
    products: [
      ...personalOffer.products,
      { id: "2000000000028", name: "Unavailable", available: false },
    ],
  };
  const facts = offerIdeaFacts([source], now());
  expect(facts).toHaveLength(1);
  expect(facts[0].price.amount).toBe(900);
  expect(facts[0].price.quantity).toBe(3);
  expect(
    offerIdeaFacts([{ ...source, validUntil: "2020-01-01" }], now()),
  ).toEqual([]);
});

test.each([
  { ideas: [{ ...output.ideas[0], price: 1 }] },
  { ideas: [{ ...output.ideas[0], eligibility: "eligible" }] },
  { ideas: [{ ...output.ideas[0], name: "Ilmainen kahvipannukakku" }] },
  { ideas: [{ ...output.ideas[0], name: "Kahvipannukakku 1 €" }] },
  {
    ideas: [
      {
        ...output.ideas[0],
        products: [
          { offerId: "invented", productId: personalOffer.products[0].id },
        ],
      },
    ],
  },
  {
    ideas: [
      {
        ...output.ideas[0],
        products: [{ offerId: personalOffer.id, productId: "2000000000028" }],
      },
    ],
  },
  {
    ideas: [
      {
        ...output.ideas[0],
        products: [...output.ideas[0].products, ...output.ideas[0].products],
      },
    ],
  },
  { ideas: [output.ideas[0], output.ideas[0]] },
  {
    ideas: Array.from({ length: 5 }, (_, n) => ({
      ...output.ideas[0],
      name: `Name${n}`,
    })),
  },
  { ideas: [] },
])(
  "invented facts, duplicate references or malformed ideas fail validation",
  (raw) => {
    expect(() =>
      validateOfferIdeas(
        JSON.stringify(raw),
        offerIdeaFacts([personalOffer], now()),
      ),
    ).toThrow("invalidOutput");
  },
);

test.each([false, true])(
  "one corrective retry is the maximum for %s native/text invalid output",
  async (native) => {
    let count = 0;
    const repaired = setup(
      async () => (++count === 1 ? '{"ideas":[]}' : JSON.stringify(output)),
      native,
    );
    expect(
      await suggestOfferIdeas(repaired.session, [personalOffer], "en", now),
    ).toHaveLength(1);
    expect(repaired.provider.calls).toHaveLength(2);
    const invalid = setup(async () => '{"ideas":[]}', native);
    await expect(
      suggestOfferIdeas(invalid.session, [personalOffer], "fi", now),
    ).rejects.toThrow();
    expect(invalid.provider.calls).toHaveLength(2);
  },
);

test("provider failures are terminal and do not spend a corrective request", async () => {
  const { provider, session } = setup(async () => {
    throw new InferenceError("usageLimit");
  });
  await expect(
    suggestOfferIdeas(session, [personalOffer], "fi", now),
  ).rejects.toThrow("usageLimit");
  expect(provider.calls).toHaveLength(1);
});

test("session request limit remains authoritative during repair", async () => {
  const { provider, session } = setup(async () => '{"ideas":[]}', false, 1);
  await expect(
    suggestOfferIdeas(session, [personalOffer], "fi", now),
  ).rejects.toThrow("requestLimit");
  expect(provider.calls).toHaveLength(1);
});

test("cancellation does not publish ideas or request repair", async () => {
  const env = setup(async () => {
    env.controller.abort();
    return JSON.stringify(output);
  });
  await expect(
    suggestOfferIdeas(env.session, [personalOffer], "fi", now),
  ).rejects.toThrow("cancelled");
  expect(env.provider.calls).toHaveLength(1);
});

test("expiry during inference invalidates the product reference", async () => {
  let time = new Date("2026-10-12T10:00:00Z");
  const offer = { ...personalOffer, validUntil: "2026-10-12T10:01:00Z" };
  const { session, provider } = setup(async () => {
    time = new Date("2026-10-12T10:02:00Z");
    return JSON.stringify(output);
  });
  await expect(
    suggestOfferIdeas(session, [offer], "fi", () => time),
  ).rejects.toThrow("invalidOutput");
  expect(provider.calls).toHaveLength(2);
});

test("empty current offer facts start no inference request", async () => {
  const { session, provider } = setup(async () => JSON.stringify(output));
  await expect(suggestOfferIdeas(session, [], "fi", now)).rejects.toThrow(
    "invalidOutput",
  );
  expect(provider.calls).toHaveLength(0);
});
