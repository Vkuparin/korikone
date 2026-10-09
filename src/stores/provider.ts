import type { Cart, Product, StoreContext, Target } from "../domain/model";
export interface StoreProvider {
  id: string;
  capabilities: { catalogue: boolean; cart: boolean; orderHistory: boolean };
  searchStores(query: string): Promise<StoreContext[]>;
  searchProducts(
    context: StoreContext,
    query: string,
    ingredientId: string,
  ): Promise<Product[]>;
  getCart(context: StoreContext): Promise<Cart>;
  setQuantity(context: StoreContext, target: Target): Promise<void>;
  /** Lowest and highest pickup fee at the store, in cents, without choosing a time. */
  pickupFee?(context: StoreContext): Promise<FeeRange | null>;
}
export type FeeRange = { min: number; max: number };
/** Real retailers; every other provider is sample data. */
export const liveProviders = ["k-ruoka", "s-kaupat"];
export const isLive = (providerId: string) =>
  liveProviders.includes(providerId);
export class ProviderRegistry {
  private providers = new Map<string, StoreProvider>();
  all() {
    return [...this.providers.values()];
  }
  register(provider: StoreProvider) {
    if (this.providers.has(provider.id)) throw new Error("duplicateProvider");
    this.providers.set(provider.id, provider);
  }
  get(id: string) {
    const provider = this.providers.get(id);
    if (!provider) throw new Error("unsupported");
    return provider;
  }
}
