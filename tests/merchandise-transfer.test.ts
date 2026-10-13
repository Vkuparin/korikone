import { expect, test } from "vitest";
import { Service } from "../src/application/service";
import { createReview, transfer } from "../src/application/transfer";
import type { MerchandiseCapabilities } from "../src/domain/merchandise";
import type {
  Journal,
  Product,
  StoreContext,
  Target,
} from "../src/domain/model";
import { DemoProvider } from "../src/stores/demo";
import { memoryStorage } from "./helpers/purchase-fixtures";

const BOOTS = "6400000000328";
/**
 * The development stand-in with a non-food shelf: it finds children's rubber boots by name and
 * declares, as K-Ruoka does, that it cannot write such products to the basket. Every write is
 * recorded by product, so a test can show that none was for a non-food product.
 */
class ShelfProvider extends DemoProvider {
  written: string[] = [];
  merchandise: MerchandiseCapabilities = {
    discovery: true,
    variants: "name",
    stock: "flag",
    cartWrite: false,
  };
  constructor() {
    super("k-ruoka");
    this.capabilities = {
      ...this.capabilities,
      merchandise: this.merchandise,
    } as never;
  }
  async searchProducts(
    context: StoreContext,
    query: string,
    ingredientId: string,
  ): Promise<Product[]> {
    if (!/kumisaapas/i.test(query))
      return super.searchProducts(context, query, ingredientId);
    this.searchRequests++;
    return [
      {
        id: BOOTS,
        providerId: this.id,
        storeId: context.storeId,
        name: "Lasten kumisaapas sininen koko 32",
        ingredientId,
        packAmount: 1,
        unit: "pcs",
        price: 1990,
        available: true,
        deposit: 0,
        nativeUnit: "kpl",
        increment: 1,
        observedAt: new Date().toISOString(),
        merchandise: { brand: "Synteettinen", inStore: true, online: true },
      },
    ];
  }
  async setQuantity(context: StoreContext, target: Target): Promise<void> {
    this.written.push(target.productId);
    return super.setQuantity(context, target);
  }
}
const boots = {
  id: "kumisaapas",
  name: "Kumisaapas",
  amount: 1,
  unit: "pcs" as const,
  merchandise: {
    version: 1 as const,
    family: "kumisaapas",
    attributes: [
      {
        kind: "size" as const,
        value: "32",
        provenance: "explicit-note" as const,
      },
    ],
    missing: [],
  },
};
const groceries = [
  { id: "milk", name: "Maito", amount: 2000, unit: "ml" as const },
  { id: "pasta", name: "Pasta", amount: 500, unit: "g" as const },
];
async function priced(extras: object[] = [...groceries, boots]) {
  const memory = memoryStorage();
  const service = new Service(memory.storage);
  service.developmentMode = true;
  const provider = new ShelfProvider();
  service.registry.register(provider);
  await service.init();
  service.storeLogins["k-ruoka"] = "signedIn";
  await service.save({
    ...service.state,
    staples: [],
    meals: [],
    context: (await provider.searchStores())[0],
    extras: extras as never,
  });
  await service.buildBasket();
  return { ...memory, service, provider };
}
const click = (service: Service) =>
  service.transferDisplayed({
    revision: service.state.revision,
    quotedAt: service.quotedAt!,
    batchKey: service.snapshot().transferBatchKey,
  });
const handed = [
  {
    requirementKey: "kumisaapas:pcs",
    name: "Kumisaapas",
    productId: BOOTS,
    productName: "Lasten kumisaapas sininen koko 32",
    packs: 1,
    total: 1990,
    reason: "unsupported-write",
  },
];

test("a mixed list sends the groceries and hands the non-food row to the shopper, before and after the transfer", async () => {
  const { service, provider, storage } = await priced();
  // The hand-off is published with the quote, before anything is sent.
  expect(service.snapshot().merchandise).toMatchObject({
    capabilities: { cartWrite: false },
    manual: handed,
  });
  const sent = await click(service);
  expect(sent.transferException).toBeNull();
  expect(sent.journal).toMatchObject({
    status: "verified",
    review: { manual: handed, unresolved: [] },
  });
  expect(sent.journal!.review.targets.map((t) => t.productId)).toEqual([
    "milk",
    "pasta",
  ]);
  expect(sent.journal!.review.total).toBe(
    service.basket
      .filter((l) => !l.requirement.merchandise)
      .reduce((sum, l) => sum + l.total!, 0),
  );
  expect(provider.written).toEqual(["milk", "pasta"]);
  // The same click again writes nothing; the row is still on the list and still handed off.
  await click(service);
  expect(provider.written).toEqual(["milk", "pasta"]);
  expect(service.state.extras.map((e) => e.id)).toContain("kumisaapas");
  expect(service.snapshot().merchandise.manual).toEqual(handed);
  // The record survives a restart.
  const restarted = new Service(storage);
  restarted.developmentMode = true;
  restarted.registry.register(new ShelfProvider());
  await restarted.init();
  expect(restarted.journal?.review.manual).toEqual(handed);
  expect(restarted.snapshot().merchandise.manual).toEqual(handed);
});

test("a list of non-food rows only says so and writes nothing; the review path gives the same result", async () => {
  const { service, provider } = await priced([boots]);
  await expect(service.prepare()).rejects.toThrow("manualOnly");
  await expect(service.prepare({ allowMissing: true })).rejects.toThrow(
    "manualOnly",
  );
  const clicked = await click(service);
  expect(clicked.transferException).toBe("manualOnly");
  expect(clicked.review).toBeNull();
  expect(clicked.journal ?? null).toBeNull();
  expect(provider.written).toEqual([]);
  // With the review asked for first, the non-food row is listed apart from missing products.
  const mixed = await priced();
  await mixed.service.setReviewBeforeTransfer({ enabled: true });
  const shown = await click(mixed.service);
  expect(shown.transferException).toBe("acknowledgeReview");
  expect(shown.review).toMatchObject({ manual: handed, unresolved: [] });
  expect(mixed.provider.written).toEqual([]);
  await mixed.service.execute({ id: shown.review!.id, acknowledged: true });
  expect(mixed.provider.written).toEqual(["milk", "pasta"]);
});

