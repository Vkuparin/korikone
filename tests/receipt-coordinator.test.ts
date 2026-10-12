import { expect, test } from "vitest";
import { FakeInferenceProvider } from "../src/ai/fake-provider";
import { FixtureAI } from "../src/ai/fixtures";
import { InferenceSession, discoverInferenceModels } from "../src/ai/provider";
import type { ReceiptAI } from "../src/application/receipt-import";
import { Service } from "../src/application/service";
import { fixtureText, receiptFixtures } from "./fixtures/receipts";
import { memoryStorage } from "./helpers/purchase-fixtures";

const text = (id: string) =>
  fixtureText(receiptFixtures.find((f) => f.id === id)!);
async function profile() {
  const store = memoryStorage();
  const service = new Service(store.storage);
  await service.init();
  return { ...store, service };
}
/** The development alternative provider with a one-call session, as main gives receipts. */
async function ai(script?: (signal: AbortSignal) => Promise<string>) {
  const connection = new (class extends FixtureAI {
    prompts = 0;
    override async generatePinned(
      m: string,
      prompt: string,
      signal: AbortSignal,
    ) {
      this.prompts++;
      return script ? script(signal) : super.generatePinned(m, prompt, signal);
    }
  })();
  await connection.signIn();
  const provider = new FakeInferenceProvider(connection, true);
  const controller = new AbortController();
  let sessions = 0;
  const receiptAI: ReceiptAI = {
    providerId: provider.id,
    session: async () => {
      sessions++;
      const models = await discoverInferenceModels(provider, controller.signal);
      return new InferenceSession(
        provider,
        models[0],
        { maxCalls: 1, maxOutputCharacters: 100_000, timeoutMs: 5000 },
        controller.signal,
      );
    },
  };
  return { connection, controller, receiptAI, sessions: () => sessions };
}
const importReceipt = (
  service: Service,
  id: string,
  receiptAI: ReceiptAI | null,
) => service.importReceiptText({ text: text(id), format: "txt" }, receiptAI);
const consent = {
  automatic: true,
  providerId: "fake-alternative",
  scope: 1 as const,
};

test("without consent the import is local only; with automatic consent it makes one request", async () => {
  const { service } = await profile();
  const state = structuredClone(service.state);
  const first = await ai();
  const local = await importReceipt(
    service,
    "s-weighed-produce",
    first.receiptAI,
  );
  expect(local.purchaseImport).toMatchObject({
    outcome: "added",
    reconciliation: "balanced",
  });
  expect(local.receiptEnrichment).toBeNull();
  expect([first.sessions(), first.connection.prompts]).toEqual([0, 0]);

  await service.setReceiptConsent(consent);
  // A repeat of the same receipt asks nothing: only a new or changed purchase is enriched.
  const repeat = await importReceipt(
    service,
    "s-weighed-produce",
    first.receiptAI,
  );
  expect(repeat.purchaseImport).toMatchObject({ outcome: "duplicate" });
  expect(repeat.receiptEnrichment).toBeNull();
  expect(first.connection.prompts).toBe(0);

  const added = await importReceipt(service, "k-weighed", first.receiptAI);
  expect(added.receiptEnrichment).toMatchObject({
    status: "enriched",
    reason: null,
    accepted: 1,
    rejected: 0,
    unresolved: 1,
    omitted: 0,
  });
  expect(first.connection.prompts).toBe(1);
  const ledger = await service.purchases.ledger();
  expect(
    ledger.annotations
      .filter((a) => a.origin === "model")
      .map((a) => [a.name, a.category, a.model?.providerId]),
  ).toEqual([["Banaani", null, "fake-alternative"]]);
  // Facts of both purchases are exactly what the local import committed.
  expect(
    ledger.events.every((e) => e.reconciliation.status === "balanced"),
  ).toBe(true);
  // No list, quote, preference or revision changed.
  expect(service.state).toEqual(state);
  // Consent for another provider does not cover this one.
  await service.setReceiptConsent({ ...consent, providerId: "chatgpt" });
  const other = await importReceipt(service, "s-five-groups", first.receiptAI);
  expect(other.receiptEnrichment).toBeNull();
  expect(first.connection.prompts).toBe(1);
  await expect(
    service.setReceiptConsent({ ...consent, scope: 2 }),
  ).rejects.toThrow();
});

