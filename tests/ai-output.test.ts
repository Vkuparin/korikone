import { expect, test } from "vitest";
import {
  extractRecipe,
  interpretShopping,
  invokeTaskOutput,
  shoppingNativeOutput,
  recipeNativeOutput,
} from "../src/ai/output";
import { InferenceError, InferenceSession } from "../src/ai/provider";
import { shoppingDraftTask } from "../src/ai/tasks";
import { initialState } from "../src/domain/model";
import { ScriptedInferenceProvider } from "./helpers/inference";
import { Service } from "../src/application/service";

const milk = {
  id: "milk",
  name: "Maito",
  amount: 1000,
  unit: "ml",
  classification: null,
};
const shopping = { recipes: [], meals: [], items: [milk], notes: "" };
const recipe = {
  id: "porridge",
  name: "Puuro",
  servings: 2,
  ingredients: [milk],
  instructions: "Keitä.",
  kind: null,
};
function setup(native: boolean, replies: unknown[]) {
  let index = 0;
  const provider = new ScriptedInferenceProvider(
    "synthetic-output",
    async () => {
      const value = replies[Math.min(index++, replies.length - 1)];
      if (value instanceof Error) throw value;
      return {
        text: typeof value === "string" ? value : JSON.stringify(value),
        completion: "complete",
      };
    },
  );
  provider.models[0].capabilities.outputModes = native
    ? ["text", "json-schema"]
    : ["text"];
  const controller = new AbortController();
  const session = new InferenceSession(
    provider,
    provider.models[0],
    { maxCalls: 2, maxOutputCharacters: 100_000, timeoutMs: 1000 },
    controller.signal,
  );
  return { provider, session, controller };
}

test("versioned native schemas require every field and forbid unknown object keys", () => {
  function inspect(value: unknown) {
    if (!value || typeof value !== "object") return;
    const schema = value as Record<string, unknown>;
    if (schema.type === "object") {
      expect(schema.additionalProperties).toBe(false);
      expect(schema.required).toEqual(Object.keys(schema.properties as object));
    }
    for (const child of Object.values(schema)) {
      if (Array.isArray(child)) child.forEach(inspect);
      else inspect(child);
    }
  }
  expect(shoppingNativeOutput.name).toBe("shopping_draft_v1");
  expect(recipeNativeOutput.name).toBe("recipe_import_v1");
  inspect(shoppingNativeOutput.schema);
  inspect(recipeNativeOutput.schema);
});

test("native nullable metadata and text omissions produce the same validated groceries and recipe", async () => {
  const state = initialState();
  state.recipes = [];
  const textMilk = { id: "milk", name: "Maito", amount: 1000, unit: "ml" };
  const native = setup(true, [shopping, recipe]);
  const text = setup(false, [
    { items: [textMilk] },
    { ...recipe, kind: undefined, ingredients: [textMilk] },
  ]);
  expect(await interpretShopping(native.session, "Maitoa", state)).toEqual(
    await interpretShopping(text.session, "Maitoa", state),
  );
  expect(await extractRecipe(native.session, "Puuro", state)).toEqual(
    await extractRecipe(text.session, "Puuro", state),
  );
  expect(native.provider.calls.map((c) => c.output.mode)).toEqual([
    "json-schema",
    "json-schema",
  ]);
  expect(text.provider.calls.every((c) => c.output.mode === "text")).toBe(true);
});

test("native nullable day and leftovers use domain defaults with real recipe references", async () => {
  const { session } = setup(true, [
    {
      ...shopping,
      recipes: [recipe],
      meals: [{ recipeId: recipe.id, servings: 2, day: null, leftovers: null }],
      items: [],
    },
  ]);
  const result = await interpretShopping(session, "Puuro", initialState());
  expect(result.meals[0]).toEqual({
    recipeId: result.recipes[0].id,
    servings: 2,
    day: 0,
    leftovers: false,
  });
});

