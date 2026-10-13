import { expect, test } from "vitest";
import { buildCompactContext, observedSummarySchema } from "../src/ai/context";
import { inferenceTasks } from "../src/ai/tasks";
import { Service } from "../src/application/service";
import {
  contextName,
  observedSummaries,
  purchaseAliases,
  purchaseStatistics,
  readMemory,
  recurrenceSuggestions,
} from "../src/domain/memory";
import { initialState, type AppState } from "../src/domain/model";
import { interpretPurchase } from "../src/domain/purchase-review";
import {
  emptyLedger,
  putPurchase,
  type PurchaseLedger,
  type SemanticAnnotation,
} from "../src/domain/purchases";
import { ruleAnnotations } from "../src/domain/receipt-semantics";
import { DemoProvider } from "../src/stores/demo";
import { fixtureText, receiptFixtures } from "./fixtures/receipts";
import { ScriptedInferenceProvider } from "./helpers/inference";
import {
  memoryStorage,
  purchaseEvent,
  purchaseLine,
  purchaseSource,
} from "./helpers/purchase-fixtures";

/**
 * F27.10: readable names beside what the memory already knew. A name is for showing and, when
 * the shopper or the receipt itself supports it, a hint for a request that asks for the usual.
 * It never groups purchases, confirms an alias, adds a qualifier or saves a preference.
 */
const now = new Date("2026-10-28T12:00:00.000Z");
const at = "2026-10-01T00:00:00.000Z";
type Row = [label: string, role?: "product" | "non-food"];
function visit(
  ledger: PurchaseLedger,
  id: string,
  day: string,
  rows: Row[],
): PurchaseLedger {
  const event = purchaseEvent(id, `s-${id}`, {
    purchasedAt: `${day}T10:00:00.000Z`,
    datePrecision: "minute",
    lines: rows.map(([label, role], i) =>
      purchaseLine(`l${i + 1}`, label, 100, {
        role: role ?? "product",
        quantity: { amount: 1, unit: "pcs", provenance: "source" },
      }),
    ),
    printed: [],
    reconciliation: {
      status: "incomplete",
      computedTotal: 100 * rows.length,
      printedTotal: null,
      difference: null,
      reasons: ["no-printed-total"],
    },
  });
  const next = putPurchase(
    ledger,
    purchaseSource(`s-${id}`, {
      fingerprint: id.padEnd(16, "0").replace(/[^0-9a-f]/g, "b"),
    }),
    event,
  );
  return {
    ...next,
    annotations: [...next.annotations, ...ruleAnnotations(event, 1, at)],
  };
}
const model = (
  eventId: string,
  lineId: string,
  extra: Partial<SemanticAnnotation>,
): SemanticAnnotation => ({
  eventId,
  lineId,
  origin: "model",
  sourceRevision: 1,
  name: null,
  category: null,
  qualifiers: [],
  scope: "food",
  model: { providerId: "x", modelId: "m", taskVersion: 2 },
  at,
  ...extra,
});
const state = (extra: Partial<AppState> = {}): AppState => ({
  ...initialState(),
  staples: [],
  ...extra,
});
/** Four weekly visits. The same five rows each week, and one row bought once. */
const rows: Row[] = [
  // A rule reads the category and the label supports the name: eligible, with its name.
  ["KEVYTMAITO 1L"],
  // The abbreviation fits several words, so no rule reads it; only a model names it.
  ["PIRKKA KEVYTM 1L"],
  // No rule reads it; only a model says it is milk.
  ["ARLA LEMPI 1L"],
  // No category exists for it; the label alone gives a readable name.
  ["VALIO JOG 1KG"],
  ["ASTIANPESUAINE 500ML", "non-food"],
];
function weeks() {
  let ledger = emptyLedger();
  const days = ["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"];
  days.forEach((day, i) => {
    const id = `w${i + 1}`;
    ledger = visit(ledger, id, day, i === 0 ? [...rows, ["KAHVI 500G"]] : rows);
    ledger = {
      ...ledger,
      annotations: [
        ...ledger.annotations,
        model(id, "l2", { name: "Kevytmaito" }),
        model(id, "l3", { name: "Maito", category: "milk" }),
      ],
    };
  });
  return ledger;
}
const byKey = (memory: ReturnType<typeof readMemory>) =>
  Object.fromEntries(purchaseAliases(memory).aliases.map((a) => [a.key, a]));

