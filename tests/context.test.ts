import { expect, test } from "vitest";
import { Service } from "../src/application/service";
import { DemoProvider } from "../src/stores/demo";
import { KRuokaProvider } from "../src/stores/k-ruoka";
import { SKaupatProvider } from "../src/stores/s-kaupat";
import { requirements } from "../src/domain/planner";

async function ready() {
  const entries = new Map<string, unknown>();
  const db = {
    get: async (key: string) => structuredClone(entries.get(key)),
    set: async (key: string, value: unknown) => {
      entries.set(key, structuredClone(value));
    },
  };
  const service = new Service(db);
  await service.init();
  await service.save({ ...service.state, note: "Keep this note" });
  await service.buildBasket();
  await service.prepare();
  const provider = service.registry.get("demo-k") as DemoProvider;
  const context = (await provider.searchStores("alternate"))[0];
  service.storeResults = [context];
  return { service, db, provider, context };
}

test("opening context options and confirming the same choice make no catalogue or state changes", async () => {
  const { service, provider } = await ready();
  const before = service.snapshot();
  const searches = provider.searchRequests;
  const options = await service.getContextOptions();
  expect(options.contextOptions?.fulfillments).toEqual(["pickup", "delivery"]);
  await service.changeContext({
    context: service.state.context,
    revision: service.state.revision,
  });
  expect(provider.searchRequests).toBe(searches);
  expect(service.state).toEqual(before.state);
  expect(service.review).toBe(before.review);
  expect(service.quotedAt).toBe(before.quotedAt);
});

test("confirmed store changes retain groceries and note, refresh quotes, and persist remembered stores", async () => {
  const { service, db, provider, context } = await ready();
  const before = service.snapshot();
  const wanted = requirements(service.state);
  const searches = provider.searchRequests;
  await service.changeContext({
    context: { ...context, storeName: "Forged name" },
    revision: service.state.revision,
  });
  expect(service.state.context).toEqual(context);
  expect(service.state.stores[context.providerId]).toEqual(context);
  expect(service.state.note).toBe(before.state.note);
  expect(requirements(service.state)).toEqual(wanted);
  expect(service.state.revision).toBe(before.state.revision + 1);
  expect(service.review).toBeNull();
  expect(
    service.basket.every((line) => line.product?.storeId === context.storeId),
  ).toBe(true);
  expect(provider.searchRequests).toBe(searches + wanted.length);
  const restarted = new Service(db);
  await restarted.init();
  expect(restarted.state.context).toEqual(context);
  expect(restarted.basket).toEqual(service.basket);
  expect(
    (restarted.registry.get("demo-k") as DemoProvider).searchRequests,
  ).toBe(0);
  expect(provider.writes).toBe(0);
});

test("switching chains reuses the remembered store and preserves both choices and login states", async () => {
  const { service } = await ready();
  const other = (
    await service.registry.get("demo-s").searchStores("alternate")
  )[0];
  await service.save({
    ...service.state,
    stores: { ...service.state.stores, "demo-s": other },
  });
  service.storeResults = [];
  service.storeLogins = { "demo-k": "signedIn", "demo-s": "signedIn" };
  const first = service.state.context;
  await service.changeContext({
    context: other,
    revision: service.state.revision,
  });
  expect(service.state.stores["demo-k"]).toEqual(first);
  expect(service.state.stores["demo-s"]).toEqual(other);
  expect(service.storeLogins).toEqual({
    "demo-k": "signedIn",
    "demo-s": "signedIn",
  });
  await service.changeContext({
    context: first,
    revision: service.state.revision,
  });
  expect(service.state.context).toEqual(first);
});

test("pickup and delivery change only the planning context, and unavailable fulfillment is rejected", async () => {
  const { service, provider } = await ready();
  const before = requirements(service.state);
  await service.changeContext({
    context: { ...service.state.context, fulfillment: "delivery" },
    revision: service.state.revision,
  });
  expect(service.state.context.fulfillment).toBe("delivery");
  expect(service.pickupFee).toBeNull();
  expect(requirements(service.state)).toEqual(before);
  await service.changeContext({
    context: { ...service.state.context, fulfillment: "pickup" },
    revision: service.state.revision,
  });
  const context = (await provider.searchStores("pickup-only"))[0];
  service.storeResults = [context];
  const snapshot = service.snapshot();
  await expect(
    service.changeContext({
      context: { ...context, fulfillment: "delivery" },
      revision: service.state.revision,
    }),
  ).rejects.toThrow("fulfillmentUnavailable");
  expect(service.snapshot()).toEqual(snapshot);
});

