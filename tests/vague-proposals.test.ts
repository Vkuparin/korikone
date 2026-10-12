import { expect, test } from "vitest";
import { validatePlanningDraft } from "../src/ai/draft";
import { planningFixtureReply } from "../src/ai/planning-fixtures";
import { inferenceTasks } from "../src/ai/tasks";
import type { PlanningRun } from "../src/application/planning";
import { initialState } from "../src/domain/model";
import {
  createFixtureService,
  type FixtureChain,
} from "./fixtures/ai-shopping/environment";
import type { BaselineProduct } from "./fixtures/matching-baseline";
import { ScriptedInferenceProvider } from "./helpers/inference";

// A synthetic store that sells one ordinary product for each ingredient, under the ingredient's
// plain name. Prices are euros.
const store = (): Record<string, BaselineProduct[]> => ({
  Uunimakkara: [
    { id: "sausage", name: "HK Kabanossi uunimakkara 600 g", price: 3.49 },
    { id: "grill", name: "Grillimakkara 400 g", price: 1.99 },
  ],
  Juustoraaste: [
    { id: "grated", name: "Valio juustoraaste 150 g", price: 1.89 },
  ],
  Peruna: [{ id: "potato", name: "Kotimaista peruna 1 kg", price: 1.29 }],
  Maito: [
    { id: "semi", name: "Kevytmaito 1 l", price: 1.09 },
    { id: "skim", name: "Rasvaton maito 1 l", price: 1.19 },
  ],
  Voi: [{ id: "butter", name: "Valio voi 500 g", price: 3.99 }],
  Juusto: [{ id: "cheese", name: "Edam juusto 500 g", price: 4.49 }],
  Poronkäristys: [
    { id: "reindeer", name: "Lapin poronkäristys 500 g", price: 19.9 },
  ],
  Puolukkasurvos: [
    { id: "lingonberry", name: "Puolukkasurvos 400 g", price: 2.49 },
  ],
  "*": [],
});
function ai(note: string, servings = 4) {
  const provider = new ScriptedInferenceProvider(
    "vague-fixture",
    async (request) => {
      if (request.task.id !== "shopping-plan")
        throw new Error(`unexpected task ${request.task.id}`);
      return {
        completion: "complete",
        text: JSON.stringify(planningFixtureReply(note, servings)),
      };
    },
  );
  provider.models[0].capabilities.tasks = inferenceTasks;
  return provider;
}
const bind =
  (provider: ScriptedInferenceProvider) => async (run: PlanningRun) =>
    run.bindInference(provider, (await provider.discoverModels(run.signal))[0]);
async function propose(
  chain: FixtureChain,
  note: string,
  options: {
    catalogue?: Record<string, BaselineProduct[]>;
    prepare?: (
      env: Awaited<ReturnType<typeof createFixtureService>>,
    ) => Promise<unknown>;
  } = {},
) {
  const env = await createFixtureService(chain, options.catalogue ?? store());
  await options.prepare?.(env);
  const provider = ai(note);
  const ready = await env.service.planShopping(
    { prompt: note, consent: true },
    bind(provider),
  );
  expect(ready.planning!.phase).toBe("ready");
  const counters = ready.planning!.counters;
  const snapshot = await env.service.commitPlanning({
    operationId: ready.planning!.operationId,
  });
  const rows = Object.fromEntries(
    snapshot.basket.map((line) => [
      line.requirement.name,
      {
        amount: line.requirement.amount,
        unit: line.requirement.unit,
        product: line.product?.id ?? null,
        packs: line.packs,
      },
    ]),
  );
  // Reading the catalogue is the only thing that reached the retailer.
  expect(
    env.tools.every((t) => t === "search_products" || t === "check_basket"),
  ).toBe(true);
  expect(provider.calls).toHaveLength(1);
  return { ...env, snapshot, rows, counters };
}