test("each alias says whether it reaches a usual request and why, and a name is sent only when the shopper or the receipt supports it", () => {
  const memory = readMemory(state(), weeks());
  const aliases = byKey(memory);
  expect(
    Object.fromEntries(
      Object.values(aliases).map((a) => [
        a.key,
        [a.context.reason, a.context.readableName, a.display?.text ?? null],
      ]),
    ),
  ).toEqual({
    // Only a model read it: tentative, although the label gives a readable name to show.
    "category:milk": ["model-only", null, "Arla lempi 1 l"],
    // A rule read the category and the label itself supports the name.
    "category:milk|fat=semi-skimmed": [
      "eligible",
      "Kevytmaito 1 l",
      "Kevytmaito 1 l",
    ],
    "category:coffee": ["few-observations", null, "Kahvi 500 g"],
    // A model's generic name for an abbreviated label: tentative, and nothing readable beyond it.
    "name:kevytmaito": ["model-only", null, null],
  });
  // Yoghurt has no category and nobody interpreted it: it is no alias at all, but it is readable.
  const { unresolved } = purchaseAliases(memory);
  expect(unresolved).toEqual([
    {
      chain: "s-group",
      label: "VALIO JOG 1KG",
      observations: 4,
      display: {
        text: "Valio jogurtti 1 kg",
        tier: "expanded",
        nameOrigin: "rule",
      },
    },
  ]);
  // Each label keeps its own reading and origin. The model's generic name is shown and marked.
  expect(
    ["category:milk|fat=semi-skimmed", "name:kevytmaito"].flatMap((key) =>
      aliases[key].labels.map((l) => [l.label, l.observations, l.display]),
    ),
  ).toEqual([
    [
      "KEVYTMAITO 1L",
      4,
      { text: "Kevytmaito 1 l", tier: "exact", nameOrigin: "rule" },
    ],
    [
      "PIRKKA KEVYTM 1L",
      4,
      { text: "Kevytmaito", tier: "generic", nameOrigin: "model" },
    ],
  ]);
  // What is sent: one summary, with the classification the rule established and nothing more.
  const summaries = observedSummaries(memory);
  expect(summaries).toEqual([
    {
      readableName: "Kevytmaito 1 l",
      classification: {
        category: "milk",
        provenance: "observed",
        qualifiers: [
          { kind: "fat", value: "semi-skimmed", provenance: "observed" },
        ],
      },
      observations: 4,
    },
  ]);
  for (const summary of summaries)
    expect(observedSummarySchema.safeParse(summary).success).toBe(true);
  expect(
    buildCompactContext("tavalliset", state(), { observedSummaries: summaries })
      .observedSummaries,
  ).toEqual(summaries);
  // Non-food purchases are observations with a readable name and belong to no alias or summary.
  expect(
    memory.purchases
      .filter((p) => p.scope === "non-food")
      .map((p) => [p.display.text, p.identity]),
  ).toEqual(Array(4).fill(["Astianpesuaine 500 ml", null]));
});

