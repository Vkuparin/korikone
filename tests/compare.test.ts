import { expect, test } from "vitest";
import { compareBaskets } from "../src/domain/compare";
import type { BasketLine, Product } from "../src/domain/model";

const line = (
  id: string,
  total: number | null,
  { packs = 1, deposit = 0, product = true } = {},
): BasketLine => ({
  requirement: { id, name: id, amount: 1, unit: "pcs", sources: [] },
  product: product
    ? ({ id, deposit, price: total, packAmount: 1 } as unknown as Product)
    : null,
  packs,
  total: product ? total : null,
  candidates: [],
});

test("compares only rows both chains priced and lists the largest differences", () => {
  const result = compareBaskets(
    [
      line("milk", 119),
      line("coffee", 599),
      line("pasta", 129),
      line("bottle", 245, { packs: 1, deposit: 15 }),
      line("egg", null, { product: false }),
    ],
    [
      line("milk", 129),
      line("coffee", 499),
      line("pasta", 129),
      line("bottle", null, { product: false }),
      line("egg", 255),
    ],
  );
  expect(result.common).toEqual({ rows: 3, a: 847, b: 757 });
  expect(result.cheaper).toBe("b");
  expect(result.a).toEqual({ priced: 1092, missing: 1, deposits: 15 });
  expect(result.b).toEqual({ priced: 1012, missing: 1, deposits: 0 });
  // Equal rows are not differences; the largest change comes first.
  expect(result.largest.map((r) => [r.requirement.id, r.difference])).toEqual([
    ["coffee", -100],
    ["milk", 10],
  ]);
});

test("reports a tie and handles a chain that prices nothing", () => {
  const tie = compareBaskets([line("milk", 119)], [line("milk", 119)]);
  expect(tie.cheaper).toBeNull();
  expect(tie.largest).toEqual([]);
  const none = compareBaskets(
    [line("milk", 119), line("pasta", 129)],
    [
      line("milk", null, { product: false }),
      line("pasta", null, { product: false }),
    ],
  );
  expect(none.common).toEqual({ rows: 0, a: 0, b: 0 });
  expect(none.cheaper).toBeNull();
  expect(none.b).toEqual({ priced: 0, missing: 2, deposits: 0 });
  expect(none.a.priced).toBe(248);
});

test("limits the difference list and breaks ties by name", () => {
  const result = compareBaskets(
    [line("c", 100), line("a", 100), line("b", 100), line("d", 100)],
    [line("c", 150), line("a", 150), line("b", 50), line("d", 110)],
    2,
  );
  expect(result.largest.map((r) => r.requirement.id)).toEqual(["a", "b"]);
});
