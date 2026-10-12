import {
  Receipt,
  balanced,
  grams,
  pcs,
  receiptFixture,
  type ReceiptFixture,
} from "./author";

/**
 * Invented receipts in the layout of a supermarket of the K-group: a name row without a price, an
 * indented row after it with `count X unit price` and the line total, a receipt-level K-Plussa
 * row, and `Yhteensä` closing the list. Nothing here is a real receipt. The accounting convention
 * is the one in s-group.ts.
 */

export const kReceiptDiscount = (() => {
  const pages = [
    [
      "K-Market Esimerkki",
      "Näytekuja 2, 00200 Helsinki",
      "13.10.2026 09:12  Kuitti 88  Kassa 1",
      "KEVYTMAITO 1L                 1,19",
      "HAPANLEIPÄ                    3,29",
      "LUOMUKANANMUNA 10 KPL         3,89",
      "K-Plussa-etu                 -0,45",
      "Yhteensä                      7,92",
    ],
  ];
  const r = new Receipt(pages);
  r.product("KEVYTMAITO", "KEVYTMAITO 1L", {
    quantity: pcs(1),
    gross: 119,
    net: 119,
  });
  r.product("HAPANLEIPÄ", "HAPANLEIPÄ", {
    quantity: pcs(1),
    gross: 329,
    net: 329,
  });
  r.product("LUOMUKANANMUNA", "LUOMUKANANMUNA 10 KPL", {
    quantity: pcs(1),
    gross: 389,
    net: 389,
  });
  // The loyalty row is tied to no product: it belongs to the whole receipt.
  r.adjustment("K-Plussa-etu", "loyalty", "K-Plussa-etu", -45, "receipt", []);
  r.print("total", "Yhteensä", 792);
  return receiptFixture({
    id: "k-receipt-discount",
    covers:
      "A loyalty discount that belongs to the whole receipt, not to a row",
    chain: "k-group",
    receipt: r,
    store: "K-Market Esimerkki",
    purchasedAt: "2026-10-13T06:12:00.000Z",
    reconciliation: balanced(792),
  });
})();

export const kQuantityBeforePrice = (() => {
  const pages = [
    [
      "K-Market Esimerkki",
      "Näytekuja 2, 00200 Helsinki",
      "14.10.2026 17:40  Kuitti 131  Kassa 2",
      "PAKASTEPIZZA 350G",
      "   2 KPL  X  2,99            5,98",
      "KURKKU",
      "   3 KPL  X  0,90            2,70",
      "Yhteensä                      8,68",
    ],
  ];
  const r = new Receipt(pages);
  r.product("PAKASTEPIZZA", "PAKASTEPIZZA 350G", {
    through: "2 KPL  X  2,99",
    quantity: pcs(2),
    unitPrice: 299,
    gross: 598,
    net: 598,
  });
  r.product("KURKKU", "KURKKU", {
    through: "3 KPL  X  0,90",
    quantity: pcs(3),
    unitPrice: 90,
    gross: 270,
    net: 270,
  });
  r.print("total", "Yhteensä", 868);
  return receiptFixture({
    id: "k-quantity-before-price",
    covers: "A name row followed by a count, unit price and line total",
    chain: "k-group",
    receipt: r,
    store: "K-Market Esimerkki",
    purchasedAt: "2026-10-14T14:40:00.000Z",
    reconciliation: balanced(868),
  });
})();

