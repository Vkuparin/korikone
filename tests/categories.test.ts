import { expect, test } from "vitest";
import {
  classificationSchema,
  inferredClassification,
} from "../src/domain/categories";
import {
  ingredientSchema,
  initialState,
  stateSchema,
} from "../src/domain/model";
import { validateDraft } from "../src/ai/draft";
import { requirements } from "../src/domain/planner";
import { Service } from "../src/application/service";

const item = (name: string, classification?: unknown) => ({
  id: "model-id",
  name,
  amount: 400,
  unit: "g",
  ...(classification ? { classification } : {}),
});
const evidence = (quote: string) => ({ start: 0, end: quote.length, quote });
const explicit = (
  quote: string,
  category = "mince",
  kind = "meat",
  value = "beef",
) => ({
  category,
  provenance: "explicit-note",
  evidence: evidence(quote),
  qualifiers: [
    { kind, value, provenance: "explicit-note", evidence: evidence(quote) },
  ],
});
const draft = (items: unknown[], source = "") =>
  validateDraft(JSON.stringify({ items }), initialState(), source);

test("generic and model-specific mince retain assumption provenance while explicit beef needs evidence", () => {
  expect(draft([item("Jauheliha")]).items[0].classification).toEqual({
    category: "mince",
    provenance: "model-assumed",
    qualifiers: [],
  });
  expect(
    draft([item("Naudan jauheliha")], "Jauhelihaa 400 g").items[0]
      .classification?.qualifiers,
  ).toEqual([{ kind: "meat", value: "beef", provenance: "model-assumed" }]);
  const note = "Naudan jauhelihaa 400 g";
  expect(
    draft([item("Naudan jauheliha", explicit(note))], note).items[0]
      .classification?.qualifiers[0].provenance,
  ).toBe("explicit-note");
});

test("milk specificity distinguishes an assumption from explicit lactose-free request", () => {
  expect(draft([item("Maito")]).items[0].classification?.qualifiers).toEqual(
    [],
  );
  expect(
    draft([item("Laktoositon maito")], "Maitoa").items[0].classification
      ?.qualifiers[0],
  ).toMatchObject({
    kind: "lactose",
    value: "free",
    provenance: "model-assumed",
  });
  const note = "Laktoositonta maitoa 1 l";
  const c = explicit(note, "milk", "lactose", "free");
  expect(
    draft([item("Laktoositon maito", c)], note).items[0].classification,
  ).toEqual(c);
});

test("invalid or unsupported explicit evidence and model-owned memory/observations fail at draft boundary", () => {
  const note = "Naudan jauhelihaa";
  for (const c of [
    { ...explicit(note), evidence: evidence("Different text") },
    {
      ...explicit(note),
      evidence: { start: 1, end: note.length + 1, quote: note },
    },
    explicit("Jauhelihaa"),
    explicit("Ei naudan jauhelihaa"),
    { ...explicit(note), evidence: undefined },
    { category: "mince", provenance: "remembered", qualifiers: [] },
    { category: "mince", provenance: "observed", qualifiers: [] },
    {
      category: "milk",
      provenance: "model-assumed",
      qualifiers: [
        { kind: "meat", value: "beef", provenance: "model-assumed" },
      ],
    },
  ])
    expect(() => draft([item("Naudan jauheliha", c)], note)).toThrow(
      "invalidDraft",
    );
});

test("schema validates category-specific values, duplicates and evidence bounds", () => {
  for (const c of [
    { category: "garlic", provenance: "model-assumed", qualifiers: [] },
    {
      category: "milk",
      provenance: "model-assumed",
      qualifiers: [
        { kind: "lactose", value: "certified-safe", provenance: "observed" },
      ],
    },
    {
      ...explicit("Naudan jauheliha"),
      qualifiers: [
        ...explicit("Naudan jauheliha").qualifiers,
        ...explicit("Naudan jauheliha").qualifiers,
      ],
    },
    {
      ...explicit("Naudan jauheliha"),
      evidence: { start: 0, end: 8, quote: "Too short" },
    },
  ])
    expect(classificationSchema.safeParse(c).success).toBe(false);
});

test("a requested dish does not make recipe-generated specificity an explicit note constraint", () => {
  const state = initialState();
  const raw = {
    recipes: [
      {
        id: "new",
        name: "Keitto",
        servings: 4,
        ingredients: [item("Naudan jauheliha")],
        instructions: "Keitä",
      },
    ],
    meals: [{ recipeId: "new", servings: 4 }],
  };
  const result = validateDraft(JSON.stringify(raw), state, "Keittoa");
  expect(
    result.recipes[0].ingredients[0].classification?.qualifiers[0].provenance,
  ).toBe("recipe-inferred");
  raw.recipes[0].ingredients[0] = item(
    "Naudan jauheliha",
    explicit("Naudan jauhelihaa"),
  );
  expect(() =>
    validateDraft(JSON.stringify(raw), state, "Naudan jauhelihaa"),
  ).toThrow("invalidDraft");
});

test("different provenance has distinct identities and survives real service save, requirements and backup", async () => {
  const note = "Naudan jauhelihaa";
  const generated = draft(
    [item("Naudan jauheliha"), item("Naudan jauheliha", explicit(note))],
    note,
  );
  expect(new Set(generated.items.map((i) => i.id)).size).toBe(2);
  const values = new Map<string, unknown>();
  const storage = {
    get: async (key: string) => values.get(key),
    set: async (key: string, value: unknown) => {
      values.set(key, structuredClone(value));
    },
  };
  const service = new Service(storage);
  service.developmentMode = true;
  await service.init();
  await service.save({
    ...service.state,
    staples: [],
    extras: generated.items,
  });
  expect(
    requirements(service.state).map(
      (r) => r.classification?.qualifiers[0].provenance,
    ),
  ).toEqual(["model-assumed", "explicit-note"]);
  const backup = await service.exportBackup();
  await service.save({ ...service.state, extras: [] });
  await service.importBackup(backup);
  const reopened = new Service(storage);
  reopened.developmentMode = true;
  await reopened.init();
  expect(reopened.state.extras.map((i) => i.classification)).toEqual(
    generated.items.map((i) => i.classification),
  );
});

test("legacy profile and ingredient schemas do not invent category provenance", () => {
  const legacy = initialState();
  expect(stateSchema.parse(legacy)).toEqual(legacy);
  expect(ingredientSchema.parse(item("Maito"))).not.toHaveProperty(
    "classification",
  );
  expect(inferredClassification("Pasta", "model-assumed")).toBeUndefined();
  for (const provenance of ["remembered", "observed"] as const)
    expect(
      classificationSchema.parse({
        category: "milk",
        provenance,
        qualifiers: [],
      }).provenance,
    ).toBe(provenance);
});
