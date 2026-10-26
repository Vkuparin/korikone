import { expect, test } from "vitest";
import {
  buildEditContext,
  editPrompt,
  editTaskLimits,
  interpretEdit,
  validateEditIntent,
} from "../src/ai/edit";
import { editFixtureReply } from "../src/ai/edit-fixtures";
import { applyEditIntent } from "../src/domain/edits";
import { ChatGPTInferenceProvider } from "../src/ai/chatgpt-provider";
import { FakeInferenceProvider } from "../src/ai/fake-provider";
import { FixtureAI } from "../src/ai/fixtures";
import { InferenceSession, discoverInferenceModels } from "../src/ai/provider";
import { shoppingEditTask } from "../src/ai/tasks";
import { requirements } from "../src/domain/planner";
import { ScriptedInferenceProvider } from "./helpers/inference";
import { editNow as now, editPlan } from "./helpers/edit-plan";

/** The real fixture connection, optionally with scripted replies in place of its rule-based ones. */
class EditConnection extends FixtureAI {
  readonly prompts: string[] = [];
  constructor(private replies?: ((signal: AbortSignal) => Promise<string>)[]) {
    super();
  }
  override async generatePinned(
    model: string,
    prompt: string,
    signal: AbortSignal,
  ) {
    this.prompts.push(prompt);
    const reply = this.replies?.[this.prompts.length - 1];
    return reply ? reply(signal) : super.generatePinned(model, prompt, signal);
  }
}
async function setup(
  alternative: boolean,
  replies?: (string | ((signal: AbortSignal) => Promise<string>))[],
) {
  const connection = new EditConnection(
    replies?.map((reply) =>
      typeof reply === "string" ? async () => reply : reply,
    ),
  );
  await connection.signIn();
  const provider = alternative
    ? new FakeInferenceProvider(connection, true)
    : new ChatGPTInferenceProvider(connection);
  const controller = new AbortController();
  const models = await discoverInferenceModels(provider, controller.signal);
  // The same two-call bound main gives a request that is not a planning run.
  const session = new InferenceSession(
    provider,
    models.find((model) => model.modelId === "fixture-mini")!,
    { maxCalls: 2, maxOutputCharacters: 100_000, timeoutMs: 180_000 },
    controller.signal,
  );
  return { connection, provider, controller, session };
}
const amounts = (state: ReturnType<typeof editPlan>) =>
  Object.fromEntries(
    requirements(state, now).map((r) => [`${r.id}:${r.unit}`, r.amount]),
  );
const reply = (operations: unknown[], rest = {}) =>
  JSON.stringify({
    version: 1,
    operations,
    ambiguities: [],
    unsupported: [],
    ...rest,
  });

