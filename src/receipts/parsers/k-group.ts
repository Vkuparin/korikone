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

export const K_GROUP_PARSER = Object.freeze({ id: "k-group", version: 1 });
export const kGroupStore =
  /^(?:K-Market|K-Supermarket|K-Citymarket|K-Ruoka|Citymarket)(?![\p{L}])/iu;

/**
 * Receipts in the K-group layout: a product with one piece has name and price on one row; a count
 * or weight is on a row after the name with `count X unit price` and the line total; `PANTTI`
 * follows its product; `K-Plussa-etu` and `RYHMÄETU` reduce the receipt or a group; `Yhteensä`
 * closes the list. A receipt may continue over pages. Rows after the total are never read.
 */
export function parseKGroup(
  rows: ReceiptRow[],
  pages: number,
): ParsedReceipt | null {
  const store = rows[0]?.text.trim() ?? "";
  if (!kGroupStore.test(store)) return null;
  const date = receiptDate(rows);
  const b = new ReceiptBuilder();
  let closed = false;
  // A name row waiting for its count or weight row.
  let pending: ReceiptRow | null = null;
  const flush = () => {
    if (pending)
      b.line(pending, pending.text.trim(), "product", null, unknownQuantity);
    pending = null;
  };
  const start = date ? rows.indexOf(date.row) + 1 : 1;
  const body = rows.slice(start);
  body.forEach((row, index) => {
    const text = row.text.trim();
    if (closed) return;
    if (/^[-=_*. ]+$/.test(text)) return;
    // Page furniture never separates a name row from its detail row.
    if (
      /^(?:SIVU|Sivu) \d+(?:\s*\/\s*\d+)?$/u.test(text) ||
      /^JATKUU\b/iu.test(text) ||
      (row.page > 1 && row.line === 1 && text.startsWith(store))
    )
      return;
    const count = text.match(
      /^(\d{1,3})\s*KPL\s*[xX]\s*(\d{1,6},\d{2})\s+(\d{1,6},\d{2})$/u,
    );
    const weight = text.match(
      /^(\d{1,4},\d{3})\s*KG\s*[xX]\s*(\d{1,6},\d{2})\s*(?:EUR|€)?\s*\/\s*KG\s+(\d{1,6},\d{2})$/iu,
    );
    if (count || weight) {
      if (!pending) {
        b.unreadableRow(row);
        return;
      }
      const m = (count ?? weight)!;
      const g = weight ? grams(weight[1]) : null;
      const line = b.line(
        pending,
        pending.text.trim(),
        "product",
        cents(m[3]),
        count
          ? pieces(Number(count[1]))
          : g
            ? { amount: g, unit: "g", provenance: "source" }
            : unknownQuantity,
      );
      line.unitPrice = cents(m[2]);
      line.unitPriceBasis = count ? "pcs" : "kg";
      // Name and detail may sit on different pages; the span then stays on the name row.
      if (pending.page === row.page)
        line.span = { ...line.span, endLine: row.line };
      pending = null;
      return;
    }
    const priced = trailingAmount(text);
    if (!priced) {
      flush();
      if (productName(text)) pending = row;
      else b.unreadableRow(row);
      return;
    }
    flush();
    const { label, amount } = priced;
    if (/^Yhteensä$/iu.test(label)) {
      b.print(row, "total", amount);
      closed = true;
    } else if (/^Välisumma$/iu.test(label)) b.print(row, "subtotal", amount);
    else if (amount < 0) {
      if (/^RYHMÄETU/iu.test(label)) b.group(row, label, amount);
      else if (/PULLOPALAUTUS|PANTTI.*PALAUTUS|PANTINPALAUTUS/iu.test(label)) {
        b.adjust(row, "deposit-return", label, amount, "receipt", []);
        b.current = null;
      } else if (/Plussa/iu.test(label)) {
        // Printed once after the rows it belongs to the receipt; between rows its place is unknown.
        const last = /^Yhteensä\s/iu.test(body[index + 1]?.text.trim() ?? "");
        b.adjust(
          row,
          "loyalty",
          label,
          amount,
          last ? "receipt" : "unknown",
          [],
        );
        b.current = null;
      } else if (/^(?:KAMPANJA|ALENNUS|TARJOUS)$/iu.test(label) && b.current)
        b.adjust(
          row,
          /^ALENNUS$/iu.test(label) ? "discount" : "campaign",
          label,
          amount,
          "line",
          [b.current.id],
        );
      else {
        b.adjust(row, "other", label, amount, "unknown", []);
        b.current = null;
      }
    } else if (/^PANTTI$/iu.test(label))
      b.line(row, label, "deposit", amount, pieces(1));
    else if (productName(label))
      b.line(row, label, "product", amount, pieces(1));
    else b.unreadableRow(row);
  });
  flush();
  return b.finish({
    chain: "k-group",
    parser: K_GROUP_PARSER,
    pages,
    lines: rows.length,
    store,
    purchasedAt: date?.purchasedAt ?? null,
    datePrecision: date?.datePrecision ?? "unknown",
  });
}
