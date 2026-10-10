import type {
  AppState,
  BasketLine,
  Cart,
  Journal,
  Review,
  StoreContext,
  Product,
} from "../domain/model";
import { applyPackSizes } from "../domain/planner";
import { candidateSuitability, type MatchingOptions } from "../domain/matching";
import { searchCandidates } from "../stores/candidates";
import type { StoreProvider } from "../stores/provider";
/** Fresh reads must retain the facts on which the quoted selection depended. */
function sameSuitability(
  line: BasketLine,
  fresh: Product,
  context: StoreContext,
  options: MatchingOptions,
): boolean {
  const original = line.product!;
  const facts = (p: Product) =>
    p.evidence
      ? JSON.stringify({
          category: p.evidence.category,
          family: p.evidence.family,
          qualifiers: [...p.evidence.qualifiers].sort((a, b) =>
            a.kind.localeCompare(b.kind),
          ),
        })
      : null;
  if (facts(original) !== facts(fresh)) return false;
  return (
    !line.matching ||
    candidateSuitability(line.requirement, fresh, { ...options, context })
      .status !== "rejected"
  );
}
async function freshProduct(
  provider: StoreProvider,
  context: StoreContext,
  line: BasketLine,
  packSizes: AppState["packSizes"],
  signal?: AbortSignal,
) {
  try {
    return applyPackSizes(
      await searchCandidates(provider, context, line.requirement, {
        signal,
        isHit: (p) => p.id === line.product!.id,
      }),
      packSizes,
    ).find((p) => p.id === line.product!.id);
  } catch (error) {
    if (signal?.aborted) throw new Error("cancelled");
    throw error;
  }
}
export function fingerprint(cart: Cart): string {
  return JSON.stringify({
    accountId: cart.accountId,
    context: cart.context,
    lines: [...cart.lines]
      .sort((a, b) => a.productId.localeCompare(b.productId))
      .map((l) => [l.productId, l.quantity, l.unit]),
  });
}
export async function createReview(
  provider: StoreProvider,
  context: StoreContext,
  revision: number,
  lines: BasketLine[],
  packSizes: AppState["packSizes"] = {},
  matchingOptions: MatchingOptions = {},
): Promise<Review> {
  if (
    !provider.capabilities.cart ||
    !lines.length ||
    lines.some((l) => !l.product || l.total === null)
  )
    throw new Error("unresolved");
  const baseline = await provider.getCart(context);
  if (!baseline.accountId) throw new Error("loginRequired");
  const targets: Review["targets"] = [];
  for (const line of lines) {
    const p = line.product!;
    if (p.providerId !== context.providerId || p.storeId !== context.storeId)
      throw new Error("contextChanged");
    const fresh = await freshProduct(provider, context, line, packSizes);
    if (
      !fresh ||
      fresh.available !== true ||
      !sameSuitability(line, fresh, context, matchingOptions) ||
      fresh.price !== p.price ||
      fresh.deposit !== p.deposit ||
      fresh.packAmount !== p.packAmount ||
      fresh.unit !== p.unit ||
      fresh.nativeUnit !== p.nativeUnit ||
      fresh.increment !== p.increment
    )
      throw new Error("priceChanged");
    const existing = baseline.lines.find((l) => l.productId === p.id);
    if (existing && existing.unit !== p.nativeUnit)
      throw new Error("unitMismatch");
    const previous = targets.find((t) => t.productId === p.id);
    if (previous) {
      previous.quantity += line.packs;
      previous.price += line.total!;
    } else
      targets.push({
        accountId: baseline.accountId,
        productId: p.id,
        name: p.name,
        unit: p.nativeUnit,
        before: existing?.quantity ?? 0,
        quantity: (existing?.quantity ?? 0) + line.packs,
        price: line.total!,
      });
  }
  if (
    targets.some(
      (t) =>
        t.quantity > 100 || t.quantity <= 0 || !Number.isFinite(t.quantity),
    )
  )
    throw new Error("excessiveQuantity");
  return {
    id: crypto.randomUUID(),
    revision,
    context,
    baseline,
    targets,
    createdAt: new Date().toISOString(),
    total: targets.reduce((sum, t) => sum + t.price, 0),
    quotes: structuredClone(lines),
  };
}
const locks = new Set<string>();
export async function transfer(
  provider: StoreProvider,
  journal: Journal,
  persist: (j: Journal) => void | Promise<void>,
  signal?: AbortSignal,
  packSizes: AppState["packSizes"] = {},
  matchingOptions: MatchingOptions = {},
): Promise<Journal> {
  const review = journal.review;
  const key = JSON.stringify([
    provider.id,
    review.baseline.accountId,
    review.context.storeId,
  ]);
  if (locks.has(key)) throw new Error("busy");
  if (journal.status !== "ready") throw new Error("reviewRequired");
  if (Date.now() - Date.parse(review.createdAt) > 5 * 60 * 1000)
    throw new Error("quoteExpired");
  locks.add(key);
  const expected = structuredClone(review.baseline);
  const record = () => persist(structuredClone(journal));
  try {
    for (const line of review.quotes) {
      const p = line.product!;
      if (!review.targets.some((t) => t.productId === p.id)) continue;
      const fresh = await freshProduct(
        provider,
        review.context,
        line,
        packSizes,
        signal,
      );
      if (
        !fresh ||
        !sameSuitability(line, fresh, review.context, matchingOptions) ||
        fresh.price !== p.price ||
        fresh.deposit !== p.deposit ||
        fresh.packAmount !== p.packAmount ||
        fresh.unit !== p.unit ||
        fresh.nativeUnit !== p.nativeUnit ||
        fresh.increment !== p.increment ||
        fresh.available !== true
      )
        throw new Error("priceChanged");
    }
    if (
      fingerprint(await provider.getCart(review.context)) !==
      fingerprint(expected)
    )
      throw new Error("cartChanged");
    journal.status = "transferring";
    await record();
    for (const target of review.targets) {
      if (signal?.aborted) throw new Error("cancelled");
      if (
        fingerprint(await provider.getCart(review.context)) !==
        fingerprint(expected)
      )
        throw new Error("cartChanged");
      journal.uncertain = target.productId;
      await record();
      await provider.setQuantity(review.context, target);
      const line = expected.lines.find((l) => l.productId === target.productId);
      if (line) line.quantity = target.quantity;
      else expected.lines.push({ ...target });
      if (
        fingerprint(await provider.getCart(review.context)) !==
        fingerprint(expected)
      )
        throw new Error("verificationFailed");
      journal.verified.push(target.productId);
      journal.uncertain = null;
      await record();
    }
    if (
      fingerprint(await provider.getCart(review.context)) !==
      fingerprint(expected)
    )
      throw new Error("verificationFailed");
    journal.status = "verified";
    journal.error = null;
    await record();
  } catch (error) {
    journal.status = "partial";
    journal.error = error instanceof Error ? error.message : "transferFailed";
    await record();
  } finally {
    locks.delete(key);
  }
  return journal;
}
export async function resumeReview(
  provider: StoreProvider,
  journal: Journal,
  packSizes: AppState["packSizes"] = {},
  matchingOptions: MatchingOptions = {},
): Promise<Review> {
  const baseline = await provider.getCart(journal.review.context);
  if (baseline.accountId !== journal.review.baseline.accountId)
    throw new Error("accountChanged");
  const targets = journal.review.targets
    .filter((t) => {
      const current = baseline.lines.find((l) => l.productId === t.productId);
      if (current && current.unit !== t.unit) throw new Error("unitMismatch");
      if (current && current.quantity > t.quantity)
        throw new Error("cartChanged");
      return (current?.quantity ?? 0) !== t.quantity;
    })
    .map((t) => ({
      ...t,
      before:
        baseline.lines.find((l) => l.productId === t.productId)?.quantity ?? 0,
    }));
  const quotes = structuredClone(journal.review.quotes);
  for (const line of quotes) {
    const target = targets.find((t) => t.productId === line.product?.id);
    if (!target) continue;
    const fresh = await freshProduct(
      provider,
      journal.review.context,
      line,
      packSizes,
    );
    if (
      !fresh ||
      !sameSuitability(line, fresh, journal.review.context, matchingOptions) ||
      fresh.price === null ||
      fresh.available !== true ||
      fresh.packAmount !== line.product!.packAmount ||
      fresh.unit !== line.product!.unit ||
      fresh.nativeUnit !== target.unit
    )
      throw new Error("priceChanged");
    line.product = fresh;
    target.price =
      (target.quantity - target.before) * (fresh.price + fresh.deposit);
  }
  return {
    ...journal.review,
    id: crypto.randomUUID(),
    baseline,
    targets,
    quotes,
    total: targets.reduce((sum, t) => sum + t.price, 0),
    createdAt: new Date().toISOString(),
  };
}
