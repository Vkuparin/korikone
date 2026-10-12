import { expect, test } from "vitest";
import { Service } from "../src/application/service";
import { observationsApply } from "../src/domain/memory";
import { DemoProvider } from "../src/stores/demo";
import { memoryStorage } from "./helpers/purchase-fixtures";
import { ScriptedInferenceProvider } from "./helpers/inference";
import { inferenceTasks } from "../src/ai/tasks";
import { fixtureText, receiptFixtures } from "./fixtures/receipts";

/**
 * F18.2: observed purchase summaries reach the planning prompt only for a request that asks for
 * what is usually bought, only from confirmed evidence, and a deleted interpretation is gone
 * from the next request. The scripted provider answers nothing usable, so only the prompt matters.
 */
async function setup() {
  const store = memoryStorage();
  const service = new Service(store.storage);
  service.developmentMode = true;
  service.registry.register(new DemoProvider("s-kaupat"));
  await service.init();
  for (const id of ["s-basic-campaign", "trip-original"]) {
    const fixture = receiptFixtures.find((f) => f.id === id)!;
    await service.importReceiptText({
      text: fixtureText(fixture),
      format: "txt",
    });
  }
  const provider = new ScriptedInferenceProvider("scripted", async () => ({
    text: "{}",
    completion: "complete",
  }));
  provider.models[0].capabilities.tasks = inferenceTasks;
  const plan = async (prompt: string) => {
    const before = provider.calls.length;
    await service
      .planShopping({ prompt, consent: true }, async (run) =>
        run.bindInference(provider, provider.models[0]),
      )
      .catch(() => undefined);
    return provider.calls.slice(before).map((c) => c.prompt);
  };
  return { service, provider, plan };
}
const summaries = (prompt: string) =>
  JSON.parse(
    prompt.match(/"observedSummaries":(\[.*?\])\}\./)?.[1] ??
      prompt.match(/"observedSummaries":(\[.*?\])/)![1],
  ) as { classification: { category: string }; observations: number }[];

test("only a request for the usual gets observed summaries, and unrelated history stays out", async () => {
  expect(observationsApply("Tee tavalliset aamupalat")).toBe(true);
  expect(observationsApply("the usual breakfasts please")).toBe(true);
  expect(observationsApply("Nakkikeitto ja pasta")).toBe(false);
  expect(observationsApply("2 l maitoa")).toBe(false);
  const { plan } = await setup();
  const usual = await plan("Tee tavalliset aamupalat viikolle");
  expect(usual.length).toBeGreaterThan(0);
  // Each grocery bought twice at the receipts' shops, confirmed by a local rule.
  expect(
    summaries(usual[0])
      .map((s) => [s.classification.category, s.observations])
      .sort(),
  ).toEqual([
    ["bread", 2],
    ["coffee", 2],
    ["milk", 2],
  ]);
  // The note itself and nothing from the receipts (stores, dates, amounts) is in the prompt.
  expect(usual[0]).not.toMatch(/Esimerkki|2026|YHTEENS|Kuitti/);
  const plain = await plan("Nakkikeitto ja kanapasta");
  expect(summaries(plain[0])).toEqual([]);
});

test("forgotten interpretations disappear from the next request and reading history makes no call", async () => {
  const { service, provider, plan } = await setup();
  const first = await plan("Kuten tavallisesti, aamupalat");
  expect(summaries(first[0]).length).toBeGreaterThan(0);

  const calls = provider.calls.length;
  const insights = await service.purchaseInsights(new Date());
  expect(insights.observedSummaries.length).toBeGreaterThan(0);
  // Navigating to History or Data reads insights only: no model request.
  expect(provider.calls.length).toBe(calls);

  const ledger = await service.purchases.ledger();
  for (const event of ledger.events)
    await service.deletePurchase({ eventId: event.id, scope: "annotations" });
  const after = await plan("Kuten tavallisesti, aamupalat");
  expect(summaries(after[0])).toEqual([]);
  // Forgetting interpretations kept the facts: the receipts and their totals are intact.
  expect((await service.purchases.ledger()).events).toHaveLength(2);
});
