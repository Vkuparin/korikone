import { expect, test } from "vitest";
import { ChatGPTInferenceProvider } from "../src/ai/chatgpt-provider";
import {
  buildEditContext,
  interpretEdit,
  validateEditIntent,
} from "../src/ai/edit";
import { FakeInferenceProvider } from "../src/ai/fake-provider";
import { FixtureAI } from "../src/ai/fixtures";
import { InferenceSession, discoverInferenceModels } from "../src/ai/provider";
import { Service } from "../src/application/service";
import { editDelta } from "../src/domain/edit-delta";
import { EditError, applyEdits, type EditOperation } from "../src/domain/edits";
import { initialState, type AppState } from "../src/domain/model";
import { requirements } from "../src/domain/planner";
import { DemoProvider } from "../src/stores/demo";
import { editNow as now, editPlan } from "./helpers/edit-plan";
import { memoryStorage } from "./helpers/purchase-fixtures";

/** The owner's prompt from v0.8.0 testing, verbatim. */
const prompt =
  "Lihamakaronilaatikko, siskonmakkarakeitto, kaksi litraa kevytmaitoa, litra vaniljajäätelöä";
const batch = (operations: EditOperation[], revision = 7) => ({
  version: 1,
  revision,
  operations,
});
const amounts = (state: AppState) =>
  Object.fromEntries(
    requirements(state, now).map((r) => [`${r.id}:${r.unit}`, r.amount]),
  );
const stew = {
  id: "stew",
  name: "Lihapata",
  servings: 4,
  ingredients: [
    { id: "beef", name: "Naudanliha", amount: 600, unit: "g" as const },
    { id: "potato", name: "Peruna", amount: 400, unit: "g" as const },
  ],
  instructions: "",
};

test("a dish is added beside the others, once, and shares ingredient rows", () => {
  const state = editPlan();
  state.skipped = [];
  const {
    state: next,
    applied,
    changedKeys,
  } = applyEdits(
    state,
    batch([
      { op: "addMeal", recipe: { kind: "new", recipe: stew }, servings: 2 },
      { op: "addMeal", recipe: { kind: "saved", recipeId: "lasagne" } },
    ]),
    { now },
  );
  // Nothing was replaced: the three earlier meals are untouched and two follow them.
  expect(next.meals.slice(0, 3)).toEqual(state.meals);
  expect(
    next.meals.slice(3).map((m) => [m.recipeId, m.servings, m.day]),
  ).toEqual([
    ["stew", 2, 3],
    ["lasagne", 4, 4],
  ]);
  expect(next.recipes.at(-1)).toMatchObject({ id: "stew" });
  const rows = amounts(next);
  // Potato is shared with the soup; milk with porridge, the manual carton and lasagne.
  expect(rows["potato:g"]).toBe(800 + 200);
  expect(rows["beef:g"]).toBe(300);
  expect(rows["milk:ml"]).toBe(1800 + 500);
  expect(applied.map((a) => [a.op, a.name, a.before, a.after])).toEqual([
    ["addMeal", "Lihapata", 0, 2],
    ["addMeal", "Lasagne", 0, 4],
  ]);
  expect(changedKeys.sort()).toEqual(
    ["beef:g", "lasagne-sheets:g", "milk:ml", "potato:g", "tomato:g"].sort(),
  );
  // The delta names the added dishes.
  const delta = editDelta(
    { state, basket: [], quoted: false },
    { state: { ...next, revision: 8 }, basket: [], quoted: false },
    now,
  );
  expect(delta.meals.map((m) => [m.change, m.name, m.servingsAfter])).toEqual([
    ["added", "Lihapata", 2],
    ["added", "Lasagne", 4],
  ]);

  // A dish that is already planned is not added again.
  let error: unknown;
  try {
    applyEdits(
      state,
      batch([{ op: "addMeal", recipe: { kind: "saved", recipeId: "soup" } }]),
      { now },
    );
  } catch (e) {
    error = e;
  }
  expect((error as EditError).code).toBe("noChange");
  // Naming it with servings updates it instead.
  const more = applyEdits(
    state,
    batch([
      {
        op: "addMeal",
        recipe: { kind: "saved", recipeId: "soup" },
        servings: 8,
      },
    ]),
    { now },
  );
  expect(more.state.meals).toHaveLength(3);
  expect(more.state.meals[1].servings).toBe(8);
  expect(more.applied).toMatchObject([
    { op: "addMeal", targetId: "meal:m-soup", before: 4, after: 8 },
  ]);
  // A new recipe with the name of a saved one is that saved recipe, not a copy.
  const named = applyEdits(
    state,
    batch([
      {
        op: "addMeal",
        recipe: {
          kind: "new",
          recipe: { ...stew, id: "other", name: " lasagne " },
        },
      },
    ]),
    { now },
  );
  expect(named.state.recipes).toHaveLength(state.recipes.length);
  expect(named.state.meals.at(-1)?.recipeId).toBe("lasagne");
  for (const [operations, code] of [
    [
      [{ op: "addMeal", recipe: { kind: "saved", recipeId: "curry" } }],
      "unknownTarget",
    ],
    [
      [
        {
          op: "addMeal",
          recipe: { kind: "new", recipe: { ...stew, id: "pasta" } },
        },
      ],
      "invalidEdit",
    ],
    [
      [
        { op: "addMeal", recipe: { kind: "saved", recipeId: "lasagne" } },
        {
          op: "addMeal",
          recipe: { kind: "saved", recipeId: "lasagne" },
          servings: 2,
        },
      ],
      "duplicateTarget",
    ],
  ] as [EditOperation[], string][])
    expect(() => applyEdits(state, batch(operations), { now })).toThrow(code);
});