export const kWeighed = (() => {
  const pages = [
    [
      "K-Market Esimerkki",
      "Näytekuja 2, 00200 Helsinki",
      "15.10.2026 08:25  Kuitti 17  Kassa 1",
      "BANAANI",
      "   0,820 KG  X  1,99 /KG      1,63",
      "PERUNA VARHAINEN",
      "   2,140 KG  X  1,49 /KG      3,19",
      "Yhteensä                      4,82",
    ],
  ];
  const r = new Receipt(pages);
  r.product("BANAANI", "BANAANI", {
    through: "0,820 KG",
    quantity: grams(820),
    unitPrice: 199,
    basis: "kg",
    gross: 163,
    net: 163,
  });
  r.product("PERUNA VARHAINEN", "PERUNA VARHAINEN", {
    through: "2,140 KG",
    quantity: grams(2140),
    unitPrice: 149,
    basis: "kg",
    gross: 319,
    net: 319,
  });
  r.print("total", "Yhteensä", 482);
  return receiptFixture({
    id: "k-weighed",
    covers: "Weighed produce with the kilogram price after a name row",
    chain: "k-group",
    receipt: r,
    store: "K-Market Esimerkki",
    purchasedAt: "2026-10-15T05:25:00.000Z",
    reconciliation: balanced(482),
  });
})();

export const kGroupPromotion = (() => {
  const pages = [
    [
      "K-Market Esimerkki",
      "Näytekuja 2, 00200 Helsinki",
      "16.10.2026 12:03  Kuitti 54  Kassa 3",
      "JOGURTTI LUONNON 150G         0,89",
      "JOGURTTI MANSIKKA 150G        0,89",
      "JOGURTTI VADELMA 150G         0,89",
      "RYHMÄETU 3 KPL 2,00          -0,67",
      "Yhteensä                      2,00",
    ],
  ];
  const r = new Receipt(pages);
  const ids = ["LUONNON", "MANSIKKA", "VADELMA"].map((flavour) =>
    r.product(`JOGURTTI ${flavour}`, `JOGURTTI ${flavour} 150G`, {
      quantity: pcs(1),
      gross: 89,
      net: null,
    }),
  );
  r.adjustment(
    "RYHMÄETU",
    "campaign",
    "RYHMÄETU 3 KPL 2,00",
    -67,
    "group",
    ids,
  );
  r.print("total", "Yhteensä", 200);
  return receiptFixture({
    id: "k-group-promotion",
    covers: "Three different rows under a 3 for 2,00 offer printed once",
    chain: "k-group",
    receipt: r,
    store: "K-Market Esimerkki",
    purchasedAt: "2026-10-16T09:03:00.000Z",
    // 3 x 0,89 - 0,67 = 2,00.
    reconciliation: balanced(200),
  });
})();

export const kDepositNoSection = (() => {
  const pages = [
    [
      "K-Market Esimerkki",
      "Näytekuja 2, 00200 Helsinki",
      "17.10.2026 15:18  Kuitti 212  Kassa 1",
      "LIMSA 1,5L                    2,39",
      "   PANTTI                     0,40",
      "TALOUSPAPERI 4 RLL            3,50",
      "PULLOPALAUTUS                -0,40",
      "Yhteensä                      5,89",
    ],
  ];
  const r = new Receipt(pages);
  r.product("LIMSA", "LIMSA 1,5L", { quantity: pcs(1), gross: 239, net: 239 });
  r.product("   PANTTI", "PANTTI", {
    role: "deposit",
    quantity: pcs(1),
    gross: 40,
    net: 40,
  });
  // No section or printed breakdown says this is not food, so the source states nothing.
  r.product("TALOUSPAPERI", "TALOUSPAPERI 4 RLL", {
    quantity: pcs(1),
    gross: 350,
    net: 350,
  });
  r.adjustment(
    "PULLOPALAUTUS",
    "deposit-return",
    "PULLOPALAUTUS",
    -40,
    "receipt",
    [],
  );
  r.print("total", "Yhteensä", 589);
  return receiptFixture({
    id: "k-deposit-no-section",
    covers:
      "A deposit and a household item with no non-food marker; no breakdown is invented",
    chain: "k-group",
    receipt: r,
    store: "K-Market Esimerkki",
    purchasedAt: "2026-10-17T12:18:00.000Z",
    reconciliation: balanced(589),
  });
})();

export const kGroupFixtures: ReceiptFixture[] = [
  kReceiptDiscount,
  kQuantityBeforePrice,
  kWeighed,
  kGroupPromotion,
  kDepositNoSection,
];
