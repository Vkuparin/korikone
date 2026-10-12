import { describe, expect, test } from "vitest";
import { spendingWeeks, weekStartMs } from "../src/domain/spending";
import type { ActualPurchase } from "../src/domain/purchase-links";
import type { TransferRecord } from "../src/domain/memory";

// Wednesday 14 October 2026: its week is Monday 12 to Sunday 18 October.
const now = new Date("2026-10-14T10:00:00.000Z");
const purchase = (
  at: string | null,
  total: number | null,
  extra: Partial<ActualPurchase> = {},
): ActualPurchase => ({
  eventIds: ["e"],
  chain: "s-group",
  purchasedAt: at,
  datePrecision: at ? "minute" : "unknown",
  total,
  totalSource: total === null ? null : "receipt",
  totals: [],
  conflictingTotals: false,
  foodSubtotal: null,
  nonFoodSubtotal: null,
  ...extra,
});
const transfer = (id: string, date: string, price: number, quantity = 1) =>
  ({
    id,
    date,
    storeKey: "",
    items: [{ name: "Maito", quantity, unit: "pcs", price }],
  }) as TransferRecord;

describe("F8.1 weekly spending", () => {
  test("weeks run Monday to Sunday, oldest first, and empty weeks stay empty", () => {
    expect(
      new Date(weekStartMs(Date.parse("2026-10-18T23:59:00Z")))
        .toISOString()
        .slice(0, 10),
    ).toBe("2026-10-12");
    expect(
      new Date(weekStartMs(Date.parse("2026-10-19T00:00:00Z")))
        .toISOString()
        .slice(0, 10),
    ).toBe("2026-10-19");
    const { weeks } = spendingWeeks([], [], now, { weeks: 4 });
    expect(weeks.map((w) => w.start)).toEqual([
      "2026-09-21",
      "2026-09-28",
      "2026-10-05",
      "2026-10-12",
    ]);
    expect(weeks[3].end).toBe("2026-10-18");
    expect(weeks.every((w) => w.coverage === "none" && w.actual === 0)).toBe(
      true,
    );
  });

  test("only confirmed purchases are spending; unknown totals and conflicts stay visible", () => {
    const { weeks } = spendingWeeks(
      [
        purchase("2026-10-12T08:00:00Z", 1500),
        purchase("2026-10-16T17:30:00Z", 2000, { conflictingTotals: true }),
        purchase("2026-10-13T12:00:00Z", null),
        purchase("2026-10-06T09:00:00Z", 700, { totalSource: "order" }),
      ],
      [],
      now,
      { weeks: 3 },
    );
    expect(weeks[2]).toMatchObject({
      purchases: 3,
      actual: 3500,
      unknownTotals: 1,
      conflicting: 1,
      coverage: "partial",
    });
    expect(weeks[1]).toMatchObject({ actual: 700, coverage: "complete" });
    expect(weeks[0]).toMatchObject({ purchases: 0, coverage: "none" });
  });

  test("printed food and non-food subtotals are summed only where printed", () => {
    const { weeks } = spendingWeeks(
      [
        purchase("2026-10-12T08:00:00Z", 893, {
          foodSubtotal: 568,
          nonFoodSubtotal: 325,
        }),
        purchase("2026-10-14T08:00:00Z", 500),
        purchase("2026-10-15T08:00:00Z", 400, {
          foodSubtotal: 400,
          nonFoodSubtotal: null,
        }),
      ],
      [],
      now,
      { weeks: 1 },
    );
    // A one-sided breakdown is unknown, so it contributes to neither amount.
    expect(weeks[0].breakdown).toEqual({
      food: 568,
      nonFood: 325,
      withBreakdown: 1,
      withoutBreakdown: 2,
    });
    expect(weeks[0].actual).toBe(1793);
  });

  test("a transfer is a separate estimate, never actual spending, and a confirmed one is not repeated", () => {
    const transfers = [
      transfer("t1", "2026-10-13T10:00:00Z", 199, 3),
      transfer("t2", "2026-10-12T09:00:00Z", 0),
      transfer("t3", "2026-10-15T09:00:00Z", 500),
    ];
    const { weeks } = spendingWeeks([], transfers, now, {
      weeks: 1,
      confirmedTransferIds: ["t3"],
    });
    expect(weeks[0].actual).toBe(0);
    expect(weeks[0].purchases).toBe(0);
    expect(weeks[0].coverage).toBe("none");
    expect(weeks[0].transferEstimate).toEqual({
      transfers: 2,
      amount: 597,
      unknownItems: 1,
    });
  });

  test("undated and out-of-range purchases are counted apart and never placed in a week", () => {
    const { weeks, undated } = spendingWeeks(
      [
        purchase(null, 1200),
        purchase(null, null),
        purchase("2025-01-01T00:00:00Z", 900),
        purchase("2026-11-30T00:00:00Z", 900),
      ],
      [],
      now,
      { weeks: 2 },
    );
    expect(undated).toEqual({ purchases: 2, actual: 1200, unknownTotals: 1 });
    expect(weeks.reduce((n, w) => n + w.purchases, 0)).toBe(0);
  });
});
