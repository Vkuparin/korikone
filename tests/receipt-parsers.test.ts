import { describe, expect, test } from "vitest";
import { parseReceipt } from "../src/receipts/parsers";
import { helsinkiTime } from "../src/receipts/parsers/shared";
import {
  reconcile,
  receiptLedger,
  sectionDifferences,
  withNetPrices,
} from "../src/domain/receipt-accounting";
import { fixtureText, receiptFixtures } from "./fixtures/receipts";

const parsed = (text: string) => {
  const result = parseReceipt(text);
  if (result.outcome !== "event") throw new Error("unsupported");
  return result;
};
/** Rows as a PDF reader returns them: no indentation and single spaces. */
const collapsed = (text: string) =>
  text
    .split("\n")
    .map((line) => (line === "\f" ? line : line.trim().replace(/\s+/g, " ")))
    .join("\n");

describe("receipt parsers against the independently authored fixtures", () => {
  for (const fixture of receiptFixtures)
    test(`${fixture.id} (${fixture.format}): ${fixture.covers}`, () => {
      for (const text of [
        fixtureText(fixture),
        collapsed(fixtureText(fixture)),
      ]) {
        const result = parseReceipt(text);
        if (fixture.outcome === "unsupported") {
          expect(result).toEqual({
            outcome: "unsupported",
            pages: fixture.source.pages,
            lines: fixture.source.lines,
          });
          continue;
        }
        if (result.outcome !== "event") throw new Error("unsupported");
        const expected = fixture.event!;
        expect(result.receipt).toMatchObject({
          chain: fixture.source.chain,
          pages: fixture.source.pages,
          lines: fixture.source.lines,
          unreadableLines: fixture.source.unreadableLines,
          parser: { id: fixture.chain, version: 1 },
        });
        const { reconciliation, ...facts } = result.facts;
        const {
          reconciliation: wanted,
          id: _id,
          sourceIds: _s,
          ...rest
        } = expected;
        expect(facts).toEqual(rest);
        // For a receipt that does not balance, only the status and the reasons are expectations.
        if (wanted.status === "balanced")
          expect(reconciliation).toEqual(wanted);
        else
          expect([reconciliation.status, reconciliation.reasons]).toEqual([
            wanted.status,
            wanted.reasons,
          ]);
      }
    });
});

const s = (...rows: string[]) =>
  [
    "S-market Esimerkki",
    "Testikatu 1, 00100 Helsinki",
    "12.10.2026 14:35  Kassa 3  Kuitti 0417",
    ...rows,
  ].join("\n");
const k = (...rows: string[]) =>
  [
    "K-Market Esimerkki",
    "Näytekuja 2, 00200 Helsinki",
    "13.10.2026 09:12  Kuitti 88  Kassa 1",
    ...rows,
  ].join("\n");
const rowsOf = (text: string) =>
  parsed(text).facts.lines.map((l) => [
    l.label,
    l.role,
    l.quantity.amount,
    l.quantity.unit,
    l.unitPrice,
    l.gross,
    l.net,
  ]);

test("S-group: four units stay four, campaigns attach to their own row and non-food is no ingredient", () => {
  const receipt = parsed(
    s(
      "MAKARONI 400G                2,20",
      "  4 KPL x 0,55",
      "  NORM. 0,69",
      "JAUHELIHA 400G               3,85",
      "  KAMPANJA                  -0,50",
      "KERMA 2DL                    1,09",
      "MUUT TUOTTEET",
      "WC-PAPERI 8 RLL              4,95",
      "  ALENNUS                   -1,00",
      "--------------------------------",
      "YHTEENSÄ                    10,59",
      "ALV 14%                      1,02",
      "KORTTI ************1234",
      "Viite 12345678901234567890",
    ),
  );
  expect(
    rowsOf(
      s("MAKARONI 400G                2,20", "  4 KPL x 0,55", "  NORM. 0,69"),
    ),
  ).toEqual([["MAKARONI 400G", "product", 4, "pcs", 55, 220, 220]]);
  expect(
    receipt.facts.lines.map((l) => [l.label, l.role, l.gross, l.net]),
  ).toEqual([
    ["MAKARONI 400G", "product", 220, 220],
    ["JAUHELIHA 400G", "product", 385, 335],
    ["KERMA 2DL", "product", 109, 109],
    ["WC-PAPERI 8 RLL", "non-food", 495, 395],
  ]);
  // Each reduction belongs to the row above it; no promotion row became a product.
  expect(
    receipt.facts.adjustments.map((a) => [
      a.kind,
      a.amount,
      a.allocation,
      a.lineIds,
    ]),
  ).toEqual([
    ["campaign", -50, "line", ["l2"]],
    ["discount", -100, "line", ["l4"]],
  ]);
  expect(receipt.facts.lines[0].span).toEqual({ page: 1, line: 4, endLine: 6 });
  expect(receipt.facts.reconciliation).toMatchObject({
    status: "balanced",
    computedTotal: 1059,
    printedTotal: 1059,
  });
  // Nothing after the total is read: no tax row, card number or reference becomes evidence.
  expect(JSON.stringify(receipt)).not.toMatch(/ALV|KORTTI|Viite|1234/);
  expect(receipt.receipt.unreadableLines).toBe(0);
  // A printed total that differs from the computed one is reported, not corrected.
  expect(
    parsed(
      s(
        "KEVYTMAITO 1L                1,19",
        "YHTEENSÄ                     1,29",
      ),
    ).facts.reconciliation,
  ).toEqual({
    status: "unbalanced",
    computedTotal: 119,
    printedTotal: 129,
    difference: -10,
    reasons: ["difference"],
  });
});

