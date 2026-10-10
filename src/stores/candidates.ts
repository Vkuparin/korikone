import type { Category } from "../domain/categories";
import { foodNameFacts } from "../domain/food-names";
import type { Product, Requirement, StoreContext } from "../domain/model";
import { relevant } from "../domain/planner";
import {
  productEvidenceSchema,
  type ProductEvidence,
} from "../domain/product-evidence";
import type { StoreProvider } from "./provider";

export const MAX_SEARCH_QUERIES = 3;
export const MAX_SEARCH_RESULTS = 20;
export const MAX_CANDIDATES = MAX_SEARCH_QUERIES * MAX_SEARCH_RESULTS;

/** Recognized label claims retain the exact retailer name; missing facts stay unknown. */
export function retailerEvidence(
  name: string,
  retailerCategory: string | null = null,
  labels: string[] = [],
): ProductEvidence {
  return productEvidenceSchema.parse({
    source: "retailer-name",
    quote: name,
    ...foodNameFacts(name),
    retailerCategory,
    labels,
  });
}
const aliases: Record<Category, readonly string[]> = {
  milk: ["maito", "kevytmaito"],
  bread: ["leipä", "ruisleipä"],
  eggs: ["kananmuna", "kanan munat"],
  mince: ["jauheliha", "sika-nauta jauheliha"],
  onion: ["sipuli", "keltasipuli"],
  rice: ["riisi", "pitkäjyväinen riisi"],
  cream: ["kerma", "ruokakerma"],
  coffee: ["kahvi", "suodatinjauhatus"],
};
export function candidateQueries(requirement: Requirement): string[] {
  const category =
    requirement.classification?.category ??
    foodNameFacts(requirement.name).category;
  const queries = [requirement.name, ...(category ? aliases[category] : [])];
  const seen = new Set<string>();
  return queries
    .filter((query) => {
      const key = query.trim().toLocaleLowerCase("fi").normalize("NFC");
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_SEARCH_QUERIES);
}

export type CandidateSearchOptions = {
  /** Numeric operation telemetry; called once immediately before each external read. */
  onSearch?: () => void;
  /** The matcher/coordinator can supply a stricter hit test; this never authorizes selection. */
  isHit?: (product: Product) => boolean;
  signal?: AbortSignal;
};
function abortableRead(
  read: Promise<Product[]>,
  signal?: AbortSignal,
): Promise<Product[]> {
  if (!signal) return read;
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", abort);
    const abort = () => {
      cleanup();
      reject(signal.reason);
    };
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    read.then(
      (products) => {
        cleanup();
        resolve(products);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}
/** Sequential bounded reads. Retailer errors are terminal, never alias retries. */
export async function searchCandidates(
  provider: StoreProvider,
  context: StoreContext,
  requirement: Requirement,
  options: CandidateSearchOptions = {},
): Promise<Product[]> {
  const snapshot = structuredClone(context);
  const request = structuredClone(requirement);
  if (snapshot.providerId !== provider.id) throw new Error("contextChanged");
  const isHit =
    options.isHit ??
    ((p) =>
      p.available === true &&
      p.price !== null &&
      p.packAmount > 0 &&
      p.unit === request.unit &&
      relevant(p.name, request.name));
  const candidates = new Map<string, Product>();
  for (const query of candidateQueries(request)) {
    options.signal?.throwIfAborted();
    options.onSearch?.();
    const products = await abortableRead(
      provider.searchProducts(structuredClone(snapshot), query, request.id),
      options.signal,
    );
    options.signal?.throwIfAborted();
    if (
      products.length > MAX_SEARCH_RESULTS ||
      new Set(products.map((p) => p.id)).size !== products.length
    )
      throw new Error("storeUnavailable");
    for (const product of products) {
      if (
        product.providerId !== snapshot.providerId ||
        product.storeId !== snapshot.storeId ||
        product.ingredientId !== request.id
      )
        throw new Error("contextChanged");
      candidates.set(product.id, product);
    }
    if (products.some(isHit)) break;
  }
  return [...candidates.values()];
}
