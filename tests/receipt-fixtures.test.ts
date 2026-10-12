import { describe, expect, test } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readReceipt } from "../src/receipts/read";
import {
  purchaseEventSchema,
  sanitizeLabel,
  type PurchaseEvent,
} from "../src/domain/purchases";
import {
  expectedSource,
  fixtureText,
  receiptFixtures,
  type ReceiptFixture,
} from "./fixtures/receipts";
import { receiptTextPDF } from "./fixtures/receipts/pdf";

const byId = new Map(receiptFixtures.map((f) => [f.id + f.format, f]));
const fixture = (id: string) => receiptFixtures.find((f) => f.id === id)!;
/** Cents as the receipts print them: 1,19. */
const printed = (cents: number) =>
  `${Math.floor(Math.abs(cents) / 100)},${String(Math.abs(cents) % 100).padStart(2, "0")}`;
const spanText = (f: ReceiptFixture, span: PurchaseEvent["lines"][0]["span"]) =>
  f.pages[(span.page ?? 1) - 1].slice(span.line - 1, span.endLine).join("\n");
const events = receiptFixtures.filter(
  (f): f is ReceiptFixture & { event: PurchaseEvent } => f.event !== null,
);

describe("F6.6 sanitized receipt fixtures", () => {
  test("every fixture is a distinct, schema-valid and self-describing expectation", () => {
    expect(byId.size).toBe(receiptFixtures.length);
    expect(new Set(receiptFixtures.map((f) => f.id)).size).toBe(
      receiptFixtures.length - 1, // the PDF twin of trip-original shares its trip
    );
    for (const f of receiptFixtures) {
      expect(f.covers.length).toBeGreaterThan(10);
      expect(expectedSource(f).pages).toBe(f.pages.length);
      expect(f.source.lines).toBe(
        f.pages.reduce((n, page) => n + page.length, 0),
      );
      if (f.outcome === "event") {
        expect(f.event).not.toBeNull();
        expect(purchaseEventSchema.safeParse(f.event).success).toBe(true);
      } else {
        // An unsupported file creates no event and counts every line as unreadable.
        expect(f.event).toBeNull();
        expect(f.source.unreadableLines).toBe(f.source.lines);
      }
    }
  });

  test("every required layout and failure is covered by a named fixture", () => {
    const required: Record<string, string[]> = {
      "quantity after price": ["s-quantity-after-price"],
      "NORM. and campaigns": ["s-norm-campaign", "s-basic-campaign"],
      "multi-page continuation": ["s-multi-page"],
      "weighted produce": ["s-weighed-produce", "k-weighed"],
      "multiple milk types": ["s-multiple-milk"],
      "three groups of five pouches": ["s-five-groups"],
      deposits: ["s-deposits", "k-deposit-no-section"],
      "group promotions": ["s-five-groups", "k-group-promotion"],
      "non-food": ["s-non-food-subtotals"],
      "printed subtotals": ["s-printed-subtotal", "s-non-food-subtotals"],
      malformed: ["partial-missing-total", "partial-missing-price"],
      "unknown format": ["unknown-restaurant-bill", "unknown-plain-note"],
      injection: ["injection-in-label", "injection-row"],
      "duplicate and distinct trips": ["trip-original", "trip-distinct"],
      unbalanced: ["unbalanced-total"],
    };
    for (const [topic, ids] of Object.entries(required))
      for (const id of ids)
        expect(fixture(id), `${topic}: ${id}`).toBeDefined();
    expect(receiptFixtures.some((f) => f.chain === "s-group")).toBe(true);
    expect(receiptFixtures.some((f) => f.chain === "k-group")).toBe(true);
  });

  test("spans point at the text each fact was read from", () => {
    for (const f of events) {
      for (const line of f.event.lines) {
        const text = spanText(f, line.span);
        expect(text, `${f.id} ${line.id} span`).not.toBe("");
        // Pieces of a sanitized label are still in the text at its position.
        for (const piece of line.label.split("…").map((p) => p.trim()))
          if (piece) expect(text, `${f.id} ${line.id}`).toContain(piece);
        if (line.gross !== null)
          expect(text, `${f.id} ${line.id} gross`).toContain(
            printed(line.gross),
          );
        if (line.unitPrice !== null)
          expect(text, `${f.id} ${line.id} unit`).toContain(
            printed(line.unitPrice),
          );
      }
      for (const a of f.event.adjustments) {
        expect(spanText(f, a.span)).toContain(a.label.split("…")[0].trim());
        if (a.amount !== null)
          expect(spanText(f, a.span)).toContain(printed(a.amount));
      }
      for (const p of f.event.printed)
        expect(spanText(f, p.span), `${f.id} ${p.role}`).toContain(
          printed(p.amount),
        );
    }
  });

  test("counts and weights multiply to the printed line price", () => {
    for (const f of events)
      for (const line of f.event.lines) {
        if (line.unitPrice === null || line.quantity.amount === null) continue;
        const expected =
          line.unitPriceBasis === "pcs"
            ? line.quantity.amount * line.unitPrice
            : Math.round((line.quantity.amount / 1000) * line.unitPrice);
        expect(line.gross, `${f.id} ${line.id}`).toBe(expected);
        if (line.unitPriceBasis !== "pcs")
          expect(spanText(f, line.span)).toContain(
            (line.quantity.amount / 1000).toFixed(3).replace(".", ","),
          );
      }
  });

  test("a balanced receipt adds up from its rows and adjustments, written independently", () => {
    for (const f of events) {
      const { event } = f;
      const total = event.printed.find((p) => p.role === "total");
      if (event.reconciliation.status !== "balanced") {
        // Only status and reasons are expectations when something is unknown or inconsistent.
        expect(event.reconciliation.reasons.length).toBeGreaterThan(0);
        continue;
      }
      const lines = event.lines
        .filter((l) => l.role !== "unreadable")
        .reduce((sum, l) => sum + (l.net ?? l.gross ?? NaN), 0);
      // Line-allocated adjustments are already in `net`; the others are added once.
      const rest = event.adjustments
        .filter((a) => a.allocation !== "line")
        .reduce((sum, a) => sum + (a.amount ?? NaN), 0);
      expect(lines + rest, f.id).toBe(total?.amount);
      expect(event.reconciliation.printedTotal).toBe(total?.amount);
      // A line-allocated adjustment is the difference between its row's gross and net.
      for (const a of event.adjustments.filter(
        (x) => x.allocation === "line",
      )) {
        const row = event.lines.find((l) => l.id === a.lineIds[0])!;
        expect(row.net! - row.gross!, `${f.id} ${a.id}`).toBe(a.amount);
      }
      // A group offer leaves its rows without a per-row paid price.
      for (const a of event.adjustments.filter((x) => x.allocation === "group"))
        for (const id of a.lineIds)
          expect(event.lines.find((l) => l.id === id)!.net).toBeNull();
    }
    expect(fixture("unbalanced-total").event!.reconciliation).toMatchObject({
      status: "unbalanced",
      difference: -10,
    });
  });

  test("unknown facts stay null and nothing is filled from a printed total", () => {
    const missing = fixture("partial-missing-price").event!;
    const apple = missing.lines.find((l) => l.label.startsWith("OMENA"))!;
    expect(apple).toMatchObject({
      quantity: { amount: null, unit: null, provenance: "unknown" },
      unitPrice: null,
      gross: null,
      net: null,
    });
    expect(missing.reconciliation).toMatchObject({
      status: "incomplete",
      reasons: ["missing-line-amount"],
      computedTotal: null,
      difference: null,
    });
    const partial = fixture("partial-missing-total").event!;
    expect(partial.printed).toEqual([]);
    expect(partial.reconciliation.reasons).toEqual([
      "no-printed-total",
      "unreadable-lines",
    ]);
    // A row of four digits is not a quantity: counts are unknown unless printed.
    for (const f of events)
      for (const line of f.event.lines)
        if (line.role === "unreadable")
          expect(line.quantity.provenance).toBe("unknown");
  });

  test("hostile text is kept only as an inert sanitized label and moves no amount", () => {
    const hostile = receiptFixtures.filter((f) => f.hostile);
    expect(hostile.map((f) => f.id)).toEqual([
      "injection-in-label",
      "injection-row",
    ]);
    const label = fixture("injection-in-label").event!;
    expect(label.lines[0]).toMatchObject({ gross: 119, net: 119 });
    expect(label.reconciliation.status).toBe("balanced");
    const row = fixture("injection-row").event!;
    const injected = row.lines.find((l) => l.role === "unreadable")!;
    expect(injected.label).toBe(
      sanitizeLabel(fixture("injection-row").hostile!),
    );
    expect(injected.label).not.toContain("@");
    expect(injected.label).toContain("…");
    expect([injected.gross, injected.net, injected.unitPrice]).toEqual([
      null,
      null,
      null,
    ]);
    expect(row.lines.find((l) => l.label === "KEVYTMAITO 1L")).toMatchObject({
      net: 119,
    });
  });

  test("duplicates are the same trip and a distinct trip is its own purchase", () => {
    const original = fixture("trip-original");
    const pdf = receiptFixtures.find(
      (f) => f.id === "trip-original" && f.format === "pdf",
    )!;
    const distinct = fixture("trip-distinct");
    expect(pdf.relation).toEqual({ kind: "duplicate", of: "trip-original" });
    expect(pdf.event).toEqual(original.event);
    expect(pdf.pages).toEqual(original.pages);
    expect(distinct.relation).toEqual({
      kind: "distinct",
      from: "trip-original",
    });
    expect(distinct.event!.id).not.toBe(original.event!.id);
    expect(distinct.event!.purchasedAt).not.toBe(original.event!.purchasedAt);
    // Same rows and total, so only the trip identity tells them apart.
    expect(distinct.event!.lines.map((l) => [l.label, l.net])).toEqual(
      original.event!.lines.map((l) => [l.label, l.net]),
    );
    expect(distinct.event!.printed.map((p) => p.amount)).toEqual(
      original.event!.printed.map((p) => p.amount),
    );
  });

  test("no original, identifier or personal data enters a fixture", () => {
    for (const f of receiptFixtures) {
      const text = fixtureText(f);
      // Receipt numbers and dates are short; nothing here is a card, account or phone number.
      expect(text, f.id).not.toMatch(/\d{6,}/);
      expect(text, f.id).not.toMatch(/https?:|www\./i);
      expect(text, f.id).not.toMatch(/\*{4,}/);
      if (!f.hostile) expect(text, f.id).not.toMatch(/\S+@\S+\.\S+/);
      expect(text, f.id).toMatch(/Esimerkki|Ravintola Esimerkki|Ostoslista/);
    }
    // The only address-like text is the invented attacker on the injection row.
    expect(
      receiptFixtures
        .filter((f) => /\S+@\S+\.\S+/.test(fixtureText(f)))
        .map((f) => f.id),
    ).toEqual(["injection-row"]);
  });

  test("every fixture is a text-bearing PDF the local reader returns line by line", async () => {
    const worker = pathToFileURL(
      join(process.cwd(), "dist/main/receipt-worker.js"),
    );
    if (!existsSync(join(process.cwd(), "dist/main/receipt-worker.js"))) return;
    const directory = await mkdtemp(join(tmpdir(), "korikone-fixtures-"));
    for (const f of receiptFixtures) {
      const path = join(directory, `${f.id}.pdf`);
      await writeFile(path, receiptTextPDF(f.pages));
      const text = (await readReceipt(path, worker)).replace(/\s+/g, " ");
      for (const page of f.pages)
        for (const line of page)
          if (line.trim() && !/^-+$/.test(line.trim()))
            expect(text, `${f.id}: ${line}`).toContain(
              line.trim().replace(/\s+/g, " "),
            );
    }
  }, 120000);
});
