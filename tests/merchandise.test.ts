import { expect, test } from "vitest";
import { editedPlan, editUndoSchema } from "../src/application/edits";
import { applyEdits } from "../src/domain/edits";
import {
  attributeEvidence,
  merchandiseCapabilitiesSchema,
  merchandiseIntentSchema,
  merchandiseStatus,
  merchandiseStatusSchema,
  noMerchandise,
  variantMatch,
  type MerchandiseIntent,
} from "../src/domain/merchandise";
import { initialState, stateSchema } from "../src/domain/model";
import { requirements } from "../src/domain/planner";

const boots: MerchandiseIntent = {
  version: 1,
  family: "kumisaapas",
  attributes: [{ kind: "size", value: "32", provenance: "explicit-note" }],
  missing: [],
};

test("the intent is a strict, versioned addition to an ordinary row", () => {
  expect(merchandiseIntentSchema.parse(boots)).toEqual(boots);
  for (const invalid of [
    { ...boots, version: 2 },
    { ...boots, family: "" },
    { ...boots, sku: "6400000000328" },
    { ...boots, attributes: [{ kind: "size", value: "32" }] },
    {
      ...boots,
      attributes: [{ kind: "size", value: "32", provenance: "model-assumed" }],
    },
    {
      ...boots,
      attributes: [{ kind: "price", value: "20", provenance: "explicit-note" }],
    },
    // One value per attribute, and an attribute cannot be both given and missing.
    { ...boots, attributes: [boots.attributes[0], boots.attributes[0]] },
    { ...boots, missing: ["size"] },
    { ...boots, missing: ["colour", "colour"] },
    { ...boots, attributes: [{ ...boots.attributes[0], stock: 4 }] },
  ])
    expect(merchandiseIntentSchema.safeParse(invalid).success).toBe(false);
  // A family that cannot be bought without a size, with the size not yet given.
  expect(
    merchandiseIntentSchema.parse({
      ...boots,
      attributes: [],
      missing: ["size"],
    }).missing,
  ).toEqual(["size"]);
  expect(merchandiseStatusSchema.options).toEqual([
    "exact-available",
    "variant-missing",
    "not-listed-here",
    "out-of-stock",
    "unknown",
    "unsupported",
    "signed-out",
    "failed",
    "stale",
  ]);
  expect(noMerchandise).toEqual({
    discovery: false,
    variants: "none",
    stock: "none",
    cartWrite: false,
  });
  expect(
    merchandiseCapabilitiesSchema.safeParse({
      ...noMerchandise,
      checkout: true,
    }).success,
  ).toBe(false);
});

test("old profiles and backups load, and grocery rows are untouched by a non-food row beside them", () => {
  const state = initialState();
  state.staples = [];
  state.meals = [
    { id: "m", recipeId: "soup", day: 0, servings: 4, leftovers: false },
  ];
  state.extras = [{ id: "milk", name: "Maito", amount: 1000, unit: "ml" }];
  const before = requirements(state);
  // A profile saved before v0.11 has no merchandise anywhere.
  const legacy = JSON.parse(JSON.stringify(state));
  expect(stateSchema.parse(legacy)).toEqual(state);
  expect(JSON.stringify(legacy)).not.toContain("merchandise");

  const withBoots = stateSchema.parse({
    ...state,
    extras: [
      ...state.extras,
      {
        id: "kumisaapas",
        name: "Kumisaapas",
        amount: 1,
        unit: "pcs",
        merchandise: boots,
      },
    ],
  });
  const rows = requirements(withBoots);
  // Grams, millilitres and pieces of the grocery rows are exactly as they were.
  expect(rows.slice(0, before.length)).toEqual(before);
  expect(rows.at(-1)).toMatchObject({
    id: "kumisaapas",
    amount: 1,
    unit: "pcs",
    merchandise: boots,
    sources: ["extra"],
  });
  // The row survives a save and a backup round trip unchanged.
  expect(stateSchema.parse(JSON.parse(JSON.stringify(withBoots)))).toEqual(
    withBoots,
  );
  // A malformed intent in a backup is refused, not repaired.
  expect(
    stateSchema.safeParse({
      ...withBoots,
      extras: [
        {
          id: "x",
          name: "X",
          amount: 1,
          unit: "pcs",
          merchandise: { family: "x" },
        },
      ],
    }).success,
  ).toBe(false);
});