test("an explicit one-receipt action needs its own answer and is one request each time", async () => {
  const { service } = await profile();
  const { receiptAI, connection } = await ai();
  await importReceipt(service, "s-weighed-produce", receiptAI);
  const [event] = (await service.purchases.ledger()).events;
  const once = { providerId: "fake-alternative", scope: 1 };
  await expect(
    service.enrichPurchase({ eventId: event.id }, receiptAI),
  ).rejects.toThrow();
  const wrong = await service.enrichPurchase(
    { eventId: event.id, consent: { providerId: "chatgpt", scope: 1 } },
    receiptAI,
  );
  expect(wrong.receiptEnrichment).toMatchObject({
    status: "skipped",
    reason: "consent",
  });
  expect(connection.prompts).toBe(0);
  const done = await service.enrichPurchase(
    { eventId: event.id, consent: once },
    receiptAI,
  );
  expect(done.receiptEnrichment).toMatchObject({
    status: "enriched",
    accepted: 1,
    unresolved: 1,
  });
  // A retry is a new bounded action on the same receipt, not an automatic chain.
  await service.enrichPurchase({ eventId: event.id, consent: once }, receiptAI);
  expect(connection.prompts).toBe(2);
  const ledger = await service.purchases.ledger();
  expect(ledger.annotations.filter((a) => a.origin === "model")).toHaveLength(
    1,
  );
  // The answer for one receipt saved no durable consent.
  expect(ledger.consent).toEqual({ automatic: null, asked: false });
  expect(
    (
      await service.enrichPurchase(
        { eventId: "missing", consent: once },
        receiptAI,
      )
    ).receiptEnrichment,
  ).toMatchObject({ status: "failed" });
});

