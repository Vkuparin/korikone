import { expect, test } from "vitest";
import { buildCompactContext } from "../src/ai/context";
import { Service } from "../src/application/service";
import {
  observedSummaries,
  purchaseAliases,
  purchaseStatistics,
  readMemory,
  recurrenceSuggestions,
} from "../src/domain/memory";
import { initialState, type AppState } from "../src/domain/model";
import {
  emptyLedger,
  putPurchase,
  type PurchaseLedger,
} from "../src/domain/purchases";
import { ruleAnnotations } from "../src/domain/receipt-semantics";
import {
  memoryStorage,
  purchaseEvent,
  purchaseLine,
  purchaseSource,
} from "./helpers/purchase-fixtures";

const now = new Date("2026-10-28T12:00:00.000Z");
const at = "2026-10-01T00:00:00.000Z";
type Row = [
  label: string,
  amount: number | null,
  unit: "pcs" | "g" | "ml" | null,
  extra?: object,
];
/** Adds a completed receipt on a day with the given rows and their rule interpretations. */
function visit(
  ledger: PurchaseLedger,
  id: string,
  day: string | null,
  rows: Row[],
  extra: Parameters<typeof purchaseEvent>[2] = {},
  chain: "s-group" | "k-group" = "s-group",
): PurchaseLedger {
  const event = purchaseEvent(id, `s-${id}`, {
    chain,
    purchasedAt: day ? `${day}T10:00:00.000Z` : null,
    datePrecision: day ? "minute" : "unknown",
    lines: rows.map(([label, amount, unit, more], i) =>
      purchaseLine(`l${i + 1}`, label, 100, {
        quantity:
          amount === null || unit === null
            ? { amount: null, unit: null, provenance: "unknown" }
            : { amount, unit, provenance: "source" },
        ...more,
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
    ...extra,
  });
  const next = putPurchase(
    ledger,
    purchaseSource(`s-${id}`, {
      chain,
      fingerprint: id.padEnd(16, "0").replace(/[^0-9a-f]/g, "b"),
    }),
    event,
  );
  return {
    ...next,
    annotations: [...next.annotations, ...ruleAnnotations(event, 1, at)],
  };
}
const state = (extra: Partial<AppState> = {}): AppState => ({
  ...initialState(),
  staples: [],
  ...extra,
});

test("facts, interpretations, preferences and transfers are read apart, and only completed purchases count", () => {
  let ledger = visit(emptyLedger(), "a", "2026-10-05", [
    ["KEVYTMAITO 1L", 2, "pcs"],
    ["OUTO TUOTE", null, null],
    ["PESUAINE", 1, "pcs", { role: "non-food" }],
    ["PANTTI", 1, "pcs", { role: "deposit" }],
  ]);
  ledger = visit(ledger, "b", "2026-10-06", [["KEVYTMAITO 1L", 1, "pcs"]], {
    status: "pending",
    origin: "order",
  });
  ledger = visit(ledger, "c", "2026-10-07", [["KEVYTMAITO 1L", 1, "pcs"]], {
    status: "cancelled",
    origin: "order",
  });
  const s = state({
    receiptText: "VANHA KUITTI\nMAITO 9,99",
    categoryPreferences: [
      {
        category: "milk",
        qualifiers: [{ kind: "lactose", value: "free" }],
        strength: "required",
      },
    ],
    listHistory: [
      {
        id: "t1",
        date: "2026-10-04T09:00:00.000Z",
        note: "",
        meals: [],
        recipes: [],
        extras: [],
        skipped: [],
        removed: [],
        quantities: {},
        prices: {},
        storeKey: "s-kaupat:1",
        transferred: [
          {
            productId: "p",
            name: "Kevytmaito 1 l",
            quantity: 9,
            unit: "kpl",
            price: 119,
          },
        ],
      },
    ],
  });
  const memory = readMemory(s, ledger);
  // Pending and cancelled orders, deposits, the legacy text and the transfer are not purchases.
  expect(
    memory.purchases.map((p) => [
      p.eventId,
      p.label,
      p.scope,
      p.identity?.key ?? null,
      p.quantity.amount,
    ]),
  ).toEqual([
    ["a", "KEVYTMAITO 1L", "food", "category:milk|fat=semi-skimmed", 2],
    ["a", "OUTO TUOTE", "unknown", null, null],
    ["a", "PESUAINE", "non-food", null, 1],
  ]);
  expect(memory.remembered).toEqual(s.categoryPreferences);
  expect(memory.transfers).toEqual([
    {
      id: "t1",
      date: "2026-10-04T09:00:00.000Z",
      storeKey: "s-kaupat:1",
      items: [{ name: "Kevytmaito 1 l", quantity: 9, unit: "kpl", price: 119 }],
    },
  ]);
  // The nine transferred cartons appear in no purchase statistic.
  expect(purchaseStatistics(memory, now).map((x) => [x.key, x.visits])).toEqual(
    [["category:milk|fat=semi-skimmed", 1]],
  );
  // An explicit preference speaks for its category: the observation is flagged and not summarized.
  const { aliases, unresolved } = purchaseAliases(memory);
  expect(aliases).toMatchObject([
    {
      key: "category:milk|fat=semi-skimmed",
      conflictsWithRemembered: true,
      origins: { rule: 1, model: 0, user: 0 },
      confirmed: true,
    },
  ]);
  expect(unresolved).toEqual([
    {
      chain: "s-group",
      label: "OUTO TUOTE",
      observations: 1,
      display: { text: "OUTO TUOTE", tier: "raw", nameOrigin: null },
    },
  ]);
  expect(observedSummaries(memory)).toEqual([]);
  // An old profile with no ledger still reads: preferences and transfers only.
  expect(readMemory(s, emptyLedger())).toMatchObject({
    purchases: [],
    transfers: [{ id: "t1" }],
  });
  expect(readMemory(initialState(), emptyLedger())).toEqual({
    remembered: [],
    purchases: [],
    transfers: [],
  });
});

test("aliases keep milk types and chains distinct, and a model-only alias is unconfirmed", () => {
  let ledger = visit(emptyLedger(), "a", "2026-10-05", [
    ["KEVYTMAITO 1L", 1, "pcs"],
    ["RASVATON MAITO 1L", 1, "pcs"],
    ["LAKTOOSITON KEVYTMAITO 1L", 1, "pcs"],
    ["ARLA LEMPI 1L", 1, "pcs"],
    ["XTRA JOTAIN", 1, "pcs"],
  ]);
  ledger = visit(
    ledger,
    "b",
    "2026-10-12",
    [
      ["PIRKKA KEVYTMAITO 1L", 2, "pcs"],
      ["KEVYTMAITO 1L", 1, "pcs"],
    ],
    {},
    "k-group",
  );
  ledger = {
    ...ledger,
    annotations: [
      ...ledger.annotations,
      {
        eventId: "a",
        lineId: "l4",
        origin: "model",
        sourceRevision: 1,
        name: "Maito",
        category: "milk",
        qualifiers: [],
        scope: "food",
        model: { providerId: "x", modelId: "m", taskVersion: 1 },
        at,
      },
    ],
  };
  const memory = readMemory(state(), ledger);
  const { aliases, unresolved } = purchaseAliases(memory);
  expect(aliases.map((a) => [a.key, a.observations, a.confirmed])).toEqual([
    ["category:milk", 1, false],
    ["category:milk|fat=semi-skimmed", 3, true],
    ["category:milk|fat=semi-skimmed|lactose=free", 1, true],
    ["category:milk|fat=skimmed", 1, true],
  ]);
  // Same kind of milk at two chains: one alias, three labels, and no claim of one product.
  expect(
    aliases[1].labels.map(({ display: _display, ...label }) => label),
  ).toEqual([
    { chain: "s-group", label: "KEVYTMAITO 1L", observations: 1 },
    { chain: "k-group", label: "PIRKKA KEVYTMAITO 1L", observations: 1 },
    { chain: "k-group", label: "KEVYTMAITO 1L", observations: 1 },
  ]);
  expect(unresolved).toEqual([
    {
      chain: "s-group",
      label: "XTRA JOTAIN",
      observations: 1,
      display: { text: "XTRA JOTAIN", tier: "raw", nameOrigin: null },
    },
  ]);
  // Only confirmed, repeated categories reach the AI context, as observations.
  const summaries = observedSummaries(memory);
  expect(summaries).toEqual([
    {
      // How the most bought of them reads on the receipts (F27.10).
      readableName: "Kevytmaito 1 l",
      classification: {
        category: "milk",
        provenance: "observed",
        qualifiers: [
          { kind: "fat", value: "semi-skimmed", provenance: "observed" },
        ],
      },
      observations: 3,
    },
  ]);
  const context = buildCompactContext("maitoa ja leipää", state(), {
    observedSummaries: summaries,
  });
  expect(context.observedSummaries).toEqual(summaries);
  // Deleting the interpretations forgets the aliases on the next read; nothing was remembered.
  const forgotten = readMemory(state(), { ...ledger, annotations: [] });
  expect(purchaseAliases(forgotten).aliases).toEqual([]);
  expect(observedSummaries(forgotten)).toEqual([]);
  expect(memory.remembered).toEqual([]);
});

test("two visits establish no cadence and no usual quantity; four weeks of eight do", () => {
  let ledger = emptyLedger();
  for (const [i, day] of ["2026-10-19", "2026-10-26"].entries())
    ledger = visit(ledger, `two${i}`, day, [["KAHVI 500G", 1, "pcs"]]);
  let memory = readMemory(state(), ledger);
  expect(purchaseStatistics(memory, now)).toMatchObject([
    {
      key: "category:coffee",
      visits: 2,
      weeksOfLastEight: 2,
      medianGapDays: 7,
      typical: null,
    },
  ]);
  expect(recurrenceSuggestions(memory, now)).toEqual([]);

  for (const [i, day] of [
    "2026-09-21",
    "2026-09-28",
    "2026-10-05",
    "2026-10-13",
  ].entries())
    ledger = visit(ledger, `more${i}`, day, [
      ["KAHVI 500G", i === 3 ? 12 : 1, "pcs"],
      ["KEVYTMAITO 1L", 2, "pcs"],
    ]);
  // An undated purchase and one from next month count for nothing.
  ledger = visit(ledger, "undated", null, [["KAHVI 500G", 50, "pcs"]]);
  ledger = visit(ledger, "future", "2026-11-20", [["KAHVI 500G", 50, "pcs"]]);
  memory = readMemory(state(), ledger);
  const coffee = purchaseStatistics(memory, now).find(
    (s) => s.key === "category:coffee",
  )!;
  expect(coffee).toMatchObject({
    visits: 6,
    weeksOfLastEight: 6,
    medianGapDays: 7,
    from: "2026-09-21T10:00:00.000Z",
    to: "2026-10-26T10:00:00.000Z",
    // The twelve-pack visit is an outlier: it neither sets nor widens the usual amount.
    typical: { amount: 1, unit: "pcs", visits: 5, min: 1, max: 1 },
  });
  const suggestions = recurrenceSuggestions(memory, now);
  expect(
    suggestions.map((s) => [
      s.key,
      s.label,
      s.weeksOfLastEight,
      s.typical?.amount ?? null,
    ]),
  ).toEqual([
    ["category:coffee", "KAHVI 500G", 6, 1],
    ["category:milk|fat=semi-skimmed", "KEVYTMAITO 1L", 4, 2],
  ]);
  // A dismissal holds for ninety days; an item that is already recurring is not suggested.
  expect(
    recurrenceSuggestions(memory, now, {
      dismissed: [{ key: "category:coffee", at: "2026-10-01T00:00:00.000Z" }],
    }).map((s) => s.key),
  ).toEqual(["category:milk|fat=semi-skimmed"]);
  expect(
    recurrenceSuggestions(memory, now, {
      dismissed: [{ key: "category:coffee", at: "2026-07-01T00:00:00.000Z" }],
    }),
  ).toHaveLength(2);
  expect(
    recurrenceSuggestions(memory, now, {
      existing: ["category:coffee", "muu"],
    }).map((s) => s.key),
  ).toEqual(["category:milk|fat=semi-skimmed"]);
});

test("unknown quantities stay unknown, pack sizes do not mix and a promotion is not a habit", () => {
  let ledger = emptyLedger();
  const days = ["2026-10-01", "2026-10-08", "2026-10-15", "2026-10-22"];
  // Three pouch variants of five under one offer, bought once: fifteen is no usual amount.
  ledger = visit(
    ledger,
    "offer",
    days[0],
    [
      ["KISSANRUOKA KANA 85G", 5, "pcs"],
      ["KISSANRUOKA LOHI 85G", 5, "pcs"],
      ["KISSANRUOKA NAUTA 85G", 5, "pcs"],
    ],
    {
      adjustments: [
        {
          id: "a1",
          kind: "campaign",
          label: "RYHMÄTARJOUS",
          span: { page: 1, line: 9, endLine: 9 },
          amount: -135,
          allocation: "group",
          lineIds: ["l1", "l2", "l3"],
          provenance: "source",
        },
      ],
    },
  );
  const named = (eventId: string, lineId: string, name: string) => ({
    eventId,
    lineId,
    origin: "user" as const,
    sourceRevision: 1,
    name,
    category: null,
    qualifiers: [],
    scope: "food" as const,
    model: null,
    at,
  });
  ledger = {
    ...ledger,
    annotations: [
      ...ledger.annotations,
      named("offer", "l1", "Kissanruoka"),
      named("offer", "l2", "Kissanruoka"),
      named("offer", "l3", "Kissanruoka"),
    ],
  };
  for (const [i, day] of days.slice(1).entries()) {
    ledger = visit(ledger, `p${i}`, day, [
      ["KISSANRUOKA KANA 85G", 2, "pcs"],
      ["RIISI 1KG", i === 0 ? null : 1, i === 0 ? null : "pcs"],
      ["RIISI 2KG", 1, "pcs"],
      ["BANAANI", [900, 1100, 1000][i], "g"],
    ]);
    ledger = {
      ...ledger,
      annotations: [
        ...ledger.annotations,
        named(`p${i}`, "l1", "Kissanruoka"),
        named(`p${i}`, "l4", "Banaani"),
      ],
    };
  }
  const stats = purchaseStatistics(
    readMemory(state(), ledger),
    new Date("2026-10-23T12:00:00.000Z"),
  );
  const by = (key: string) => stats.find((s) => s.key === key)!;
  // Ordinary visits of two pouches set the usual amount; the offer visit of fifteen does not.
  expect(by("name:kissanruoka")).toMatchObject({
    visits: 4,
    typical: { amount: 2, unit: "pcs", visits: 3, min: 2, max: 2 },
  });
  // Weights compare across visits; the middle one is the usual, with its spread shown.
  expect(by("name:banaani").typical).toEqual({
    amount: 1000,
    unit: "g",
    visits: 3,
    min: 900,
    max: 1100,
  });
  // Rice: the 1 kg pack has two known visits, the 2 kg pack three. Different packs are not added.
  expect(by("category:rice")).toMatchObject({
    visits: 3,
    typical: { amount: 1, unit: "pcs", visits: 3 },
  });
  // With one more unknown the only comparable class drops below three visits: unknown, not zero.
  const thinner = structuredClone(ledger);
  thinner.events.find((e) => e.id === "p1")!.lines[2].quantity = {
    amount: null,
    unit: null,
    provenance: "unknown",
  };
  expect(
    purchaseStatistics(
      readMemory(state(), thinner),
      new Date("2026-10-23T12:00:00.000Z"),
    ).find((s) => s.key === "category:rice")!.typical,
  ).toBeNull();
});

test("the service reads memory fresh: a deleted purchase and a dismissed suggestion disappear", async () => {
  const { storage } = memoryStorage();
  const service = new Service(storage);
  await service.init();
  let ledger = emptyLedger();
  for (const [i, day] of [
    "2026-09-21",
    "2026-09-28",
    "2026-10-05",
    "2026-10-13",
  ].entries())
    ledger = visit(ledger, `v${i}`, day, [["KAHVI 500G", 1, "pcs"]]);
  await service.purchases.write(ledger);
  await service.save({ ...service.state, staples: [] });
  const preferences = structuredClone(service.state.categoryPreferences);
  let insights = await service.purchaseInsights(now);
  expect(insights.suggestions.map((s) => s.key)).toEqual(["category:coffee"]);
  expect(insights.actualPurchases).toHaveLength(4);
  // The default profile already has coffee as a recurring item by name: no duplicate suggestion.
  await service.save({ ...service.state, staples: initialState().staples });
  expect((await service.purchaseInsights(now)).suggestions).toEqual([]);
  await service.save({ ...service.state, staples: [] });
  await service.dismissSuggestion({ key: "category:coffee" });
  expect((await service.purchaseInsights(new Date())).suggestions).toEqual([]);
  await service.purchases.delete({ eventId: "v0", scope: "event" });
  insights = await service.purchaseInsights(now);
  expect(insights.statistics[0]).toMatchObject({
    visits: 3,
    weeksOfLastEight: 3,
  });
  // Observing purchases saved no preference and no recurring item.
  expect(service.state.categoryPreferences).toEqual(preferences);
  expect(service.state.staples).toEqual([]);
  expect((await service.memory()).purchases).toHaveLength(3);
});
