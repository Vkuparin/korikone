import { contextSchema, type StoreContext } from "../domain/model";
import {
  currentOffer,
  offerCapabilitiesSchema,
  offerSourceResultSchema,
  type OfferReadOptions,
  type OfferSourceResult,
} from "../domain/offers";
import type { StoreProvider } from "../stores/provider";

export type CollectOfferOptions = OfferReadOptions & {
  /** The service owns active-context changes; the adapter owns retailer account changes. */
  isCurrent?: (context: StoreContext) => boolean;
  now?: () => Date;
};

/** One explicit discovery read for the active retailer. Never searches products or reads a cart. */
export async function collectOffers(
  provider: StoreProvider,
  requested: StoreContext,
  options: CollectOfferOptions = {},
): Promise<OfferSourceResult> {
  const context = { ...requested };
  const bound = { providerId: context.providerId, storeId: context.storeId };
  const error = (
    code: Extract<OfferSourceResult, { status: "error" }>["code"],
  ): OfferSourceResult => ({ ...bound, status: "error", code });
  const stale = () => {
    if (options.signal?.aborted) return error("cancelled");
    if (options.isCurrent && !options.isCurrent({ ...context }))
      return error("contextChanged");
    return null;
  };
  try {
    const obsolete = stale();
    if (obsolete) return obsolete;
    if (
      !contextSchema.safeParse(context).success ||
      provider.id !== context.providerId
    )
      return error("contextChanged");
    const capabilities = provider.capabilities.offers;
    if (!capabilities)
      return { ...bound, status: "unsupported", reason: "no-discovery-source" };
    const supported = offerCapabilitiesSchema.safeParse(capabilities);
    if (!supported.success) return error("storeUnavailable");
    if (!supported.data.public && !supported.data.personal) {
      return {
        ...bound,
        status: "unsupported",
        reason:
          provider.id === "k-ruoka" ? "external-worker" : "no-discovery-source",
      };
    }
    if (!provider.readOffers) return error("storeUnavailable");
    const raw = await provider.readOffers(
      { ...context },
      { signal: options.signal },
    );
    const late = stale();
    if (late) return late;
    const parsed = offerSourceResultSchema.safeParse(raw);
    if (!parsed.success) return error("storeUnavailable");
    const result = parsed.data;
    if (
      result.providerId !== context.providerId ||
      result.storeId !== context.storeId
    )
      return error("contextChanged");
    if (result.status !== "ready") return result;
    if (result.offers.some((offer) => !supported.data[offer.kind]))
      return error("storeUnavailable");
    const now = options.now?.() ?? new Date();
    return {
      ...result,
      offers: result.offers.filter((offer) => currentOffer(offer, now)),
    };
  } catch {
    return stale() ?? error("storeUnavailable");
  }
}
