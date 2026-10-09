import { z } from "zod";
import type { Cart, Product, StoreContext, Target } from "../domain/model";
import type { StoreProvider } from "./provider";
import { packFromName, type ToolCall } from "./k-ruoka";
import { McpWorker } from "./worker";

/** Pinned s-kaupat-mcp release. Update together with scripts/prepare-s-kaupat.mjs. */
export const S_KAUPAT_VERSION = "1.2.0";
export const S_KAUPAT_SCHEMA = "1.0";
export const S_KAUPAT_CHECKSUM =
  "17f973844c2216be3f51b7b272351025e5dd1dec0d209b1fce15fb8fd0fc032a";
/** S-kaupat has no server-side cart. Korikone transfers to this shopping list on the account. */
export const S_KAUPAT_LIST = "Korikone";
// Checkout, payment, time choice and list deletion tools are deliberately absent.
// get_delivery_options only reads the pickup fees.
export const S_KAUPAT_TOOLS = [
  "get_setup_status",
  "search_stores",
  "select_store",
  "search_products",
  "get_products",
  "check_basket",
  "login_status",
  "start_login",
  "log_out",
  "get_shopping_lists",
  "create_shopping_list",
  "add_to_shopping_list",
  "open_site",
  "get_delivery_options",
];
const errorCodes: Record<string, string> = {
  login_required: "loginRequired",
  session_expired: "loginRequired",
  login_in_progress: "loginInProgress",
  login_window_unavailable: "browserRequired",
  browser_unavailable: "browserRequired",
  browser_busy: "storeBusy",
  store_not_selected: "chooseStore",
  store_not_found: "chooseStore",
  product_unavailable: "productUnavailable",
  list_not_found: "cartChanged",
  invalid_quantity: "unitMismatch",
  write_uncertain: "writeUncertain",
  context_changed: "cartChanged",
  conflict: "cartChanged",
  unsupported: "unsupported",
};
/** Translates the server's stable error codes into Korikone's message keys. */
export function sKaupatError(data: unknown): Error {
  const parsed = z
    .object({ error: z.object({ code: z.string() }) })
    .safeParse(data);
  return new Error(
    (parsed.success && errorCodes[parsed.data.error.code]) ||
      "storeUnavailable",
  );
}
export function sKaupatWorker(options: {
  script: string;
  dataDir: string;
  demo?: boolean;
  node?: string;
}) {
  return new McpWorker({
    // Electron runs the single-file release as plain Node.js; users install nothing else.
    command: options.node ?? process.execPath,
    script: options.script,
    args: ["--data-dir", options.dataDir, ...(options.demo ? ["--demo"] : [])],
    env: {
      ELECTRON_RUN_AS_NODE: "1",
      SKAUPAT_ORDERING: "false",
      // Since 1.2.0: the login belongs to this data folder, like the store window's own login,
      // so signing in or out here never touches other apps on the PC.
      SKAUPAT_LOGIN_SCOPE: "data-dir",
    },
    checksum: S_KAUPAT_CHECKSUM,
    version: S_KAUPAT_VERSION,
    schemaVersion: S_KAUPAT_SCHEMA,
    tools: S_KAUPAT_TOOLS,
    errors: sKaupatError,
  });
}
const productSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  price: z.number().nonnegative().nullable(),
  depositPrice: z.number().nonnegative().nullable(),
  approximatePrice: z.boolean(),
  priceBasis: z.string(),
  packSize: z.string().nullable(),
  quantityUnit: z.string().nullable(),
});
const listSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  items: z.array(
    z.object({
      productId: z.string(),
      name: z.string().nullable(),
      quantity: z.number().nonnegative(),
      product: z.object({ priceBasis: z.string() }).nullish(),
    }),
  ),
});
const writeSchema = z.object({
  results: z.array(
    z.object({
      productId: z.string(),
      status: z.string(),
      error: z.object({ code: z.string() }).nullish(),
    }),
  ),
});
export class SKaupatProvider implements StoreProvider {
  id = "s-kaupat";
  capabilities = { catalogue: true, cart: true, orderHistory: false };
  constructor(private call: ToolCall) {}
  async searchStores(query: string): Promise<StoreContext[]> {
    const data = z
      .object({
        stores: z.array(
          z.object({
            id: z.string().min(1),
            name: z.string(),
            street: z.string().nullish(),
            onlineOrdering: z.boolean().nullable(),
          }),
        ),
      })
      .parse(await this.call("search_stores", { query, limit: 20 }));
    return data.stores
      .filter((s) => s.onlineOrdering !== false)
      .map((s) => ({
        providerId: this.id,
        storeId: s.id,
        storeName: s.name + (s.street ? ` · ${s.street}` : ""),
        fulfillment: "pickup",
      }));
  }
  /** Pickup fees at the store; home delivery would need the shopper's address, which Korikone does not ask for. */
  async pickupFee(context: StoreContext) {
    const data = z
      .object({
        options: z.array(
          z.object({
            method: z.string(),
            storeId: z.string().nullish(),
            price: z.number().nullish(),
            nextSlot: z.object({ price: z.number().nullish() }).nullish(),
          }),
        ),
      })
      .parse(
        await this.call("get_delivery_options", { storeId: context.storeId }),
      );
    const prices = data.options
      .filter(
        (o) =>
          o.method === "pickup" &&
          (!o.storeId || o.storeId === context.storeId),
      )
      .flatMap((o) => [o.price, o.nextSlot?.price])
      .filter((p): p is number => typeof p === "number" && p >= 0)
      .map((p) => Math.round(p * 100));
    return prices.length
      ? { min: Math.min(...prices), max: Math.max(...prices) }
      : null;
  }
  /** Keeps the server's own store choice in step, so its site handoff names the same store. */
  async selectStore(context: StoreContext) {
    await this.call("select_store", { storeId: context.storeId });
  }
  async searchProducts(
    context: StoreContext,
    query: string,
    ingredientId: string,
  ): Promise<Product[]> {
    const data = z.object({ products: z.array(productSchema) }).parse(
      await this.call("search_products", {
        storeId: context.storeId,
        query,
        limit: 20,
      }),
    );
    // Search results never report stock; the basket check does.
    const stock = new Map<string, string>();
    if (data.products.length) {
      const checked = z
        .object({
          items: z.array(
            z.object({ productId: z.string(), status: z.string() }),
          ),
        })
        .parse(
          await this.call("check_basket", {
            storeId: context.storeId,
            items: data.products.map((p) => ({ productId: p.id, quantity: 1 })),
          }),
        );
      for (const item of checked.items) stock.set(item.productId, item.status);
    }
    const observedAt = new Date().toISOString();
    return data.products.map((p) => {
      const pack = packFromName(p.packSize ?? p.name);
      // Weighed goods and unclear packs stay unpriced, as with K-Ruoka.
      const supported =
        p.priceBasis === "per_item" &&
        !p.approximatePrice &&
        p.quantityUnit?.toUpperCase() === "KPL" &&
        pack !== null;
      const status = stock.get(p.id);
      return {
        id: p.id,
        providerId: this.id,
        storeId: context.storeId,
        name: p.name,
        ingredientId,
        packAmount: pack?.amount ?? 0,
        unit: pack?.unit ?? "pcs",
        price: supported && p.price != null ? Math.round(p.price * 100) : null,
        available:
          status === "ok"
            ? true
            : status === "unavailable" ||
                status === "not_in_store" ||
                status === "not_found"
              ? false
              : null,
        deposit: p.depositPrice ? Math.round(p.depositPrice * 100) : 0,
        nativeUnit: "kpl",
        increment: 1,
        observedAt,
      };
    });
  }
  private async read(context: StoreContext) {
    const login = z
      .object({
        status: z.string(),
        accountId: z.string().nullish(),
        displayName: z.string().nullish(),
      })
      .parse(await this.call("login_status", {}));
    if (login.status !== "logged_in") throw new Error("loginRequired");
    // An opaque, stable hash of the S-kaupat user ID (since server 1.1.0).
    if (!login.accountId) throw new Error("workerIncompatible");
    const lists = z
      .object({ lists: z.array(listSchema) })
      .parse(
        await this.call("get_shopping_lists", { storeId: context.storeId }),
      )
      .lists.filter((l) => l.name === S_KAUPAT_LIST);
    if (lists.length > 1) throw new Error("unsupportedCart");
    const list = lists[0] ?? null;
    if (
      list &&
      new Set(list.items.map((i) => i.productId)).size !== list.items.length
    )
      throw new Error("unsupportedCart");
    return {
      account: `s-kaupat:${login.accountId}`,
      name: login.displayName ?? null,
      list,
    };
  }
  async getCart(context: StoreContext): Promise<Cart> {
    const { account, name, list } = await this.read(context);
    return {
      accountId: account,
      accountName: name,
      context,
      lines: (list?.items ?? []).map((i) => ({
        productId: i.productId,
        name: i.name ?? i.productId,
        quantity: i.quantity,
        unit: i.product?.priceBasis === "per_item" ? "kpl" : "kg",
      })),
    };
  }
  async setQuantity(context: StoreContext, target: Target): Promise<void> {
    if (
      target.unit !== "kpl" ||
      !Number.isInteger(target.quantity) ||
      target.quantity <= 0 ||
      target.quantity > 99
    )
      throw new Error("unitMismatch");
    const { account, list } = await this.read(context);
    if (!target.accountId || account !== target.accountId)
      throw new Error("accountChanged");
    const item = list?.items.find((i) => i.productId === target.productId);
    if ((item?.quantity ?? 0) !== target.before) throw new Error("cartChanged");
    if (item && item.product?.priceBasis !== "per_item")
      throw new Error("unitMismatch");
    // A product already on the list gets the new absolute quantity, never a second row.
    const items = [
      {
        productId: target.productId,
        quantity: target.quantity,
        allowSubstitutes: false,
      },
    ];
    const result = writeSchema.parse(
      list
        ? await this.call("add_to_shopping_list", {
            listId: list.id,
            items,
            storeId: context.storeId,
          })
        : await this.call("create_shopping_list", {
            name: S_KAUPAT_LIST,
            items,
            storeId: context.storeId,
          }),
    );
    const outcome = result.results.find(
      (r) => r.productId === target.productId,
    );
    if (!outcome || outcome.status === "uncertain")
      throw new Error("writeUncertain");
    if (!["added", "updated", "unchanged"].includes(outcome.status))
      throw sKaupatError({ error: outcome.error ?? { code: "unavailable" } });
  }
}
type TimedCall = (
  name: string,
  args: Record<string, unknown>,
  timeout?: number,
) => Promise<unknown>;
type Marker = {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<unknown>;
};
const WINDOW_ACCOUNT = "s-kaupat-window-account";
const accountSchema = z.object({
  status: z.string(),
  accountId: z.string().nullish(),
});
/**
 * Sign-in as the shopper sees it: the store window Korikone opens must be signed in too.
 * The site session lives in this data folder's browser profile. Korikone runs the server with
 * a login of its own for this folder (SKAUPAT_LOGIN_SCOPE), so a token normally means the window
 * signed in here too. A login still counts only once the server's login window has completed here
 * for the same account, which also covers a folder restored without its browser profile.
 */
