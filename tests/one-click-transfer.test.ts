import { expect, test } from "vitest";
import { Service } from "../src/application/service";
import { initialState, stateSchema } from "../src/domain/model";
import { DemoProvider } from "../src/stores/demo";
import { memoryStorage } from "./helpers/purchase-fixtures";

type Chain = "k-ruoka" | "s-kaupat";
/** A priced two-row list at a development stand-in for one chain. */
async function priced(
  chain: Chain,
  change: (service: Service) => void = () => {},
) {
  const memory = memoryStorage();
  const service = new Service(memory.storage);
  service.developmentMode = true;
  const provider = new DemoProvider(chain);
  service.registry.register(provider);
  await service.init();
  service.storeLogins[chain] = "signedIn";
  await service.save({
    ...service.state,
    staples: [],
    meals: [],
    context: (await provider.searchStores())[0],
    extras: [
      { id: "milk", name: "Maito", amount: 2000, unit: "ml" },
      { id: "pasta", name: "Pasta", amount: 500, unit: "g" },
    ],
  });
  change(service);
  await service.buildBasket();
  // The development store basket already holds a few items, as a real one may.
  baskets.set(service, await held(service, provider));
  return { ...memory, service, provider };
}
const click = (service: Service) =>
  service.transferDisplayed({
    revision: service.state.revision,
    quotedAt: service.quotedAt!,
    batchKey: service.snapshot().transferBatchKey,
  });
/** What the transfer added on top of the items the store basket already held. */
const baskets = new WeakMap<Service, Record<string, number>>();
const held = async (service: Service, provider: DemoProvider) =>
  Object.fromEntries(
    (await provider.getCart(service.state.context)).lines.map((l) => [
      l.productId,
      l.quantity,
    ]),
  );
const cartOf = async (service: Service, provider: DemoProvider) => {
  const before = baskets.get(service) ?? {};
  return Object.fromEntries(
    Object.entries(await held(service, provider))
      .map(([id, quantity]) => [id, quantity - (before[id] ?? 0)] as const)
      .filter(([, quantity]) => quantity !== 0),
  );
};

for (const chain of ["k-ruoka", "s-kaupat"] as const)
  test(`${chain}: one click sends the displayed list, and a repeat of the same list writes nothing`, async () => {
    const { service, provider, storage } = await priced(chain);
    expect(service.state.reviewBeforeTransfer).toBe(false);
    const snapshot = await click(service);
    expect(snapshot.transferException).toBeNull();
    expect(snapshot.review).toBeNull();
    expect(snapshot.journal).toMatchObject({
      status: "verified",
      error: null,
      review: {
        // The store basket already held one pasta; quantities are absolute.
        targets: [
          { productId: "milk", before: 0, quantity: 2 },
          { productId: "pasta", before: 1, quantity: 2 },
        ],
      },
    });
    expect(await cartOf(service, provider)).toEqual({ milk: 2, pasta: 1 });
    expect(provider.writes).toBe(2);
    // The same list again: the verified transfer is recognised and nothing is added.
    const again = await click(service);
    expect(again.transferException).toBeNull();
    expect(provider.writes).toBe(2);
    expect(await cartOf(service, provider)).toEqual({ milk: 2, pasta: 1 });
    // The record of what was sent survives a restart.
    const restarted = new Service(storage);
    restarted.developmentMode = true;
    restarted.registry.register(new DemoProvider(chain));
    await restarted.init();
    expect(restarted.journal?.status).toBe("verified");
    expect(restarted.state.listHistory).toHaveLength(1);
  });

test("items already in the store basket, a budget overrun and rows left out need no second approval", async () => {
  const { service, provider } = await priced("s-kaupat", (s) => {
    s.state.household.budget = 1;
    s.state.extras.push({
      id: "unknown",
      name: "Tuntematon ruoka",
      amount: 1,
      unit: "pcs",
    });
  });
  const cart = await provider.getCart(service.state.context);
  cart.lines.push({
    productId: "milk",
    name: "Maito 1 l",
    quantity: 3,
    unit: "kpl",
  });
  provider.carts.set(JSON.stringify(service.state.context), cart);
  expect(
    service.basket.find((l) => l.requirement.id === "unknown")?.product,
  ).toBeNull();

  const snapshot = await click(service);
  expect(snapshot.transferException).toBeNull();
  expect(snapshot.journal?.status).toBe("verified");
  // Absolute quantities: what was there plus what the list needs. The unfound row was not sent
  // and is recorded as left out, never as transferred.
  expect(await cartOf(service, provider)).toEqual({ milk: 5, pasta: 1 });
  expect(snapshot.journal!.review.targets).toMatchObject([
    { productId: "milk", before: 3, quantity: 5 },
    { productId: "pasta", before: 1, quantity: 2 },
  ]);
  expect(snapshot.journal!.review.unresolved!.map((r) => r.id)).toEqual([
    "unknown",
  ]);
  expect(snapshot.journal!.review.total).toBeGreaterThan(1);
  expect(provider.writes).toBe(2);
});

