import {
  ReceiptBuilder,
  cents,
  grams,
  pieces,
  productName,
  receiptDate,
  trailingAmount,
  unknownQuantity,
  type ParsedReceipt,
  type ReceiptRow,
} from "./shared";

export const S_GROUP_PARSER = Object.freeze({ id: "s-group", version: 1 });
export const sGroupStore =
  /^(?:S-market|Prisma|Sale|Alepa|Sokos Herkku|Food Market Herkku|ABC)(?![\p{L}])/iu;

const printedRoles: [
  RegExp,
  "total" | "subtotal" | "food" | "non-food" | "deposits",
][] = [
  [/^YHTEENSÄ$/iu, "total"],
  [/^VÄLISUMMA$/iu, "subtotal"],
  [/^RUOKA YHT\.?$/iu, "food"],
  [/^MUUT YHT\.?$/iu, "non-food"],
  [/^PANTIT YHT\.?$/iu, "deposits"],
];

/**
 * Receipts in the S-group layout: name and line price on one row; a count or weight on a row
 * after the price; `KAMPANJA` and `NORM.` rows under their product; section headers; `YHTEENSÄ`
 * closing the list. Rows after the total (payment, tax and loyalty details) are never read.
 * Column positions and indentation are not relied on, so PDF text reads the same as plain text.
 */
export function parseSGroup(
  rows: ReceiptRow[],
  pages: number,
): ParsedReceipt | null {
  const store = rows[0]?.text.trim() ?? "";
  if (!sGroupStore.test(store)) return null;
  const date = receiptDate(rows);
  const b = new ReceiptBuilder();
  let section: "product" | "non-food" = "product";
  let closed = false;
  // The header ends at the date row, or after the shop name when no date is printed.
  const start = date ? rows.indexOf(date.row) + 1 : 1;
  for (const row of rows.slice(start)) {
    const text = row.text.trim();
    if (closed) continue;
    if (/^[-=_*. ]+$/.test(text)) continue;
    // Page furniture: continuation notes and the shop name repeated on a later page.
    if (
      /^JATKUU (?:SIVULLA \d+|EDELTÄ)$/iu.test(text) ||
      /\sSIVU \d+$/iu.test(text) ||
      (row.page > 1 && row.line === 1 && text.startsWith(store))
    )
      continue;
    if (/^RUOKA$/iu.test(text)) {
      section = "product";
      b.current = null;
      continue;
    }
    if (/^MUUT TUOTTEET$/iu.test(text)) {
      section = "non-food";
      b.current = null;
      continue;
    }
    // Detail rows of the product above: a reference price, a count or a weight.
    if (/^NORM\.?\s+\d{1,6},\d{2}$/iu.test(text) && b.current) {
      b.extend(row);
      continue;
    }
    const count = text.match(/^(\d{1,3})\s*KPL\s*[xX]\s*(\d{1,6},\d{2})$/u);
    const weight = text.match(
      /^(\d{1,4},\d{3})\s*KG\s*[xX]\s*(\d{1,6},\d{2})\s*(?:EUR|€)\s*\/\s*KG$/iu,
    );
    if ((count || weight) && b.current) {
      const line = b.current;
      // A second detail row for the same product is a contradiction, not more evidence.
      if (line.unitPrice !== null) {
        b.unreadableRow(row);
        continue;
      }
      if (count) {
        line.quantity = pieces(Number(count[1]));
        line.unitPrice = cents(count[2]);
        line.unitPriceBasis = "pcs";
      } else {
        const g = grams(weight![1]);
        line.quantity = g
          ? { amount: g, unit: "g", provenance: "source" }
          : unknownQuantity;
        line.unitPrice = cents(weight![2]);
        line.unitPriceBasis = "kg";
      }
      b.extend(row);
      continue;
    }
    const priced = trailingAmount(text);
    if (priced) {
      const { label, amount } = priced;
      const printed = printedRoles.find(([pattern]) => pattern.test(label));
      if (printed) {
        b.print(row, printed[1], amount);
        if (printed[1] === "total") closed = true;
        continue;
      }
      if (amount < 0) {
        if (/^(?:KAMPANJA|ALENNUS|TARJOUS)$/iu.test(label) && b.current)
          b.adjust(
            row,
            /^ALENNUS$/iu.test(label) ? "discount" : "campaign",
            label,
            amount,
            "line",
            [b.current.id],
          );
        else if (/^RYHMÄTARJOUS/iu.test(label)) b.group(row, label, amount);
        else if (/PANTTI.*PALAUTUS|PULLOPALAUTUS/iu.test(label)) {
          b.adjust(row, "deposit-return", label, amount, "receipt", []);
          b.current = null;
        } else {
          // A reduction the layout does not explain is kept with its amount and no placement.
          b.adjust(row, "other", label, amount, "unknown", []);
          b.current = null;
        }
        continue;
      }
      if (/^PANTTI$/iu.test(label))
        b.line(row, label, "deposit", amount, pieces(1));
      else if (productName(label))
        b.line(row, label, section, amount, pieces(1));
      else b.unreadableRow(row);
      continue;
    }
    // A product name with no price is kept as a row whose amount and quantity are unknown.
    if (productName(text)) b.line(row, text, section, null, unknownQuantity);
    else b.unreadableRow(row);
  }
  return b.finish({
    chain: "s-group",
    parser: S_GROUP_PARSER,
    pages,
    lines: rows.length,
    store,
    purchasedAt: date?.purchasedAt ?? null,
    datePrecision: date?.datePrecision ?? "unknown",
  });
}