test("no provider, quota, failure and cancellation leave the committed purchase intact", async () => {
  const { service } = await profile();
  await service.setReceiptConsent(consent);
  expect(
    (await importReceipt(service, "s-weighed-produce", null)).receiptEnrichment,
  ).toBeNull();
  const facts = JSON.stringify((await service.purchases.ledger()).events);
  const [event] = (await service.purchases.ledger()).events;
  const once = { providerId: "fake-alternative", scope: 1 };
  expect(
    (await service.enrichPurchase({ eventId: event.id, consent: once }, null))
      .receiptEnrichment,
  ).toMatchObject({ status: "unavailable", reason: "unsupportedProvider" });
  for (const [scenario, status, reason] of [
    ["usageLimit", "failed", "usageLimit"],
    ["aiFailed", "failed", "transport"],
    ["invalidDraft", "failed", "invalidOutput"],
  ] as const) {
    const run = await ai();
    run.connection.scenario = scenario;
    expect(
      (
        await service.enrichPurchase(
          { eventId: event.id, consent: once },
          run.receiptAI,
        )
      ).receiptEnrichment,
    ).toMatchObject({ status, reason, accepted: 0 });
    expect(run.connection.prompts).toBe(1);
  }
  const cancelled = await ai(
    (signal) =>
      new Promise((_, reject) =>
        signal.addEventListener("abort", () =>
          reject(Object.assign(new Error("x"), { name: "AbortError" })),
        ),
      ),
  );
  const pending = service.enrichPurchase(
    { eventId: event.id, consent: once },
    cancelled.receiptAI,
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  cancelled.controller.abort();
  expect((await pending).receiptEnrichment).toMatchObject({
    status: "cancelled",
  });
  const ledger = await service.purchases.ledger();
  expect(JSON.stringify(ledger.events)).toBe(facts);
  expect(ledger.annotations.every((a) => a.origin === "rule")).toBe(true);
  expect(service.snapshot().purchaseImport).toMatchObject({ outcome: "added" });
});

test("a correction or deletion made while the model answers wins over its late result", async () => {
  for (const change of ["correct", "delete"] as const) {
    const { service } = await profile();
    const reply = JSON.stringify({
      version: 1,
      rows: [
        {
          rowId: "r0",
          name: "Banaani",
          category: null,
          qualifiers: [],
          scope: "food",
        },
      ],
    });
    let release = () => {};
    const run = await ai(
      () => new Promise<string>((resolve) => (release = () => resolve(reply))),
    );
    await importReceipt(service, "s-weighed-produce", null);
    const [event] = (await service.purchases.ledger()).events;
    const pending = service.enrichPurchase(
      {
        eventId: event.id,
        consent: { providerId: "fake-alternative", scope: 1 },
      },
      run.receiptAI,
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    if (change === "correct")
      await service.correctPurchase({
        eventId: event.id,
        lineId: "l1",
        revision: 1,
        field: "quantity",
        amount: 950,
        unit: "g",
      });
    else await service.deletePurchase({ eventId: event.id, scope: "event" });
    release();
    expect((await pending).receiptEnrichment).toMatchObject({
      status: "stale",
      reason: "enrichmentStale",
      accepted: 0,
    });
    const ledger = await service.purchases.ledger();
    expect(ledger.annotations.some((a) => a.origin === "model")).toBe(false);
    if (change === "correct")
      expect(ledger.events[0].lines[0].quantity).toEqual({
        amount: 950,
        unit: "g",
        provenance: "user",
      });
    else expect(ledger.events).toEqual([]);
  }
});

test("corrections keep the source facts auditable, rerun the balance and remember nothing", async () => {
  const { service, storage } = await profile();
  await importReceipt(service, "unbalanced-total", null);
  await importReceipt(service, "partial-missing-price", null);
  const preferences = structuredClone(service.state.categoryPreferences);
  let view = await service.purchaseView();
  const unbalanced = view.purchases.find(
    (p) => p.reconciliation.status === "unbalanced",
  )!;
  const partial = view.purchases.find(
    (p) => p.reconciliation.status === "incomplete",
  )!;
  expect(unbalanced).toMatchObject({
    revision: 1,
    reviewCount: 0,
    retention: "sanitized",
  });
  expect(partial.lines[0].review).toEqual([
    "missing-amount",
    "unknown-quantity",
    "uninterpreted",
  ]);
  expect(partial.reviewCount).toBe(1);

  // The bread was really 2,39: the receipt then balances, and the correction is marked as the shopper's.
  await service.correctPurchase({
    eventId: unbalanced.eventId,
    lineId: "l2",
    revision: 1,
    field: "gross",
    amount: 239,
  });
  view = await service.purchaseView();
  const fixed = view.purchases.find((p) => p.eventId === unbalanced.eventId)!;
  expect(fixed).toMatchObject({
    revision: 2,
    reconciliation: {
      status: "balanced",
      computedTotal: 358,
      printedTotal: 358,
      difference: 0,
    },
  });
  expect(fixed.lines[1]).toMatchObject({
    label: "RUISLEIPÄ",
    gross: 239,
    net: 239,
    provenance: "user",
    span: { page: 1, line: 5, endLine: 5 },
  });
  // The printed total stays the source's own; the other line keeps its source provenance.
  expect(fixed.printed).toEqual(unbalanced.printed);
  expect(fixed.lines[0].provenance).toBe("source");
  // The interpretation made for the old facts of that line is gone; the other line keeps its own.
  expect(fixed.lines.map((l) => l.interpretation?.origin ?? null)).toEqual([
    "rule",
    null,
  ]);
  // A request made for the old revision is refused, as is any attempt to edit the label.
  await expect(
    service.correctPurchase({
      eventId: unbalanced.eventId,
      lineId: "l2",
      revision: 1,
      field: "gross",
      amount: 1,
    }),
  ).rejects.toThrow("purchaseStale");
  await expect(
    service.correctPurchase({
      eventId: unbalanced.eventId,
      lineId: "l2",
      revision: 2,
      field: "label",
      label: "x",
    }),
  ).rejects.toThrow();
  await expect(
    service.correctPurchase({
      eventId: "none",
      lineId: "l2",
      revision: 2,
      field: "gross",
      amount: 1,
    }),
  ).rejects.toThrow("purchaseMissing");

  // Completing the missing price and quantity of the apple row, then saying what it is.
  await service.correctPurchase({
    eventId: partial.eventId,
    lineId: "l1",
    revision: 1,
    field: "gross",
    amount: 199,
  });
  await service.correctPurchase({
    eventId: partial.eventId,
    lineId: "l1",
    revision: 2,
    field: "quantity",
    amount: 1000,
    unit: "g",
  });
  await service.interpretPurchase({
    eventId: partial.eventId,
    lineId: "l1",
    revision: 3,
    name: "Omena",
    category: null,
    qualifiers: [],
    scope: "food",
  });
  view = await service.purchaseView();
  const completed = view.purchases.find((p) => p.eventId === partial.eventId)!;
  expect(completed).toMatchObject({
    revision: 4,
    reviewCount: 0,
    reconciliation: { status: "balanced", computedTotal: 318 },
  });
  expect(completed.lines[0].interpretation).toEqual({
    origin: "user",
    name: "Omena",
    category: null,
    qualifiers: [],
    scope: "food",
  });
  await expect(
    service.interpretPurchase({
      eventId: partial.eventId,
      lineId: "l1",
      revision: 4,
      name: "Maito",
      category: "milk",
      qualifiers: [{ kind: "meat", value: "beef" }],
      scope: "food",
    }),
  ).rejects.toThrow();
  // Nothing became a household preference, and a restart shows the same corrected history.
  expect(service.state.categoryPreferences).toEqual(preferences);
  const restarted = new Service(storage);
  await restarted.init();
  expect((await restarted.purchaseView()).purchases).toEqual(view.purchases);
  // Deleting interpretations or the event is scoped, and the view follows.
  await restarted.deletePurchase({
    eventId: partial.eventId,
    scope: "annotations",
  });
  expect(
    (await restarted.purchaseView()).purchases.find(
      (p) => p.eventId === partial.eventId,
    )!.lines[0].interpretation,
  ).toBeNull();
  await restarted.deletePurchase({ eventId: partial.eventId, scope: "event" });
  const after = await restarted.purchaseView();
  expect(after.purchases.map((p) => p.eventId)).toEqual([unbalanced.eventId]);
  expect(after).toMatchObject({
    legacy: null,
    dataScope: 1,
    consent: { automatic: null, asked: false },
  });
});

test("a model proposal is shown as a proposal until the shopper accepts or replaces it", async () => {
  const { service } = await profile();
  const run = await ai();
  await importReceipt(service, "s-weighed-produce", null);
  const [event] = (await service.purchases.ledger()).events;
  await service.enrichPurchase(
    {
      eventId: event.id,
      consent: { providerId: "fake-alternative", scope: 1 },
    },
    run.receiptAI,
  );
  let [purchase] = (await service.purchaseView()).purchases;
  expect(
    purchase.lines.map((l) => [
      l.label,
      l.interpretation?.origin ?? null,
      l.review,
    ]),
  ).toEqual([
    ["BANAANI", "model", ["model-proposal"]],
    ["OMENA PUNAINEN", null, ["uninterpreted"]],
    ["SIPULI KELTAINEN", "rule", []],
  ]);
  // Accepting it makes it the shopper's own; the earlier proposal stays visible beside it.
  await service.interpretPurchase({
    eventId: event.id,
    lineId: "l1",
    revision: 1,
    name: "Banaani",
    category: null,
    qualifiers: [],
    scope: "food",
  });
  [purchase] = (await service.purchaseView()).purchases;
  expect(purchase.lines[0]).toMatchObject({
    interpretation: { origin: "user", name: "Banaani" },
    proposal: { origin: "model", name: "Banaani" },
    review: [],
  });
  expect(purchase.reviewCount).toBe(1);
});
