import { withNetPrices } from "../../domain/receipt-accounting";
import {
  sanitizeLabel,
  type EvidenceLine,
  type PrintedAmount,
  type PurchaseAdjustment,
  type PurchaseChain,
  type PurchaseQuantity,
  type SourceSpan,
} from "../../domain/purchases";

/** Bounds of one receipt text. Anything larger is not parsed at all. */
export const receiptLimits = Object.freeze({
  characters: 50_000,
  pages: 100,
  lines: 2_000,
  lineCharacters: 300,
});

export type ReceiptRow = { page: number; line: number; text: string };
/** Non-empty rows with 1-based positions within their page. Pages are separated by a form feed. */
export function receiptRows(text: string): {
  rows: ReceiptRow[];
  pages: number;
} {
  if (text.length > receiptLimits.characters)
    throw new Error("receiptTooLarge");
  const pages = text
    .replace(/\r\n?/g, "\n")
    .split("\f")
    .map((page) =>
      page
        .split("\n")
        // Spacing carries no meaning: a PDF reader returns the same row with other gaps.
        .map((line) => line.trim().replace(/\s+/gu, " "))
        .filter((line) => line),
    )
    .filter((page) => page.length);
  if (pages.length > receiptLimits.pages) throw new Error("receiptTooLarge");
  const rows = pages.flatMap((page, p) =>
    page.map((text, i) => ({
      page: p + 1,
      line: i + 1,
      text: text.slice(0, receiptLimits.lineCharacters),
    })),
  );
  if (rows.length > receiptLimits.lines) throw new Error("receiptTooLarge");
  return { rows, pages: pages.length };
}

/** `1,19` or `-0,45` as integer cents. */
export const cents = (text: string) => {
  const m = text.match(/^(-?)(\d{1,6}),(\d{2})$/);
  return m ? (m[1] ? -1 : 1) * (Number(m[2]) * 100 + Number(m[3])) : null;
};
/** A row's text and the amount printed at its end, when there is one. */
export function trailingAmount(text: string) {
  const m = text.match(/^(.*?)\s+(-?\d{1,6},\d{2})\s*$/);
  return m ? { label: m[1].trim(), amount: cents(m[2])! } : null;
}

const lastSunday = (year: number, month: number) => {
  const end = new Date(Date.UTC(year, month + 1, 0));
  return end.getUTCDate() - end.getUTCDay();
};
/** Finnish local time to UTC: summer time runs from the last Sunday of March to that of October. */
export function helsinkiTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): string | null {
  const local = Date.UTC(year, month - 1, day, hour, minute);
  const check = new Date(local);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59 ||
    year < 2000 ||
    year > 2100
  )
    return null;
  const summerStart = Date.UTC(year, 2, lastSunday(year, 2), 3);
  const summerEnd = Date.UTC(year, 9, lastSunday(year, 9), 4);
  const offset = local >= summerStart && local < summerEnd ? 3 : 2;
  return new Date(local - offset * 3_600_000).toISOString();
}
/** The first `d.m.yyyy hh:mm` in the opening rows; a date without a time has day precision. */
export function receiptDate(rows: ReceiptRow[]) {
  for (const row of rows.slice(0, 12)) {
    const m = row.text.match(
      /(?<!\d)(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(?:klo\s+)?(\d{1,2})[:.](\d{2}))?(?!\d)/,
    );
    if (!m) continue;
    const timed = m[4] !== undefined;
    const at = helsinkiTime(
      Number(m[3]),
      Number(m[2]),
      Number(m[1]),
      timed ? Number(m[4]) : 12,
      timed ? Number(m[5]) : 0,
    );
    if (at)
      return {
        row,
        purchasedAt: timed
          ? at
          : `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}T00:00:00.000Z`,
        datePrecision: timed ? ("minute" as const) : ("day" as const),
      };
  }
  return null;
}

/** A row that reads like a printed product name: capitals, digits and plain punctuation only. */
export const productName = (text: string) =>
  /^[\p{Lu}\d][\p{Lu}\d ,.%&/+-]*$/u.test(text.trim()) &&
  (text.match(/\p{Lu}/gu)?.length ?? 0) >= 3;

export const pieces = (amount: number): PurchaseQuantity => ({
  amount,
  unit: "pcs",
  provenance: "source",
});
export const unknownQuantity: PurchaseQuantity = {
  amount: null,
  unit: null,
  provenance: "unknown",
};
/** `0,940` kilograms as whole grams; null unless the weight has exactly three decimals. */
export const grams = (text: string) => {
  const m = text.match(/^(\d{1,4}),(\d{3})$/);
  const value = m ? Number(m[1]) * 1000 + Number(m[2]) : 0;
  return value > 0 ? value : null;
};