test("a stated amount is what the grocery should be; adding is a separate, explicit operation", () => {
  const state = editPlan();
  // Milk has a row of 1800 ml: stating two litres sets it, and saying it again changes nothing.
  const set = applyEdits(
    state,
    batch([
      {
        op: "setItem",
        name: "Maito",
        quantity: { kind: "amount", amount: 2000, unit: "ml" },
      },
      {
        op: "setItem",
        name: "Vaniljajäätelö",
        quantity: { kind: "amount", amount: 1000, unit: "ml" },
      },
    ]),
    { now },
  );
  expect(amounts(set.state)["milk:ml"]).toBe(2000);
  expect(amounts(set.state)["vaniljajäätelö:ml"]).toBe(1000);
  expect(set.state.extras.at(-1)).toMatchObject({
    id: "vaniljajäätelö",
    name: "Vaniljajäätelö",
    amount: 1000,
  });
  expect(set.applied.map((a) => [a.op, a.name, a.before, a.after])).toEqual([
    ["setItem", "Maito", 1800, 2000],
    ["setItem", "Vaniljajäätelö", 0, 1000],
  ]);
  expect(() =>
    applyEdits(
      { ...set.state, revision: 7 },
      batch([
        {
          op: "setItem",
          name: "Maito",
          quantity: { kind: "amount", amount: 2000, unit: "ml" },
        },
        {
          op: "setItem",
          name: "Vaniljajäätelö",
          quantity: { kind: "amount", amount: 1000, unit: "ml" },
        },
      ]),
      { now },
    ),
  ).toThrow("noChange");
  // "Lisää 2 litraa maitoa" is addItem: it increases what is there.
  const added = applyEdits(
    state,
    batch([
      {
        op: "addItem",
        name: "Maito",
        quantity: { kind: "amount", amount: 2000, unit: "ml" },
      },
    ]),
    { now },
  );
  expect(amounts(added.state)["milk:ml"]).toBe(3800);
  // A grocery removed earlier returns with exactly the stated amount, not its old one.
  const removed = { ...editPlan(), removed: ["ruisleipä:g"] };
  const back = applyEdits(
    removed,
    batch([
      {
        op: "setItem",
        name: "Ruisleipä",
        quantity: { kind: "amount", amount: 300, unit: "g" },
      },
    ]),
    { now },
  );
  expect(back.state.removed).toEqual([]);
  expect(amounts(back.state)["ruisleipä:g"]).toBe(300);
  // Another unit, a pack count for nothing on the list and a repeated grocery are refused.
  for (const [operations, code] of [
    [
      [{ op: "setItem", name: "Kahvi", quantity: { kind: "packs", count: 2 } }],
      "packSizeUnknown",
    ],
    [
      [
        {
          op: "setItem",
          name: "Maito",
          quantity: { kind: "amount", amount: 2000, unit: "ml" },
        },
        { op: "markAtHome", rowKey: "milk:ml", atHome: true },
      ],
      "duplicateTarget",
    ],
    [
      [
        {
          op: "setItem",
          quantity: { kind: "amount", amount: 1, unit: "g" },
        } as never,
      ],
      "unsupportedEdit",
    ],
  ] as [EditOperation[], string][])
    expect(() => applyEdits(state, batch(operations), { now })).toThrow(code);
});

