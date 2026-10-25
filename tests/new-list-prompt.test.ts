import { expect, test } from "vitest";
import { validatePlanningDraft } from "../src/ai/draft";
import { planningFixtureReply } from "../src/ai/planning-fixtures";
import { inferenceTasks } from "../src/ai/tasks";
import type { PlanningRun } from "../src/application/planning";
import { Service } from "../src/application/service";
import { DraftError } from "../src/domain/draft-errors";
import { noteQuantity, noteUnspecifiedCount } from "../src/domain/intents";
import { initialState } from "../src/domain/model";
import { ScriptedInferenceProvider } from "./helpers/inference";
import { memoryStorage } from "./helpers/purchase-fixtures";

/** The owner's prompt from v0.8.0 testing, verbatim. */
const prompt =
  "Lihamakaronilaatikko, siskonmakkarakeitto, kaksi litraa kevytmaitoa, litra vaniljajäätelöä";
const span = (quote: string) => {
  const start = prompt.indexOf(quote);
  return { start, end: start + quote.length, quote };
};
const intent = (quote: string, extra: object) => ({
  id: `i-${quote.length}`,
  kind: "grocery",
  label: quote,
  evidence: span(quote),
  provenance: "explicit-note",
  quantity: null,
  mealIndex: null,
  itemIndex: null,
  unresolvedReason: null,
  ...extra,
});
/**
 * A reply written by hand from the prompt, as a capable model answers it: two cooked dishes and
 * two groceries with the quantities the note states in words. It was not produced by any code here.
 */
const reply = () => ({
  recipes: [
    {
      id: "lihamakaronilaatikko",
      name: "Lihamakaronilaatikko",
      kind: "meal",
      servings: 4,
      ingredients: [
        { id: "makaroni", name: "Makaroni", amount: 400, unit: "g" },
        { id: "jauheliha", name: "Jauheliha", amount: 400, unit: "g" },
        { id: "maito", name: "Maito", amount: 700, unit: "ml" },
        { id: "kananmuna", name: "Kananmuna", amount: 2, unit: "pcs" },
      ],
      instructions:
        "Keitä makaronit, ruskista liha, kaada munamaito ja paista.",
    },
    {
      id: "siskonmakkarakeitto",
      name: "Siskonmakkarakeitto",
      kind: "meal",
      servings: 4,
      ingredients: [
        { id: "siskonmakkara", name: "Siskonmakkara", amount: 400, unit: "g" },
        { id: "peruna", name: "Peruna", amount: 600, unit: "g" },
        { id: "porkkana", name: "Porkkana", amount: 200, unit: "g" },
      ],
      instructions: "Keitä kasvikset ja lisää makkarapyörykät.",
    },
  ],
  meals: [
    { recipeId: "lihamakaronilaatikko", servings: 4, leftovers: false },
    { recipeId: "siskonmakkarakeitto", servings: 4, leftovers: false },
  ],
  items: [
    {
      id: "kevytmaito",
      name: "Kevytmaito",
      amount: 2000,
      unit: "ml",
      classification: {
        category: "milk",
        provenance: "explicit-note",
        evidence: span("kaksi litraa kevytmaitoa"),
        qualifiers: [
          {
            kind: "fat",
            value: "semi-skimmed",
            provenance: "explicit-note",
            evidence: span("kaksi litraa kevytmaitoa"),
          },
        ],
      },
    },
    { id: "vaniljajaatelo", name: "Vaniljajäätelö", amount: 1000, unit: "ml" },
  ],
  notes: "",
  intents: [
    intent("Lihamakaronilaatikko", { kind: "meal", mealIndex: 0 }),
    intent("siskonmakkarakeitto", { kind: "meal", mealIndex: 1 }),
    intent("kaksi litraa kevytmaitoa", {
      quantity: { amount: 2000, unit: "ml", provenance: "explicit-note" },
      itemIndex: 0,
    }),
    intent("litra vaniljajäätelöä", {
      quantity: { amount: 1000, unit: "ml", provenance: "explicit-note" },
      itemIndex: 1,
    }),
  ],
});
const state = { recipes: initialState().recipes, note: prompt };