test.each(["options", "catalogue", "state"])(
  "%s failure preserves context, quote and approval",
  async (failure) => {
    const { service, db, provider, context } = await ready();
    const before = service.snapshot();
    if (failure === "options") provider.failContext = true;
    if (failure === "catalogue") provider.failSearch = true;
    if (failure === "state")
      db.set = async () => {
        throw new Error("storageFailed");
      };
    await expect(
      service.changeContext({ context, revision: service.state.revision }),
    ).rejects.toThrow(failure === "state" ? "storageFailed" : "storeBusy");
    expect(service.state).toEqual(before.state);
    expect(service.basket).toEqual(before.basket);
    expect(service.review).toBe(before.review);
    expect(service.quotedAt).toBe(before.quotedAt);
    expect(service.busy).toBe(false);
    expect(provider.writes).toBe(0);
  },
);

test("a failed quote-cache write reports the saved context as unpriced", async () => {
  const { service, db, context } = await ready();
  const set = db.set;
  db.set = async (key, value) => {
    if (key === "last-quote") throw new Error("storageFailed");
    await set(key, value);
  };
  const result = await service.changeContext({
    context,
    revision: service.state.revision,
  });
  expect(result.state.context).toEqual(context);
  expect(result.basket).toEqual([]);
  expect(result.quotedAt).toBeNull();
  expect(result.pricingError).toBe("storageFailed");
  const restarted = new Service(db);
  await restarted.init();
  expect(restarted.state.context).toEqual(context);
  expect(restarted.basket).toEqual([]);
});

test("unknown stores and obsolete confirmations cannot change the context", async () => {
  const { service, context, provider } = await ready();
  const searches = provider.searchRequests;
  await expect(
    service.changeContext({
      context: { ...context, storeId: "unknown" },
      revision: service.state.revision,
    }),
  ).rejects.toThrow("storeUnavailable");
  await expect(
    service.changeContext({ context, revision: service.state.revision - 1 }),
  ).rejects.toThrow("draftStale");
  expect(provider.searchRequests).toBe(searches);
});

test("pending context confirmation blocks transfers and rejects an obsolete second confirmation", async () => {
  const { service, context, provider } = await ready();
  const search = provider.searchProducts.bind(provider);
  let signal!: () => void;
  const started = new Promise<void>((resolve) => {
    signal = resolve;
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  provider.searchProducts = async (...args) => {
    signal();
    await gate;
    return search(...args);
  };
  const revision = service.state.revision;
  const pending = service.changeContext({ context, revision });
  await started;
  await expect(service.prepare()).rejects.toThrow("busy");
  await expect(service.changeContext({ context, revision })).rejects.toThrow(
    "busy",
  );
  release();
  await pending;
  await expect(service.changeContext({ context, revision })).rejects.toThrow(
    "draftStale",
  );
  expect(service.state.context).toEqual(context);
  expect(provider.writes).toBe(0);
});

test.each([KRuokaProvider, SKaupatProvider])(
  "live adapters expose pickup only without retailer calls",
  async (Provider) => {
    const { service } = await ready();
    let calls = 0;
    const provider = new Provider(async () => {
      calls++;
      throw new Error("Unexpected retailer call");
    });
    service.registry.register(provider);
    const context = { ...service.state.context, providerId: provider.id };
    service.storeResults = [context];
    expect(
      (await service.getContextOptions(context)).contextOptions?.fulfillments,
    ).toEqual(["pickup"]);
    await expect(
      service.changeContext({
        context: { ...context, fulfillment: "delivery" },
        revision: service.state.revision,
      }),
    ).rejects.toThrow("fulfillmentUnavailable");
    expect(calls).toBe(0);
  },
);