for (const chain of ["k-ruoka", "s-kaupat"] as const) {
  test(`${chain}: a dish named alone becomes a complete meal with a side and real products`, async () => {
    const { snapshot, rows, counters, service } = await propose(
      chain,
      "Uunimakkaraa",
    );
    expect(rows).toEqual({
      Uunimakkara: { amount: 600, unit: "g", product: "sausage", packs: 1 },
      Juustoraaste: { amount: 150, unit: "g", product: "grated", packs: 1 },
      Peruna: { amount: 800, unit: "g", product: "potato", packs: 1 },
      Maito: { amount: 200, unit: "ml", product: "semi", packs: 1 },
      Voi: { amount: 50, unit: "g", product: "butter", packs: 1 },
    });
    expect(snapshot.basket.every((l) => l.product?.providerId === chain)).toBe(
      true,
    );
    expect(snapshot.state.meals).toHaveLength(1);
    // The side is part of the dish and is published as an assumption, not as a request.
    expect(snapshot.proposal).toEqual({
      sides: [
        {
          mealId: snapshot.state.meals[0].id,
          recipeId: snapshot.state.meals[0].recipeId,
          dish: "Uunimakkara",
          side: "Perunamuusi",
        },
      ],
      quantities: [],
    });
    expect(snapshot.committedIntents.map((i) => i.intent.label)).toEqual([
      "Uunimakkaraa",
    ]);
    expect(snapshot.planningIncomplete).toBe(false);
    // One interpretation, no resolver call, and at most three reads for each of five rows.
    expect(counters.aiCalls).toBe(1);
    expect(counters.searches).toBeGreaterThanOrEqual(5);
    expect(counters.searches).toBeLessThanOrEqual(15);
    // Nothing was saved as a preference or accepted on the shopper's behalf.
    expect(service.state.categoryPreferences).toEqual([]);
    expect(service.state.accepted).toEqual({});
  });

  test(`${chain}: the supplied three-dish note uses the named side once`, async () => {
    const { snapshot, rows } = await propose(
      chain,
      "Uunimakkaraa, perunamuusia, poronkäristystä",
    );
    expect(snapshot.state.meals).toHaveLength(3);
    // Mashed potato was asked for itself, so neither other dish adds its own.
    expect(snapshot.proposal.sides).toEqual([]);
    expect(rows).toEqual({
      Uunimakkara: { amount: 600, unit: "g", product: "sausage", packs: 1 },
      Juustoraaste: { amount: 150, unit: "g", product: "grated", packs: 1 },
      Peruna: { amount: 800, unit: "g", product: "potato", packs: 1 },
      Maito: { amount: 200, unit: "ml", product: "semi", packs: 1 },
      Voi: { amount: 100, unit: "g", product: "butter", packs: 1 },
      Poronkäristys: {
        amount: 500,
        unit: "g",
        product: "reindeer",
        packs: 1,
      },
      Puolukkasurvos: {
        amount: 200,
        unit: "g",
        product: "lingonberry",
        packs: 1,
      },
    });
    expect(snapshot.committedIntents.map((i) => i.status)).toEqual([
      "resolved",
      "resolved",
      "resolved",
    ]);
  });

  test(`${chain}: plain groceries get one ordinary purchase each, marked as assumed`, async () => {
    const { snapshot, rows } = await propose(
      chain,
      "maitoa, voita ja 2 kg juustoa",
    );
    expect(rows).toEqual({
      Maito: { amount: 1000, unit: "ml", product: "semi", packs: 1 },
      Voi: { amount: 500, unit: "g", product: "butter", packs: 1 },
      // A stated amount is kept exactly and is not an assumption.
      Juusto: { amount: 2000, unit: "g", product: "cheese", packs: 4 },
    });
    expect(snapshot.proposal.quantities).toEqual([
      {
        requirementKey: snapshot.proposal.quantities[0].requirementKey,
        label: "maitoa",
        amount: 1000,
        unit: "ml",
      },
      {
        requirementKey: snapshot.proposal.quantities[1].requirementKey,
        label: "voita",
        amount: 500,
        unit: "g",
      },
    ]);
    expect(snapshot.planningIncomplete).toBe(false);
  });
}

test("a declined side, an exclusion, a saved preference and an empty store are respected", async () => {
  const plain = await propose("s-kaupat", "Uunimakkaraa ilman lisuketta");
  expect(Object.keys(plain.rows)).toEqual(["Uunimakkara", "Juustoraaste"]);
  expect(plain.snapshot.proposal.sides).toEqual([]);

  // The household excludes the only oven sausage: the row stays open, nothing else is taken.
  const excluded = await propose("k-ruoka", "Uunimakkaraa", {
    prepare: (env) =>
      env.service.save({
        ...env.service.state,
        household: { ...env.service.state.household, exclusions: "kabanossi" },
      }),
  });
  expect(excluded.rows.Uunimakkara).toMatchObject({ product: null, packs: 0 });
  expect(excluded.rows.Peruna.product).toBe("potato");
  expect(excluded.snapshot.planningIncomplete).toBe(true);

  // A saved required milk type decides the assumed milk as well.
  const preferred = await propose("s-kaupat", "maitoa", {
    // A remembered rule is written by its own action; here the saved profile already has it.
    prepare: async (env) => {
      env.service.state = {
        ...env.service.state,
        categoryPreferences: [
          {
            category: "milk",
            qualifiers: [{ kind: "fat", value: "skimmed" }],
            strength: "required",
          },
        ],
      };
    },
  });
  expect(preferred.rows.Maito).toMatchObject({ amount: 1000, product: "skim" });

  // Nothing suitable is sold: every row is shown unresolved and no product is invented.
  const empty = await propose("k-ruoka", "Uunimakkaraa", {
    catalogue: { "*": [] },
  });
  expect(Object.values(empty.rows).map((r) => r.product)).toEqual([
    null,
    null,
    null,
    null,
    null,
  ]);
  expect(empty.snapshot.proposal.sides).toHaveLength(1);
  expect(empty.snapshot.state.meals).toHaveLength(1);
});