async function sessionFor(alternative: boolean, replies: string[] = []) {
  const connection = new (class extends FixtureAI {
    prompts: string[] = [];
    override async generatePinned(m: string, p: string, signal: AbortSignal) {
      this.prompts.push(p);
      return (
        replies[this.prompts.length - 1] ?? super.generatePinned(m, p, signal)
      );
    }
  })();
  await connection.signIn();
  const provider = alternative
    ? new FakeInferenceProvider(connection, true)
    : new ChatGPTInferenceProvider(connection);
  const controller = new AbortController();
  const models = await discoverInferenceModels(provider, controller.signal);
  const sessions: InferenceSession[] = [];
  const session = async () => {
    sessions.push(
      new InferenceSession(
        provider,
        models[0],
        { maxCalls: 2, maxOutputCharacters: 100_000, timeoutMs: 180_000 },
        controller.signal,
      ),
    );
    return sessions.at(-1)!;
  };
  return { connection, session, sessions };
}

for (const alternative of [false, true]) {
  const label = alternative ? "fake alternative" : "local ChatGPT adapter";
  test(`${label}: the owner's enumeration adds two dishes and states two amounts in one request`, async () => {
    const { session, sessions } = await sessionFor(alternative);
    const state = editPlan();
    const intent = await interpretEdit(
      await session(),
      { instruction: prompt },
      state,
      now,
    );
    expect(intent.ambiguities).toEqual([]);
    expect(intent.unsupported).toEqual([]);
    expect(
      intent.operations.map((o) =>
        o.op === "addMeal"
          ? [
              o.op,
              o.recipe.kind === "new"
                ? o.recipe.recipe.name
                : o.recipe.recipeId,
            ]
          : o.op === "setItem"
            ? [o.op, o.name, o.quantity]
            : [o.op],
      ),
    ).toEqual([
      ["addMeal", "Makaronilaatikko"],
      ["addMeal", "Siskonmakkarakeitto"],
      ["setItem", "Kevytmaito", { kind: "amount", amount: 2000, unit: "ml" }],
      [
        "setItem",
        "Vaniljajäätelö",
        { kind: "amount", amount: 1000, unit: "ml" },
      ],
    ]);
    expect(sessions[0].callCount).toBe(1);
    // With "lisää" the same grocery is an addition to its row.
    const add = await interpretEdit(
      (await sessionFor(alternative)).sessions[0] ??
        (await (await sessionFor(alternative)).session()),
      { instruction: "Lisää 2 litraa maitoa" },
      state,
      now,
    );
    expect(add.operations).toEqual([
      {
        op: "addItem",
        rowKey: "milk:ml",
        quantity: { kind: "amount", amount: 2000, unit: "ml" },
      },
    ]);
    // A dish already on the list is left alone; a bare amount for its row sets the row.
    const again = await interpretEdit(
      await (await sessionFor(alternative)).session(),
      { instruction: "keitto, 2 kg perunaa" },
      state,
      now,
    );
    expect(again.operations).toEqual([
      {
        op: "changeQuantity",
        rowKey: "potato:g",
        quantity: { kind: "amount", amount: 2000, unit: "g" },
      },
    ]);
  });
}

