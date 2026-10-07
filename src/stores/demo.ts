import type { Cart, Product, StoreContext, Target } from "../domain/model";
import type { StoreProvider } from "./provider";
const catalogue: [string, string, number, "g" | "ml" | "pcs", number][] = [
  ["pasta", "Pasta 500 g", 500, "g", 129],
  ["tomato", "Tomaattimurska 400 g", 400, "g", 99],
  ["potato", "Peruna 1 kg", 1000, "g", 199],
  ["carrot", "Porkkana 1 kg", 1000, "g", 149],
  ["cream", "Ruokakerma 2 dl", 200, "ml", 109],
  ["oats", "Kaurahiutale 1 kg", 1000, "g", 169],
  ["milk", "Maito 1 l", 1000, "ml", 119],
  ["coffee", "Kahvi 500 g", 500, "g", 599],
];
export class DemoProvider implements StoreProvider {
  capabilities = { catalogue: true, cart: true, orderHistory: false };
  carts = new Map<string, Cart>();
  failAfter: number | null = null;
  priceChange = false;
  writes = 0;
  constructor(
    public id: string,
    private save?: () => void,
  ) {}
  async searchStores(): Promise<StoreContext[]> {
    return [
      {
        providerId: this.id,
        storeId: "demo-helsinki",
        storeName: `${this.id === "demo-k" ? "K-Ruoka" : "S-kaupat"} · Helsinki (demo)`,
        fulfillment: "pickup",
      },
    ];
  }
  async searchProducts(
    context: StoreContext,
    _query: string,
    ingredientId: string,
  ): Promise<Product[]> {
    return catalogue
      .filter((p) => p[0] === ingredientId)
      .flatMap(([id, name, packAmount, unit, price]) => [
        {
          id,
          providerId: this.id,
          storeId: context.storeId,
          ingredientId: id,
          name,
          packAmount,
          unit,
          price:
            price +
            (this.id === "demo-s" ? 10 : 0) +
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
                ingredientId: id,
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
      ]);
  }
  async getCart(context: StoreContext): Promise<Cart> {
    const key = JSON.stringify(context);
    if (!this.carts.has(key))
      this.carts.set(key, {
        accountId: "demo-household",
        context,
        lines: [
          { productId: "bread", quantity: 1, unit: "kpl", name: "Leipä" },
          { productId: "pasta", quantity: 1, unit: "kpl", name: "Pasta 500 g" },
        ],
      });
    return structuredClone(this.carts.get(key)!);
  }
  async setQuantity(context: StoreContext, target: Target): Promise<void> {
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
    this.carts.set(JSON.stringify(context), cart);
    this.writes++;
    this.save?.();
    if (this.failAfter !== null && this.writes >= this.failAfter) {
      this.failAfter = null;
      throw new Error("interrupted");
    }
  }
}
