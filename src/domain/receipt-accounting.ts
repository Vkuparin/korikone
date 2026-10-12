import {
  reconciliationSchema,
  type EvidenceLine,
  type PrintedAmount,
  type PurchaseAdjustment,
  type PurchaseEvent,
  type Reconciliation,
} from "./purchases";

type Facts = Pick<PurchaseEvent, "lines" | "adjustments" | "printed">;

/**
 * Sets each line's paid amount from its printed price and the adjustments the source ties to that
 * line alone. A line under a group adjustment has no stated paid amount, so its `net` is null: the
 * group's reduction is never split by guesswork. A corrected `net` (provenance `user`) is kept.
 */
export function withNetPrices<T extends Pick<Facts, "lines" | "adjustments">>(
  facts: T,
): T {
  const grouped = new Set(
    facts.adjustments
      .filter((a) => a.allocation === "group")
      .flatMap((a) => a.lineIds),
  );
  return {
    ...facts,
    lines: facts.lines.map((line): EvidenceLine => {
      if (line.provenance === "user" && line.net !== null) return line;
      const own = facts.adjustments.filter(
        (a) => a.allocation === "line" && a.lineIds.includes(line.id),
      );
      if (line.gross === null || grouped.has(line.id))
        return { ...line, net: null };
      if (own.some((a) => a.amount === null)) return { ...line, net: null };
      // An adjustment tied to several lines at once states no per-line share either.
      if (own.some((a) => a.lineIds.length > 1)) return { ...line, net: null };
      return {
        ...line,
        net: own.reduce((sum, a) => sum + a.amount!, line.gross),
      };
    }),
  };
}

/** The parts of one receipt's money, each counted once. Null where a part has an unknown amount. */
export type ReceiptLedger = {
  /** Printed line prices of product and non-food rows, before any adjustment. */
  goods: number | null;
  /** Deposit rows charged. */
  deposits: number | null;
  /** Adjustments tied to single lines, to groups of lines, and to the whole receipt or to nothing. */
  lineAdjustments: number | null;
  groupAdjustments: number | null;
  receiptAdjustments: number | null;
  /** What the rows and adjustments add up to; null when any part is unknown. */
  paid: number | null;
};
const sum = (values: (number | null)[]) =>
  values.some((v) => v === null)
    ? null
    : (values as number[]).reduce((a, b) => a + b, 0);
export function receiptLedger(facts: Facts): ReceiptLedger {
  const readable = facts.lines.filter((l) => l.role !== "unreadable");
  const amounts = (allocation: PurchaseAdjustment["allocation"][]) =>
    sum(
      facts.adjustments
        .filter((a) => allocation.includes(a.allocation))
        .map((a) => a.amount),
    );
  const goods = sum(
    readable.filter((l) => l.role !== "deposit").map((l) => l.gross),
  );
  const deposits = sum(
    readable.filter((l) => l.role === "deposit").map((l) => l.gross),
  );
  const lineAdjustments = amounts(["line"]);
  const groupAdjustments = amounts(["group"]);
  const receiptAdjustments = amounts(["receipt", "unknown"]);
  return {
    goods,
    deposits,
    lineAdjustments,
    groupAdjustments,
    receiptAdjustments,
    paid: sum([
      goods,
      deposits,
      lineAdjustments,
      groupAdjustments,
      receiptAdjustments,
    ]),
  };
}

const printedTotal = (printed: PrintedAmount[]) => {
  const totals = printed.filter((p) => p.role === "total");
  // Two different printed totals are a contradiction in the source; neither is chosen.
  return totals.length &&
    totals.every((total) => total.amount === totals[0].amount)
    ? totals[0].amount
    : null;
};

/**
 * Checks the rows and adjustments against the printed total, in integer cents. Every adjustment is
 * counted exactly once at the level the source gives it. Nothing is filled in: a missing amount,
 * an unreadable row or an adjustment the source does not place makes the result `incomplete`, and
 * a known difference is reported, never corrected.
 */
export function reconcile(facts: Facts): Reconciliation {
  const reasons: Reconciliation["reasons"] = [];
  const printed = printedTotal(facts.printed);
  if (printed === null) reasons.push("no-printed-total");
  if (facts.lines.some((l) => l.role === "unreadable"))
    reasons.push("unreadable-lines");
  if (facts.lines.some((l) => l.role !== "unreadable" && l.gross === null))
    reasons.push("missing-line-amount");
  if (facts.adjustments.some((a) => a.amount === null))
    reasons.push("missing-adjustment-amount");
  if (facts.adjustments.some((a) => a.allocation === "unknown"))
    reasons.push("unallocated-adjustment");
  const complete = !reasons.some((r) =>
    [
      "unreadable-lines",
      "missing-line-amount",
      "missing-adjustment-amount",
    ].includes(r),
  );
  // With an unreadable row or a missing amount there is no trustworthy sum to compare.
  const computed = complete ? receiptLedger(facts).paid : null;
  const difference =
    computed !== null && printed !== null ? computed - printed : null;
  if (difference !== null && difference !== 0) reasons.push("difference");
  return reconciliationSchema.parse({
    status: !reasons.length
      ? "balanced"
      : reasons.length === 1 && reasons[0] === "difference"
        ? "unbalanced"
        : "incomplete",
    computedTotal: computed,
    printedTotal: printed,
    difference,
    reasons,
  });
}

/** Printed section subtotals against the rows of that section; null where either side is unknown. */
export function sectionDifferences(facts: Facts) {
  const check = (
    role: "food" | "non-food" | "deposits",
    lines: EvidenceLine[],
  ) => {
    const printed = facts.printed.find((p) => p.role === role)?.amount ?? null;
    const computed = sum(lines.map((l) => l.net ?? l.gross));
    return printed === null || computed === null ? null : computed - printed;
  };
  return {
    food: check(
      "food",
      facts.lines.filter((l) => l.role === "product"),
    ),
    nonFood: check(
      "non-food",
      facts.lines.filter((l) => l.role === "non-food"),
    ),
    deposits: check(
      "deposits",
      facts.lines.filter((l) => l.role === "deposit"),
    ),
  };
}
