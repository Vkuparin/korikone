import { createHash } from "node:crypto";
import { z } from "zod";
import type { ToolCall } from "./k-ruoka";

/** One request run by the k-ruoka.fi page itself, so the store tab's session cookie goes with it. */
export type PageRequest = (request: {
  method: "GET" | "POST" | "PATCH";
  path: string;
  body?: unknown;
  build: string | null;
}) => Promise<{
  status: number;
  build: string | null;
  cfMitigated: string | null;
  body: string;
}>;

const localized = z.object({ finnish: z.string().nullish() }).passthrough();
const searchSchema = z.object({
  result: z.array(
    z
      .object({
        type: z.string().nullish(),
        product: z
          .object({
            ean: z.string().min(1),
            localizedName: localized,
            isAvailable: z.boolean().nullish(),
            mobilescan: z
              .object({
                pricing: z
                  .object({
                    normal: z
                      .object({
                        price: z.number().nullish(),
                        unit: z.string().nullish(),
                        isApproximate: z.boolean().nullish(),
                      })
                      .passthrough()
                      .nullish(),
                  })
                  .passthrough()
                  .nullish(),
              })
              .passthrough()
              .nullish(),
          })
          .passthrough()
          .nullish(),
      })
      .passthrough(),
  ),
});
const storesSchema = z.object({
  results: z.array(
    z
      .object({
        id: z.string().min(1),
        name: z.string(),
        location: z.string().nullish(),
        isWebStore: z.boolean(),
        hasPickup: z.boolean(),
        hasHomeDelivery: z.boolean(),
      })
      .passthrough(),
  ),
});
const basketSchema = z
  .object({
    id: z.string().min(1),
    userInfo: z
      .object({
        firstName: z.string().nullish(),
        email: z.string().nullish(),
      })
      .passthrough()
      .nullish(),
    store: z.object({ id: z.string(), name: z.string() }).passthrough(),
    items: z.array(
      z
        .object({
          id: z.string().min(1),
          ean: z.string(),
          name: localized,
          amountInfo: z.object({
            amount: z.number().nonnegative(),
            unit: z.string(),
          }),
        })
        .passthrough(),
    ),
  })
  .passthrough();
type Basket = z.infer<typeof basketSchema>;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Korikone's K-Ruoka client: the same tool calls as the pinned k-ruoka-mcp worker, answered by
 * the site's own API from the store tab's session. Only adding an item and setting an item's
 * amount are ever written; checkout, delivery, payment and clearing events are never built.
 */
export class KRuokaSite {
  private build: string | null = null;
  private last = 0;
  private queue: Promise<unknown> = Promise.resolve();
  // Only EANs the store returned in a search are ever added.
  private known = new Set<string>();
  private reviewed: ReturnType<KRuokaSite["cart"]> | null = null;

  constructor(
    private request: PageRequest,
    private spacing = 500,
  ) {}

  call: ToolCall = (name, args) => {
    const run = this.queue.then(() => this.tool(name, args));
    this.queue = run.catch(() => {});
    return run;
  };

  /** The site's own query parameters select the reviewed store and open its basket. */
  cartUrl(storeId: string): Promise<string> {
    const run = this.queue.then(async () => {
      const store = z
        .object({ id: z.string(), slug: z.string().regex(/^k-[a-z0-9-]+$/) })
        .parse(
          await this.api("GET", `/kr-api/store/${encodeURIComponent(storeId)}`),
        );
      if (store.id !== storeId) throw new Error("contextChanged");
      const url = new URL("https://www.k-ruoka.fi/kauppa");
      url.searchParams.set("kauppa", store.slug);
      url.searchParams.set("ostoskori", "");
      return url.toString();
    });
    this.queue = run.catch(() => {});
    return run;
  }

