import type { BasketLine, Requirement } from "./model";

export type ChainTotals = {
  /** Every row this chain could price, deposits included. */
  priced: number;
  /** Rows with no product or no price at this chain. */
  missing: number;
  /** Known deposits within the priced total. */
  deposits: number;
};
export type RowDifference = {
  requirement: Requirement;
  a: number;
  b: number;
  /** b minus a, in cents. */
  difference: number;
};
export type Comparison = {
  /** Rows both chains priced: the fair comparison. */
  common: { rows: number; a: number; b: number };
  a: ChainTotals;
  b: ChainTotals;
  /** Which chain is cheaper on the common rows, or null for a tie or nothing in common. */
  cheaper: "a" | "b" | null;
  /** Common rows with the biggest price difference, largest first. */
  largest: RowDifference[];
};

const key = (line: BasketLine) =>
  `${line.requirement.id}:${line.requirement.unit}`;

function totals(lines: BasketLine[]): ChainTotals {
  const priced = lines.filter((l) => l.product && l.total !== null);
  return {
    priced: priced.reduce((sum, l) => sum + l.total!, 0),
    missing: lines.length - priced.length,
    deposits: priced.reduce((sum, l) => sum + l.packs * l.product!.deposit, 0),
  };
}

/** Compares the same list priced at two chains, without changing either. */
export function compareBaskets(
  a: BasketLine[],
  b: BasketLine[],
  limit = 3,
): Comparison {
  const others = new Map(b.map((l) => [key(l), l]));
  const rows: RowDifference[] = [];
  for (const line of a) {
    const other = others.get(key(line));
    if (
      !line.product ||
      line.total === null ||
      !other?.product ||
      other.total === null
    )
      continue;
    rows.push({
      requirement: line.requirement,
      a: line.total,
      b: other.total,
      difference: other.total - line.total,
    });
  }
  const common = {
    rows: rows.length,
    a: rows.reduce((sum, r) => sum + r.a, 0),
    b: rows.reduce((sum, r) => sum + r.b, 0),
  };
  return {
    common,
    a: totals(a),
    b: totals(b),
    cheaper:
      !rows.length || common.a === common.b
        ? null
        : common.a < common.b
          ? "a"
          : "b",
    largest: rows
      .filter((r) => r.difference !== 0)
      .sort(
        (x, y) =>
          Math.abs(y.difference) - Math.abs(x.difference) ||
          x.requirement.name.localeCompare(y.requirement.name, "fi"),
      )
      .slice(0, limit),
  };
}
