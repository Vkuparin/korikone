import { z } from "zod";
import { storeKey } from "./changes";
import { unitSchema, type AppState, type BasketLine } from "./model";
import { requirements } from "./planner";

/**
 * What one side of an edit would cost for a row.
 * known: exact pack arithmetic. estimated: a weighed or per-piece estimate. unknown: the quote has
 * the row but no usable product or price. stale: that side has no quote for its plan, so nothing
 * can be said. none: the row is not bought on that side (absent, removed or at home).
 */
export const editPriceSchema = z
  .object({
    kind: z.enum(["known", "estimated", "unknown", "stale", "none"]),
    total: z.number().nonnegative().nullable(),
    productId: z.string().nullable(),
    packs: z.number().nonnegative().nullable(),
  })
  .strict();
export type EditPrice = z.infer<typeof editPriceSchema>;
export const editDeltaRowSchema = z
  .object({
    key: z.string().min(3).max(110),
    name: z.string().min(1).max(200),
    unit: unitSchema,
    change: z.enum(["added", "removed", "quantity", "atHome", "notAtHome"]),
    /** Amount bought before and after; null when the row is not bought on that side. */
    before: z.number().int().positive().nullable(),
    after: z.number().int().positive().nullable(),
    priceBefore: editPriceSchema,
    priceAfter: editPriceSchema,
    /** Both sides are priced but with different products, so the difference is not like for like. */
    productChanged: z.boolean(),
  })
  .strict();
export type EditDeltaRow = z.infer<typeof editDeltaRowSchema>;
export const editDeltaSchema = z
  .object({
    fromRevision: z.number().int().nonnegative(),
    toRevision: z.number().int().nonnegative(),
    meals: z
      .array(
        z
          .object({
            mealId: z.string(),
            change: z.enum(["replaced", "servings"]),
            name: z.string(),
            to: z.string().nullable(),
            servingsBefore: z.number().int(),
            servingsAfter: z.number().int(),
          })
          .strict(),
      )
      .max(100),
    rows: z.array(editDeltaRowSchema).max(1000),
    /** Rows bought on both sides with the same amount. */
    retained: z
      .array(z.object({ key: z.string(), name: z.string() }).strict())
      .max(1000),
    price: z
      .object({
        /**
         * exact: every changed row is known on both sides. estimated: some are estimates.
         * incomplete: at least one changed row is unknown or stale, so no difference is stated.
         * incomparable: the two sides are quotes of different stores or fulfilment.
         */
        status: z.enum(["exact", "estimated", "incomplete", "incomparable"]),
        /** After minus before over the changed rows, in cents; null unless exact or estimated. */
        difference: z.number().nullable(),
        unknownRows: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();
export type EditDelta = z.infer<typeof editDeltaSchema>;

/** A plan with the basket quoted for exactly that plan, or `quoted: false` when there is none. */
export type EditSide = {
  state: AppState;
  basket: BasketLine[];
  quoted: boolean;
};

const keyOf = (r: { id: string; unit: string }) => `${r.id}:${r.unit}`;
function price(side: EditSide, key: string, bought: boolean): EditPrice {
  if (!bought) return { kind: "none", total: 0, productId: null, packs: null };
  const line = side.quoted
    ? side.basket.find((l) => keyOf(l.requirement) === key)
    : undefined;
  if (!line)
    return { kind: "stale", total: null, productId: null, packs: null };
  if (!line.product || line.total === null)
    return { kind: "unknown", total: null, productId: null, packs: null };
  return {
    kind: line.approximate ? "estimated" : "known",
    total: line.total,
    productId: line.product.id,
    packs: line.packs,
  };
}

/**
 * Compares the plan immediately before and after one local edit or undo. It reads retained data
 * only: no catalogue, AI or retailer call, and it never fills a missing price.
 */
export function editDelta(
  before: EditSide,
  after: EditSide,
  now = new Date(),
): EditDelta {
  const comparable =
    storeKey(before.state.context) === storeKey(after.state.context) &&
    before.state.context.fulfillment === after.state.context.fulfillment;
  const rowsOf = (side: EditSide) => ({
    all: new Map(requirements(side.state, now, true).map((r) => [keyOf(r), r])),
    bought: new Map(requirements(side.state, now).map((r) => [keyOf(r), r])),
  });
  const a = rowsOf(before),
    b = rowsOf(after);
  const rows: EditDeltaRow[] = [];
  const retained: EditDelta["retained"] = [];
  for (const key of new Set([...a.all.keys(), ...b.all.keys()])) {
    const was = a.bought.get(key),
      is = b.bought.get(key);
    if (!was && !is) continue;
    const named = (is ?? was)!;
    if (was && is && was.amount === is.amount) {
      retained.push({ key, name: named.name });
      continue;
    }
    const priceBefore = price(before, key, !!was),
      priceAfter = price(after, key, !!is);
    rows.push({
      key,
      name: named.name,
      unit: named.unit,
      change:
        was && is
          ? "quantity"
          : is
            ? before.state.skipped.includes(key) && a.all.has(key)
              ? "notAtHome"
              : "added"
            : after.state.skipped.includes(key) && b.all.has(key)
              ? "atHome"
              : "removed",
      before: was?.amount ?? null,
      after: is?.amount ?? null,
      priceBefore,
      priceAfter,
      productChanged:
        priceBefore.productId !== null &&
        priceAfter.productId !== null &&
        priceBefore.productId !== priceAfter.productId,
    });
  }
  const meals: EditDelta["meals"] = [];
  const recipe = (state: AppState, id: string) =>
    state.recipes.find((r) => r.id === id)?.name ?? id;
  for (const meal of after.state.meals) {
    const old = before.state.meals.find((m) => m.id === meal.id);
    if (!old) continue;
    const replaced = old.recipeId !== meal.recipeId;
    if (!replaced && old.servings === meal.servings) continue;
    meals.push({
      mealId: meal.id,
      change: replaced ? "replaced" : "servings",
      name: recipe(before.state, old.recipeId),
      to: replaced ? recipe(after.state, meal.recipeId) : null,
      servingsBefore: old.servings,
      servingsAfter: meal.servings,
    });
  }
  const facts = rows.flatMap((row) => [row.priceBefore, row.priceAfter]);
  const unknownRows = rows.filter((row) =>
    [row.priceBefore.kind, row.priceAfter.kind].some(
      (kind) => kind === "unknown" || kind === "stale",
    ),
  ).length;
  const status = !comparable
    ? "incomparable"
    : unknownRows
      ? "incomplete"
      : facts.some((fact) => fact.kind === "estimated")
        ? "estimated"
        : "exact";
  return editDeltaSchema.parse({
    fromRevision: before.state.revision,
    toRevision: after.state.revision,
    meals,
    rows,
    retained,
    price: {
      status,
      difference:
        status === "exact" || status === "estimated"
          ? rows.reduce(
              (sum, row) =>
                sum +
                (row.priceAfter.total ?? 0) -
                (row.priceBefore.total ?? 0),
              0,
            )
          : null,
      unknownRows,
    },
  });
}

/** A delta describes one revision step; it must not be shown beside any other plan. */
export function currentEditDelta(
  delta: EditDelta | null | undefined,
  revision: number,
): EditDelta | null {
  return delta && delta.toRevision === revision ? delta : null;
}