test("Finnish number words and unit words state a quantity; other wording still does not", () => {
  expect(noteQuantity("kaksi litraa kevytmaitoa")).toEqual({
    amount: 2000,
    unit: "ml",
  });
  expect(noteQuantity("litra vaniljajäätelöä")).toEqual({
    amount: 1000,
    unit: "ml",
  });
  expect(noteQuantity("kilo jauhelihaa")).toEqual({ amount: 1000, unit: "g" });
  expect(noteQuantity("puoli kiloa jauhelihaa")).toEqual({
    amount: 500,
    unit: "g",
  });
  expect(noteQuantity("puolitoista litraa mehua")).toEqual({
    amount: 1500,
    unit: "ml",
  });
  expect(noteQuantity("kahden litran maito")).toEqual({
    amount: 2000,
    unit: "ml",
  });
  expect(noteQuantity("3 dl kermaa")).toEqual({ amount: 300, unit: "ml" });
  expect(noteQuantity("kolme desilitraa kermaa")).toEqual({
    amount: 300,
    unit: "ml",
  });
  expect(noteQuantity("neljä kappaletta sämpylöitä")).toEqual({
    amount: 4,
    unit: "pcs",
  });
  expect(noteQuantity("kaksitoista kananmunaa")).toEqual({
    amount: 12,
    unit: "pcs",
  });
  expect(noteQuantity("1 l maitoa")).toEqual({ amount: 1000, unit: "ml" });
  // No stated amount, a compound number, a pack word or a unit in the middle proves nothing.
  for (const text of [
    "maitoa",
    "vähän maitoa",
    "kolmetoista litraa maitoa",
    "kaksikymmentä kananmunaa",
    "maitoa litra tai kaksi",
    "pari litraa maitoa",
    "litrakaupalla maitoa",
    "kilohailia",
  ])
    expect([text, noteQuantity(text)]).toEqual([text, null]);
  // A count without a unit is a count, not an amount: the unit stays unknown.
  expect(noteQuantity("kaksi maitoa")).toBeNull();
  expect(noteUnspecifiedCount("kaksi maitoa")).toBe(2);
});

test("the hand-written reply for the owner's prompt validates with both amounts and both dishes", () => {
  const draft = validatePlanningDraft(JSON.stringify(reply()), state, prompt);
  expect(draft.meals.map((m) => m.recipeId)).toEqual([
    "lihamakaronilaatikko",
    "siskonmakkarakeitto",
  ]);
  expect(draft.items.map((i) => [i.name, i.amount, i.unit])).toEqual([
    ["Kevytmaito", 2000, "ml"],
    ["Vaniljajäätelö", 1000, "ml"],
  ]);
  // The explicit milk type survives as an explicit qualifier.
  expect(draft.items[0].classification).toMatchObject({
    category: "milk",
    provenance: "explicit-note",
    qualifiers: [
      { kind: "fat", value: "semi-skimmed", provenance: "explicit-note" },
    ],
  });
  expect(
    draft.intents.map((i) => [i.kind, i.label, i.unresolvedReason]),
  ).toEqual([
    ["meal", "Lihamakaronilaatikko", null],
    ["meal", "siskonmakkarakeitto", null],
    ["grocery", "kaksi litraa kevytmaitoa", null],
    ["grocery", "litra vaniljajäätelöä", null],
  ]);
  // The development reply reads the same quantities and keeps the explicit names.
  const fixture = planningFixtureReply(prompt, 4);
  expect(fixture.items.map((i) => [i.name, i.amount, i.unit])).toEqual([
    ["Kevytmaito", 2000, "ml"],
    ["Vaniljajäätelö", 1000, "ml"],
  ]);
  expect(fixture.recipes.map((r) => r.name)).toEqual([
    "Makaronilaatikko",
    "Siskonmakkarakeitto",
  ]);
  expect(fixture.intents.every((i) => i.unresolvedReason === null)).toBe(true);
  expect(() =>
    validatePlanningDraft(JSON.stringify(fixture), state, prompt),
  ).not.toThrow();
});

