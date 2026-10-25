import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { validatePlanningDraft } from "../src/ai/draft";
import { validateEditIntent } from "../src/ai/edit";
import { planningFixtureReply } from "../src/ai/planning-fixtures";
import { InferenceError } from "../src/ai/provider";
import { inferenceTasks } from "../src/ai/tasks";
import type { PlanningRun } from "../src/application/planning";
import { Service } from "../src/application/service";
import { lineMerchandiseStatus } from "../src/domain/matching";
import { initialState, type StoreContext } from "../src/domain/model";
import { KRuokaProvider } from "../src/stores/k-ruoka";
import { KRuokaSite, type PageRequest } from "../src/stores/k-ruoka-site";
import { LARGE_STORE, largeStore, response } from "./fixtures/k-ruoka/non-food";
import { editInference } from "./helpers/edit-inference";
import { ScriptedInferenceProvider } from "./helpers/inference";
import { memoryStorage } from "./helpers/purchase-fixtures";

const basket = JSON.parse(
  readFileSync(
    new URL("./fixtures/k-ruoka/basket-active.json", import.meta.url),
    "utf8",
  ),
);
const context: StoreContext = {
  providerId: "k-ruoka",
  storeId: LARGE_STORE,
  storeName: "Synteettinen kauppa",
  fulfillment: "pickup",
};
/** A real Service over the real K client and a synthetic large store that also sells milk. */
async function shop() {
  const searches: string[] = [];
  const request: PageRequest = async (r) => {
    const query = decodeURIComponent(
      r.path.match(/product-search\/([^?]+)/)?.[1] ?? "",
    );
    let body: unknown = {};
    if (r.path.startsWith("/kr-api/v2/product-search/")) {
      searches.push(query);
      body = response(
        LARGE_STORE,
        query,
        /^maito$/i.test(query)
          ? [{ ean: "6400000009001", name: "Kevytmaito 1 l", price: 1.09 }]
          : (largeStore[query.toLowerCase()] ?? []),
      );
    } else if (r.path.startsWith("/kr-api/basket/"))
      body = { ...basket, items: [], store: { id: LARGE_STORE, name: "S" } };
    return {
      status: 200,
      build: "42",
      cfMitigated: null,
      body: JSON.stringify(body),
    };
  };
  const memory = memoryStorage();
  const service = new Service(memory.storage);
  service.registry.register(
    new KRuokaProvider(new KRuokaSite(request, 0).call),
  );
  await service.init();
  await service.save({
    ...service.state,
    staples: [],
    meals: [],
    extras: [],
    context,
  });
  return { ...memory, service, searches };
}
function ai(replies: (string | Error)[]) {
  let call = 0;
  const provider = new ScriptedInferenceProvider("merchandise", async () => {
    const reply = replies[Math.min(call++, replies.length - 1)];
    if (reply instanceof Error) throw reply;
    return { completion: "complete", text: reply };
  });
  provider.models[0].capabilities.tasks = inferenceTasks;
  return provider;
}
const bind =
  (provider: ScriptedInferenceProvider) => async (run: PlanningRun) =>
    run.bindInference(provider, (await provider.discoverModels(run.signal))[0]);
const plan = async (
  service: Service,
  note: string,
  replies: (string | Error)[] = [JSON.stringify(planningFixtureReply(note, 4))],
) => {
  const provider = ai(replies);
  const ready = await service.planShopping(
    { prompt: note, consent: true },
    bind(provider),
  );
  return {
    provider,
    snapshot: await service.commitPlanning({
      operationId: ready.planning!.operationId,
    }),
  };
};
const row = (service: Service, name: string) =>
  service.basket.find((l) => l.requirement.name === name)!;
const status = (service: Service, name: string) =>
  lineMerchandiseStatus(
    row(service, name),
    service.registry.get("k-ruoka").capabilities.merchandise,
  );

