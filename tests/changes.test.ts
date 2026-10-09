import { test, expect } from "vitest";
import { compareTransfers, hasChanges } from "../src/domain/changes";

const context = {
  providerId: "s-kaupat",
  storeId: "1",
  storeName: "S",
  fulfillment: "pickup" as const,
};
const target = (productId: string, quantity: number, price: number) => ({
  productId,
  name: `Tuote ${productId}`,
  quantity,
  unit: "kpl",
  // Like a real target: the price is for the packs added.
  price: price * quantity,
  before: 0,
});
const last = (lines: [string, number, number][], storeKey = "s-kaupat:1") => ({
  storeKey,
  transferred: lines.map(([id, quantity, price]) => ({
    productId: id,
    name: `Tuote ${id}`,
    quantity,
    unit: "kpl",
    price,
  })),
});

test("nothing to compare with an empty history or a transfer saved without its products", () => {
  const review = { context, targets: [target("a", 1, 100)] };
  expect(compareTransfers(review, [])).toBeNull();
  expect(
    compareTransfers(review, [{ storeKey: "", transferred: [] }]),
  ).toBeNull();
});

test("reports new and dropped products and changed quantities and prices", () => {
  const review = {
    context,
    targets: [target("a", 1, 100), target("b", 3, 250), target("d", 1, 90)],
  };
  const changes = compareTransfers(review, [
    last([
      ["a", 1, 100],
      ["b", 2, 250],
      ["c", 1, 300],
      ["d", 1, 80],
    ]),
    // Older transfers are not consulted.
    last([["z", 9, 1]]),
  ])!;
  expect(changes.storeChanged).toBe(false);
  expect(changes.added).toEqual([]);
  expect(changes.dropped.map((l) => l.productId)).toEqual(["c"]);
  expect(changes.quantity).toEqual([
    { name: "Tuote b", unit: "kpl", before: 2, now: 3 },
  ]);
  expect(changes.price).toEqual([{ name: "Tuote d", before: 80, now: 90 }]);
  expect(hasChanges(changes)).toBe(true);
  const added = compareTransfers(
    { context, targets: [target("a", 1, 100), target("n", 1, 50)] },
    [last([["a", 1, 100]])],
  )!;
  expect(added.added.map((l) => l.productId)).toEqual(["n"]);
});

test("an identical basket has no changes, and another store is reported as such", () => {
  const review = { context, targets: [target("a", 1, 100)] };
  expect(hasChanges(compareTransfers(review, [last([["a", 1, 100]])])!)).toBe(
    false,
  );
  const other = compareTransfers(review, [last([["a", 1, 100]], "k-ruoka:9")])!;
  expect(other.storeChanged).toBe(true);
  expect(hasChanges(other)).toBe(false);
});

test("packs already in the cart do not count as a change", () => {
  const inCart = { ...target("a", 3, 100), before: 1, price: 200 };
  const changes = compareTransfers({ context, targets: [inCart] }, [
    last([["a", 2, 100]]),
  ])!;
  expect(hasChanges(changes)).toBe(false);
});
