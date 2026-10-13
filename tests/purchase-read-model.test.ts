import { expect, test } from "vitest";
import {
  displayName,
  interpretPurchase,
  purchaseView,
} from "../src/domain/purchase-review";
import {
  emptyLedger,
  purchaseLedgerSchema,
  type PurchaseLedger,
  type SemanticAnnotation,
} from "../src/domain/purchases";
import {
  purchaseEvent,
  purchaseLine,
  purchaseSource,
} from "./helpers/purchase-fixtures";

const model = { providerId: "chatgpt", modelId: "m", taskVersion: 1 };
const annotation = (
  lineId: string,
  origin: SemanticAnnotation["origin"],
  extra: Partial<SemanticAnnotation> = {},
): SemanticAnnotation => ({
  eventId: "e1",
  lineId,
  origin,
  sourceRevision: 1,
  name: null,
  category: null,
  qualifiers: [],
  scope: "food",
  model: origin === "model" ? model : null,
  at: "2026-10-01T10:00:00.000Z",
  ...extra,
});
/** One receipt whose seven lines each show a different naming or factual situation. */
function ledger(extra: Partial<PurchaseLedger> = {}): PurchaseLedger {
  return purchaseLedgerSchema.parse({
    ...emptyLedger(),
    sources: [purchaseSource("s1")],
    events: [
      purchaseEvent("e1", "s1", {
        lines: [
          purchaseLine("l1", "VALIO JOG 1KG", 249),
          purchaseLine("l2", "KEVYTMAITO 1L", 119),
          purchaseLine("l3", "RUISLEIPÄ", 229),
          purchaseLine("l4", "PIRKKA KAHVI", 499),
          purchaseLine("l5", "TUNTEMATON RIVI", 100),
          purchaseLine("l6", "IRTOKARKIT", 310, {
            quantity: { amount: null, unit: null, provenance: "unknown" },
          }),
          purchaseLine("l7", "PARISTOT AA", null, {
            role: "non-food",
            unitPrice: null,
            unitPriceBasis: null,
            gross: null,
            net: null,
          }),
        ],
        printed: [],
        reconciliation: {
          status: "incomplete",
          computedTotal: null,
          printedTotal: null,
          difference: null,
          reasons: ["missing-line-amount"],
        },
      }),
    ],
    annotations: [
      // A model alone.
      annotation("l1", "model", { name: "Valio jogurtti 1 kg" }),
      // A rule's category beside a model's fuller name.
      annotation("l2", "rule", { category: "milk" }),
      annotation("l2", "model", { name: "Kevytmaito 1 l", category: "milk" }),
      // The shopper's own name over a model's.
      annotation("l3", "user", { name: "Ruisleipä", category: "bread" }),
      annotation("l3", "model", { name: "Leipä" }),
      // A rule's category and nothing else.
      annotation("l4", "rule", { category: "coffee" }),
    ],
    ...extra,
  });
}
const row = (view: ReturnType<typeof purchaseView>, id: string) =>
  view[0].lines.find((l) => l.id === id)!;

test("every line has a readable name, and name quality is reported apart from factual issues", () => {
  const view = purchaseView(ledger());
  expect(
    Object.fromEntries(
      view[0].lines.map((l) => [l.id, [l.display.text, l.display.specificity]]),
    ),
  ).toEqual({
    l1: ["Valio jogurtti 1 kg", "named"],
    l2: ["Kevytmaito 1 l", "named"],
    l3: ["Ruisleipä", "user"],
    // The local rule writes the printed label in ordinary case (F27.8).
    l4: ["Pirkka kahvi", "named"],
    l5: ["TUNTEMATON RIVI", "raw"],
    l6: ["IRTOKARKIT", "raw"],
    l7: ["PARISTOT AA", "raw"],
  });
  // Origins are kept per field: the rule's category does not become the model's, or the reverse.
  // The label supports the same name locally, so the rule's name stands and the line is not
  // a model's alone.
  expect(row(view, "l1").display).toMatchObject({
    nameOrigin: "rule",
    categoryOrigin: null,
    modelOnly: false,
  });
  expect(row(view, "l2").display).toMatchObject({
    nameOrigin: "rule",
    categoryOrigin: "rule",
    modelOnly: false,
  });
  expect(row(view, "l2").interpretation).toMatchObject({
    origin: "rule",
    category: "milk",
  });
  expect(row(view, "l3").display).toMatchObject({
    nameOrigin: "user",
    categoryOrigin: "user",
    modelOnly: false,
  });
  expect(row(view, "l4").display).toMatchObject({
    nameOrigin: "rule",
    categoryOrigin: "rule",
  });
  // A model's name, or no name at all, is not an issue. Unknown facts are.
  expect(
    Object.fromEntries(view[0].lines.map((l) => [l.id, l.issues])),
  ).toEqual({
    l1: [],
    l2: [],
    l3: [],
    l4: [],
    l5: [],
    l6: ["unknown-quantity"],
    l7: ["missing-amount"],
  });
  expect(view[0].issueCount).toBe(2);
  expect(view[0].names).toEqual({
    lines: 7,
    user: 1,
    named: 3,
    general: 0,
    raw: 3,
    modelOnly: 0,
  });
  expect(view[0].factual).toEqual({
    unbalanced: false,
    incomplete: true,
    unreadableLines: 0,
    ocr: false,
  });
  // The earlier fields are still there with their earlier meaning.
  expect(row(view, "l1").review).toEqual(["model-proposal"]);
  expect(row(view, "l5").review).toEqual(["uninterpreted"]);
  expect(view[0].reviewCount).toBe(4);
});