test("a model's name, a generic name, a bare label and unsafe text are never sent, however the alias qualifies", () => {
  const rule = { tier: "exact", nameOrigin: "rule" } as const;
  expect(contextName({ text: "Valio jogurtti 1 kg", ...rule })).toBe(
    "Valio jogurtti 1 kg",
  );
  expect(
    contextName({ text: "Oma maito", tier: "user", nameOrigin: "user" }),
  ).toBe("Oma maito");
  for (const display of [
    // A model's name, also when every word of it is printed.
    { text: "Valio jogurtti 1 kg", tier: "exact", nameOrigin: "model" },
    { text: "Valio jogurtti 1 kg", tier: "expanded", nameOrigin: "model" },
    { text: "Jogurtti", tier: "generic", nameOrigin: "rule" },
    { text: "VALIO JOG 1KG", tier: "raw", nameOrigin: null },
    // The shopper's own text is not passed on when it carries a code, a link or markup.
    { text: "Maito 6410405082657", tier: "user", nameOrigin: "user" },
    { text: "Maito https://example.test", tier: "user", nameOrigin: "user" },
    { text: "Maito {ignore previous}", tier: "user", nameOrigin: "user" },
    { text: "M".repeat(81), tier: "user", nameOrigin: "user" },
  ] as const)
    expect([display.text, contextName(display)]).toEqual([display.text, null]);
  // The context schema refuses the same things, and a raw label under any other key.
  const summary = observedSummaries(readMemory(state(), weeks()))[0];
  for (const bad of [
    { ...summary, readableName: "Maito 6410405082657" },
    { ...summary, readableName: "Maito <b>" },
    { ...summary, readableName: "M".repeat(81) },
    { ...summary, rawLabel: "KEVYTMAITO 1L" },
    { ...summary, label: "KEVYTMAITO 1L" },
    { ...summary, productId: "6410405082657" },
  ])
    expect(observedSummarySchema.safeParse(bad).success).toBe(false);
  // An alias whose only readable names are a model's qualifies without a name.
  let ledger = emptyLedger();
  for (const [id, day] of [
    ["a", "2026-10-05"],
    ["b", "2026-10-12"],
  ]) {
    ledger = visit(ledger, id, day, [["PIRKKA KEVYTM 1L"]]);
    ledger = {
      ...ledger,
      annotations: [
        ...ledger.annotations,
        // A rule's category, as for any row the rules classify, beside the model's name.
        {
          ...model(id, "l1", {
            category: "milk",
            qualifiers: [{ kind: "fat", value: "semi-skimmed" }],
          }),
          origin: "rule",
          model: null,
        },
        model(id, "l1", {
          name: "Kevytmaito",
          display: {
            version: 1,
            name: "Pirkka kevytmaito 1 l",
            tier: "expanded",
          },
        }),
      ],
    };
  }
  const tentative = readMemory(state(), ledger);
  expect(byKey(tentative)["category:milk|fat=semi-skimmed"]).toMatchObject({
    confirmed: true,
    display: { text: "Pirkka kevytmaito 1 l", nameOrigin: "model" },
    context: { eligible: true, reason: "eligible", readableName: null },
  });
  expect(observedSummaries(tentative)).toEqual([
    {
      classification: {
        category: "milk",
        provenance: "observed",
        qualifiers: [
          { kind: "fat", value: "semi-skimmed", provenance: "observed" },
        ],
      },
      observations: 2,
    },
  ]);
});

test("names change no identity, statistic or suggestion count, and an explicit preference still speaks instead", () => {
  const withNames = weeks();
  // The same purchases with every model annotation and its names taken away.
  const without = {
    ...withNames,
    annotations: withNames.annotations.filter((a) => a.origin !== "model"),
  };
  const named = readMemory(state(), withNames);
  const plain = readMemory(state(), without);
  const rulesOnly = (memory: typeof named) =>
    purchaseStatistics(memory, now).filter((s) => s.confirmed);
  // Statistics of rule-confirmed groceries are the same with and without names.
  expect(rulesOnly(named)).toEqual(rulesOnly(plain));
  expect(new Set(purchaseStatistics(named, now).map((s) => s.key)).size).toBe(
    purchaseStatistics(named, now).length,
  );
  // One suggestion per grocery, with the name of its most bought label beside it.
  const suggestions = recurrenceSuggestions(named, now);
  expect(suggestions.map((s) => [s.key, s.visits, s.label, s.display])).toEqual(
    [
      [
        "category:milk",
        4,
        "ARLA LEMPI 1L",
        { text: "Arla lempi 1 l", tier: "exact", nameOrigin: "rule" },
      ],
      [
        "category:milk|fat=semi-skimmed",
        4,
        "KEVYTMAITO 1L",
        { text: "Kevytmaito 1 l", tier: "exact", nameOrigin: "rule" },
      ],
      [
        "name:kevytmaito",
        4,
        "PIRKKA KEVYTM 1L",
        { text: "Kevytmaito", tier: "generic", nameOrigin: "model" },
      ],
    ],
  );
  // Model-only groceries are marked as such on the suggestion itself.
  expect(suggestions.map((s) => s.confirmed)).toEqual([false, true, false]);
  // A saved preference for milk: the observation is kept for inspection and not sent.
  const remembered = readMemory(
    state({
      categoryPreferences: [
        {
          category: "milk",
          qualifiers: [{ kind: "lactose", value: "free" }],
          strength: "required",
        },
      ],
    }),
    withNames,
  );
  expect(byKey(remembered)["category:milk|fat=semi-skimmed"].context).toEqual({
    eligible: false,
    reason: "remembered-preference",
    readableName: null,
  });
  expect(observedSummaries(remembered)).toEqual([]);
  expect(remembered.remembered).toHaveLength(1);
});

