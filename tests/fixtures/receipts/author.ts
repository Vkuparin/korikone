import {
  purchaseEventSchema,
  purchaseSourceSchema,
  sanitizeLabel,
  type PurchaseAdjustment,
  type PurchaseChain,
  type PurchaseEvent,
  type PurchaseQuantity,
  type PurchaseSource,
  type Reconciliation,
} from "../../../src/domain/purchases";

/**
 * Authoring helpers for sanitized receipt fixtures (F6.6).
 *
 * Every fixture is invented: the shop, address, products, dates and amounts are synthetic and no
 * line is copied from a real receipt. Expectations are written from the printed layout and its
 * arithmetic, never from a parser's output. Positions are looked up in the fixture's own text, so
 * a line can be moved without silently moving its span.
 */

export type Page = readonly string[];

/** What a parser is expected to do with the file as a whole. */
export type Outcome =
  /** A purchase event with the stated lines. */
  | "event"
  /** Not a supported receipt: no event, no spending, and a visible reason. */
  | "unsupported";

export type TripRelation =
  /** The same trip again: the same source and event, nothing added. */
  | { kind: "duplicate"; of: string }
  /** A different trip that happens to look alike: its own source and event. */
  | { kind: "distinct"; from: string };

export type ReceiptFixture = {
  id: string;
  /** What the layout exercises, in one line. */
  covers: string;
  chain: PurchaseChain;
  format: "txt" | "pdf";
  /** Text of each page, one entry per printed line. */
  pages: readonly Page[];
  outcome: Outcome;
  /** Source facts a parser must report; `fingerprint`, `id` and import time belong to F6.10. */
  source: Pick<
    PurchaseSource,
    "chain" | "format" | "pages" | "lines" | "unreadableLines"
  >;
  /** The expected event, with IDs a parser may choose differently; null when unsupported. */
  event: PurchaseEvent | null;
  relation?: TripRelation;
  /** Text that must reach evidence only as an inert, sanitized label or not at all. */
  hostile?: string;
};

/** 1-based line number of the `nth` line on the page that holds `needle`, from line `from + 1`. */
const find = (
  pages: readonly Page[],
  page: number,
  needle: string,
  from = 0,
  nth = 1,
) => {
  const lines = pages[page - 1];
  let seen = 0;
  for (let i = from; i < lines.length; i++)
    if (lines[i].includes(needle) && ++seen === nth) return i + 1;
  throw new Error(`No line ${nth} with "${needle}" on page ${page}`);
};

export class Receipt {
  private lineCount = 0;
  private readonly lineIds: string[] = [];
  readonly lines: PurchaseEvent["lines"] = [];
  readonly adjustments: PurchaseAdjustment[] = [];
  readonly printed: PurchaseEvent["printed"] = [];
  constructor(readonly pages: readonly Page[]) {}

  /** The position of the first line holding `needle` (searching from `after`'s line when given). */
  private span(page: number, needle: string, through?: string, nth = 1) {
    const line = find(this.pages, page, needle, 0, nth);
    const endLine = through ? find(this.pages, page, through, line - 1) : line;
    return { page, line, endLine };
  }

  product(
    needle: string,
    label: string,
    o: {
      page?: number;
      /** Which line holding `needle`, counted from 1, when the same text repeats. */
      nth?: number;
      through?: string;
      quantity: PurchaseQuantity;
      unitPrice?: number;
      basis?: "pcs" | "kg" | "l";
      gross: number | null;
      net: number | null;
      role?: "product" | "deposit" | "non-food" | "other" | "unreadable";
    },
  ) {
    const id = `l${++this.lineCount}`;
    this.lineIds.push(id);
    this.lines.push({
      id,
      role: o.role ?? "product",
      label: sanitizeLabel(label),
      span: this.span(o.page ?? 1, needle, o.through, o.nth),
      quantity: o.quantity,
      unitPrice: o.unitPrice ?? null,
      unitPriceBasis: o.unitPrice === undefined ? null : (o.basis ?? "pcs"),
      gross: o.gross,
      net: o.net,
      provenance: "source",
    });
    return id;
  }

