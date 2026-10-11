import type { Cart, Product, StoreContext, Target } from "../domain/model";
import type { StoreProvider } from "./provider";
import { retailerEvidence } from "./candidates";
import { SKaupatProvider } from "./s-kaupat";
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
export class DemoProvider implements StoreProvider {
  capabilities = { catalogue: true, cart: true, orderHistory: false };
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
  ) {}
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