test("S-group: an unexplained group offer or reduction is kept unallocated", () => {
  const offer = parsed(
    s(
      "TONNIKALA 185G               1,99",
      "TONNIKALA 185G               1,99",
      "PASTAKASTIKE 400G            2,49",
      "RYHMÄTARJOUS                -0,80",
      "HYVITYS                     -0,20",
      "YHTEENSÄ                     5,47",
    ),
  );
  expect(
    offer.facts.adjustments.map((a) => [
      a.kind,
      a.amount,
      a.allocation,
      a.lineIds,
    ]),
  ).toEqual([
    ["campaign", -80, "unknown", []],
    ["other", -20, "unknown", []],
  ]);
  // The money still adds up, but the receipt is not fully understood.
  expect(offer.facts.lines.every((l) => l.net === l.gross)).toBe(true);
  expect(offer.facts.reconciliation).toMatchObject({
    status: "incomplete",
    computedTotal: 547,
    difference: 0,
    reasons: ["unallocated-adjustment"],
  });
  // A stated count that the rows above do not add up to is not evidence of membership either.
  const mismatch = parsed(
    s(
      "KISSANRUOKA KANA 85G         4,45",
      "  5 KPL x 0,89",
      "KISSANRUOKA LOHI 85G         3,56",
      "  4 KPL x 0,89",
      "RYHMÄTARJOUS 3 x 5 KPL      -1,35",
      "YHTEENSÄ                     6,66",
    ),
  );
  expect(mismatch.facts.adjustments[0]).toMatchObject({
    allocation: "unknown",
    lineIds: [],
  });
});

test("K-group: milk variants, pouches, weights and a second page keep their own facts", () => {
  const text = [
    k(
      "KEVYTMAITO 1L",
      "   2 KPL  X  1,19            2,38",
      "LAKTOOSITON MAITOJUOMA 1L",
      "   2 KPL  X  1,69            3,38",
      "KISSANRUOKA KANA 85G",
      "   5 KPL  X  0,89            4,45",
      "KISSANRUOKA LOHI 85G",
      "   5 KPL  X  0,89            4,45",
      "KISSANRUOKA NAUTA 85G",
      "   5 KPL  X  0,89            4,45",
      "RYHMÄETU 15 KPL 12,00        -1,35",
      "TOMAATTI",
      "Sivu 1/2",
    ),
    [
      "K-Market Esimerkki",
      "Sivu 2/2",
      "   0,455 KG  X  3,98 /KG      1,81",
      "PORKKANA",
      "   1,005 KG  X  0,99 /KG      0,99",
      "K-Plussa-etu                 -0,62",
      "Yhteensä                     19,94",
      "PLUSSA-KORTTI 9246 1234 5678 9012",
    ].join("\n"),
  ].join("\n\f\n");
  const receipt = parsed(text);
  expect(
    receipt.facts.lines.map((l) => [
      l.label,
      l.quantity.amount,
      l.quantity.unit,
      l.unitPrice,
      l.unitPriceBasis,
      l.gross,
      l.net,
    ]),
  ).toEqual([
    ["KEVYTMAITO 1L", 2, "pcs", 119, "pcs", 238, 238],
    ["LAKTOOSITON MAITOJUOMA 1L", 2, "pcs", 169, "pcs", 338, 338],
    // Fifteen pouches are three rows of five: no row is a fifteen-pack and none has a split price.
    ["KISSANRUOKA KANA 85G", 5, "pcs", 89, "pcs", 445, null],
    ["KISSANRUOKA LOHI 85G", 5, "pcs", 89, "pcs", 445, null],
    ["KISSANRUOKA NAUTA 85G", 5, "pcs", 89, "pcs", 445, null],
    ["TOMAATTI", 455, "g", 398, "kg", 181, 181],
    ["PORKKANA", 1005, "g", 99, "kg", 99, 99],
  ]);
  expect(
    receipt.facts.adjustments.map((a) => [
      a.kind,
      a.amount,
      a.allocation,
      a.lineIds,
    ]),
  ).toEqual([
    ["campaign", -135, "group", ["l3", "l4", "l5"]],
    ["loyalty", -62, "receipt", []],
  ]);
  // The name on page 1 and its weight on page 2 are one row; its span stays on the name.
  expect(receipt.facts.lines[5].span).toEqual({
    page: 1,
    line: 15,
    endLine: 15,
  });
  expect(receipt.facts.lines[6].span).toEqual({ page: 2, line: 4, endLine: 5 });
  expect(receipt.receipt).toMatchObject({ pages: 2, unreadableLines: 0 });
  expect(receipt.facts.printed).toEqual([
    { role: "total", amount: 1994, span: { page: 2, line: 7, endLine: 7 } },
  ]);
  expect(receipt.facts.reconciliation).toMatchObject({
    status: "balanced",
    computedTotal: 1994,
  });
  expect(JSON.stringify(receipt)).not.toMatch(/9246|PLUSSA-KORTTI/);
});

