import {
  Receipt,
  balanced,
  grams,
  pcs,
  receiptFixture,
  type ReceiptFixture,
} from "./author";

/**
 * Invented receipts in the layout of a supermarket of the S-group: the item name and its line price
 * share a row; a count or weight is printed on an indented row after the price; campaigns are
 * negative rows under the item; the total closes the list. Nothing here is a real receipt.
 *
 * Accounting convention for the expectations: `gross` is the printed line price, `net` is the line
 * after adjustments that the source ties to that line alone, and the printed total is the sum of
 * the nets plus group and receipt-level adjustments.
 */

export const sBasicCampaign = (() => {
  const pages = [
    [
      "S-market Esimerkki",
      "Testikatu 1, 00100 Helsinki",
      "12.10.2026 14:35  Kassa 3  Kuitti 0417",
      "--------------------------------",
      "KEVYTMAITO 1L                1,19",
      "RUISLEIPÄ                    2,29",
      "KAHVI 500G                   4,99",
      "  KAMPANJA                  -1,00",
      "--------------------------------",
      "YHTEENSÄ                     7,47",
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
  const coffee = r.product("KAHVI", "KAHVI 500G", {
    quantity: pcs(1),
    gross: 499,
    net: 399,
  });
  r.adjustment("KAMPANJA", "campaign", "KAMPANJA", -100, "line", [coffee]);
  r.print("total", "YHTEENSÄ", 747);
  return receiptFixture({
    id: "s-basic-campaign",
    covers: "Three single items and a campaign tied to the row above it",
    chain: "s-group",
    receipt: r,
    store: "S-market Esimerkki",
    purchasedAt: "2026-10-12T11:35:00.000Z",
    reconciliation: balanced(747),
  });
})();

export const sQuantityAfterPrice = (() => {
  const pages = [
    [
      "S-market Esimerkki",
      "Testikatu 1, 00100 Helsinki",
      "13.10.2026 18:02  Kassa 1  Kuitti 0188",
      "--------------------------------",
      "PAKASTEPIZZA 350G            5,98",
      "  2 KPL x 2,99",
      "KANANMUNA 10KPL              3,45",
      "KURKKU                       2,70",
      "  3 KPL x 0,90",
      "--------------------------------",
      "YHTEENSÄ                    12,13",
    ],
  ];
  const r = new Receipt(pages);
  r.product("PAKASTEPIZZA", "PAKASTEPIZZA 350G", {
    through: "2 KPL x 2,99",
    quantity: pcs(2),
    unitPrice: 299,
    gross: 598,
    net: 598,
  });
  r.product("KANANMUNA", "KANANMUNA 10KPL", {
    quantity: pcs(1),
    gross: 345,
    net: 345,
  });
  r.product("KURKKU", "KURKKU", {
    through: "3 KPL x 0,90",
    quantity: pcs(3),
    unitPrice: 90,
    gross: 270,
    net: 270,
  });
  r.print("total", "YHTEENSÄ", 1213);
  return receiptFixture({
    id: "s-quantity-after-price",
    covers:
      "A count printed after the line price, and a pack size that is not a count",
    chain: "s-group",
    receipt: r,
    store: "S-market Esimerkki",
    purchasedAt: "2026-10-13T15:02:00.000Z",
    reconciliation: balanced(1213),
  });
})();

export const sNormCampaign = (() => {
  const pages = [
    [
      "S-market Esimerkki",
      "Testikatu 1, 00100 Helsinki",
      "14.10.2026 12:10  Kassa 2  Kuitti 0231",
      "--------------------------------",
      "JUUSTO 400G                  2,99",
      "  NORM. 3,99",
      "SUKLAALEVY 200G              1,79",
      "  KAMPANJA                  -0,30",
      "  NORM. 1,99",
      "--------------------------------",
      "YHTEENSÄ                     4,48",
    ],
  ];
  const r = new Receipt(pages);
  r.product("JUUSTO", "JUUSTO 400G", {
    through: "NORM. 3,99",
    quantity: pcs(1),
    gross: 299,
    net: 299,
  });
  const chocolate = r.product("SUKLAALEVY", "SUKLAALEVY 200G", {
    through: "NORM. 1,99",
    quantity: pcs(1),
    gross: 179,
    net: 149,
  });
  r.adjustment("KAMPANJA", "campaign", "KAMPANJA", -30, "line", [chocolate]);
  r.print("total", "YHTEENSÄ", 448);
  return receiptFixture({
    id: "s-norm-campaign",
    covers:
      "NORM. reference prices that are informational and must not be added or subtracted",
    chain: "s-group",
    receipt: r,
    store: "S-market Esimerkki",
    purchasedAt: "2026-10-14T09:10:00.000Z",
    reconciliation: balanced(448),
  });
})();

export const sWeighedProduce = (() => {
  const pages = [
    [
      "S-market Esimerkki",
      "Testikatu 1, 00100 Helsinki",
      "15.10.2026 10:48  Kassa 5  Kuitti 0099",
      "--------------------------------",
      "BANAANI                      1,87",
      "  0,940 KG x 1,99 EUR/KG",
      "OMENA PUNAINEN               2,66",
      "  1,330 KG x 2,00 EUR/KG",
      "SIPULI KELTAINEN             0,89",
      "  0,445 KG x 2,00 EUR/KG",
      "--------------------------------",
      "YHTEENSÄ                     5,42",
    ],
  ];
  const r = new Receipt(pages);
  r.product("BANAANI", "BANAANI", {
    through: "0,940 KG",
    quantity: grams(940),
    unitPrice: 199,
    basis: "kg",
    gross: 187,
    net: 187,
  });
  r.product("OMENA PUNAINEN", "OMENA PUNAINEN", {
    through: "1,330 KG",
    quantity: grams(1330),
    unitPrice: 200,
    basis: "kg",
    gross: 266,
    net: 266,
  });
  r.product("SIPULI", "SIPULI KELTAINEN", {
    through: "0,445 KG",
    quantity: grams(445),
    unitPrice: 200,
    basis: "kg",
    gross: 89,
    net: 89,
  });
  r.print("total", "YHTEENSÄ", 542);
  return receiptFixture({
    id: "s-weighed-produce",
    covers: "Decimal kilogram weights and a per-kilogram unit price",
    chain: "s-group",
    receipt: r,
    store: "S-market Esimerkki",
    purchasedAt: "2026-10-15T07:48:00.000Z",
    reconciliation: balanced(542),
  });
})();

export const sMultipleMilk = (() => {
  const pages = [
    [
      "S-market Esimerkki",
      "Testikatu 1, 00100 Helsinki",
      "16.10.2026 17:20  Kassa 4  Kuitti 0360",
      "--------------------------------",
      "KEVYTMAITO 1L                1,19",
      "RASVATON MAITO 1L            1,29",
      "LAKTOOSITON KEVYTMAITO 1L    1,69",
      "KAURAJUOMA 1L                2,09",
      "KEVYTMAITO 1L                1,19",
      "--------------------------------",
      "YHTEENSÄ                     7,45",
    ],
  ];
  const r = new Receipt(pages);
  r.product("KEVYTMAITO 1L                1,19", "KEVYTMAITO 1L", {
    quantity: pcs(1),
    gross: 119,
    net: 119,
  });
  r.product("RASVATON MAITO", "RASVATON MAITO 1L", {
    quantity: pcs(1),
    gross: 129,
    net: 129,
  });
  r.product("LAKTOOSITON", "LAKTOOSITON KEVYTMAITO 1L", {
    quantity: pcs(1),
    gross: 169,
    net: 169,
  });
  r.product("KAURAJUOMA", "KAURAJUOMA 1L", {
    quantity: pcs(1),
    gross: 209,
    net: 209,
  });
  // The same product again further down is its own row, not a count of two.
  r.product("KEVYTMAITO 1L                1,19", "KEVYTMAITO 1L", {
    nth: 2,
    quantity: pcs(1),
    gross: 119,
    net: 119,
  });
  r.print("total", "YHTEENSÄ", 745);
  return receiptFixture({
    id: "s-multiple-milk",
    covers:
      "Several milk variants and a repeated row that stays two separate lines",
    chain: "s-group",
    receipt: r,
    store: "S-market Esimerkki",
    purchasedAt: "2026-10-16T14:20:00.000Z",
    reconciliation: balanced(745),
  });
})();

export const sFiveGroups = (() => {
  const pages = [
    [
      "S-market Esimerkki",
      "Testikatu 1, 00100 Helsinki",
      "17.10.2026 19:05  Kassa 2  Kuitti 0412",
      "--------------------------------",
      "KISSANRUOKA KANA 85G         4,45",
      "  5 KPL x 0,89",
      "KISSANRUOKA LOHI 85G         4,45",
      "  5 KPL x 0,89",
      "KISSANRUOKA NAUTA 85G        4,45",
      "  5 KPL x 0,89",
      "RYHMÄTARJOUS 3 x 5 KPL      -1,35",
      "--------------------------------",
      "YHTEENSÄ                    12,00",
    ],
  ];
  const r = new Receipt(pages);
  const ids = ["KANA", "LOHI", "NAUTA"].map((flavour) =>
    r.product(`KISSANRUOKA ${flavour}`, `KISSANRUOKA ${flavour} 85G`, {
      through: "5 KPL x 0,89",
      quantity: pcs(5),
      unitPrice: 89,
      gross: 445,
      // The offer is printed once for all three rows: no per-row paid price is stated.
      net: null,
    }),
  );
  r.adjustment(
    "RYHMÄTARJOUS",
    "campaign",
    "RYHMÄTARJOUS 3 x 5 KPL",
    -135,
    "group",
    ids,
  );
  r.print("total", "YHTEENSÄ", 1200);
  return receiptFixture({
    id: "s-five-groups",
    covers:
      "Three groups of five pouches under one group promotion with no per-row split",
    chain: "s-group",
    receipt: r,
    store: "S-market Esimerkki",
    purchasedAt: "2026-10-17T16:05:00.000Z",
    // The arithmetic of the printed receipt: 3 x 4,45 - 1,35 = 12,00.
    reconciliation: balanced(1200),
  });
})();

export const sDeposits = (() => {
  const pages = [
    [
      "S-market Esimerkki",
      "Testikatu 1, 00100 Helsinki",
      "18.10.2026 16:44  Kassa 1  Kuitti 0275",
      "--------------------------------",
      "LIMONADI 0,5L                4,40",
      "  4 KPL x 1,10",
      "PANTTI                       0,80",
      "  4 KPL x 0,20",
      "PULLOPANTTI PALAUTUS        -1,20",
      "--------------------------------",
      "PANTIT YHT                   0,80",
      "YHTEENSÄ                     4,00",
    ],
  ];
  const r = new Receipt(pages);
  r.product("LIMONADI", "LIMONADI 0,5L", {
    through: "4 KPL x 1,10",
    quantity: pcs(4),
    unitPrice: 110,
    gross: 440,
    net: 440,
  });
  r.product("PANTTI ", "PANTTI", {
    through: "4 KPL x 0,20",
    role: "deposit",
    quantity: pcs(4),
    unitPrice: 20,
    gross: 80,
    net: 80,
  });
  r.adjustment(
    "PULLOPANTTI PALAUTUS",
    "deposit-return",
    "PULLOPANTTI PALAUTUS",
    -120,
    "receipt",
    [],
  );
  r.print("deposits", "PANTIT YHT", 80);
  r.print("total", "YHTEENSÄ", 400);
  return receiptFixture({
    id: "s-deposits",
    covers: "A deposit charge, a deposit return and a printed deposit total",
    chain: "s-group",
    receipt: r,
    store: "S-market Esimerkki",
    purchasedAt: "2026-10-18T13:44:00.000Z",
    reconciliation: balanced(400),
  });
})();

export const sNonFoodSubtotals = (() => {
  const pages = [
    [
      "S-market Esimerkki",
      "Testikatu 1, 00100 Helsinki",
      "19.10.2026 11:30  Kassa 3  Kuitti 0301",
      "--------------------------------",
      "RUOKA",
      "VEHNÄLEIPÄ                   2,19",
      "JUUSTO 400G                  3,49",
      "MUUT TUOTTEET",
      "ASTIANPESUAINE 500ML         2,95",
      "KANTOKASSI                   0,30",
      "--------------------------------",
      "RUOKA YHT                    5,68",
      "MUUT YHT                     3,25",
      "YHTEENSÄ                     8,93",
    ],
  ];
  const r = new Receipt(pages);
  r.product("VEHNÄLEIPÄ", "VEHNÄLEIPÄ", {
    quantity: pcs(1),
    gross: 219,
    net: 219,
  });
  r.product("JUUSTO", "JUUSTO 400G", {
    quantity: pcs(1),
    gross: 349,
    net: 349,
  });
  r.product("ASTIANPESUAINE", "ASTIANPESUAINE 500ML", {
    role: "non-food",
    quantity: pcs(1),
    gross: 295,
    net: 295,
  });
  r.product("KANTOKASSI", "KANTOKASSI", {
    role: "non-food",
    quantity: pcs(1),
    gross: 30,
    net: 30,
  });
  r.print("food", "RUOKA YHT", 568);
  r.print("non-food", "MUUT YHT", 325);
  r.print("total", "YHTEENSÄ", 893);
  return receiptFixture({
    id: "s-non-food-subtotals",
    covers:
      "Section headers, non-food rows and printed food and non-food subtotals",
    chain: "s-group",
    receipt: r,
    store: "S-market Esimerkki",
    purchasedAt: "2026-10-19T08:30:00.000Z",
    reconciliation: balanced(893),
  });
})();

export const sMultiPage = (() => {
  const pages = [
    [
      "S-market Esimerkki",
      "Testikatu 1, 00100 Helsinki",
      "20.10.2026 20:15  Kassa 2  Kuitti 0455",
      "--------------------------------",
      "SPAGETTI 500G                1,39",
      "TOMAATTIMURSKA 400G          0,99",
      "RIISI 1KG                    2,49",
      "                  JATKUU SIVULLA 2",
    ],
    [
      "S-market Esimerkki        SIVU 2",
      "                   JATKUU EDELTÄ",
      "KAURAHIUTALE 1KG             1,79",
      "VOI 500G                     4,29",
      "  KAMPANJA                  -0,80",
      "--------------------------------",
      "YHTEENSÄ                    10,15",
    ],
  ];
  const r = new Receipt(pages);
  r.product("SPAGETTI", "SPAGETTI 500G", {
    quantity: pcs(1),
    gross: 139,
    net: 139,
  });
  r.product("TOMAATTIMURSKA", "TOMAATTIMURSKA 400G", {
    quantity: pcs(1),
    gross: 99,
    net: 99,
  });
  r.product("RIISI", "RIISI 1KG", { quantity: pcs(1), gross: 249, net: 249 });
  r.product("KAURAHIUTALE", "KAURAHIUTALE 1KG", {
    page: 2,
    quantity: pcs(1),
    gross: 179,
    net: 179,
  });
  const butter = r.product("VOI 500G", "VOI 500G", {
    page: 2,
    quantity: pcs(1),
    gross: 429,
    net: 349,
  });
  r.adjustment("KAMPANJA", "campaign", "KAMPANJA", -80, "line", [butter], 2);
  r.print("total", "YHTEENSÄ", 1015, 2);
  return receiptFixture({
    id: "s-multi-page",
    covers:
      "A receipt continued on a second page with repeated header text and a campaign there",
    chain: "s-group",
    receipt: r,
    store: "S-market Esimerkki",
    purchasedAt: "2026-10-20T17:15:00.000Z",
    reconciliation: balanced(1015),
  });
})();

export const sPrintedSubtotal = (() => {
  const pages = [
    [
      "S-market Esimerkki",
      "Testikatu 1, 00100 Helsinki",
      "21.10.2026 15:55  Kassa 4  Kuitti 0510",
      "--------------------------------",
      "NAKKIMAKKARA 300G            1,99",
      "PERUNA 2KG                   2,89",
      "VÄLISUMMA                    4,88",
      "PORKKANA 1KG                 1,49",
      "SIPULI 1KG                   1,29",
      "--------------------------------",
      "YHTEENSÄ                     7,66",
    ],
  ];
  const r = new Receipt(pages);
  r.product("NAKKIMAKKARA", "NAKKIMAKKARA 300G", {
    quantity: pcs(1),
    gross: 199,
    net: 199,
  });
  r.product("PERUNA", "PERUNA 2KG", { quantity: pcs(1), gross: 289, net: 289 });
  r.product("PORKKANA", "PORKKANA 1KG", {
    quantity: pcs(1),
    gross: 149,
    net: 149,
  });
  r.product("SIPULI", "SIPULI 1KG", { quantity: pcs(1), gross: 129, net: 129 });
  r.print("subtotal", "VÄLISUMMA", 488);
  r.print("total", "YHTEENSÄ", 766);
  return receiptFixture({
    id: "s-printed-subtotal",
    covers:
      "A running subtotal in the middle of the list that must not be counted as a row",
    chain: "s-group",
    receipt: r,
    store: "S-market Esimerkki",
    purchasedAt: "2026-10-21T12:55:00.000Z",
    reconciliation: balanced(766),
  });
})();

export const sGroupFixtures: ReceiptFixture[] = [
  sBasicCampaign,
  sQuantityAfterPrice,
  sNormCampaign,
  sWeighedProduce,
  sMultipleMilk,
  sFiveGroups,
  sDeposits,
  sNonFoodSubtotals,
  sMultiPage,
  sPrintedSubtotal,
];
