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
}
export class ProviderRegistry {
  private providers = new Map<string, StoreProvider>();
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