test("K-group: a truncated name, an unplaced benefit and a group that does not add up stay unknown", () => {
  const receipt = parsed(
    k(
      "JOGURTTI LUONNON 150G         0,89",
      "K-Plussa-etu                 -0,10",
      "JOGURTTI MANSIKKA 150G        0,89",
      "RYHMÄETU 3 KPL 2,00          -0,67",
      "PIRKKA LUOMU TÄYSJYVÄ",
      "   2 KPL  X  1,25            2,50",
      "   3 KPL  X  1,00            3,00",
      "VALIO OLTERM",
      "Yhteensä                      6,51",
    ),
  );
  // Two rows cannot be the three pieces the offer names; the benefit sits between rows.
  expect(
    receipt.facts.adjustments.map((a) => [a.kind, a.allocation, a.lineIds]),
  ).toEqual([
    ["loyalty", "unknown", []],
    ["campaign", "unknown", []],
  ]);
  // A count row with no name above it is unreadable; a cut-off name has no amount or quantity.
  expect(
    receipt.facts.lines.map((l) => [
      l.label,
      l.role,
      l.quantity.amount,
      l.gross,
    ]),
  ).toEqual([
    ["JOGURTTI LUONNON 150G", "product", 1, 89],
    ["JOGURTTI MANSIKKA 150G", "product", 1, 89],
    ["PIRKKA LUOMU TÄYSJYVÄ", "product", 2, 250],
    ["3 KPL X 1,00 3,00", "unreadable", null, null],
    ["VALIO OLTERM", "product", null, null],
  ]);
  expect(receipt.receipt.unreadableLines).toBe(1);
  expect(receipt.facts.reconciliation).toMatchObject({
    status: "incomplete",
    computedTotal: null,
    printedTotal: 651,
    reasons: [
      "unreadable-lines",
      "missing-line-amount",
      "unallocated-adjustment",
    ],
  });
});

test("only a recognized shop layout is read; anything else is unsupported and bounded", () => {
  for (const text of [
    "",
    "S-market Esimerkki",
    "Kauppa Tuntematon\n12.10.2026 14:35\nKEVYTMAITO 1L 1,19\nYHTEENSÄ 1,19",
    "S-marketti Oy lasku\nMAKSETTAVAA 100,00 euroa viimeistään",
  ])
    expect(parseReceipt(text).outcome).toBe("unsupported");
  expect(() => parseReceipt("x".repeat(50_001))).toThrow("receiptTooLarge");
  expect(() => parseReceipt(Array(2_001).fill("RIVI 1,00").join("\n"))).toThrow(
    "receiptTooLarge",
  );
  // A date without a time has day precision; no date is unknown, never today's.
  expect(
    parsed("Prisma Esimerkki\n3.11.2026\nKEVYTMAITO 1L 1,19\nYHTEENSÄ 1,19")
      .facts,
  ).toMatchObject({
    purchasedAt: "2026-11-03T00:00:00.000Z",
    datePrecision: "day",
  });
  expect(
    parsed("Prisma Esimerkki\nKEVYTMAITO 1L 1,19\nYHTEENSÄ 1,19").facts,
  ).toMatchObject({
    purchasedAt: null,
    datePrecision: "unknown",
  });
  expect(
    parsed(
      "Prisma Esimerkki\n31.2.2026 10:00\nKEVYTMAITO 1L 1,19\nYHTEENSÄ 1,19",
    ).facts.purchasedAt,
  ).toBeNull();
});