for (const [language, note, family] of [
  [
    "fi",
    "paistinpannu 28 cm, kumisaappaat koko 32 ja 2 l maitoa",
    "kumisaapas",
  ],
  ["en", "frying pan 28 cm, rubber boots size 32 and 2 l milk", "rubber boots"],
] as const)
  test(`${language}: stated attributes become requirements, groceries stay groceries, one request`, async () => {
    const { service } = await shop();
    const { provider, snapshot } = await plan(service, note);
    expect(provider.calls).toHaveLength(1);
    const boots = snapshot.state.extras.find((i) => i.name === "Kumisaapas")!;
    expect(boots).toMatchObject({
      amount: 1,
      unit: "pcs",
      merchandise: {
        version: 1,
        family,
        attributes: [
          { kind: "size", value: "32", provenance: "explicit-note" },
        ],
        missing: [],
      },
    });
    // No grocery category is put on a non-food row.
    expect(boots.classification).toBeUndefined();
    expect(row(service, "Kumisaapas")).toMatchObject({
      product: { id: "6400000000328" },
      packs: 1,
      total: 1990,
    });
    expect(row(service, "Paistinpannu").product?.id).toBe("6400000001004");
    // The size and the 28 cm are attributes, never amounts; the milk's two litres are an amount.
    const milk = snapshot.state.extras.find((i) => i.name === "Maito")!;
    expect(milk).toMatchObject({ amount: 2000, unit: "ml" });
    expect(milk.merchandise).toBeUndefined();
    expect(row(service, "Maito")).toMatchObject({ packs: 2, total: 218 });
    expect(
      snapshot.committedIntents.map((i) => i.intent.quantity?.provenance),
    ).toEqual(["assumed", "assumed", "explicit-note"]);
  });

test("a missing size is asked for, not guessed: nothing is searched until the shopper answers", async () => {
  const { service, searches } = await shop();
  const { snapshot } = await plan(service, "kumisaappaat");
  expect(snapshot.state.extras[0].merchandise).toEqual({
    version: 1,
    family: "kumisaapas",
    attributes: [],
    missing: ["size"],
  });
  expect(searches).toEqual([]);
  expect(row(service, "Kumisaapas")).toMatchObject({
    product: null,
    total: null,
  });
  // The shopper answers on the row: one edit request, then the row is read and chosen.
  const edits = await editInference();
  const answered = await service.editList(
    {
      revision: service.state.revision,
      instruction: "32",
      consent: true,
      focusTargetId: "row:kumisaapas:pcs",
    },
    edits.session,
  );
  expect(edits.sessions[0].callCount).toBe(1);
  expect(answered.edit).toMatchObject({
    applied: [{ op: "setAttribute", name: "Kumisaapas", to: "size: 32" }],
  });
  expect(answered.state.extras[0].merchandise).toEqual({
    version: 1,
    family: "kumisaapas",
    attributes: [{ kind: "size", value: "32", provenance: "clarified" }],
    missing: [],
  });
  expect(searches).toEqual(["Kumisaapas 32"]);
  expect(row(service, "Kumisaapas").product?.id).toBe("6400000000328");
  expect(status(service, "Kumisaapas")).toBe("exact-available");
  // An alternative of another size cannot be accepted for the row.
  await expect(
    service.accept({ ingredientId: "kumisaapas", productId: "6400000000311" }),
  ).rejects.toThrow("unresolved");
  // Undo returns the row to waiting for its size.
  const undone = await service.undoEdit({ revision: service.state.revision });
  expect(undone.state.extras[0].merchandise?.missing).toEqual(["size"]);
});

test("a model cannot add an attribute, a product code or a retailer fact the shopper did not write", async () => {
  const note = "kumisaappaat koko 32";
  const state = { recipes: initialState().recipes, note };
  const draft = (
    change: (d: ReturnType<typeof planningFixtureReply>) => void,
  ) => {
    const reply = planningFixtureReply(note, 4);
    change(reply);
    return JSON.stringify(reply);
  };
  const refused = (raw: string) => {
    let caught: unknown;
    try {
      validatePlanningDraft(raw, state, note);
    } catch (error) {
      caught = error;
    }
    return (caught as { reason?: string } | undefined)?.reason ?? null;
  };
  const intent = (d: ReturnType<typeof planningFixtureReply>) =>
    d.items[0].merchandise!;
  expect(refused(draft(() => {}))).toBeNull();
  // Another size than the one written, a colour, a brand and a product code.
  expect(refused(draft((d) => (intent(d).attributes[0].value = "33")))).toBe(
    "merchandise",
  );
  for (const [kind, value] of [
    ["colour", "sininen"],
    ["model", "Nokian"],
    ["spec", "6400000000328"],
  ] as const)
    expect(
      refused(
        draft((d) =>
          intent(d).attributes.push({
            kind,
            value,
            provenance: "explicit-note",
          }),
        ),
      ),
    ).toBe("merchandise");
  // A provenance only the shopper's own answer can have, grams for a piece row, another family.
  expect(
    refused(draft((d) => (intent(d).attributes[0].provenance = "clarified"))),
  ).toBe("merchandise");
  expect(refused(draft((d) => (d.items[0].unit = "g")))).not.toBeNull();
  expect(refused(draft((d) => (intent(d).family = "sadetakki")))).toBe(
    "merchandise",
  );
  // Stock, price, product IDs and capabilities are not fields a model can fill.
  for (const extra of [
    { ean: "6400000000328" },
    { available: true },
    { price: 1990 },
    { cartWrite: true },
  ])
    expect(
      refused(draft((d) => Object.assign(intent(d), extra))),
    ).not.toBeNull();
  // A model that drops the needed size without saying so still ends with the size asked for.
  const dropped = validatePlanningDraft(
    draft((d) => (intent(d).attributes = [])),
    state,
    note,
  );
  expect(dropped.items[0].merchandise).toMatchObject({
    attributes: [],
    missing: ["size"],
  });
});