test("a refused reply names the failing boundary and position without any of its text", () => {
  const cases: [
    string,
    (r: ReturnType<typeof reply>) => unknown,
    string,
    string | null,
  ][] = [
    ["not JSON", () => "{", "json", null],
    [
      "a decimal amount",
      (r) => ((r.items[0].amount = 2.5), r),
      "shape",
      "items[0].amount",
    ],
    [
      "an unknown unit",
      (r) => (((r.items[1] as { unit: string }).unit = "l"), r),
      "shape",
      "items[1].unit",
    ],
    [
      "an unknown recipe",
      (r) => ((r.meals[1].recipeId = "missing"), r),
      "recipe-reference",
      "meals[1]",
    ],
    [
      "a repeated recipe ID",
      (r) => ((r.recipes[1].id = r.recipes[0].id), r),
      "recipe-id",
      null,
    ],
    [
      "no request ledger",
      (r) => ({ ...r, intents: undefined }),
      "intents-missing",
      null,
    ],
    [
      "an omitted request",
      (r) => (r.intents.pop(), r),
      "intent-coverage",
      "intents",
    ],
    [
      "a quantity the note does not state",
      (r) => (
        ((r.intents[2].quantity as unknown as { amount: number }).amount =
          3000),
        (r.items[0].amount = 3000),
        r
      ),
      "intent-quantity",
      "intents[2]",
    ],
    [
      "an item that differs from its request",
      (r) => ((r.items[1].amount = 500), r),
      "intent-target",
      "intents[3]",
    ],
    [
      "a span that is not in the note",
      (r) => (
        (r.intents[1].evidence.start += 1),
        (r.intents[1].evidence.end += 1),
        r
      ),
      "intent-span",
      "intents[1]",
    ],
    [
      "an explicit claim without the word",
      (r) => ((r.items[0].classification!.qualifiers[0].value = "skimmed"), r),
      "classification",
      "items[0]",
    ],
  ];
  for (const [name, change, reason, path] of cases) {
    const changed = change(reply());
    let error: unknown;
    try {
      validatePlanningDraft(
        typeof changed === "string" ? changed : JSON.stringify(changed),
        state,
        prompt,
      );
    } catch (e) {
      error = e;
    }
    expect(error, name).toBeInstanceOf(DraftError);
    const { message, reason: got, path: at } = error as DraftError;
    expect([name, message, got, at]).toEqual([
      name,
      "invalidDraft",
      reason,
      path,
    ]);
    expect(JSON.stringify([got, at])).not.toMatch(/maito|jäätelö|keitto/i);
  }
});

function session(replies: unknown[], calls: { count: number }) {
  const provider = new ScriptedInferenceProvider("scripted", async () => {
    const next = replies[Math.min(calls.count++, replies.length - 1)];
    return {
      completion: "complete",
      text: typeof next === "string" ? next : JSON.stringify(next),
    };
  });
  provider.models[0].capabilities.tasks = inferenceTasks;
  return async (run: PlanningRun) =>
    run.bindInference(provider, (await provider.discoverModels(run.signal))[0]);
}
async function saved() {
  const store = memoryStorage();
  const service = new Service(store.storage);
  service.developmentMode = true;
  await service.init();
  await service.save({
    ...service.state,
    onboarded: true,
    staples: [],
    note: "kahvia",
    extras: [{ id: "coffee", name: "Kahvi", amount: 500, unit: "g" }],
  });
  await service.buildBasket();
  return { ...store, service };
}