test("Finnish local time converts with the summer-time change on the last Sundays", () => {
  expect(helsinkiTime(2026, 10, 12, 14, 35)).toBe("2026-10-12T11:35:00.000Z");
  expect(helsinkiTime(2026, 10, 25, 2, 30)).toBe("2026-10-24T23:30:00.000Z");
  expect(helsinkiTime(2026, 10, 25, 11, 11)).toBe("2026-10-25T09:11:00.000Z");
  expect(helsinkiTime(2026, 3, 29, 2, 30)).toBe("2026-03-29T00:30:00.000Z");
  expect(helsinkiTime(2026, 3, 29, 12, 0)).toBe("2026-03-29T09:00:00.000Z");
  expect(helsinkiTime(2026, 1, 15, 8, 0)).toBe("2026-01-15T06:00:00.000Z");
  expect(helsinkiTime(2026, 2, 30, 8, 0)).toBeNull();
  expect(helsinkiTime(2026, 5, 1, 24, 0)).toBeNull();
});

test("the ledger counts every amount once and never invents or doubles a discount", () => {
  const five = parsed(
    fixtureText(receiptFixtures.find((f) => f.id === "s-five-groups")!),
  ).facts;
  expect(receiptLedger(five)).toEqual({
    goods: 1335,
    deposits: 0,
    lineAdjustments: 0,
    groupAdjustments: -135,
    receiptAdjustments: 0,
    paid: 1200,
  });
  const deposits = parsed(
    fixtureText(receiptFixtures.find((f) => f.id === "s-deposits")!),
  ).facts;
  expect(receiptLedger(deposits)).toMatchObject({
    goods: 440,
    deposits: 80,
    receiptAdjustments: -120,
    paid: 400,
  });
  expect(sectionDifferences(deposits)).toEqual({
    food: null,
    nonFood: null,
    deposits: 0,
  });
  const sections = parsed(
    fixtureText(receiptFixtures.find((f) => f.id === "s-non-food-subtotals")!),
  ).facts;
  expect(sectionDifferences(sections)).toEqual({
    food: 0,
    nonFood: 0,
    deposits: null,
  });
  // NORM. is a reference: with it or without it the same receipt has the same paid amounts.
  const norm = parsed(
    fixtureText(receiptFixtures.find((f) => f.id === "s-norm-campaign")!),
  ).facts;
  expect(receiptLedger(norm)).toMatchObject({
    goods: 478,
    lineAdjustments: -30,
    paid: 448,
  });
  // Summing nets and then subtracting line adjustments again would double-count; the ledger does not.
  expect(norm.lines.reduce((sum, l) => sum + l.net!, 0)).toBe(448);

  // A missing amount makes the part unknown instead of zero.
  const missing = structuredClone(five);
  missing.adjustments[0].amount = null;
  expect(receiptLedger(missing)).toMatchObject({
    groupAdjustments: null,
    paid: null,
  });
  expect(reconcile(missing)).toMatchObject({
    status: "incomplete",
    computedTotal: null,
    difference: null,
    reasons: ["missing-adjustment-amount"],
  });
  // Two different printed totals are a contradiction; neither is taken.
  const conflict = structuredClone(norm);
  conflict.printed.push({ ...conflict.printed[0], amount: 500 });
  expect(reconcile(conflict)).toMatchObject({
    printedTotal: null,
    reasons: ["no-printed-total"],
  });
  // A corrected paid amount is kept; an adjustment shared by two rows states no per-row share.
  const corrected = withNetPrices({
    lines: norm.lines.map((l, i) =>
      i === 0 ? { ...l, net: 250, provenance: "user" as const } : l,
    ),
    adjustments: [
      { ...norm.adjustments[0], lineIds: [norm.lines[0].id, norm.lines[1].id] },
    ],
  });
  expect(corrected.lines.map((l) => l.net)).toEqual([250, null]);
});