  adjustment(
    needle: string,
    kind: PurchaseAdjustment["kind"],
    label: string,
    amount: number | null,
    allocation: PurchaseAdjustment["allocation"],
    lineIds: string[],
    page = 1,
  ) {
    this.adjustments.push({
      id: `a${this.adjustments.length + 1}`,
      kind,
      label: sanitizeLabel(label),
      span: this.span(page, needle),
      amount,
      allocation,
      lineIds,
      provenance: "source",
    });
  }

  print(
    role: PurchaseEvent["printed"][number]["role"],
    needle: string,
    amount: number,
    page = 1,
  ) {
    this.printed.push({ role, amount, span: this.span(page, needle) });
  }
}

export const pcs = (amount: number): PurchaseQuantity => ({
  amount,
  unit: "pcs",
  provenance: "source",
});
export const grams = (amount: number): PurchaseQuantity => ({
  amount,
  unit: "g",
  provenance: "source",
});
export const unknownQuantity: PurchaseQuantity = {
  amount: null,
  unit: null,
  provenance: "unknown",
};

export function receiptFixture(input: {
  id: string;
  covers: string;
  chain: PurchaseChain;
  format?: "txt" | "pdf";
  receipt: Receipt;
  unreadableLines?: number;
  store: string | null;
  purchasedAt: string | null;
  datePrecision?: "minute" | "day" | "unknown";
  reconciliation: Reconciliation;
  relation?: TripRelation;
  hostile?: string;
}): ReceiptFixture {
  const { receipt } = input;
  const lines = receipt.pages.reduce((n, page) => n + page.length, 0);
  const event = purchaseEventSchema.parse({
    id: `event-${input.id}`,
    sourceIds: [`source-${input.id}`],
    origin: "receipt",
    status: "completed",
    chain: input.chain,
    store: input.store === null ? null : sanitizeLabel(input.store),
    purchasedAt: input.purchasedAt,
    datePrecision:
      input.datePrecision ??
      (input.purchasedAt === null ? "unknown" : "minute"),
    lines: receipt.lines,
    adjustments: receipt.adjustments,
    printed: receipt.printed,
    reconciliation: input.reconciliation,
  });
  return {
    id: input.id,
    covers: input.covers,
    chain: input.chain,
    format: input.format ?? "txt",
    pages: receipt.pages,
    outcome: "event",
    source: {
      chain: input.chain,
      format: input.format ?? "txt",
      pages: receipt.pages.length,
      lines,
      unreadableLines: input.unreadableLines ?? 0,
    },
    event,
    relation: input.relation,
    hostile: input.hostile,
  };
}

/** A file that is not a supported receipt: nothing is spent and nothing is guessed. */
export function unsupportedFixture(input: {
  id: string;
  covers: string;
  pages: readonly Page[];
  format?: "txt" | "pdf";
  hostile?: string;
}): ReceiptFixture {
  const lines = input.pages.reduce((n, page) => n + page.length, 0);
  return {
    id: input.id,
    covers: input.covers,
    chain: "unknown",
    format: input.format ?? "txt",
    pages: input.pages,
    outcome: "unsupported",
    source: {
      chain: "unknown",
      format: input.format ?? "txt",
      pages: input.pages.length,
      lines,
      unreadableLines: lines,
    },
    event: null,
    hostile: input.hostile,
  };
}

export const balanced = (total: number): Reconciliation => ({
  status: "balanced",
  computedTotal: total,
  printedTotal: total,
  difference: 0,
  reasons: [],
});

/** The text of a fixture as a file: lines joined, pages separated by a form feed. */
export const fixtureText = (fixture: ReceiptFixture) =>
  fixture.pages.map((page) => page.join("\n")).join("\n\f\n");

/** Source expectation completed with the fields that belong to import (F6.10). */
export function expectedSource(
  fixture: ReceiptFixture,
  fingerprint = "a".repeat(32),
) {
  return purchaseSourceSchema.parse({
    id: `source-${fixture.id}`,
    kind: "receipt",
    ...fixture.source,
    parser: null,
    importedAt: "2026-10-13T08:00:00.000Z",
    fingerprint,
    retention: "sanitized",
    revision: 1,
  });
}