for (const alternative of [false, true]) {
  const label = alternative ? "fake alternative" : "local ChatGPT adapter";

  test(`${label}: a Finnish multi-part instruction becomes exact operations in one call`, async () => {
    const { connection, provider, session } = await setup(alternative);
    const state = editPlan();
    const intent = await interpretEdit(
      session,
      {
        instruction:
          "Lisää 1 l maitoa, poista paahtoleipä ja tuplaa keitto. Porkkanaa ei löydy kotoa",
      },
      state,
      now,
    );
    expect(intent).toEqual({
      version: 1,
      operations: [
        {
          op: "addItem",
          rowKey: "milk:ml",
          quantity: { kind: "amount", amount: 1000, unit: "ml" },
        },
        { op: "removeItem", rowKey: "paahtoleipä:g" },
        { op: "changeServings", mealId: "m-soup", servings: 8 },
        { op: "markAtHome", rowKey: "carrot:g", atHome: false },
      ],
      ambiguities: [],
      unsupported: [],
    });
    const outcome = applyEditIntent(state, intent, { now });
    expect(outcome.status).toBe("applied");
    if (outcome.status !== "applied") return;
    const rows = amounts(outcome.result.state);
    expect(rows["milk:ml"]).toBe(2800);
    expect(rows["paahtoleipä:g"]).toBeUndefined();
    expect(rows["potato:g"]).toBe(1600);
    expect(rows["carrot:g"]).toBe(800);
    expect(rows["ruisleipä:g"]).toBe(500);
    expect(session.callCount).toBe(1);
    expect(session.model.providerId).toBe(provider.id);
    expect(connection.catalogueRequests).toBe(1);
  });

  test(`${label}: an English instruction replaces a meal with a new recipe and counts packs`, async () => {
    const { session } = await setup(alternative);
    const state = editPlan();
    const intent = await interpretEdit(
      session,
      {
        instruction:
          "replace pasta with sausage soup, two cartons of milk and we already have potatoes",
      },
      state,
      now,
    );
    expect(intent.operations.map((o) => o.op)).toEqual([
      "replaceMeal",
      "changeQuantity",
      "markAtHome",
    ]);
    expect(intent.operations[0]).toMatchObject({
      mealId: "m-pasta",
      replacement: { kind: "new", recipe: { name: "Nakkikeitto" } },
    });
    expect(intent.operations[1]).toEqual({
      op: "changeQuantity",
      rowKey: "milk:ml",
      quantity: { kind: "packs", count: 2 },
    });
    // No pack size is in the interpretation; the caller supplies the quoted one.
    expect(() => applyEditIntent(state, intent, { now })).toThrow(
      "packSizeUnknown",
    );
    const outcome = applyEditIntent(state, intent, {
      now,
      packSizes: { "milk:ml": { amount: 1000, unit: "ml" } },
    });
    if (outcome.status !== "applied") throw new Error("not applied");
    const next = outcome.result.state;
    expect(next.meals[0]).toMatchObject({ id: "m-pasta", servings: 4 });
    expect(next.recipes.at(-1)!.name).toBe("Nakkikeitto");
    // The new recipe shares the soup's potato and carrot identities.
    expect(
      requirements(next, now, true).find((r) => r.id === "potato"),
    ).toMatchObject({
      amount: 1600,
      sources: ["Nakkikeitto", "Peruna-porkkanakeitto"],
    });
    expect(amounts(next)["milk:ml"]).toBe(2000);
    expect(next.skipped.sort()).toEqual(["carrot:g", "potato:g"]);
  });

  test(`${label}: an unclear target returns ambiguity and the focused row settles it`, async () => {
    const state = editPlan();
    const before = JSON.stringify(state);
    const first = await setup(alternative);
    const ambiguous = await interpretEdit(
      first.session,
      { instruction: "poista leipä ja tuplaa keitto" },
      state,
      now,
    );
    expect(ambiguous.ambiguities).toEqual([
      {
        phrase: "poista leipä",
        candidates: ["row:ruisleipä:g", "row:paahtoleipä:g"],
      },
    ]);
    expect(applyEditIntent(state, ambiguous, { now }).status).toBe(
      "clarification",
    );
    expect(JSON.stringify(state)).toBe(before);
    const second = await setup(alternative);
    const focused = await interpretEdit(
      second.session,
      { instruction: "remove this", focusTargetId: "row:paahtoleipä:g" },
      state,
      now,
    );
    expect(focused.operations).toEqual([
      { op: "removeItem", rowKey: "paahtoleipä:g" },
    ]);
    const third = await setup(alternative);
    const unsupported = await interpretEdit(
      third.session,
      { instruction: "tilaa kotiinkuljetus huomiseksi" },
      state,
      now,
    );
    expect(unsupported).toEqual({
      version: 1,
      operations: [],
      ambiguities: [],
      unsupported: [{ phrase: "tilaa kotiinkuljetus huomiseksi" }],
    });
  });

  test(`${label}: invented, altered and misused targets are repaired once, then fail`, async () => {
    const valid = reply([{ op: "removeItem", target: "row:pasta:g" }]);
    for (const invalid of [
      reply([{ op: "removeItem", target: "row:saffron:g" }]),
      reply([{ op: "removeItem", target: "pasta:g" }]),
      reply([{ op: "removeItem", target: "meal:m-pasta" }]),
      // Two operations on one row contradict each other.
      reply([
        { op: "removeItem", target: "row:pasta:g" },
        { op: "markAtHome", target: "row:pasta:g", atHome: true },
      ]),
      reply([{ op: "changeServings", target: "row:pasta:g", servings: 2 }]),
      reply([
        {
          op: "replaceMeal",
          target: "meal:m-pasta",
          recipeId: "not-a-saved-recipe",
        },
      ]),
      // Retailer facts and unsupported commands have no place in the shape.
      reply([{ op: "removeItem", target: "row:pasta:g", productId: "p1" }]),
      reply([{ op: "removeItem", target: "row:pasta:g", atHome: true }]),
      reply([
        {
          op: "addItem",
          name: "Maito",
          quantity: { kind: "amount", amount: 1000, unit: "ml", price: 129 },
        },
      ]),
      reply([{ op: "orderDelivery", target: "meal:m-pasta" }]),
      reply([{ op: "removeItem", target: "row:pasta:g" }], { store: "x" }),
      "{",
    ]) {
      const repaired = await setup(alternative, [invalid, valid]);
      await expect(
        interpretEdit(
          repaired.session,
          { instruction: "poista pasta" },
          editPlan(),
          now,
        ),
      ).resolves.toMatchObject({
        operations: [{ op: "removeItem", rowKey: "pasta:g" }],
      });
      expect(repaired.connection.prompts).toHaveLength(2);
      expect(repaired.connection.prompts[1]).toContain(
        "previous response failed validation",
      );
      const failed = await setup(alternative, [invalid, invalid, valid]);
      await expect(
        interpretEdit(
          failed.session,
          { instruction: "poista pasta" },
          editPlan(),
          now,
        ),
      ).rejects.toThrow("invalidDraft");
      expect(failed.connection.prompts).toHaveLength(editTaskLimits.aiCalls);
    }
  });

  test(`${label}: a reply with a usable part keeps it without a repair (B4.4)`, async () => {
    // An ambiguity naming invented rows becomes a part to say again, never a choice.
    const invented = await setup(alternative, [
      reply(
        [
          {
            op: "addItem",
            name: "Kahvi",
            quantity: { kind: "amount", amount: 500, unit: "g" },
          },
        ],
        {
          ambiguities: [
            {
              phrase: "leipä",
              candidates: ["row:ruisleipä:g", "row:sämpylä:g"],
            },
          ],
        },
      ),
    ]);
    await expect(
      interpretEdit(
        invented.session,
        { instruction: "lisää kahvia ja leipää" },
        editPlan(),
        now,
      ),
    ).resolves.toMatchObject({
      operations: [{ op: "addItem", name: "Kahvi" }],
      ambiguities: [],
      unsupported: [{ phrase: "leipä" }],
    });
    expect(invented.connection.prompts).toHaveLength(1);
    // A named operation that fails validation is reported by its name.
    const named = await setup(alternative, [
      reply([
        { op: "removeItem", target: "row:pasta:g" },
        {
          op: "replaceMeal",
          target: "meal:m-pasta",
          recipeId: "invented",
          recipe: { name: "Lohikeitto" },
        },
      ]),
    ]);
    const kept = await interpretEdit(
      named.session,
      { instruction: "poista pasta ja vaihda lohikeittoon" },
      editPlan(),
      now,
    );
    expect(kept.operations).toMatchObject([{ op: "removeItem" }]);
    expect(kept.unsupported).toEqual([{ phrase: "Lohikeitto" }]);
  });

  test(`${label}: usage limit, provider failure and cancellation are not repaired`, async () => {
    for (const [scenario, code] of [
      ["usageLimit", "usageLimit"],
      ["incompleteDraft", "incomplete"],
      ["aiFailed", "transport"],
    ] as const) {
      const { connection, session } = await setup(alternative);
      connection.scenario = scenario;
      await expect(
        interpretEdit(
          session,
          { instruction: "poista pasta" },
          editPlan(),
          now,
        ),
      ).rejects.toMatchObject({ code });
      expect(session.callCount).toBe(1);
      expect(connection.prompts).toHaveLength(1);
    }
    const { connection, controller, session } = await setup(alternative, [
      (signal) =>
        new Promise((_, reject) =>
          signal.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          ),
        ),
    ]);
    const pending = interpretEdit(
      session,
      { instruction: "poista pasta" },
      editPlan(),
      now,
    );
    await Promise.resolve();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
    expect(connection.prompts).toHaveLength(1);
    await expect(
      interpretEdit(session, { instruction: "poista pasta" }, editPlan(), now),
    ).rejects.toMatchObject({ code: "cancelled" });
    expect(connection.prompts).toHaveLength(1);
  });
}

