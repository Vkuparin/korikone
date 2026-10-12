import type { Cart, Product, StoreContext, Target } from "../domain/model";
import type { StoreProvider } from "./provider";
import type { RetailerOrder } from "../domain/order-evidence";
import { retailerEvidence } from "./candidates";
import { pizzaPackageContent } from "../domain/package-content";
import { SKaupatProvider } from "./s-kaupat";
import { setTimeout as delay } from "node:timers/promises";
// The optional last entry is a search word the store also answers with this product.
const catalogue: [
  string,
  string,
  number,
  "g" | "ml" | "pcs",
  number | null,
  string?,
][] = [
  ["pasta", "Pasta 500 g", 500, "g", 129],
  ["tomato", "Tomaattimurska 400 g", 400, "g", 99],
  ["potato", "Peruna 1 kg", 1000, "g", 199],
  ["carrot", "Porkkana 1 kg", 1000, "g", 149],
  ["cream", "Ruokakerma 2 dl", 200, "ml", 109],
  ["whipping-cream", "Kuohukerma 200 ml", 200, "ml", 199],
  ["weighed-apple", "Omena", 0, "g", 249],
  // Synthetic kilo-only examples: no verified piece/pack ordering metadata.
  ["weighed-banana", "Banaani irtomyynti", 0, "g", 169],
  ["weighed-mince", "Naudan jauheliha irtomyynti", 0, "g", 999],
  ["loose-banana", "Banaani", 0, "g", 40],
  ["oats", "Kaurahiutale 1 kg", 1000, "g", 169],
  ["milk", "Maito 1 l", 1000, "ml", 119],
  ["coffee", "Kahvi suodatinjauhatus 500 g", 500, "g", 599],
  ["pizza", "Pakastepizza 350 g", 350, "g", 249],
  ["sausage", "Nakki 400 g", 400, "g", 299],
  ["chicken", "Broilerin fileesuikale 400 g", 400, "g", 449],
  ["yoghurt", "Jogurtti 1 kg", 1000, "g", 199],
  ["banana", "Banaani 6 kpl", 6, "pcs", 199],
  ["chocolate", "Suklaa 200 g", 200, "g", 249],
  // Names and prices seen at S-market Herttoniemi on 9 October 2026, with the
  // look-alikes a loose store search returns beside the ingredient itself.
  ["macaroni", "Myllyn Paras Makaroni 400g", 400, "g", 55],
  ["macaroni-meal", "Kokkikartano Lihamakaronilaatikko 300g", 300, "g", 409],
  ["mince", "Kotimaista sika-nauta jauheliha 23 % 400 g", 400, "g", 385],
  ["mince-chicken", "Kotimaista kanan jauheliha 4% 400 g", 400, "g", 329],
  ["onion", "Kotimaista sipuli 500 g", 500, "g", 89],
  ["garlic", "Coop valkosipuli 100 g", 100, "g", 89],
  ["pepper", "Meira Mustapippuri jauhettu 25g", 25, "g", 124],
  [
    "lemon-pepper",
    "Santa Maria 33G Sitruunapippuri",
    33,
    "g",
    105,
    "mustapippuri",
  ],
  // The shop does not state the pack size, so the shopper confirms it.
  ["mince-unlabelled", "Luomujauheliha", 0, "pcs", 299],
  ["salt", "JOZO 125g suola jodioitu sirotin", 125, "g", 99],
  ["egg", "Kotimaista vapaan kanan munat M10", 10, "pcs", 255, "kananmuna"],
  ["egg-slicer", "House kananmunaleikkuri", 1, "pcs", 550],
  [
    "layout-long",
    "Pitkän tuotenimen paikallinen testituote, jonka koko nimi ja pakkaustiedot pitää voida lukea myös kapeassa ostoslistassa 500 g",
    500,
    "g",
    219,
  ],
  [
    "layout-unknown-pack",
    "Testituote ilman ilmoitettua pakkauskokoa",
    0,
    "g",
    199,
  ],
  [
    "layout-unknown-price",
    "Testituote ilman ilmoitettua hintaa 500 g",
    500,
    "g",
    null,
  ],
];
// The K-Ruoka fixture differs from the S-kaupat one so a comparison has something to show:
// its mince costs more and it does not stock the salt.
const kRuokaFixture: Record<string, number | null> = { mince: 90, salt: null };
/** Synthetic orders: one finished, one being picked, one cancelled and one with unreadable rows. */
export const demoOrders: RetailerOrder[] = [
  {
    orderId: "fixture-order-1",
    state: "completed",
    storeName: "S-kaupat · Helsinki (fixture)",
    date: "2026-10-02",
    total: 1267,
    items: [
      { name: "Kevytmaito 1 l", quantity: 2, unit: "pcs", unitPrice: 119 },
      { name: "Banaani", quantity: 0.85, unit: "kg", unitPrice: 169 },
      {
        name: "Kahvi suodatinjauhatus 500 g",
        quantity: 1,
        unit: "pcs",
        unitPrice: 599,
      },
    ],
  },
  {
    orderId: "fixture-order-2",
    state: "pending",
    storeName: "S-kaupat · Helsinki (fixture)",
    date: "2026-10-14",
    total: 2310,
    items: null,
  },
  {
    orderId: "fixture-order-3",
    state: "cancelled",
    storeName: "S-kaupat · Helsinki (fixture)",
    date: "2026-09-20",
    total: 1890,
    items: null,
  },
  {
    orderId: "fixture-order-4",
    state: "completed",
    storeName: null,
    date: null,
    total: null,
    items: [{ name: null, quantity: 1.5, unit: "pcs", unitPrice: null }],
  },
];
/**
 * A deterministic weekly history for the S-kaupat stand-ins (development scenario `history`):
 * dates are counted back from `now`, so the last eight weeks always hold the same pattern.
 *
 * - Kevytmaito 1 l, two pieces, every week for six weeks: a recurring grocery with a typical
 *   quantity of two pieces.
 * - Banaani, weighed, in five of the six weeks with different weights: a recurring grocery whose
 *   quantity is comparable across weights.
 * - Kahvi suodatinjauhatus 500 g in two weeks only: two visits establish no cadence.
 * - A week-three order that was cancelled and one with unreadable rows: never spending.
 */