test("an interrupted transfer, its recovery and the retry never write the non-food row", async () => {
  const { service, provider } = await priced();
  provider.failAfter = 1;
  const failed = await click(service);
  expect(failed.journal).toMatchObject({
    status: "partial",
    review: { manual: handed },
  });
  expect(provider.written).toEqual(["milk"]);
  expect((await click(service)).transferException).toBe("recoverFirst");
  await service.recover();
  // Recovery keeps the hand-off and plans only the grocery that is still missing.
  expect(service.review).toMatchObject({ manual: handed });
  expect(service.review!.targets.map((t) => t.productId)).not.toContain(BOOTS);
  await service.execute({ id: service.review!.id, acknowledged: true });
  expect(service.journal?.status).toBe("verified");
  expect(provider.written.filter((id) => id === BOOTS)).toEqual([]);
  expect(new Set(provider.written)).toEqual(new Set(["milk", "pasta"]));
});

test("a changed quantity, an expired review and an uncertain read-back stop as before, with no non-food write", async () => {
  // Changed quantity: the click named an older list.
  const changed = await priced();
  const stale = {
    revision: changed.service.state.revision,
    quotedAt: changed.service.quotedAt!,
    batchKey: changed.service.snapshot().transferBatchKey,
  };
  await changed.service.save({
    ...changed.service.state,
    extras: changed.service.state.extras.map((e) =>
      e.id === "kumisaapas" ? { ...e, amount: 2 } : e,
    ),
  });
  await expect(changed.service.transferDisplayed(stale)).rejects.toThrow(
    "draftStale",
  );
  expect(changed.provider.written).toEqual([]);
  // Expiry: a review older than five minutes is not executed.
  const expired = await priced();
  await expired.service.setReviewBeforeTransfer({ enabled: true });
  const review = (await click(expired.service)).review!;
  expired.service.review!.createdAt = new Date(
    Date.now() - 6 * 60 * 1000,
  ).toISOString();
  await expect(
    expired.service.execute({ id: review.id, acknowledged: true }),
  ).rejects.toThrow("quoteExpired");
  expect(expired.service.journal?.verified).toEqual([]);
  expect(expired.provider.written).toEqual([]);
  // Read-back uncertainty: the store shows another basket than the write should have made.
  const uncertain = await priced();
  const original = uncertain.provider.getCart.bind(uncertain.provider);
  let reads = 0;
  uncertain.provider.getCart = async (context) => {
    const cart = await original(context);
    // The read after the first write comes back without that write.
    if (uncertain.provider.writes === 1 && reads++ === 0)
      cart.lines = cart.lines.filter((l) => l.productId !== "milk");
    return cart;
  };
  const result = await click(uncertain.service);
  expect(result.journal).toMatchObject({
    status: "partial",
    error: "verificationFailed",
    uncertain: "milk",
    review: { manual: handed },
  });
  expect(uncertain.provider.written).toEqual(["milk"]);
});

test("a review or journal that names a non-food product is refused at every write boundary before any store call", async () => {
  const { service, provider } = await priced();
  const context = service.state.context;
  const line = service.basket.find((l) => l.requirement.id === "kumisaapas")!;
  const calls = () => provider.searchRequests + provider.written.length;
  const before = calls();
  // A found product is not write authority.
  await expect(
    createReview(provider, context, service.state.revision, [line]),
  ).rejects.toThrow("unsupportedWrite");
  // Neither is a journal made elsewhere or kept from before.
  const baseline = await provider.getCart(context);
  const forged: Journal = {
    review: {
      id: "forged",
      revision: service.state.revision,
      context,
      baseline,
      targets: [
        {
          accountId: baseline.accountId,
          productId: BOOTS,
          name: line.product!.name,
          unit: "kpl",
          before: 0,
          quantity: 1,
          price: 1990,
        },
      ],
      createdAt: new Date().toISOString(),
      total: 1990,
      quotes: [line],
    },
    status: "ready",
    verified: [],
    uncertain: null,
    error: null,
  };
  const saved: Journal[] = [];
  await expect(
    transfer(provider, forged, (j) => void saved.push(j)),
  ).rejects.toThrow("unsupportedWrite");
  expect(saved).toEqual([]);
  expect(calls()).toBe(before);
  expect(provider.written).toEqual([]);
  // The service's own paths refuse it too, and leave the journal as it was.
  service.journal = { ...forged, status: "partial", error: "interrupted" };
  await expect(service.recover()).rejects.toThrow("unsupportedWrite");
  service.journal = null;
  service.review = forged.review;
  await expect(
    service.execute({ id: "forged", acknowledged: true }),
  ).rejects.toThrow("unsupportedWrite");
  expect(service.journal).toBeNull();
  expect(provider.written).toEqual([]);
});

test("a provider that declares the write sends the row through the same verified transfer; the declaration alone decides", async () => {
  const { service, provider } = await priced();
  provider.capabilities = {
    ...provider.capabilities,
    merchandise: { ...provider.merchandise, cartWrite: true },
  } as never;
  expect(service.snapshot().merchandise.manual).toEqual([]);
  const sent = await click(service);
  expect(sent.journal).toMatchObject({ status: "verified" });
  expect(sent.journal!.review.manual).toBeUndefined();
  expect(provider.written).toEqual(["milk", "pasta", BOOTS]);
});