test("a model without the edit task, or an incomplete reply, fails without a call or repair", async () => {
  const provider = new ScriptedInferenceProvider("other", async () => ({
    text: "{",
    completion: "incomplete",
  }));
  const controller = new AbortController();
  const bounds = { maxCalls: 2, maxOutputCharacters: 100_000, timeoutMs: 1000 };
  const unsupported = new InferenceSession(
    provider,
    provider.models[0],
    bounds,
    controller.signal,
  );
  await expect(
    interpretEdit(
      unsupported,
      { instruction: "poista pasta" },
      editPlan(),
      now,
    ),
  ).rejects.toMatchObject({ code: "unsupportedTask" });
  expect(provider.calls).toHaveLength(0);
  const session = new InferenceSession(
    provider,
    {
      ...provider.models[0],
      capabilities: {
        ...provider.models[0].capabilities,
        tasks: [shoppingEditTask],
      },
    },
    bounds,
    controller.signal,
  );
  await expect(
    interpretEdit(session, { instruction: "poista pasta" }, editPlan(), now),
  ).rejects.toMatchObject({ code: "incomplete" });
  expect(provider.calls).toHaveLength(1);
  expect(provider.calls[0]).toMatchObject({
    task: shoppingEditTask,
    model: { providerId: "other" },
    output: { mode: "text" },
    maxOutputCharacters: editTaskLimits.maxOutputCharacters,
  });
});