export function demoWeeklyOrders(now: Date): RetailerOrder[] {
  const day = (weeksAgo: number) =>
    new Date(now.getTime() - weeksAgo * 7 * 86_400_000)
      .toISOString()
      .slice(0, 10);
  const weights: Record<number, number> = {
    1: 0.9,
    2: 1.1,
    3: 1,
    5: 0.95,
    6: 1.05,
  };
  const orders: RetailerOrder[] = [];
  for (let week = 1; week <= 6; week++) {
    const items: NonNullable<RetailerOrder["items"]> = [
      { name: "Kevytmaito 1 l", quantity: 2, unit: "pcs", unitPrice: 119 },
    ];
    if (weights[week])
      items.push({
        name: "Banaani",
        quantity: weights[week],
        unit: "kg",
        unitPrice: 169,
      });
    if (week === 2 || week === 5)
      items.push({
        name: "Kahvi suodatinjauhatus 500 g",
        quantity: 1,
        unit: "pcs",
        unitPrice: 599,
      });
    orders.push({
      orderId: `fixture-weekly-${week}`,
      state: "completed",
      storeName: "S-kaupat · Helsinki (fixture)",
      date: day(week),
      total: items.reduce(
        (sum, item) =>
          sum + Math.round((item.quantity ?? 0) * (item.unitPrice ?? 0)),
        0,
      ),
      items,
    });
  }
  orders.push({
    orderId: "fixture-weekly-cancelled",
    state: "cancelled",
    storeName: "S-kaupat · Helsinki (fixture)",
    date: day(3),
    total: 3100,
    items: null,
  });
  orders.push({
    orderId: "fixture-weekly-unreadable",
    state: "completed",
    storeName: "S-kaupat · Helsinki (fixture)",
    date: day(4),
    total: 1450,
    items: null,
  });
  return orders;
}
export class DemoProvider implements StoreProvider {
  offerScenario: "success" | "empty" | "unsupported" | "personal" = "success";
  capabilities = {
    catalogue: true,
    cart: true,
    orderHistory: false,
    offers: { public: true, personal: false },
  };
  async readOffers(
    context: StoreContext,
  ): Promise<import("../domain/offers").OfferSourceResult> {
    if (this.offerScenario === "unsupported")
      return {
        providerId: this.id,
        storeId: context.storeId,
        status: "unsupported",
        reason: "no-discovery-source",
      };
    if (this.offerScenario === "empty")
      return {
        providerId: this.id,
        storeId: context.storeId,
        status: "ready",
        accountKey: null,
        offers: [],
        truncated: false,
      };
    return {
      providerId: this.id,
      storeId: context.storeId,
      status: "ready",
      accountKey:
        this.offerScenario === "personal" ? "k-ruoka:0123456789abcdef" : null,
      truncated: false,
      offers: [
        {
          id: "synthetic-tomato-offer",
          kind: this.offerScenario === "personal" ? "personal" : "public",
          title: "Synteettinen tomaattitarjous",
          products: [
            {
              id: "2000000000011",
              name: "Tomaattimurska 400 g",
              available: true,
            },
          ],
          price: {
            amount: this.offerScenario === "personal" ? 199 : 79,
            basis: "pcs",
            quantity: this.offerScenario === "personal" ? 3 : 1,
            unitLabel: this.offerScenario === "personal" ? "3 kpl" : "kpl",
          },
          normalPrice: null,
          validUntil: "2030-01-01",
          remainingRedemptions: this.offerScenario === "personal" ? 2 : null,
          eligibility:
            this.offerScenario === "personal" ? "conditional" : "eligible",
          conditions:
            this.offerScenario === "personal"
              ? ["plussa-required", "activation-unverified"]
              : [],
        },
      ],
    };
  }
  orderReads = 0;
  /** Development scenario `history`: adds the weekly sequence to the order history. */
  weeklyHistory = false;
  /** Synthetic order history for the S-kaupat stand-ins; K-Ruoka has no established order read. */
  orderHistory?: (limit: number) => Promise<RetailerOrder[]>;
  carts = new Map<string, Cart>();
  failAfter: number | null = null;
  priceChange = false;
  writes = 0;
  searchRequests = 0;
  failSearch = false;
  failContext = false;
  refusePieces = false;
  pieceReadbackAdjustment = 0;
  pieceWeightChange = false;
  constructor(
    public id: string,
    private save?: () => void,
  ) {
    if (["s-kaupat", "demo-s"].includes(id)) {
      this.capabilities = { ...this.capabilities, orderHistory: true };
      this.orderHistory = async (limit) => {
        this.orderReads++;
        if (this.failSearch) throw new Error("storeBusy");
        return structuredClone(
          this.weeklyHistory
            ? [...demoOrders, ...demoWeeklyOrders(new Date())]
            : demoOrders,
        ).slice(0, limit);
      };
    }
  }
  async searchStores(query = ""): Promise<StoreContext[]> {
    if (/search-error/i.test(query)) throw new Error("storeBusy");
    if (/no-results/i.test(query)) return [];
    return [
      {
        providerId: this.id,
        storeId: /alternate/i.test(query)
          ? "demo-alternate"
          : /pickup-only/i.test(query)
            ? "demo-pickup-only"
            : "demo-helsinki",
        storeName: `${["demo-k", "k-ruoka"].includes(this.id) ? "K-Ruoka" : "S-kaupat"} · ${/alternate/i.test(query) ? "Alternate" : /pickup-only/i.test(query) ? "Pickup only" : "Helsinki"} (${this.id.startsWith("demo-") ? "demo" : "fixture"})`,
        fulfillment: "pickup",
      },
    ];
  }
  async fulfillments(
    context: StoreContext,
  ): Promise<StoreContext["fulfillment"][]> {
    if (this.failContext) throw new Error("storeBusy");
    return context.storeId === "demo-pickup-only"
      ? ["pickup"]
      : ["pickup", "delivery"];
  }
  async searchProducts(
    context: StoreContext,
    query: string,
    ingredientId: string,
  ): Promise<Product[]> {
    this.searchRequests++;
    // Opt-in local fixture keeps the real catalogue phase observable in UI checks.
    if (context.storeId === "demo-delayed-search") await delay(1200);
    if (this.failSearch) throw new Error("storeBusy");
    if (this.id === "s-kaupat" && context.storeId === "demo-campaign") {
      if (ingredientId !== "milk") return [];
      // Opt-in synthetic worker response exercises the same campaign normalization as production.
      const provider = new SKaupatProvider(async (tool) =>
        tool === "search_products"
          ? {
              products: [
                {
                  id: "campaign-milk",
                  name: "Kevytmaito 1 l",
                  price: 1.09,
                  regularPrice: 1.49,
                  campaignPrice: 1.09,
                  campaignValidUntil: null,
                  lowest30DayPrice: 0.99,
                  quantityUnit: "KPL",
                  priceBasis: "per_item",
                  packSize: "1 l",
                  approximatePrice: false,
                },
              ],
            }
          : { items: [{ productId: "campaign-milk", status: "ok" }] },
      );
      return provider.searchProducts(context, query, ingredientId);
    }
    const adjust = this.id === "k-ruoka" ? kRuokaFixture : {};
    return catalogue
      .filter(
        (p) =>
          !["weighed-banana", "weighed-mince"].includes(p[0]) ||
          p[0] === ingredientId ||
          query.toLocaleLowerCase("fi").includes("irtomyynti"),
      )
      .filter((p) => adjust[p[0]] !== null)
      .filter(
        (p) =>
          p[0] === ingredientId ||
          p[1]
            .toLocaleLowerCase("fi")
            .includes(query.toLocaleLowerCase("fi")) ||
          p[5] === query.toLocaleLowerCase("fi"),
      )
      .flatMap(([id, name, packAmount, unit, price]) => [
        {
          id,
          providerId: this.id,
          storeId: context.storeId,
          ingredientId,
          name,
          packAmount,
          unit,
          packageContent: pizzaPackageContent(name),
          price:
            price === null
              ? null
              : price +
                (["demo-s", "s-kaupat"].includes(this.id) ? 10 : 0) +
                (adjust[id] ?? 0) +
                (this.priceChange ? 20 : 0),
          available: id !== "carrot",
          deposit: 0,
          nativeUnit: "kpl",
          increment: 1,
          observedAt: new Date().toISOString(),
        },
        ...(id === "carrot"
          ? [
              {
                id: "carrot-alt",
                providerId: this.id,
                storeId: context.storeId,
                ingredientId,
                name: "Porkkana 500 g",
                packAmount: 500,
                unit,
                price: 109,
                available: true,
                deposit: 0,
                nativeUnit: "kpl",
                increment: 1,
                observedAt: new Date().toISOString(),
              },
            ]
          : []),
      ])
      .map((p) => ({
        ...p,
        evidence: retailerEvidence(p.name),
        ...(["weighed-apple", "weighed-banana", "weighed-mince"].includes(p.id)
          ? {
              price: null,
              nativeUnit: "kg",
              increment: 0,
              cataloguePricing: {
                amount: p.price,
                unit: "kg",
                basis: "per_weight",
                approximate: true,
                deposit: 0,
              },
            }
          : {}),
        ...(p.id === "loose-banana"
          ? {
              price: null,
              cataloguePricing: {
                amount: p.price,
                unit: "kpl",
                basis: "per_item",
                approximate: true,
                deposit: 0,
              },
              pieceOrdering: {
                unit: "kpl" as const,
                increment: 1 as const,
                estimatedWeightGrams:
                  (["demo-s", "s-kaupat"].includes(this.id) ? 163 : 175) +
                  (this.pieceWeightChange ? 5 : 0),
              },
            }
          : {}),
      }));
  }
  async pickupFee() {
    // Only the S-kaupat fixture reports fees, as only the real S-kaupat worker does.
    return this.id === "s-kaupat" ? { min: 390, max: 590 } : null;
  }
  async getCart(context: StoreContext): Promise<Cart> {
    const key = JSON.stringify(context);
    if (!this.carts.has(key))
      this.carts.set(key, {
        accountId: "demo-household",
        accountName: "Testi",
        context,
        lines: [
          { productId: "bread", quantity: 1, unit: "kpl", name: "Leipä" },
          { productId: "pasta", quantity: 1, unit: "kpl", name: "Pasta 500 g" },
        ],
      });
    return structuredClone(this.carts.get(key)!);
  }
  async setQuantity(context: StoreContext, target: Target): Promise<void> {
    if (
      ["weighed-apple", "weighed-banana", "weighed-mince"].includes(
        target.productId,
      )
    )
      throw new Error("unitMismatch");
    if (target.productId === "loose-banana" && this.refusePieces)
      throw new Error("unitMismatch");
    const cart = await this.getCart(context);
    const existing = cart.lines.find((l) => l.productId === target.productId);
    if (existing) existing.quantity = target.quantity;
    else
      cart.lines.push({
        productId: target.productId,
        quantity: target.quantity,
        unit: target.unit,
        name: target.name,
      });
    if (target.productId === "loose-banana")
      cart.lines.find(
        (line) => line.productId === target.productId,
      )!.quantity += this.pieceReadbackAdjustment;
    this.carts.set(JSON.stringify(context), cart);
    this.writes++;
    this.save?.();
    if (this.failAfter !== null && this.writes >= this.failAfter) {
      this.failAfter = null;
      throw new Error("interrupted");
    }
  }
}
