import { expect, test } from "vitest";
import {
  currentEditDelta,
  editDelta,
  type EditSide,
} from "../src/domain/edit-delta";
import { applyEdits, type EditOperation } from "../src/domain/edits";
import type { AppState, BasketLine, Product } from "../src/domain/model";
import { requirements } from "../src/domain/planner";
import { editNow as now, editPlan } from "./helpers/edit-plan";

/** Pack size and price in cents per ingredient; anything else has no usable product. */
const shelf: Record<string, [number, number]> = {
  pasta: [500, 129],
  tomato: [400, 99],
  potato: [1000, 199],
  carrot: [500, 109],
  cream: [200, 109],
  oats: [1000, 169],
  milk: [1000, 119],
};
/** A quote for exactly this plan, with the same pack arithmetic the matcher uses. */
function quoted(
  state: AppState,
  options: { estimated?: string[]; variant?: Record<string, string> } = {},
): EditSide {
  const basket: BasketLine[] = requirements(state, now).map((requirement) => {
    const entry = shelf[requirement.id];
    if (!entry)
      return {
        requirement,
        product: null,
        packs: 0,
        total: null,
        candidates: [],
      };
    const packs = Math.ceil(requirement.amount / entry[0]);
    const product = {
      id: options.variant?.[requirement.id] ?? `${requirement.id}-1`,
      packAmount: entry[0],
      price: entry[1],
    } as Product;
    return {
      requirement,
      product,
      packs,
      total: packs * entry[1],
      candidates: [product],
      ...(options.estimated?.includes(requirement.id)
        ? { approximate: true }
        : {}),
    };
  });
  return { state, basket, quoted: true };
}
function edited(state: AppState, operations: EditOperation[]): AppState {
  const result = applyEdits(
    state,
    { version: 1, revision: state.revision, operations },
    { now },
  );
  return { ...result.state, revision: state.revision + 1 };
}
const row = (delta: ReturnType<typeof editDelta>, key: string) =>
  delta.rows.find((r) => r.key === key);

test("a replaced meal changes its own rows and leaves shared ones as quantity changes", () => {
  const before = editPlan();
  const after = edited(before, [
    {
      op: "replaceMeal",
      mealId: "m-pasta",
      replacement: { kind: "saved", recipeId: "lasagne" },
    },
  ]);
  const delta = editDelta(quoted(before), quoted(after), now);
  expect(delta.meals).toEqual([
    {
      mealId: "m-pasta",
      change: "replaced",
      name: "Tomaattipasta",
      to: "Lasagne",
      servingsBefore: 4,
      servingsAfter: 4,
    },
  ]);
  expect(row(delta, "pasta:g")).toMatchObject({
    change: "removed",
    before: 400,
    after: null,
    priceBefore: { kind: "known", total: 129, packs: 1 },
    priceAfter: { kind: "none", total: 0 },
  });
  // Tomato and milk are shared: one row each, with the amounts of every source added together.
  expect(row(delta, "tomato:g")).toMatchObject({
    change: "quantity",
    before: 800,
    after: 400,
    priceBefore: { total: 198 },
    priceAfter: { total: 99 },
    productChanged: false,
  });
  expect(row(delta, "milk:ml")).toMatchObject({
    before: 1800,
    after: 2300,
    priceBefore: { total: 238, packs: 2 },
    priceAfter: { total: 357, packs: 3 },
  });
  // Lasagne sheets have no priced product, so no overall difference is stated.
  expect(row(delta, "lasagne-sheets:g")).toMatchObject({
    change: "added",
    priceBefore: { kind: "none" },
    priceAfter: { kind: "unknown", total: null },
  });
  expect(delta.price).toEqual({
    status: "incomplete",
    difference: null,
    unknownRows: 1,
  });
  expect(delta.retained.map((r) => r.key).sort()).toEqual(
    ["cream:ml", "oats:g", "paahtoleipä:g", "potato:g", "ruisleipä:g"].sort(),
  );
  expect(delta.rows.some((r) => r.key === "carrot:g")).toBe(false);
  expect([delta.fromRevision, delta.toRevision]).toEqual([7, 8]);
});