export class SKaupatSession {
  constructor(
    private call: TimedCall,
    private marker: Marker,
  ) {}
  private async account() {
    const login = accountSchema.parse(await this.call("login_status", {}));
    return login.status === "logged_in" ? (login.accountId ?? null) : null;
  }
  async signedIn(): Promise<boolean> {
    const account = await this.account();
    return !!account && (await this.marker.get(WINDOW_ACCOUNT)) === account;
  }
  async login(timeoutSeconds = 300): Promise<string> {
    const account = await this.account();
    if (account) {
      if ((await this.marker.get(WINDOW_ACCOUNT)) === account)
        return "signedIn";
      // Forget the token so the login window opens and signs this profile in.
      await this.call("log_out", {});
    }
    const result = accountSchema
      .extend({ alreadyLoggedIn: z.boolean().nullish() })
      .parse(
        await this.call(
          "start_login",
          { timeoutSeconds },
          (timeoutSeconds + 30) * 1000,
        ),
      );
    if (result.status === "cancelled") return "notStarted";
    // alreadyLoggedIn: no window was shown, so this profile is still signed out.
    if (
      result.status !== "logged_in" ||
      !result.accountId ||
      result.alreadyLoggedIn
    )
      return "failed";
    await this.marker.set(WINDOW_ACCOUNT, result.accountId);
    return "signedIn";
  }
  async logout() {
    await this.call("log_out", {});
    await this.marker.set(WINDOW_ACCOUNT, null);
  }
}
