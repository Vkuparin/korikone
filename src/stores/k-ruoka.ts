import { z } from "zod";
import type {
  Cart,
  Product,
  StoreContext,
  Target,
  Unit,
} from "../domain/model";
import type { StoreProvider } from "./provider";
export type ToolCall = (
  name: string,
  args: Record<string, unknown>,
) => Promise<unknown>;
const productSchema = z.object({
  ean: z.string().min(1),
  name: z.string().min(1),
  price: z.number().nonnegative().nullish(),
  priceUnit: z.string().nullish(),
  priceIsApproximate: z.boolean(),
  isAvailable: z.boolean(),
});
const cartSchema = z.object({
  basketId: z.string().min(1),
  account: z.string().nullable().optional(),
  store: z.object({ id: z.string(), name: z.string() }),
  items: z.array(
    z.object({
      itemId: z.string(),
      ean: z.string(),
      name: z.string(),
      amount: z.number().nonnegative(),
      unit: z.string(),
    }),
  ),
});
export function packFromName(
  name: string,
): { amount: number; unit: Unit } | null {
  // A label is a suggestion only. The shopper explicitly confirms it when selecting.
  // Egg packs carry a size class and count, such as "M10" or "M/L15", often next to grams.
  const eggs = /muna|munia/i.test(name)
    ? name.match(/(?:^|\s)(?:XS|S|M|L|XL)(?:\/(?:S|M|L|XL))?(\d{1,2})(?=\s|$)/)
    : null;
  if (eggs) return { amount: Number(eggs[1]), unit: "pcs" };
  const matches = [
    ...name.matchAll(
      /(?:^|\s)(\d+(?:[.,]\d+)?)\s*(kg|g|ml|cl|dl|l|kpl)(?=\s|$)/gi,
    ),
  ];
  if (matches.length !== 1 || /\d\s*[x×]\s*\d/i.test(name)) return null;
  const value = Number(matches[0][1].replace(",", "."));
  const unit = matches[0][2].toLowerCase();
  const amount = Math.round(
    value *
      ({ kg: 1000, g: 1, ml: 1, cl: 10, dl: 100, l: 1000, kpl: 1 }[unit] ?? 0),
  );
  if (!Number.isSafeInteger(amount) || amount <= 0) return null;
  return {
    amount,
    unit: unit === "kg" || unit === "g" ? "g" : unit === "kpl" ? "pcs" : "ml",
  };
}
export class KRuokaProvider implements StoreProvider {
  id = "k-ruoka";
  capabilities = { catalogue: true, cart: true, orderHistory: false };
  constructor(private call: ToolCall) {}
  async searchStores(query: string): Promise<StoreContext[]> {
    const data = z
      .object({
        results: z.array(
          z.object({
            storeId: z.string().min(1),
            name: z.string(),
            location: z.string().nullish(),
            isWebStore: z.boolean(),
            hasPickup: z.boolean(),
            hasHomeDelivery: z.boolean(),
          }),
        ),
      })
      .parse(await this.call("search_stores", { query, limit: 20 }));
    return data.results
      .filter((s) => s.isWebStore && s.hasPickup)
      .map((s) => ({
        providerId: this.id,
        storeId: s.storeId,
        storeName: s.name + (s.location ? ` · ${s.location}` : ""),
        fulfillment: "pickup",
      }));
  }
  async searchProducts(
    context: StoreContext,
    query: string,
    ingredientId: string,
  ): Promise<Product[]> {
    const data = z.object({ results: z.array(productSchema) }).parse(
      await this.call("search_products", {
        store_id: context.storeId,
        query,
        limit: 20,
      }),
    );
    return data.results.map((p) => {
      const pack = packFromName(p.name);
      // Weight pricing and missing pack data remain unresolved; never assume a kg is a pack.
      const supported =
        !p.priceIsApproximate && p.priceUnit === "kpl" && pack !== null;
      return {
        id: p.ean,
        providerId: this.id,
        storeId: context.storeId,
        name: p.name,
        ingredientId,
        packAmount: pack?.amount ?? 0,
        unit: pack?.unit ?? "pcs",
        price: supported && p.price != null ? Math.round(p.price * 100) : null,
        available: p.isAvailable,
        deposit: 0,
        nativeUnit: "kpl",
        increment: 1,
        observedAt: new Date().toISOString(),
      };
    });
  }
  private async read(context: StoreContext) {
    const data = cartSchema.parse(
      await this.call("get_cart", { store_id: context.storeId }),
    );
    if (!data.account) throw new Error("loginRequired");
    if (data.store.id !== context.storeId) throw new Error("contextChanged");
    if (
      new Set(data.items.map((i) => i.ean)).size !== data.items.length ||
      data.items.some((i) => !i.ean)
    )
      throw new Error("unsupportedCart");
    return data;
  }
  async getCart(context: StoreContext): Promise<Cart> {
    const data = await this.read(context);
    return {
      accountId: data.account!,
      context,
      lines: data.items.map((i) => ({
        productId: i.ean,
        name: i.name,
        quantity: i.amount,
        unit: i.unit,
      })),
    };
  }
  async setQuantity(context: StoreContext, target: Target): Promise<void> {
    if (
      target.unit !== "kpl" ||
      !Number.isInteger(target.quantity) ||
      target.quantity <= 0 ||
      target.quantity > 100
    )
      throw new Error("unitMismatch");
    const data = await this.read(context);
    const item = data.items.find((i) => i.ean === target.productId);
    if (!target.accountId || data.account !== target.accountId)
      throw new Error("accountChanged");
    if ((item?.amount ?? 0) !== target.before) throw new Error("cartChanged");
    if (item && item.unit !== target.unit) throw new Error("unitMismatch");
    if (item)
      await this.call("update_cart_item", {
        store_id: context.storeId,
        item_id: item.itemId,
        quantity: target.quantity,
        unit: target.unit,
      });
    else
      await this.call("add_to_cart", {
        store_id: context.storeId,
        ean: target.productId,
        quantity: target.quantity,
        unit: target.unit,
        allow_substitutes: false,
      });
  }
}
