import type { Category } from "../domain/categories";
import { inferredClassification } from "../domain/categories";
import type { Product, Requirement, StoreContext } from "../domain/model";
import { relevant } from "../domain/planner";
import {
  productEvidenceSchema,
  type ProductEvidence,
  type ProductFamily,
} from "../domain/product-evidence";
import type { StoreProvider } from "./provider";

export const MAX_SEARCH_QUERIES = 3;
export const MAX_SEARCH_RESULTS = 20;
export const MAX_CANDIDATES = MAX_SEARCH_QUERIES * MAX_SEARCH_RESULTS;

/** Only recognized product-name words establish facts. Absence is unknown, never false. */
export function retailerEvidence(
  name: string,
  retailerCategory: string | null = null,
  labels: string[] = [],
): ProductEvidence {
  const text = name.toLocaleLowerCase("fi").normalize("NFC");
  const has = (pattern: RegExp) =>
    new RegExp(
      `(?<![\\p{L}])${pattern.source.slice(2, -2)}(?![\\p{L}])`,
      "u",
    ).test(text);
  let category: Category | null = null;
  let family: ProductFamily | null = null;
  // Reject ingredient-containing products before recognizing the ingredient head word.
  if (has(/\b[\p{L}-]*(?:leikkuri|keitin|veitsi|suodatinpussi|equipment)\b/u))
    family = "equipment";
  else if (has(/\b[\p{L}-]*(?:juusto|munakas|jauho|omelette|flour)\b/u))
    family = "other-food";
  else if (has(/\b[\p{L}-]*(?:mauste|mausteseos|seasoning)\b/u))
    family = "seasoning";
  else if (
    has(/\b[\p{L}-]*(?:keitto|laatikko|kastike|pizza|salaatti|ateria)\b/u)
  )
    family = "prepared-food";
  else if (has(/\b(?:valkosipul[\p{L}]*|garlic)\b/u)) family = "garlic";
  else if (has(/\b[\p{L}-]*(?:maito|milk)[\p{L}]*\b/u)) {
    category = "milk";
    family = has(
      /\b(?:kaura|soija|manteli|riisi|kookos|kasvi|oat|soy|almond|coconut)[\p{L}-]*\b/u,
    )
      ? "plant-drink"
      : has(
            /\b(?:suklaa|kaakao|mansikka|vanilja|chocolate|strawberry|flavou?red)[\p{L}-]*\b/u,
          )
        ? "flavoured-milk"
        : has(/\b(?:maito|kevytmaito|täysmaito|rasvaton\s+maito|milk)\b/u)
          ? "plain-milk"
          : null;
  } else if (has(/\b(?:[\p{L}-]*näkkileip[\p{L}]*|crispbread)\b/u)) {
    category = "bread";
    family = "crispbread";
  } else if (has(/\b(?:tortilla[\p{L}]*|wraps?)\b/u)) {
    category = "bread";
    family = "tortilla";
  } else if (has(/\b(?:pulla[\p{L}]*|briossi[\p{L}]*|sweet\s+bread)\b/u)) {
    category = "bread";
    family = "sweet-bread";
  } else if (
    has(
      /\b(?:[\p{L}-]*leip[äa][\p{L}]*|[\p{L}-]*sämpyl[\p{L}]*|ruispala[\p{L}]*|bread|rolls?)\b/u,
    )
  ) {
    category = "bread";
    family = "bread";
  } else if (
    has(
      /\b(?:viiriäis[\p{L}]*|ankan\s+mun[\p{L}]*|quail\s+eggs?|duck\s+eggs?)\b/u,
    )
  ) {
    category = "eggs";
    family = "other-egg";
  } else if (
    has(
      /\b(?:[\p{L}-]*munajauhe|munamassa|munavalkuainen|valkuais[\p{L}]*|liquid\s+egg|egg\s+white)\b/u,
    )
  ) {
    category = "eggs";
    family = "egg-product";
  } else if (has(/\b(?:kanan\s*mun(?:a|at|ia)|kananmun[\p{L}]*|eggs?)\b/u)) {
    category = "eggs";
    family = "hen-egg";
  } else if (has(/\b[\p{L}-]*(?:jauheliha|mince)\b/u)) {
    category = "mince";
    family = has(/\b(?:kasvis|kasvi|soija|herne|vegan|plant)[\p{L}-]*\b/u)
      ? "plant-mince"
      : null;
  } else if (has(/\b(?:[\p{L}-]*sipul(?:i|it|ia)|onions?|shallots?)\b/u)) {
    category = "onion";
    family = "onion";
  } else if (has(/\b(?:[\p{L}-]*riisi|rice)\b/u)) {
    category = "rice";
    family = has(
      /\b(?:valmis|mikro|keitetty|ready|cooked|seasoned)[\p{L}-]*\b/u,
    )
      ? "prepared-rice"
      : null;
  } else if (has(/\b(?:[\p{L}-]*kerma|cream)\b/u)) {
    category = "cream";
    family = has(/\b(?:kaura|soija|kasvi|vegan|oat|soy|plant)[\p{L}-]*\b/u)
      ? "plant-cream"
      : null;
  } else if (
    has(
      /\b(?:[\p{L}-]*kahvi[\p{L}]*|coffee|suodatinjauhatus|espressojauhatus)\b/u,
    )
  ) {
    category = "coffee";
    family = has(/\b(?:kapseli[\p{L}]*|capsules?)\b/u)
      ? "coffee-capsule"
      : has(/\b(?:juoma|latte|cappuccino)[\p{L}-]*\b/u)
        ? "coffee-drink"
        : null;
  }
  const categoryName = {
    milk: "Maito",
    bread: "Leipä",
    eggs: "Kananmuna",
    mince: "Jauheliha",
    onion: "Sipuli",
    rice: "Riisi",
    cream: "Kerma",
    coffee: "Kahvi",
  };
  const inferred = inferredClassification(
    category ? `${categoryName[category]} ${name}` : name,
    "model-assumed",
  );
  const qualifiers =
    inferred?.category === category
      ? inferred.qualifiers.map(({ kind, value }) => ({ kind, value }))
      : [];
  const value = (kind: string) =>
    qualifiers.find((q) => q.kind === kind)?.value;
  if (category === "mince" && family !== "plant-mince" && value("meat"))
    family = "meat-mince";
  if (category === "cream" && family !== "plant-cream" && value("cream"))
    family = "dairy-cream";
  if (
    category === "rice" &&
    !family &&
    (value("rice") || has(/\b(?:kuiva|pitkäjyväinen|dry)[\p{L}-]*\b/u))
  )
    family = "dry-rice";
  if (category === "coffee" && !family)
    family =
      (
        {
          ground: "ground-coffee",
          beans: "coffee-beans",
          instant: "instant-coffee",
        } as const
      )[value("coffee") as "ground" | "beans" | "instant"] ?? null;
  // Name hints from request classification are reused only as recognized retailer-name claims.
  return productEvidenceSchema.parse({
    source: "retailer-name",
    quote: name,
    category,
    family,
    qualifiers,
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
    inferredClassification(requirement.name, "model-assumed")?.category;
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