test("the owner's prompt plans and commits through the real coordinator after New list", async () => {
  const { service, entries } = await saved();
  const calls = { count: 0 };
  const planned = await service.planShopping(
    { prompt, consent: true },
    session([reply()], calls),
  );
  expect(planned.planning).toMatchObject({ phase: "ready", failure: null });
  expect(calls.count).toBe(1);
  // Nothing is saved until the commit.
  expect(service.state.note).toBe("kahvia");
  const committed = await service.commitPlanning({
    operationId: planned.planning!.operationId,
  });
  expect(committed.state.note).toBe(prompt);
  expect(committed.state.meals).toHaveLength(2);
  expect(committed.state.extras.map((i) => [i.name, i.amount, i.unit])).toEqual(
    [
      ["Kevytmaito", 2000, "ml"],
      ["Vaniljajäätelö", 1000, "ml"],
    ],
  );
  expect(committed.committedIntents.map((i) => i.intent.label)).toEqual([
    "Lihamakaronilaatikko",
    "siskonmakkarakeitto",
    "kaksi litraa kevytmaitoa",
    "litra vaniljajäätelöä",
  ]);
  const milk = committed.basket.find(
    (l) => l.requirement.name === "Kevytmaito",
  )!;
  // The explicit semi-skimmed request is kept as a requirement: the sample store's plain milk
  // does not state its fat content, so the row waits for the shopper instead of guessing.
  expect(milk.requirement).toMatchObject({
    amount: 2000,
    unit: "ml",
    classification: { qualifiers: [{ value: "semi-skimmed" }] },
  });
  expect(milk.product).toBeNull();
  expect(entries.get("state")).toEqual(service.state);
});

test("a refused but usable reply is salvaged; an unusable one is repaired once", async () => {
  const { service, entries } = await saved();
  const before = structuredClone(service.state);
  const basket = structuredClone(service.basket);
  const broken = reply();
  broken.intents.pop();
  // B4.1: the usable reply is kept without a second request.
  let calls = { count: 0 };
  const salvaged = await service.planShopping(
    { prompt, consent: true },
    session([broken, reply()], calls),
  );
  expect(salvaged.planning).toMatchObject({ phase: "ready" });
  expect(calls.count).toBe(1);
  service.planning.cancel();
  // One repair succeeds.
  calls = { count: 0 };
  const repaired = await service.planShopping(
    { prompt, consent: true },
    session(["{", reply()], calls),
  );
  expect(repaired.planning).toMatchObject({ phase: "ready" });
  expect(calls.count).toBe(2);
  service.planning.cancel();
  // Two refusals: no third request, nothing saved yet, and the note itself is planned (B4.3).
  calls = { count: 0 };
  const fallback = await service.planShopping(
    { prompt, consent: true },
    session(["{", "{"], calls),
  );
  expect(calls.count).toBe(2);
  expect(fallback.planning).toMatchObject({ phase: "ready", failure: null });
  expect(service.state).toEqual(before);
  expect(service.basket).toEqual(basket);
  expect(entries.get("state")).toEqual(before);
});

test("a cancelled or superseded plan cannot commit late", async () => {
  const { service } = await saved();
  const before = structuredClone(service.state);
  const calls = { count: 0 };
  const first = await service.planShopping(
    { prompt, consent: true },
    session([reply()], calls),
  );
  service.planning.cancel();
  await expect(
    service.commitPlanning({ operationId: first.planning!.operationId }),
  ).rejects.toThrow();
  const second = await service.planShopping(
    { prompt, consent: true },
    session([reply()], calls),
  );
  const third = await service.planShopping(
    { prompt: "kahvia 500 g", consent: true },
    session([planningFixtureReply("kahvia 500 g", 4)], calls),
  );
  await expect(
    service.commitPlanning({ operationId: second.planning!.operationId }),
  ).rejects.toThrow();
  expect(service.state).toEqual(before);
  await service.commitPlanning({ operationId: third.planning!.operationId });
  expect(service.state.note).toBe("kahvia 500 g");
});