test("a changed price is reconciled and shown; a changed pack, account, store or revision stops", async () => {
  const { service, provider, storage } = await priced("k-ruoka");
  const before = Object.fromEntries(
    service.basket.map((l) => [l.requirement.id, l.total!]),
  );
  provider.priceChange = true;
  const snapshot = await click(service);
  expect(snapshot.transferException).toBeNull();
  expect(snapshot.journal?.status).toBe("verified");
  // Same products and quantities, the store's current prices.
  expect(await cartOf(service, provider)).toEqual({ milk: 2, pasta: 1 });
  expect(snapshot.journal!.review.priceChanges).toEqual([
    {
      productId: "milk",
      name: "Maito 1 l",
      before: before.milk,
      after: before.milk + 40,
    },
    {
      productId: "pasta",
      name: "Pasta 500 g",
      before: before.pasta,
      after: before.pasta + 20,
    },
  ]);
  expect(
    Object.fromEntries(snapshot.basket.map((l) => [l.requirement.id, l.total])),
  ).toEqual({ milk: before.milk + 40, pasta: before.pasta + 20 });
  expect(snapshot.journal!.review.total).toBe(before.milk + before.pasta + 60);
  // The reconciled list is the saved quote and is the batch that counts as sent.
  expect(snapshot.transferBatchKey).toBe(snapshot.journal!.batchKey);
  const restarted = new Service(storage);
  restarted.developmentMode = true;
  const again = new DemoProvider("k-ruoka");
  again.priceChange = true;
  restarted.registry.register(again);
  await restarted.init();
  expect(restarted.basket.map((l) => l.total)).toEqual(
    snapshot.basket.map((l) => l.total),
  );

  // Another pack size is another purchase: nothing is written and the list must be priced again.
  const packs = await priced("k-ruoka");
  const search = packs.provider.searchProducts.bind(packs.provider);
  packs.provider.searchProducts = async (...args) =>
    (await search(...args)).map((p) => ({
      ...p,
      packAmount: p.packAmount * 2,
    }));
  const stopped = await click(packs.service);
  expect(stopped.transferException).toBe("priceChanged");
  expect(stopped.journal ?? null).toBeNull();
  expect(packs.provider.writes).toBe(0);

  // A stale revision or batch never reaches the store.
  const stale = await priced("s-kaupat");
  await expect(
    stale.service.transferDisplayed({
      revision: stale.service.state.revision - 1,
      quotedAt: stale.service.quotedAt!,
      batchKey: stale.service.snapshot().transferBatchKey,
    }),
  ).rejects.toThrow("draftStale");
  await expect(
    stale.service.transferDisplayed({
      revision: stale.service.state.revision,
      quotedAt: stale.service.quotedAt!,
      batchKey: "another list",
    }),
  ).rejects.toThrow("draftStale");
  expect(stale.provider.writes).toBe(0);

  // A different account after a verified transfer is refused before anything is read as done.
  await click(stale.service);
  const cart = await stale.provider.getCart(stale.service.state.context);
  cart.accountId = "another-account";
  stale.provider.carts.set(JSON.stringify(stale.service.state.context), cart);
  await expect(click(stale.service)).rejects.toThrow("accountChanged");
  expect(stale.provider.writes).toBe(2);
});

test("a partial failure stops with a recoverable state instead of asking for another approval", async () => {
  const { service, provider } = await priced("s-kaupat");
  provider.failAfter = 1;
  const failed = await click(service);
  expect(failed.journal?.status).toBe("partial");
  expect(provider.writes).toBe(1);
  // The next click does not write on top of the uncertain state.
  const next = await click(service);
  expect(next.transferException).toBe("recoverFirst");
  expect(next.review).toBeNull();
  expect(provider.writes).toBe(1);
  // Recovery reads the store and completes only what is missing.
  await service.recover();
  await service.execute({ id: service.review!.id, acknowledged: true });
  expect(service.journal?.status).toBe("verified");
  expect(await cartOf(service, provider)).toEqual({ milk: 2, pasta: 1 });
});

test("review before transfer is an explicit, persisted choice and adds one confirmation", async () => {
  // Profiles saved before the setting existed have it off.
  const { reviewBeforeTransfer: _absent, ...legacy } = initialState();
  expect(stateSchema.parse(legacy).reviewBeforeTransfer).toBe(false);

  const { service, provider, storage } = await priced("k-ruoka");
  const revision = service.state.revision;
  const quotedAt = service.quotedAt;
  for (const invalid of [{}, { enabled: "yes" }, { enabled: true, extra: 1 }])
    await expect(service.setReviewBeforeTransfer(invalid)).rejects.toThrow();
  const saved = await service.setReviewBeforeTransfer({ enabled: true });
  // A preference only: the list, its revision and its quote are untouched.
  expect(saved.state.reviewBeforeTransfer).toBe(true);
  expect([saved.state.revision, saved.quotedAt]).toEqual([revision, quotedAt]);
  const restarted = new Service(storage);
  restarted.developmentMode = true;
  restarted.registry.register(new DemoProvider("k-ruoka"));
  await restarted.init();
  expect(restarted.state.reviewBeforeTransfer).toBe(true);

  const reviewed = await click(service);
  expect(reviewed.transferException).toBe("acknowledgeReview");
  expect(reviewed.review).toMatchObject({
    targets: [{ productId: "milk" }, { productId: "pasta" }],
  });
  expect(reviewed.journal ?? null).toBeNull();
  expect(provider.writes).toBe(0);
  const done = await service.execute({
    id: reviewed.review!.id,
    acknowledged: true,
  });
  expect(done.journal?.status).toBe("verified");
  expect(provider.writes).toBe(2);

  // Switching it off returns to one click.
  await service.setReviewBeforeTransfer({ enabled: false });
  await service.save({
    ...service.state,
    extras: [{ id: "pasta", name: "Pasta", amount: 500, unit: "g" }],
  });
  await service.buildBasket();
  expect((await click(service)).transferException).toBeNull();
  expect(service.journal?.status).toBe("verified");
});