test("the resolver switch changes nothing here, and cancelling keeps the saved list", async () => {
  for (const resolverEnabled of [true, false]) {
    const { counters, rows } = await propose("s-kaupat", "Uunimakkaraa", {
      prepare: (env) =>
        env.service.save({ ...env.service.state, resolverEnabled }),
    });
    expect(counters.aiCalls).toBe(1);
    expect(rows.Uunimakkara.product).toBe("sausage");
  }
  let cancel = () => {};
  const env = await createFixtureService(
    "k-ruoka",
    store(),
    undefined,
    async () => cancel(),
  );
  cancel = () => env.service.planning.cancel();
  const before = structuredClone(env.service.state);
  await expect(
    env.service.planShopping(
      { prompt: "Uunimakkaraa", consent: true },
      bind(ai("Uunimakkaraa")),
    ),
  ).rejects.toThrow("aiCancelled");
  expect(env.service.state).toEqual(before);
  expect(env.service.basket).toEqual([]);
});

test("the draft contract accepts a fitting side and an assumed amount, and refuses the rest", () => {
  const state = { recipes: initialState().recipes, note: "" };
  const valid = (note: string) => planningFixtureReply(note, 4);
  const check = (
    note: string,
    change: (draft: ReturnType<typeof valid>) => void = () => {},
  ) => {
    const draft = valid(note);
    change(draft);
    return validatePlanningDraft(JSON.stringify(draft), state, note);
  };
  const alone = check("Uunimakkaraa");
  expect(alone.recipes[0]).toMatchObject({
    name: "Uunimakkara",
    assumedSide: "Perunamuusi",
  });
  expect(alone.recipes[0].ingredients.map((i) => i.name)).toEqual([
    "Uunimakkara",
    "Juustoraaste",
    "Peruna",
    "Maito",
    "Voi",
  ]);
  expect(check("maitoa").intents[0].quantity).toEqual({
    amount: 1000,
    unit: "ml",
    provenance: "assumed",
  });
  const refused = (
    note: string,
    change: (draft: ReturnType<typeof valid>) => void,
    reason: string,
  ) => {
    let caught: unknown;
    try {
      check(note, change);
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ message: "invalidDraft", reason });
  };
  // A side that the note asks for as its own dish, twice on one dish, or for no dish at all.
  refused(
    "Uunimakkaraa, perunamuusia",
    (draft) => draft.sides!.push({ mealIndex: 0, name: "Perunamuusi" }),
    "assumed-side",
  );
  refused(
    "Uunimakkaraa",
    (draft) => draft.sides!.push({ mealIndex: 0, name: "Riisi" }),
    "assumed-side",
  );
  refused(
    "Uunimakkaraa",
    (draft) => (draft.sides![0].mealIndex = 3),
    "assumed-side",
  );
  // A side against the shopper's word.
  refused(
    "Uunimakkaraa ilman lisuketta",
    (draft) => draft.sides!.push({ mealIndex: 0, name: "Perunamuusi" }),
    "assumed-side",
  );
  // An assumed amount where the note states one, or for a grocery that is not on the list.
  refused(
    "2 l maitoa",
    (draft) => (draft.intents[0].quantity!.provenance = "assumed"),
    "intent-quantity",
  );
  refused(
    "maitoa",
    (draft) => {
      draft.items = [];
      draft.intents[0].itemIndex = null;
      draft.intents[0].unresolvedReason = "unknown-quantity";
    },
    "shape",
  );
  // Coffee stays the scripted request the planner could not size: still valid, still unresolved.
  expect(check("kahvia").intents[0]).toMatchObject({
    unresolvedReason: "unknown-quantity",
    quantity: { provenance: "unknown" },
  });
});