test("the edit context carries names, amounts and IDs only", () => {
  const state = editPlan();
  state.note = "Yksityinen muistiinpano";
  state.receiptText = "KUITTI 12,34 EUR";
  state.context.storeName = "Private store";
  state.accepted = { "demo-k:demo-helsinki:potato": ["private-product"] };
  state.recipes[0].instructions = "Private cooking steps";
  const { context, known } = buildEditContext(
    { instruction: "vaihda keitto lasagneen", focusTargetId: "row:gone:g" },
    state,
    now,
  );
  const prompt = editPrompt(context);
  expect(prompt).not.toMatch(
    /Yksityinen|KUITTI|Private|private-product|demo-helsinki|budget|accepted/,
  );
  // A focus that is no longer on the list is dropped rather than passed on.
  expect(context.focus).toBeNull();
  expect(context.recipes.map((r) => r.id).sort()).toEqual([
    "lasagne",
    "pasta",
    "porridge",
    "soup",
  ]);
  expect(known.has("row:carrot:g")).toBe(true);
  expect(known.has("meal:m-soup")).toBe(true);
  expect(editFixtureReply(context).operations).toEqual([
    { op: "replaceMeal", target: "meal:m-soup", recipeId: "lasagne" },
  ]);
  expect(() => buildEditContext({ instruction: " " }, state, now)).toThrow();
  expect(() =>
    buildEditContext({ instruction: "x".repeat(2001) }, state, now),
  ).toThrow();
});

test("text and native-shaped output validate to the same intent", () => {
  const state = editPlan();
  const { known } = buildEditContext({ instruction: "x" }, state, now);
  const native = JSON.stringify({
    version: 1,
    operations: [
      {
        op: "changeQuantity",
        target: "row:milk:ml",
        name: null,
        quantity: { kind: "packs", amount: null, unit: null, count: 2 },
        recipeId: null,
        recipe: null,
        servings: null,
        atHome: null,
      },
    ],
    ambiguities: [],
    unsupported: [],
  });
  const text =
    '```json\n{"version":1,"operations":[{"op":"changeQuantity","target":"row:milk:ml","quantity":{"kind":"packs","count":2}}]}\n```';
  expect(validateEditIntent(native, known, state)).toEqual(
    validateEditIntent(text, known, state),
  );
  for (const quantity of [
    { kind: "packs", count: 2, amount: 2000 },
    { kind: "amount", amount: 2000, unit: "ml", count: 2 },
    { kind: "amount", amount: 2.5, unit: "ml" },
    { kind: "packs", count: 0 },
  ])
    expect(() =>
      validateEditIntent(
        reply([{ op: "changeQuantity", target: "row:milk:ml", quantity }]),
        known,
        state,
      ),
    ).toThrow("invalidDraft");
});

test("B5.9: a reply over the operation and phrase limits keeps its first operations and names the rest", () => {
  const state = editPlan();
  const { known } = buildEditContext({ instruction: "x" }, state, now);
  const names = Array.from({ length: 22 }, (_, i) => `Tuote ${i + 1}`);
  const intent = validateEditIntent(
    reply(
      names.map((name) => ({
        op: "setItem",
        name,
        quantity: { kind: "packs", count: 1 },
      })),
      { unsupported: [{ phrase: "x".repeat(300) }] },
    ),
    known,
    state,
  );
  expect(intent.operations).toHaveLength(20);
  expect(intent.unsupported.map((u) => u.phrase)).toEqual([
    "x".repeat(200),
    "Tuote 21",
    "Tuote 22",
  ]);
});