test("edits and undo keep the intent with its row", () => {
  const state = stateSchema.parse({
    ...initialState(),
    staples: [],
    meals: [],
    revision: 4,
    extras: [
      {
        id: "kumisaapas",
        name: "Kumisaapas",
        amount: 1,
        unit: "pcs",
        merchandise: boots,
      },
      { id: "milk", name: "Maito", amount: 1000, unit: "ml" },
    ],
  });
  const { state: next, applied } = applyEdits(state, {
    version: 1,
    revision: 4,
    operations: [
      {
        op: "changeQuantity",
        rowKey: "kumisaapas:pcs",
        quantity: { kind: "amount", amount: 2, unit: "pcs" },
      },
      { op: "removeItem", rowKey: "milk:ml" },
    ],
  });
  expect(applied.map((a) => a.targetId)).toEqual([
    "row:kumisaapas:pcs",
    "row:milk:ml",
  ]);
  const row = requirements(next).find((r) => r.id === "kumisaapas")!;
  expect(row).toMatchObject({ amount: 2, unit: "pcs", merchandise: boots });
  // A piece row cannot be given grams: nothing is converted.
  expect(() =>
    applyEdits(state, {
      version: 1,
      revision: 4,
      operations: [
        {
          op: "changeQuantity",
          rowKey: "kumisaapas:pcs",
          quantity: { kind: "amount", amount: 500, unit: "g" },
        },
      ],
    }),
  ).toThrow("invalidUnit");
  // The undo snapshot carries the row with its intent.
  const plan = editedPlan(state);
  expect(plan.extras[0].merchandise).toEqual(boots);
  expect(
    editUndoSchema.shape.plan.parse(JSON.parse(JSON.stringify(plan))).extras[0]
      .merchandise,
  ).toEqual(boots);
});

test("a variant is evidenced only by what the product name prints", () => {
  const size = { kind: "size" as const, value: "32" };
  expect(attributeEvidence("Lasten kumisaapas sininen koko 32", size)).toBe(
    "printed",
  );
  expect(attributeEvidence("Lasten kumisaapas sininen koko 31", size)).toBe(
    "conflict",
  );
  expect(attributeEvidence("Lasten kumisaapas keltainen", size)).toBe("absent");
  // "32" is not found inside another number.
  expect(attributeEvidence("Kumisaapas 320 g koko 34", size)).toBe("conflict");
  expect(attributeEvidence("Kumisaapas 320", size)).toBe("absent");
  const blue = { kind: "colour" as const, value: "sininen" };
  expect(attributeEvidence("Kumisaapas sininen koko 32", blue)).toBe("printed");
  expect(attributeEvidence("Kumisaapas punainen koko 32", blue)).toBe(
    "conflict",
  );
  expect(attributeEvidence("Kumisaapas koko 32", blue)).toBe("absent");
  const pan = { kind: "spec" as const, value: "28 cm" };
  expect(attributeEvidence("Paistinpannu 28 cm induktio", pan)).toBe("printed");
  expect(attributeEvidence("Paistinpannu 24 cm", pan)).toBe("absent");
  expect(
    attributeEvidence("Alkaliparisto AAA 4 kpl", {
      kind: "model",
      value: "AA",
    }),
  ).toBe("absent");
  const both: MerchandiseIntent = {
    ...boots,
    attributes: [
      { ...size, provenance: "explicit-note" },
      { ...blue, provenance: "clarified" },
    ],
  };
  expect(variantMatch("Lasten kumisaapas sininen koko 32", both)).toBe("exact");
  expect(variantMatch("Lasten kumisaapas punainen koko 32", both)).toBe(
    "other",
  );
  expect(variantMatch("Lasten kumisaapas koko 32", both)).toBe("unverified");
  // With no required attribute any product of the family is the variant.
  expect(variantMatch("Paistinpannu", { attributes: [] })).toBe("exact");
});

test("each store answer becomes exactly one statement, and unknown is never read as in stock", () => {
  const product = (name: string, available: boolean | null) => ({
    name,
    available,
  });
  const status = (products: { name: string; available: boolean | null }[]) =>
    merchandiseStatus(boots, { kind: "results", products });
  expect(status([])).toBe("not-listed-here");
  expect(status([product("Lasten kumisaapas koko 31", true)])).toBe(
    "variant-missing",
  );
  // A product silent about its size is not the requested size.
  expect(status([product("Lasten kumisaapas keltainen", true)])).toBe(
    "variant-missing",
  );
  expect(
    status([
      product("Lasten kumisaapas koko 31", true),
      product("Lasten kumisaapas koko 32", true),
    ]),
  ).toBe("exact-available");
  expect(status([product("Lasten kumisaapas koko 32", false)])).toBe(
    "out-of-stock",
  );
  expect(status([product("Lasten kumisaapas koko 32", null)])).toBe("unknown");
  // One available listing of the variant is enough; an unknown one beside a sold-out one is unknown.
  expect(
    status([
      product("Kumisaapas sininen koko 32", false),
      product("Kumisaapas punainen koko 32", null),
    ]),
  ).toBe("unknown");
  for (const kind of ["unsupported", "signed-out", "failed", "stale"] as const)
    expect(merchandiseStatus(boots, { kind })).toBe(kind);
});