  private async api(
    method: "GET" | "POST" | "PATCH",
    path: string,
    body?: unknown,
  ) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const pause = this.last + this.spacing - Date.now();
      if (pause > 0) await wait(pause);
      this.last = Date.now();
      const response = await this.request({
        method,
        path,
        body,
        build: this.build,
      });
      if (response.build) this.build = response.build;
      if (response.cfMitigated) throw new Error("storeBlocked");
      // A stale or missing build number is refused with 409 and the current one in the header.
      if (response.status === 409 && attempt === 0 && response.build) continue;
      if (response.status === 401 || response.status === 403)
        throw new Error("loginRequired");
      if (response.status < 200 || response.status >= 300)
        throw new Error("storeUnavailable");
      try {
        return JSON.parse(response.body) as unknown;
      } catch {
        throw new Error("storeUnavailable");
      }
    }
    throw new Error("storeUnavailable");
  }

  private async basket(storeId: string) {
    return basketSchema.parse(
      await this.api("POST", "/kr-api/basket/active", {
        storeId,
        substitutionDefault: false,
        skipClearClosedDeliverySlot: true,
      }),
    );
  }

  /** The cart as k-ruoka-mcp's get_cart returns it; the account is a hash, never the e-mail. */
  private cart(basket: Basket) {
    const email = basket.userInfo?.email?.trim().toLowerCase();
    return {
      basketId: basket.id,
      account: email
        ? `k-ruoka:${createHash("sha256").update(email).digest("hex").slice(0, 16)}`
        : null,
      accountName: basket.userInfo?.firstName ?? null,
      store: { id: basket.store.id, name: basket.store.name },
      items: basket.items.map((item) => ({
        itemId: item.id,
        ean: item.ean,
        name: item.name.finnish ?? item.ean,
        amount: item.amountInfo.amount,
        unit: item.amountInfo.unit,
      })),
    };
  }

  private async write(storeId: string, event: object) {
    const expected = this.reviewed;
    const before = await this.basket(storeId);
    if (before.store.id !== storeId) throw new Error("contextChanged");
    if (!before.userInfo?.email) throw new Error("loginRequired");
    if (!expected) throw new Error("reviewRequired");
    const current = this.cart(before);
    if (current.account !== expected.account) throw new Error("accountChanged");
    if (JSON.stringify(current.items) !== JSON.stringify(expected.items))
      throw new Error("cartChanged");
    return basketSchema.parse(
      await this.api(
        "PATCH",
        `/kr-api/basket/by-id/${encodeURIComponent(before.id)}`,
        [event],
      ),
    );
  }

  private async tool(name: string, args: Record<string, unknown>) {
    const storeId = () => z.string().min(1).parse(args.store_id);
    if (name === "search_stores") {
      const { query, limit } = z
        .object({
          query: z.string().min(1),
          limit: z.number().int().positive(),
        })
        .parse(args);
      const data = storesSchema.parse(
        await this.api("POST", "/kr-api/stores/search", {
          query,
          offset: 0,
          limit,
        }),
      );
      return {
        results: data.results.map((s) => ({
          storeId: s.id,
          name: s.name,
          location: s.location ?? null,
          isWebStore: s.isWebStore,
          hasPickup: s.hasPickup,
          hasHomeDelivery: s.hasHomeDelivery,
        })),
      };
    }
    if (name === "search_products") {
      const { query, limit } = z
        .object({
          query: z.string().min(1),
          limit: z.number().int().positive(),
        })
        .parse(args);
      const params = new URLSearchParams({
        language: "fi",
        storeId: storeId(),
        offset: "0",
        limit: String(limit),
      });
      const data = searchSchema.parse(
        await this.api(
          "POST",
          `/kr-api/v2/product-search/${encodeURIComponent(query)}?${params}`,
        ),
      );
      const results = {
        results: data.result.flatMap((hit) => {
          const product = hit.product;
          if (!product || (hit.type && hit.type !== "product")) return [];
          const normal = product.mobilescan?.pricing?.normal;
          return [
            {
              ean: product.ean,
              name: product.localizedName.finnish ?? product.ean,
              price: normal?.price ?? null,
              priceUnit: normal?.unit ?? null,
              priceIsApproximate: normal?.isApproximate ?? true,
              isAvailable: product.isAvailable ?? false,
            },
          ];
        }),
      };
      for (const product of results.results) this.known.add(product.ean);
      return results;
    }
    if (name === "get_cart") {
      this.reviewed = this.cart(await this.basket(storeId()));
      return this.reviewed;
    }
    if (name === "update_cart_item") {
      const { item_id, quantity, unit } = z
        .object({
          item_id: z.string().min(1),
          quantity: z.number().int().positive().max(100),
          unit: z.literal("kpl"),
        })
        .parse(args);
      const after = await this.write(storeId(), {
        type: "SET-ITEM-AMOUNT",
        itemId: item_id,
        value: { amount: quantity, unit },
      });
      return this.cart(after);
    }
    if (name === "add_to_cart") {
      const { ean, quantity, unit } = z
        .object({
          ean: z.string().regex(/^\d{4,14}$/),
          quantity: z.number().int().positive().max(100),
          unit: z.literal("kpl"),
          allow_substitutes: z.literal(false),
        })
        .parse(args);
      if (!this.known.has(ean)) throw new Error("productUnavailable");
      const after = await this.write(storeId(), {
        type: "ADD-ITEM",
        item: {
          ean,
          allowSubstitutes: false,
          amountInfo: { amount: quantity, unit },
        },
      });
      return this.cart(after);
    }
    if (name === "auth_status") {
      const basket = await this.basket(storeId());
      return { loggedIn: !!basket.userInfo?.email };
    }
    throw new Error("unsupported");
  }
}

/** The page script: a same-origin fetch from www.k-ruoka.fi with the session cookie. */
export const pageScript = (request: Parameters<PageRequest>[0]) =>
  `(async (request) => {
    const headers = { Accept: "application/json" };
    if (request.build) headers["X-K-Build-Number"] = request.build;
    if (request.body !== undefined) headers["Content-Type"] = "application/json";
    const r = await fetch(request.path, {
      method: request.method,
      headers,
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
      credentials: "include",
    });
    return {
      status: r.status,
      build: r.headers.get("k-ruoka-build"),
      cfMitigated: r.headers.get("cf-mitigated"),
      body: await r.text(),
    };
  })(${JSON.stringify(request)})`;
