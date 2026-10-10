import { Service, type Storage } from "../../../src/application/service";
import { KRuokaProvider, type ToolCall } from "../../../src/stores/k-ruoka";
import { SKaupatProvider } from "../../../src/stores/s-kaupat";
import type { BaselineProduct } from "../matching-baseline";
import type { Product } from "../../../src/domain/model";

export type FixtureChain = "k-ruoka" | "s-kaupat";
/** Synthetic external boundaries shared by the released audit and expanded evaluator. */
export async function createFixtureService(
  chain: FixtureChain,
  catalogue: Record<string, BaselineProduct[]>,
  failure?: "search-error" | "malformed",
) {
  const entries = new Map<string, unknown>();
  const tools: string[] = [];
  const normalized = new Map<string, Product[]>();
  const all = Object.values(catalogue).flat();
  const call: ToolCall = async (name, args) => {
    tools.push(name);
    if (name === "search_products") {
      if (failure === "search-error") throw new Error("storeUnavailable");
      const products = catalogue[String(args.query)] ?? catalogue["*"] ?? [];
      const price = (p: BaselineProduct) =>
        failure === "malformed" ? "unknown" : p.price;
      return chain === "k-ruoka"
        ? {
            results: products.map((p) => ({
              ean: p.id,
              name: p.name,
              price: price(p),
              priceUnit: p.weighed ? "kg" : "kpl",
              priceIsApproximate: !!p.weighed,
              isAvailable: p.available !== false,
            })),
          }
        : {
            products: products.map((p) => ({
              id: p.id,
              name: p.name,
              price: price(p),
              depositPrice: null,
              approximatePrice: !!p.weighed,
              priceBasis: p.weighed ? "per_kg" : "per_item",
              packSize: null,
              quantityUnit: "KPL",
            })),
          };
    }
    if (name === "check_basket")
      return {
        items: all
          .filter(
            (p, index) =>
              all.findIndex((other) => other.id === p.id) === index &&
              (args.items as { productId: string }[]).some(
                (item) => item.productId === p.id,
              ),
          )
          .map((p) => ({
            productId: p.id,
            status: p.available === false ? "unavailable" : "ok",
          })),
      };
    if (name === "get_delivery_options") return {};
    throw new Error(`Unexpected boundary call: ${name}`);
  };
  const storage: Storage = {
    get: async (key) => structuredClone(entries.get(key)),
    set: async (key, value) => {
      entries.set(key, structuredClone(value));
    },
  };
  const service = new Service(storage);
  service.developmentMode = true;
  const adapter =
    chain === "k-ruoka" ? new KRuokaProvider(call) : new SKaupatProvider(call);
  const search = adapter.searchProducts.bind(adapter);
  adapter.searchProducts = async (context, query, ingredientId) => {
    const products = await search(context, query, ingredientId);
    const merged = new Map(
      (normalized.get(ingredientId) ?? []).map((p) => [p.id, p]),
    );
    for (const product of products)
      merged.set(product.id, structuredClone(product));
    normalized.set(ingredientId, [...merged.values()]);
    return products;
  };
  service.registry.register(adapter);
  await service.init();
  await service.save({
    ...service.state,
    staples: [],
    context: {
      providerId: chain,
      storeId: "synthetic-store",
      storeName: "Synthetic store",
      fulfillment: "pickup",
    },
  });
  return { service, tools, normalized, storage };
}