test("native groceries approve and survive the real persistence path", async () => {
  const values = new Map<string, unknown>();
  const storage = {
    get: async (key: string) => values.get(key),
    set: async (key: string, value: unknown) =>
      values.set(key, structuredClone(value)),
  };
  const service = new Service(storage);
  service.developmentMode = true;
  await service.init();
  await service.save({ ...service.state, recipes: [], staples: [] });
  const { session } = setup(true, [shopping]);
  service.draft = await interpretShopping(session, "Maitoa", service.state);
  service.draftNote = "Maitoa";
  service.draftRevision = service.state.revision;
  await service.approveDraft();
  expect(service.state.extras[0]).toMatchObject({
    name: "Maito",
    amount: 1000,
    unit: "ml",
  });
  const restarted = new Service(storage);
  restarted.developmentMode = true;
  await restarted.init();
  expect(restarted.state).toEqual(service.state);
});

test("native recipe extraction repairs structure and domain bounds without saving state", async () => {
  for (const invalid of [
    { ...recipe, instructions: undefined },
    { ...recipe, servings: 101 },
    { ...recipe, ingredients: [] },
  ]) {
    const state = initialState();
    const before = structuredClone(state);
    const { provider, session } = setup(true, [invalid, recipe]);
    expect((await extractRecipe(session, "Puuro", state)).name).toBe("Puuro");
    expect(state).toEqual(before);
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[1].output).toEqual(provider.calls[0].output);
    expect(provider.calls[0].task.id).toBe("recipe-import");
  }
});

test("invalid native syntax, missing fields, extra fields and semantic quantities each get one fixed-format repair", async () => {
  for (const invalid of [
    "{",
    { items: [milk] },
    { ...shopping, unexpected: true },
    { ...shopping, items: [{ ...milk, amount: 0 }] },
    {
      ...shopping,
      meals: [
        { recipeId: "invented", servings: 2, day: null, leftovers: null },
      ],
    },
  ]) {
    const { provider, session } = setup(true, [invalid, shopping]);
    const result = await interpretShopping(session, "Maitoa", initialState());
    expect(result.items[0].amount).toBe(1000);
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[1].output).toEqual(provider.calls[0].output);
    expect(provider.calls[1].model).toEqual(provider.calls[0].model);
    expect(provider.calls[1].task).toEqual(provider.calls[0].task);
  }
});

test("both formats reject a second invalid response without a third invocation", async () => {
  for (const native of [false, true]) {
    const { provider, session } = setup(native, ["invalid"]);
    await expect(
      interpretShopping(session, "Maito", initialState()),
    ).rejects.toThrow("invalidDraft");
    expect(provider.calls).toHaveLength(2);
  }
});

test("native structure cannot forge explicit source evidence or remembered provenance", async () => {
  for (const classification of [
    {
      category: "milk",
      provenance: "explicit-note",
      evidence: { start: 0, end: 5, quote: "Maito" },
      qualifiers: [],
    },
    {
      category: "milk",
      provenance: "remembered",
      evidence: null,
      qualifiers: [],
    },
  ]) {
    const { provider, session } = setup(true, [
      {
        ...shopping,
        items: [{ ...milk, classification }],
      },
    ]);
    await expect(
      interpretShopping(session, "Leipä", initialState()),
    ).rejects.toThrow("invalidDraft");
    expect(provider.calls).toHaveLength(2);
  }
  const { session } = setup(true, [
    {
      ...shopping,
      items: [
        {
          ...milk,
          classification: {
            category: "milk",
            provenance: "explicit-note",
            evidence: { start: 0, end: 5, quote: "Maito" },
            qualifiers: [],
          },
        },
      ],
    },
  ]);
  expect(
    (await interpretShopping(session, "Maito", initialState())).items[0]
      .classification?.provenance,
  ).toBe("explicit-note");
});

test("permission, limit, cancel and rejected native capability are terminal with no text fallback", async () => {
  for (const code of [
    "permissionDenied",
    "usageLimit",
    "cancelled",
    "unsupportedCapability",
  ] as const) {
    const { provider, session } = setup(true, [
      new InferenceError(code),
      shopping,
    ]);
    await expect(
      interpretShopping(session, "Maito", initialState()),
    ).rejects.toMatchObject({ code });
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0].output.mode).toBe("json-schema");
  }
});