test("model output for the new operations is held to the same rules", () => {
  const state = editPlan();
  const { known } = buildEditContext({ instruction: "x" }, state, now);
  const check = (operations: unknown[]) =>
    validateEditIntent(
      JSON.stringify({ version: 1, operations }),
      known,
      state,
    );
  const meal = check([
    { op: "addMeal", recipeId: "lasagne", servings: 2 },
    { op: "addMeal", recipe: { ...stew, id: "pasta" } },
    {
      op: "setItem",
      name: "Kevytmaito",
      quantity: { kind: "amount", amount: 2000, unit: "ml" },
    },
  ]);
  expect(meal.operations[0]).toEqual({
    op: "addMeal",
    recipe: { kind: "saved", recipeId: "lasagne" },
    servings: 2,
  });
  // A new recipe's colliding ID is remapped and its ingredients share saved identities.
  const fresh = meal.operations[1];
  if (fresh.op !== "addMeal" || fresh.recipe.kind !== "new")
    throw new Error("shape");
  expect(fresh.recipe.recipe.id).not.toBe("pasta");
  expect(fresh.recipe.recipe.ingredients[1].id).toBe("potato");
  for (const invalid of [
    [{ op: "addMeal", recipeId: "not-saved" }],
    [{ op: "addMeal" }],
    [{ op: "addMeal", recipeId: "lasagne", recipe: stew }],
    [{ op: "addMeal", recipeId: "lasagne", target: "meal:m-soup" }],
    [
      { op: "addMeal", recipeId: "lasagne" },
      { op: "addMeal", recipeId: "lasagne" },
    ],
    [
      { op: "addMeal", recipe: stew },
      { op: "addMeal", recipe: { ...stew, id: "b" } },
    ],
    [{ op: "addMeal", recipeId: "lasagne", price: 5 }],
    [{ op: "setItem", quantity: { kind: "amount", amount: 1, unit: "g" } }],
    [
      {
        op: "setItem",
        name: "Maito",
        target: "row:milk:ml",
        quantity: { kind: "amount", amount: 1, unit: "ml" },
      },
    ],
    [
      {
        op: "setItem",
        name: "Maito",
        quantity: { kind: "amount", amount: 1.5, unit: "ml" },
      },
    ],
    [
      {
        op: "setItem",
        name: "Maito",
        quantity: { kind: "amount", amount: 1, unit: "ml" },
        productId: "x",
      },
    ],
  ])
    expect(() => check(invalid), JSON.stringify(invalid)).toThrow(
      "invalidDraft",
    );
});

async function shop(state: AppState) {
  const store = memoryStorage();
  const service = new Service(store.storage);
  service.developmentMode = true;
  await store.storage.set("state", state);
  await service.init();
  await service.buildBasket().catch(() => {});
  const provider = service.registry.get("demo-k") as DemoProvider;
  return { ...store, service, provider };
}
const edit = (service: Service, instruction: string) => ({
  revision: service.state.revision,
  instruction,
  consent: true as const,
});