test("at-home, removal, restoring and adding are distinct, and known rows give an exact difference", () => {
  const before = editPlan();
  const after = edited(before, [
    { op: "markAtHome", rowKey: "potato:g", atHome: true },
    { op: "markAtHome", rowKey: "carrot:g", atHome: false },
    { op: "removeItem", rowKey: "pasta:g" },
    {
      op: "addItem",
      name: "Kaurahiutale",
      quantity: { kind: "amount", amount: 900, unit: "g" },
    },
  ]);
  const delta = editDelta(quoted(before), quoted(after), now);
  expect(delta.rows.map((r) => [r.key, r.change]).sort()).toEqual([
    ["carrot:g", "notAtHome"],
    ["oats:g", "quantity"],
    ["pasta:g", "removed"],
    ["potato:g", "atHome"],
  ]);
  expect(row(delta, "potato:g")).toMatchObject({ before: 800, after: null });
  expect(row(delta, "carrot:g")).toMatchObject({ before: null, after: 400 });
  // −199 potato, +109 carrot, −129 pasta, oats 200 g → 1100 g is one more pack: +169.
  expect(delta.price).toEqual({
    status: "exact",
    difference: -199 + 109 - 129 + 169,
    unknownRows: 0,
  });
  expect(delta.meals).toEqual([]);
});

test("a change that needs no more packs is an exact zero, and estimates are labelled", () => {
  const before = editPlan();
  const after = edited(before, [
    {
      op: "changeQuantity",
      rowKey: "pasta:g",
      quantity: { kind: "amount", amount: 500, unit: "g" },
    },
  ]);
  const unchanged = editDelta(quoted(before), quoted(after), now);
  expect(unchanged.price).toEqual({
    status: "exact",
    difference: 0,
    unknownRows: 0,
  });
  expect(row(unchanged, "pasta:g")).toMatchObject({
    priceBefore: { total: 129, packs: 1 },
    priceAfter: { total: 129, packs: 1 },
  });
  const doubled = edited(before, [
    { op: "changeServings", mealId: "m-soup", servings: 8 },
  ]);
  const estimated = editDelta(
    quoted(before, { estimated: ["potato"] }),
    quoted(doubled, { estimated: ["potato"], variant: { cream: "cream-2" } }),
    now,
  );
  expect(estimated.price).toMatchObject({
    status: "estimated",
    difference: 199 + 109,
  });
  expect(row(estimated, "potato:g")?.priceAfter.kind).toBe("estimated");
  // The cream row is priced on both sides but with another product.
  expect(row(estimated, "cream:ml")?.productChanged).toBe(true);
  expect(estimated.meals).toEqual([
    {
      mealId: "m-soup",
      change: "servings",
      name: "Peruna-porkkanakeitto",
      to: null,
      servingsBefore: 4,
      servingsAfter: 8,
    },
  ]);
});

test("a side without a quote is stale and never yields a price difference", () => {
  const before = editPlan();
  const after = edited(before, [
    { op: "changeServings", mealId: "m-soup", servings: 8 },
  ]);
  const delta = editDelta(
    { state: before, basket: [], quoted: false },
    quoted(after),
    now,
  );
  expect(row(delta, "potato:g")).toMatchObject({
    priceBefore: { kind: "stale", total: null },
    priceAfter: { kind: "known", total: 398 },
  });
  expect(delta.price).toEqual({
    status: "incomplete",
    difference: null,
    unknownRows: 2,
  });
  // A quote passed for a side that says it has none is ignored, not trusted.
  const ignored = editDelta(
    { ...quoted(before), quoted: false },
    quoted(after),
    now,
  );
  expect(ignored.price.difference).toBeNull();
  const elsewhere = structuredClone(after);
  elsewhere.context.storeId = "another-store";
  expect(editDelta(quoted(before), quoted(elsewhere), now).price).toMatchObject(
    { status: "incomparable", difference: null },
  );
});

test("undo is the same comparison reversed, and a delta belongs to one revision", () => {
  const before = editPlan();
  const after = edited(before, [
    { op: "changeServings", mealId: "m-soup", servings: 8 },
    { op: "removeItem", rowKey: "ruisleipä:g" },
  ]);
  const forward = editDelta(quoted(before), quoted(after), now);
  const restored = { ...structuredClone(before), revision: 9 };
  const back = editDelta(quoted(after), quoted(restored), now);
  expect(forward.price.status).toBe("incomplete");
  expect(row(forward, "ruisleipä:g")).toMatchObject({
    change: "removed",
    priceBefore: { kind: "unknown" },
  });
  expect(row(back, "ruisleipä:g")).toMatchObject({
    change: "added",
    before: null,
    after: 500,
  });
  expect(row(back, "potato:g")).toMatchObject({
    before: 1600,
    after: 800,
    priceBefore: { total: 398 },
    priceAfter: { total: 199 },
  });
  expect([back.fromRevision, back.toRevision]).toEqual([8, 9]);
  expect(currentEditDelta(forward, 8)).toBe(forward);
  // After undo, another edit or a failed edit at another revision, the old delta is not shown.
  expect(currentEditDelta(forward, 9)).toBeNull();
  expect(currentEditDelta(forward, 7)).toBeNull();
  expect(currentEditDelta(null, 8)).toBeNull();
});