test("unbalanced and scanned receipts are factual; old records without annotations fall back to their labels", () => {
  const old = purchaseView(
    ledger({
      sources: [
        purchaseSource("s1", {
          format: "pdf",
          ocrPages: [1],
          unreadableLines: 2,
        }),
      ],
      events: [
        purchaseEvent("e1", "s1", {
          lines: [
            purchaseLine("l1", "KEVYTMAITO 1L", 119),
            purchaseLine("l2", "???", null, {
              role: "unreadable",
              quantity: { amount: null, unit: null, provenance: "unknown" },
              unitPrice: null,
              unitPriceBasis: null,
              gross: null,
              net: null,
            }),
          ],
          reconciliation: {
            status: "unbalanced",
            computedTotal: 119,
            printedTotal: 348,
            difference: -229,
            reasons: ["difference", "unreadable-lines"],
          },
        }),
      ],
      annotations: [],
    }),
  );
  expect(old[0].factual).toEqual({
    unbalanced: true,
    incomplete: false,
    unreadableLines: 2,
    ocr: true,
  });
  expect(old[0].lines.map((l) => [l.display.text, l.issues])).toEqual([
    ["Kevytmaito 1 l", []],
    ["???", ["unreadable"]],
  ]);
  // An unreadable line is not a bought line and is not counted among names.
  expect(old[0].names).toEqual({
    lines: 1,
    user: 0,
    named: 1,
    general: 0,
    raw: 0,
    modelOnly: 0,
  });
  expect(old[0].issueCount).toBe(1);
});

test("a correction by the shopper becomes the name without accepting anything else in bulk", () => {
  const base = ledger();
  const corrected = interpretPurchase(
    base,
    {
      eventId: "e1",
      lineId: "l1",
      revision: 1,
      name: "Valio maustamaton jogurtti",
      category: null,
      qualifiers: [],
      scope: "food",
    },
    "2026-10-02T08:00:00.000Z",
  );
  const view = purchaseView(corrected);
  expect(row(view, "l1").display).toMatchObject({
    text: "Valio maustamaton jogurtti",
    specificity: "user",
    nameOrigin: "user",
    modelOnly: false,
  });
  // The other rows keep their own origins; nothing was turned into a user interpretation.
  expect(row(view, "l2").display.nameOrigin).toBe("rule");
  expect(view[0].names).toMatchObject({ user: 2, named: 2, modelOnly: 0 });
  expect(corrected.annotations.filter((a) => a.origin === "user")).toHaveLength(
    2,
  );
  // Money and identities are untouched.
  expect(corrected.events[0].lines).toEqual(base.events[0].lines);
  expect(corrected.events[0].reconciliation).toEqual(
    base.events[0].reconciliation,
  );
});

test("an annotation made for an older revision of the source is not used", () => {
  expect(displayName({ label: "VALIO JOG 1KG" }, [])).toEqual({
    text: "VALIO JOG 1KG",
    specificity: "raw",
    tier: "raw",
    nameOrigin: null,
    categoryOrigin: null,
    modelOnly: false,
  });
  const stale = purchaseView(
    ledger({
      sources: [purchaseSource("s1", { revision: 2 })],
    }),
  );
  // Nothing of the old annotations is used: no category and no model origin, only the local rule.
  expect(
    stale[0].lines.every(
      (l) => l.display.categoryOrigin === null && l.display.modelOnly === false,
    ),
  ).toBe(true);
});
