import { expect, test } from "vitest";
import { createService } from "../src/application/development";
import { Service } from "../src/application/service";
import type { StoreContext } from "../src/domain/model";
import { DemoProvider } from "../src/stores/demo";
import type { StoreProvider } from "../src/stores/provider";
import { memoryStorage } from "./helpers/purchase-fixtures";

const store = (
  providerId: string,
  storeId = "demo-helsinki",
): StoreContext => ({
  providerId,
  storeId,
  storeName: `${providerId} store`,
  fulfillment: "pickup",
});
/** A fresh profile with both chains present as local stand-ins, as development mode has them. */
async function fresh() {
  const memory = memoryStorage();
  const service = new Service(memory.storage);
  service.developmentMode = true;
  const k = new DemoProvider("k-ruoka");
  const s = new DemoProvider("s-kaupat");
  service.registry.register(k);
  service.registry.register(s);
  await service.init();
  const searches = () =>
    service.registry
      .all()
      .reduce((sum, p) => sum + (p as DemoProvider).searchRequests, 0);
  return { ...memory, service, searches };
}
/** What the main process does for the renderer's `save`. */
const save = (service: Service, change: object) =>
  service.refreshAfterChange(() =>
    service.save({ ...service.state, ...change }),
  );

for (const chain of ["k-ruoka", "s-kaupat"]) {
  test(`${chain}: connecting a first store searches nothing until the shopper asks for prices`, async () => {
    const { service, storage, searches } = await fresh();
    // The starter profile already has a row: the default recurring coffee.
    expect(service.snapshot().pricingState).toBe("unpriced");
    // Onboarding, choosing the store, signing in and finishing setup.
    await save(service, { onboarded: true });
    const chosen = await save(service, { context: store(chain) });
    service.storeLogins[chain] = "signedIn";
    await save(service, { setupComplete: true });
    expect(searches()).toBe(0);
    expect(chosen).toMatchObject({
      pricingState: "unpriced",
      basket: [],
      quotedAt: null,
      pricingError: null,
    });
    expect(service.state.context.providerId).toBe(chain);
    // Returning to the list and restarting restore what is saved and read nothing.
    service.snapshot();
    const restarted = new Service(storage);
    restarted.developmentMode = true;
    const again = new DemoProvider(chain);
    restarted.registry.register(again);
    await restarted.init();
    expect(restarted.snapshot().pricingState).toBe("unpriced");
    expect(again.searchRequests).toBe(0);

    // The explicit request reads the one starter row, once.
    const priced = await service.buildBasket();
    expect(priced.pricingState).toBe("quoted");
    expect(priced.basket.map((l) => l.requirement.name)).toEqual(["Kahvi"]);
    const first = searches();
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThanOrEqual(3);
    // From then on the list is a priced list: it follows a store change as before.
    const other = chain === "k-ruoka" ? "s-kaupat" : "k-ruoka";
    const moved = await save(service, { context: store(other) });
    expect(moved.pricingState).toBe("quoted");
    expect(searches()).toBeGreaterThan(first);
    expect(moved.basket[0].product?.providerId).toBe(other);
    expect(
      service.registry
        .all()
        .reduce((n, p) => n + (p as DemoProvider).writes, 0),
    ).toBe(0);
  });
}

test("the header store selector follows the same rule, and list changes still price", async () => {
  const { service, searches } = await fresh();
  service.storeResults = [store("s-kaupat"), store("k-ruoka")];
  const confirmed = await service.changeContext({
    context: store("s-kaupat"),
    revision: service.state.revision,
  });
  expect(confirmed.state.context.providerId).toBe("s-kaupat");
  expect([confirmed.pricingState, searches()]).toEqual(["unpriced", 0]);
  // A change to the list itself is the shopper asking for that list: it is priced.
  const added = await save(service, {
    extras: [{ id: "milk", name: "Maito", amount: 1000, unit: "ml" }],
  });
  expect(added.pricingState).toBe("quoted");
  const afterList = searches();
  expect(afterList).toBeGreaterThan(0);
  // On the now priced list a confirmed store change reads the new store before committing.
  const switched = await service.changeContext({
    context: store("k-ruoka"),
    revision: service.state.revision,
  });
  expect(switched.pricingState).toBe("quoted");
  expect(searches()).toBeGreaterThan(afterList);
  // Emptying the list leaves nothing to price.
  const emptied = await save(service, { extras: [], staples: [] });
  expect(emptied.pricingState).toBe("empty");
});

test("a failed first read is shown as failed with a retry, never as endless loading", async () => {
  const { service } = await fresh();
  await save(service, { context: store("k-ruoka") });
  const provider = service.registry.get("k-ruoka") as DemoProvider;
  provider.failSearch = true;
  await expect(service.buildBasket()).rejects.toThrow("storeBusy");
  // The explicit request failed; the list stays saved and can be asked again.
  expect(service.busy).toBe(false);
  provider.failSearch = false;
  expect((await service.buildBasket()).pricingState).toBe("quoted");
  // A list change that cannot be priced reports the failure instead of hiding it.
  provider.failSearch = true;
  const failed = await save(service, {
    extras: [{ id: "milk", name: "Maito", amount: 1000, unit: "ml" }],
  });
  expect(failed).toMatchObject({
    pricingState: "failed",
    pricingError: "storeBusy",
  });
});

test("production uses the real adapters and development only ever the local stand-ins", async () => {
  const calls: string[] = [];
  const live = (id: string): StoreProvider => ({
    id,
    capabilities: { catalogue: true, cart: true, orderHistory: false },
    searchStores: async () => [],
    searchProducts: async () => {
      calls.push(id);
      return [];
    },
    getCart: async (context) => ({ accountId: "a", context, lines: [] }),
    setQuantity: async () => {},
  });
  const production = await createService(memoryStorage().storage, false, [
    live("k-ruoka"),
    live("s-kaupat"),
  ]);
  expect(production.developmentMode).toBe(false);
  for (const id of ["k-ruoka", "s-kaupat"])
    expect(production.registry.get(id)).not.toBeInstanceOf(DemoProvider);
  // The sample stores exist in production only under their own demo IDs.
  for (const id of ["demo-k", "demo-s"])
    expect(production.registry.get(id)).toBeInstanceOf(DemoProvider);
  // Connecting a real store on a fresh production profile calls no adapter at all.
  await production.refreshAfterChange(() =>
    production.save({
      ...production.state,
      context: store("k-ruoka", "real-1"),
    }),
  );
  expect(calls).toEqual([]);
  expect(production.snapshot().pricingState).toBe("unpriced");
  // The explicit request reaches the real adapter, and only that chain's.
  await production.buildBasket();
  expect(new Set(calls)).toEqual(new Set(["k-ruoka"]));

  const development = await createService(memoryStorage().storage, true, [
    live("k-ruoka"),
    live("s-kaupat"),
  ]);
  for (const id of ["k-ruoka", "s-kaupat"])
    expect(development.registry.get(id)).toBeInstanceOf(DemoProvider);
  calls.length = 0;
  await development.refreshAfterChange(() =>
    development.save({ ...development.state, context: store("s-kaupat") }),
  );
  await development.buildBasket();
  expect(calls).toEqual([]);
});