export type ParsedReceipt = {
  chain: PurchaseChain;
  parser: { id: string; version: number };
  pages: number;
  /** Non-empty rows of the file. */
  lines: number;
  unreadableLines: number;
  store: string | null;
  purchasedAt: string | null;
  datePrecision: "minute" | "day" | "unknown";
  evidence: EvidenceLine[];
  adjustments: PurchaseAdjustment[];
  printed: PrintedAmount[];
};

/** Collects evidence in reading order and keeps IDs, spans and group membership consistent. */
export class ReceiptBuilder {
  readonly evidence: EvidenceLine[] = [];
  readonly adjustments: PurchaseAdjustment[] = [];
  readonly printed: PrintedAmount[] = [];
  unreadable = 0;
  /** The last product or deposit row, which detail rows and row campaigns attach to. */
  current: EvidenceLine | null = null;

  private span(row: ReceiptRow): SourceSpan {
    return { page: row.page, line: row.line, endLine: row.line };
  }
  line(
    row: ReceiptRow,
    label: string,
    role: EvidenceLine["role"],
    gross: number | null,
    quantity: PurchaseQuantity,
  ) {
    const line: EvidenceLine = {
      id: `l${this.evidence.length + 1}`,
      role,
      label: sanitizeLabel(label),
      span: this.span(row),
      quantity,
      unitPrice: null,
      unitPriceBasis: null,
      gross,
      net: null,
      provenance: "source",
    };
    this.evidence.push(line);
    this.current = role === "unreadable" ? null : line;
    return line;
  }
  unreadableRow(row: ReceiptRow) {
    this.unreadable++;
    this.line(row, row.text, "unreadable", null, unknownQuantity);
  }
  /** Extends the current row over a detail row printed on the same page. */
  extend(row: ReceiptRow) {
    if (this.current && this.current.span.page === row.page)
      this.current.span = { ...this.current.span, endLine: row.line };
  }
  adjust(
    row: ReceiptRow,
    kind: PurchaseAdjustment["kind"],
    label: string,
    amount: number | null,
    allocation: PurchaseAdjustment["allocation"],
    lineIds: string[],
  ) {
    this.adjustments.push({
      id: `a${this.adjustments.length + 1}`,
      kind,
      label: sanitizeLabel(label),
      span: this.span(row),
      amount,
      allocation,
      lineIds,
      provenance: "source",
    });
  }
  print(row: ReceiptRow, role: PrintedAmount["role"], amount: number) {
    this.printed.push({ role, amount, span: this.span(row) });
    this.current = null;
  }
  /**
   * The rows a group offer covers, when the offer states a piece count: the product rows directly
   * above it whose counts add up to exactly that many pieces (and each to `each`, when stated).
   * Anything else is not evidence of membership.
   */
  groupMembers(total: number, each: number | null): string[] {
    const members: string[] = [];
    let remaining = total;
    for (let i = this.evidence.length - 1; i >= 0 && remaining > 0; i--) {
      const line = this.evidence[i];
      if (
        line.role !== "product" ||
        line.quantity.unit !== "pcs" ||
        line.quantity.amount === null ||
        (each !== null && line.quantity.amount !== each) ||
        line.quantity.amount > remaining ||
        this.adjustments.some((a) => a.lineIds.includes(line.id))
      )
        break;
      members.unshift(line.id);
      remaining -= line.quantity.amount;
    }
    return remaining === 0 && members.length >= 2 ? members : [];
  }
  /** An offer for a group of rows: allocated to its members when they are evident, else unknown. */
  group(row: ReceiptRow, label: string, amount: number) {
    const stated =
      label.match(/(\d{1,2})\s*[xX]\s*(\d{1,3})\s*KPL/u) ??
      label.match(/()(\d{1,3})\s*KPL/u);
    const members = stated
      ? stated[1]
        ? this.groupMembers(
            Number(stated[1]) * Number(stated[2]),
            Number(stated[2]),
          )
        : this.groupMembers(Number(stated[2]), null)
      : [];
    this.adjust(
      row,
      "campaign",
      label,
      amount,
      members.length ? "group" : "unknown",
      members,
    );
    this.current = null;
  }
  finish(
    base: Omit<
      ParsedReceipt,
      "evidence" | "adjustments" | "printed" | "unreadableLines"
    >,
  ): ParsedReceipt {
    const priced = withNetPrices({
      lines: this.evidence,
      adjustments: this.adjustments,
    });
    return {
      ...base,
      unreadableLines: this.unreadable,
      evidence: priced.lines,
      adjustments: priced.adjustments,
      printed: this.printed,
    };
  }
}
