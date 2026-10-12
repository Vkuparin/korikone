import {
  Receipt,
  balanced,
  pcs,
  receiptFixture,
  type ReceiptFixture,
} from "./author";

/**
 * The same shopping trip imported twice, and two different trips that look alike. A duplicate
 * adds nothing; a distinct trip is its own purchase even with the same rows.
 */
function trip(
  id: string,
  date: string,
  time: string,
  receiptNumber: string,
  purchasedAt: string,
  extra: Partial<Parameters<typeof receiptFixture>[0]> = {},
) {
  const pages = [
    [
      "S-market Esimerkki",
      "Testikatu 1, 00100 Helsinki",
      `${date} ${time}  Kassa 2  Kuitti ${receiptNumber}`,
      "--------------------------------",
      "KEVYTMAITO 1L                1,19",
      "RUISLEIPÄ                    2,29",
      "KAHVI 500G                   4,99",
      "--------------------------------",
      "YHTEENSÄ                     8,47",
    ],
  ];
  const r = new Receipt(pages);
  r.product("KEVYTMAITO", "KEVYTMAITO 1L", {
    quantity: pcs(1),
    gross: 119,
    net: 119,
  });
  r.product("RUISLEIPÄ", "RUISLEIPÄ", {
    quantity: pcs(1),
    gross: 229,
    net: 229,
  });
  r.product("KAHVI", "KAHVI 500G", { quantity: pcs(1), gross: 499, net: 499 });
  r.print("total", "YHTEENSÄ", 847);
  return receiptFixture({
    id,
    covers: "A three-row trip",
    chain: "s-group",
    receipt: r,
    store: "S-market Esimerkki",
    purchasedAt,
    reconciliation: balanced(847),
    ...extra,
  });
}

export const tripOriginal = trip(
  "trip-original",
  "27.10.2026",
  "16:20",
  "0801",
  "2026-10-27T14:20:00.000Z",
  { covers: "The first import of a trip" },
);
/** The same receipt exported again as a PDF: same content, same trip. */
export const tripSameAsPdf: ReceiptFixture = {
  ...trip(
    "trip-original",
    "27.10.2026",
    "16:20",
    "0801",
    "2026-10-27T14:20:00.000Z",
  ),
  format: "pdf",
  covers:
    "The same trip as a PDF of the same text: a duplicate of the text import",
  relation: { kind: "duplicate", of: "trip-original" },
  source: { ...tripOriginal.source, format: "pdf" },
};
/** Same shop, same three rows and total, but another day and receipt number. */
export const tripDistinct = trip(
  "trip-distinct",
  "03.11.2026",
  "16:25",
  "0912",
  "2026-11-03T14:25:00.000Z",
  {
    covers:
      "A different trip with identical rows: a separate purchase, not a duplicate",
    relation: { kind: "distinct", from: "trip-original" },
  },
);

export const tripFixtures: ReceiptFixture[] = [
  tripOriginal,
  tripSameAsPdf,
  tripDistinct,
];