test("incomplete native envelopes cannot trigger schema repair", async () => {
  const provider = new ScriptedInferenceProvider("partial", async () => ({
    text: JSON.stringify(shopping),
    completion: "incomplete",
  }));
  provider.models[0].capabilities.outputModes = ["json-schema"];
  const session = new InferenceSession(
    provider,
    provider.models[0],
    {
      maxCalls: 2,
      maxOutputCharacters: 100_000,
      timeoutMs: 1000,
    },
    new AbortController().signal,
  );
  await expect(
    interpretShopping(session, "Maito", initialState()),
  ).rejects.toMatchObject({ code: "incomplete" });
  expect(provider.calls).toHaveLength(1);
});

test("cancellation rejects a pending native invocation and ignores late valid output", async () => {
  let release!: () => void;
  let started!: () => void;
  const dispatched = new Promise<void>((resolve) => {
    started = resolve;
  });
  const provider = new ScriptedInferenceProvider("late-native", async () => {
    started();
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return { text: JSON.stringify(shopping), completion: "complete" };
  });
  provider.models[0].capabilities.outputModes = ["json-schema"];
  const controller = new AbortController();
  const session = new InferenceSession(
    provider,
    provider.models[0],
    {
      maxCalls: 2,
      maxOutputCharacters: 100_000,
      timeoutMs: 1000,
    },
    controller.signal,
  );
  const result = interpretShopping(session, "Maito", initialState());
  const rejected = expect(result).rejects.toMatchObject({ code: "cancelled" });
  await dispatched;
  controller.abort();
  await rejected;
  release();
  expect(provider.signals[0].aborted).toBe(true);
  expect(provider.calls).toHaveLength(1);
});

test("task snapshots preserve validation references across concurrent edits and never read private history", async () => {
  const state = initialState();
  state.recipes = [
    {
      ...recipe,
      kind: "meal",
      ingredients: [{ ...milk, unit: "ml", classification: undefined }],
    },
  ];
  for (const key of ["receiptText", "note", "purchaseHistory"])
    Object.defineProperty(state, key, {
      get() {
        throw new Error("private field read");
      },
    });
  const provider = new ScriptedInferenceProvider("snapshot", async () => {
    state.recipes = [];
    state.household.servings = 99;
    return {
      text: JSON.stringify({ meals: [{ recipeId: "porridge", servings: 2 }] }),
      completion: "complete",
    };
  });
  const session = new InferenceSession(
    provider,
    provider.models[0],
    {
      maxCalls: 2,
      maxOutputCharacters: 100_000,
      timeoutMs: 1000,
    },
    new AbortController().signal,
  );
  expect(
    (await interpretShopping(session, "Puuro", state)).meals[0].recipeId,
  ).toBe("porridge");
  expect(provider.calls).toHaveLength(1);
  const imported = setup(false, [
    {
      ...recipe,
      kind: undefined,
      ingredients: [{ ...milk, classification: undefined }],
    },
  ]);
  expect((await extractRecipe(imported.session, "Puuro", state)).name).toBe(
    "Puuro",
  );
});

test("zero-repair task contract performs one validation attempt and unsupported versions dispatch nothing", async () => {
  const { provider, session } = setup(false, ["invalid"]);
  const definition = {
    task: shoppingDraftTask,
    prompt: "synthetic",
    native: shoppingNativeOutput,
    normalizeNative: (raw: string) => raw,
    validate: (_raw: string): never => {
      throw new Error("invalidDraft");
    },
    repairLimit: 0 as const,
    correction: "",
  };
  await expect(invokeTaskOutput(session, definition)).rejects.toThrow(
    "invalidDraft",
  );
  expect(provider.calls).toHaveLength(1);
  await expect(
    invokeTaskOutput(session, {
      ...definition,
      task: { ...shoppingDraftTask, version: 999 },
    }),
  ).rejects.toMatchObject({ code: "unsupportedTask" });
  expect(provider.calls).toHaveLength(1);
});