test("the owner's prompt edits an existing list in place: both dishes and both amounts, nothing lost", async () => {
  const { service, provider, storage } = await shop(editPlan());
  const { session, sessions } = await sessionFor(true);
  const before = structuredClone(service.state);
  const pasta = structuredClone(
    service.basket.find((l) => l.requirement.id === "pasta"),
  );
  const snapshot = await service.editList(edit(service, prompt), session);
  expect(snapshot.edit).toMatchObject({
    status: "applied",
    applied: [
      { op: "addMeal", name: "Makaronilaatikko", before: 0, after: 4 },
      { op: "addMeal", name: "Siskonmakkarakeitto", before: 0, after: 4 },
      { op: "setItem", name: "Kevytmaito", before: 0, after: 2000 },
      { op: "setItem", name: "Vaniljajäätelö", before: 0, after: 1000 },
    ],
  });
  // Everything that was planned is still planned; nothing was replaced.
  expect(snapshot.state.meals.slice(0, 3)).toEqual(before.meals);
  expect(
    snapshot.state.meals
      .slice(3)
      .map(
        (m) => snapshot.state.recipes.find((r) => r.id === m.recipeId)!.name,
      ),
  ).toEqual(["Makaronilaatikko", "Siskonmakkarakeitto"]);
  expect(snapshot.state.extras.slice(0, 3)).toEqual(before.extras);
  expect(snapshot.state.skipped).toEqual(before.skipped);
  expect(snapshot.state.accepted).toEqual(before.accepted);
  const names = snapshot.basket.map((l) => l.requirement.name);
  for (const name of [
    "Kevytmaito",
    "Vaniljajäätelö",
    "Siskonmakkara",
    "Pasta",
    "Ruisleipä",
  ])
    expect(names).toContain(name);
  // The explicit variety is its own row beside plain milk, with the stated amount.
  expect(
    snapshot.basket.find((l) => l.requirement.name === "Kevytmaito")!
      .requirement,
  ).toMatchObject({
    amount: 2000,
    unit: "ml",
    classification: {
      category: "milk",
      qualifiers: [{ value: "semi-skimmed" }],
    },
  });
  // An untouched row was not read again; one request, no retailer write.
  expect(snapshot.basket.find((l) => l.requirement.id === "pasta")).toEqual(
    pasta,
  );
  expect(sessions[0].callCount).toBe(1);
  expect(provider.writes).toBe(0);
  // Saying the same thing again changes nothing and leaves the undo of the first edit.
  await expect(
    service.editList(edit(service, prompt), session),
  ).rejects.toThrow("noChange");
  expect(service.snapshot().editUndoAvailable).toBe(true);
  // "Lisää" is a delta on the existing amount.
  const more = await service.editList(
    edit(service, "Lisää 2 litraa kevytmaitoa"),
    session,
  );
  expect(
    more.basket.find((l) => l.requirement.name === "Kevytmaito")!.requirement
      .amount,
  ).toBe(4000);
  // Undo goes back one edit; a restart shows the same list.
  await service.undoEdit({ revision: service.state.revision });
  expect(
    requirements(service.state).find((r) => r.name === "Kevytmaito")!.amount,
  ).toBe(2000);
  const restarted = new Service(storage);
  await restarted.init();
  expect(restarted.state.meals).toHaveLength(5);
  expect(provider.writes).toBe(0);
});

test("the same prompt works on an empty list, and unclear or failed edits keep the saved list", async () => {
  const empty = initialState();
  empty.staples = [];
  const { service } = await shop(empty);
  const { session } = await sessionFor(false);
  const snapshot = await service.editList(edit(service, prompt), session);
  expect(snapshot.state.meals).toHaveLength(2);
  expect(snapshot.state.extras.map((i) => [i.name, i.amount])).toEqual([
    ["Kevytmaito", 2000],
    ["Vaniljajäätelö", 1000],
  ]);
  expect(snapshot.quotedAt).not.toBeNull();
  const state = structuredClone(service.state);
  // A dish the interpreter does not know and a missing amount are asked about, not guessed.
  const asked = await service.editList(
    edit(service, "kummallinen pata, maitoa"),
    session,
  );
  expect(asked.edit).toMatchObject({
    status: "clarification",
    unsupported: ["kummallinen pata", "maitoa"],
  });
  expect(service.state).toEqual(state);
  // Stale, invalid twice and a limit all leave the list as it was.
  await expect(
    service.editList(
      { ...edit(service, prompt), revision: state.revision - 1 },
      session,
    ),
  ).rejects.toThrow("draftStale");
  const invalid = await sessionFor(
    false,
    Array(2).fill(
      JSON.stringify({
        version: 1,
        operations: [{ op: "addMeal", recipeId: "nope" }],
      }),
    ),
  );
  await expect(
    service.editList(edit(service, "lisää pata"), invalid.session),
  ).rejects.toThrow("invalidDraft");
  expect(invalid.sessions[0].callCount).toBe(2);
  const limited = await sessionFor(false);
  limited.connection.scenario = "usageLimit";
  await expect(
    service.editList(edit(service, prompt), limited.session),
  ).rejects.toThrow("usageLimit");
  expect(service.state).toEqual(state);
});