test("an invented non-food attribute is left out and asked for; a quota error leaves the list alone", async () => {
  const note = "kumisaappaat koko 32";
  const invented = planningFixtureReply(note, 4);
  invented.items[0].merchandise!.attributes[0].value = "33";
  const { service, searches } = await shop();
  const before = structuredClone(service.state);
  // B4.1: the reply is kept without its invented size and without a repair request.
  const salvaged = await plan(service, note, [JSON.stringify(invented)]);
  expect(salvaged.provider.calls).toHaveLength(1);
  expect(
    service.state.extras.find((i) => i.name === "Kumisaapas")?.merchandise,
  ).toMatchObject({ attributes: [], missing: ["size"] });
  expect(searches.filter((q) => q === "Kumisaapas 33")).toEqual([]);
  const limited = ai([new InferenceError("usageLimit")]);
  await expect(
    service.planShopping({ prompt: note, consent: true }, bind(limited)),
  ).rejects.toThrow();
  expect(limited.calls).toHaveLength(1);
  const exact = await plan(service, note);
  expect(exact.provider.calls).toHaveLength(1);
  expect(row(service, "Kumisaapas").product?.id).toBe("6400000000328");
  expect(before.extras).toEqual([]);
  expect(searches.filter((q) => q === "Kumisaapas 33")).toEqual([]);
});

test("one edit can add a non-food item and change groceries together; evidence is the instruction", async () => {
  const { service } = await shop();
  await plan(service, "2 l maitoa");
  const milkBefore = structuredClone(row(service, "Maito"));
  const edits = await editInference();
  const edited = await service.editList(
    {
      revision: service.state.revision,
      instruction: "paistinpannu 28 cm, kumisaappaat koko 32",
      consent: true,
    },
    edits.session,
  );
  expect(edits.sessions[0].callCount).toBe(1);
  expect(edited.edit).toMatchObject({
    applied: [
      { op: "setItem", name: "Paistinpannu", after: 1 },
      { op: "setItem", name: "Kumisaapas", after: 1 },
    ],
  });
  expect(row(service, "Paistinpannu").product?.id).toBe("6400000001004");
  expect(row(service, "Kumisaapas").product?.id).toBe("6400000000328");
  // The grocery row beside them was neither changed nor read again.
  expect(row(service, "Maito")).toEqual(milkBefore);

  // The validator itself: an attribute or intent not in the instruction is invalid output.
  const known = new Set(["row:kumisaapas:pcs"]);
  const state = { recipes: [], note: "" };
  const operation = (extra: object) =>
    JSON.stringify({ version: 1, operations: [extra] });
  const attribute = (value: string) =>
    operation({
      op: "setAttribute",
      target: "row:kumisaapas:pcs",
      attribute: { kind: "size", value },
    });
  expect(
    validateEditIntent(attribute("32"), known, state, "koko 32").operations,
  ).toEqual([
    { op: "setAttribute", rowKey: "kumisaapas:pcs", kind: "size", value: "32" },
  ]);
  for (const [raw, instruction] of [
    [attribute("33"), "koko 32"],
    [attribute("32"), ""],
    [attribute("6400000000328"), "6400000000328"],
    [
      operation({
        op: "setItem",
        name: "Kumisaapas",
        quantity: { kind: "amount", amount: 1, unit: "pcs" },
        merchandise: {
          version: 1,
          family: "kumisaapas",
          attributes: [
            { kind: "colour", value: "sininen", provenance: "explicit-note" },
          ],
          missing: [],
        },
      }),
      "kumisaappaat koko 32",
    ],
    [
      operation({
        op: "setAttribute",
        attribute: { kind: "size", value: "32" },
      }),
      "32",
    ],
  ] as const)
    expect(() => validateEditIntent(raw, known, state, instruction)).toThrow(
      "invalidDraft",
    );
});