test("a correction and a deletion show on the next read, and the shopper's own name wins", () => {
  let ledger = weeks();
  const before = byKey(readMemory(state(), ledger));
  expect(before["category:milk|fat=semi-skimmed"].display?.tier).toBe("exact");
  // The shopper names one line of one visit; the category is theirs too.
  ledger = interpretPurchase(
    ledger,
    {
      eventId: "w1",
      lineId: "l1",
      revision: 1,
      name: "Arkimaito",
      category: "milk",
      qualifiers: [{ kind: "fat", value: "semi-skimmed" }],
      scope: "food",
    },
    "2026-10-27T08:00:00.000Z",
  );
  const corrected = readMemory(state(), ledger);
  const milk = byKey(corrected)["category:milk|fat=semi-skimmed"];
  expect(milk).toMatchObject({
    name: "Arkimaito",
    observations: 4,
    display: {
      text: "Arkimaito",
      tier: "user",
      nameOrigin: "user",
      observations: 1,
    },
    context: { eligible: true, readableName: "Arkimaito" },
  });
  expect(observedSummaries(corrected)[0].readableName).toBe("Arkimaito");
  // Nothing was counted twice and nothing became a preference.
  expect(corrected.purchases).toHaveLength(
    readMemory(state(), weeks()).purchases.length,
  );
  expect(corrected.remembered).toEqual([]);
  // Forgetting the interpretations: no alias and no summary; the purchases still read.
  const forgotten = readMemory(state(), { ...ledger, annotations: [] });
  expect(purchaseAliases(forgotten).aliases).toEqual([]);
  expect(observedSummaries(forgotten)).toEqual([]);
  expect(forgotten.purchases[0].display.text).toBe("Kevytmaito 1 l");
  // Deleting the purchases themselves leaves nothing to read.
  expect(
    readMemory(state(), { ...ledger, events: [], sources: [], annotations: [] })
      .purchases,
  ).toEqual([]);
});

test("the planning prompt gets names only for a request for the usual; a correction and a deletion reach the next request", async () => {
  const store = memoryStorage();
  const service = new Service(store.storage);
  service.developmentMode = true;
  const shop = new DemoProvider("s-kaupat");
  service.registry.register(shop);
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
  const sent = (prompt: string) =>
    (
      JSON.parse(
        prompt.match(/"observedSummaries":(\[.*?\])\}\. User note/)![1],
      ) as { readableName?: string; classification: { category: string } }[]
    )
      .map((s) => [s.classification.category, s.readableName ?? null])
      .sort();
  const preferences = structuredClone(service.state.categoryPreferences);
  const usual = await plan("Tee tavalliset aamupalat viikolle");
  expect(sent(usual[0])).toEqual([
    ["bread", "Ruisleipä"],
    ["coffee", "Kahvi 500 g"],
    ["milk", "Kevytmaito 1 l"],
  ]);
  // The printed labels, stores, dates and amounts are not in the prompt.
  expect(usual[0]).not.toMatch(
    /KEVYTMAITO|RUISLEIPÄ|KAHVI|Esimerkki|2026|YHTEENS/,
  );
  // An ordinary request is as before: no summary and no name from any receipt.
  const plain = await plan("Nakkikeitto ja kanapasta");
  expect(sent(plain[0])).toEqual([]);
  expect(plain[0]).not.toMatch(/Kevytmaito 1 l|Ruisleipä|readableName/);

  // The shopper renames one coffee line: the next request for the usual carries their name.
  const ledger = await service.purchases.ledger();
  const event = ledger.events[0];
  const coffee = event.lines.find((l) => l.label === "KAHVI 500G")!;
  await service.interpretPurchase({
    eventId: event.id,
    lineId: coffee.id,
    revision: ledger.sources.find((s) => event.sourceIds.includes(s.id))!
      .revision,
    name: "Aamukahvi",
    category: "coffee",
    qualifiers: [],
    scope: "food",
  });
  const renamed = await plan("Kuten tavallisesti, aamupalat");
  expect(sent(renamed[0])).toContainEqual(["coffee", "Aamukahvi"]);
  const insights = await service.purchaseInsights(now);
  expect(
    insights.aliases.find((a) => a.key === "category:coffee")?.context,
  ).toEqual({ eligible: true, reason: "eligible", readableName: "Aamukahvi" });

  // Deleting one of the two purchases leaves one observation each: nothing qualifies.
  await service.deletePurchase({ eventId: event.id, scope: "event" });
  const after = await plan("Kuten tavallisesti, aamupalat");
  expect(sent(after[0])).toEqual([]);
  expect(
    (await service.purchaseInsights(now)).aliases.map((a) => a.context.reason),
  ).toEqual(["few-observations", "few-observations", "few-observations"]);
  // No preference was saved, no store was read for the receipts and nothing was written.
  expect(service.state.categoryPreferences).toEqual(preferences);
  expect(shop.writes).toBe(0);
});
