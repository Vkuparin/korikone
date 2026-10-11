import { z } from "zod";
import type { StoreContext } from "../domain/model";
import { MAX_SEARCH_RESULTS } from "./candidates";

export type PieceCatalogue = {
  id: string;
  price: number | null;
  unit: string | null;
  approximate: boolean | null;
  weightKg: number | null;
  salesUnit: string | null;
  multiplier: number | null;
};
export type PieceCatalogueReader = (
  context: StoreContext,
  ids: string[],
) => Promise<PieceCatalogue[]>;
type Request = (input: {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
}) => Promise<unknown>;

// Public source fields captured in weighed-public-s-search.json. Read only,
// selected store explicit, no login/list/checkout mutation or price-ratio conversion.
export const pieceCatalogueQuery = `query KorikonePieceCatalogue($storeId: ID!, $eans: [String!]) {
  store(id: $storeId) { id products(eans: $eans) {
    total productListItems { product {
      ean price priceUnit approxPrice measurement { pceApproxWeight }
      pricing { currentPrice isApproximatePrice salesUnit quantityMultiplier }
    } }
  } }
}`;
const rawProduct = z.object({
  ean: z.string().regex(/^\d{8,14}$/),
  price: z.number().nonnegative().nullish(),
  priceUnit: z.string().nullish(),
  approxPrice: z.boolean().nullish(),
  measurement: z
    .object({ pceApproxWeight: z.number().nonnegative().nullish() })
    .nullish(),
  pricing: z
    .object({
      currentPrice: z.number().nonnegative().nullish(),
      isApproximatePrice: z.boolean().nullish(),
      salesUnit: z.string().nullish(),
      quantityMultiplier: z.number().nonnegative().nullish(),
    })
    .nullish(),
});
const responseSchema = z.object({
  errors: z.array(z.unknown()).optional(),
  data: z.object({
    store: z.object({
      id: z.string(),
      products: z.object({
        productListItems: z
          .array(z.object({ product: rawProduct }))
          .max(MAX_SEARCH_RESULTS),
      }),
    }),
  }),
});

/** Uses the existing embedded S-kaupat host session, with a fixed read-only query. */
export function sKaupatPieceCatalogue(request: Request): PieceCatalogueReader {
  return async (context, ids) => {
    if (
      context.providerId !== "s-kaupat" ||
      !context.storeId ||
      context.storeId.length > 100 ||
      ids.length > MAX_SEARCH_RESULTS ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !/^\d{8,14}$/.test(id))
    )
      throw new Error("storeUnavailable");
    if (!ids.length) return [];
    const response = z
      .object({ ok: z.literal(true), status: z.number(), body: z.string() })
      .safeParse(
        await request({
          url: "https://api.s-kaupat.fi/",
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            operationName: "KorikonePieceCatalogue",
            query: pieceCatalogueQuery,
            variables: { storeId: context.storeId, eans: ids },
          }),
          timeoutMs: 30_000,
        }),
      );
    if (!response.success || response.data.status !== 200)
      throw new Error("storeUnavailable");
    let json: unknown;
    try {
      json = JSON.parse(response.data.body);
    } catch {
      throw new Error("storeUnavailable");
    }
    const parsed = responseSchema.safeParse(json);
    if (!parsed.success || parsed.data.errors?.length)
      throw new Error("storeUnavailable");
    const store = parsed.data.data.store;
    if (store.id !== context.storeId) throw new Error("contextChanged");
    const products = store.products.productListItems.map(
      (item) => item.product,
    );
    if (
      new Set(products.map((p) => p.ean)).size !== products.length ||
      products.some((p) => !ids.includes(p.ean))
    )
      throw new Error("storeUnavailable");
    return products.map((p) => ({
      id: p.ean,
      price: p.pricing?.currentPrice ?? p.price ?? null,
      unit: p.priceUnit ?? null,
      approximate: p.pricing?.isApproximatePrice ?? p.approxPrice ?? null,
      weightKg: p.measurement?.pceApproxWeight ?? null,
      salesUnit: p.pricing?.salesUnit ?? null,
      multiplier: p.pricing?.quantityMultiplier ?? null,
    }));
  };
}
