import { expect, test } from "vitest";
import { Service } from "../src/application/service";
import { DemoProvider } from "../src/stores/demo";
import { editPlan } from "./helpers/edit-plan";
import { memoryStorage } from "./helpers/purchase-fixtures";

/** An eight-row priced list whose store answers each search after `delay` ms. */
async function priced(delay = 0) {
  const store = memoryStorage();
  const service = new Service(store.storage);
  service.developmentMode = true;
  const state = editPlan();
  state.skipped = [];
  state.extras.push({ id: "mince", name: "Jauheliha", amount: 400, unit: "g" });
  await store.storage.set("state", state);
  await service.init();
  await service.buildBasket();
  const provider = service.registry.get("demo-k") as DemoProvider;
  const search = provider.searchProducts.bind(provider);
  provider.searchProducts = async (...args) => {
    if (delay) await new Promise((done) => setTimeout(done, delay));
    return search(...args);
  };
  provider.searchRequests = 0;
  const line = () => service.basket.find((l) => l.requirement.id === "mince")!;
  const other = () =>
    line().candidates.find(
      (p) => p.id !== line().product?.id && p.id === "mince-chicken",
    )!;
  return { ...store, service, provider, line, other };
}
const choose = (service: Service, productId: string) =>
  service.accept({ ingredientId: "mince", productId });

test("choosing an alternative already read for the row updates that row only and reads nothing", async () => {
  const { service, provider, line, other, entries, storage } = await priced(20);
  expect(service.basket).toHaveLength(10);
  expect(line().product?.id).toBe("mince");
  const others = structuredClone(
    service.basket.filter((l) => l.requirement.id !== "mince"),
  );
  const quotedAt = service.quotedAt;
  const revision = service.state.revision;
  await service.prepare({ allowMissing: true });
  provider.searchRequests = 0;

  const started = performance.now();
  const snapshot = await choose(service, other().id);
  const elapsed = performance.now() - started;
  // Before B2.8 this one choice priced the whole ten-row list again: 13 store searches and,
  // at 20 ms a search, 404 ms on the development PC (13 October 2026). Now it reads nothing.
  expect(provider.searchRequests).toBe(0);
  expect(elapsed).toBeLessThan(13 * 20);
  expect(line()).toMatchObject({
    product: { id: "mince-chicken" },
    packs: 1,
    total: 329,
    matching: { status: "resolved", reason: "approved" },
  });
  // Every other row is exactly as it was, with the same reading time.
  expect(snapshot.basket.filter((l) => l.requirement.id !== "mince")).toEqual(
    others,
  );
  expect(snapshot.quotedAt).toBe(quotedAt);
  expect(snapshot.state.revision).toBe(revision + 1);
  expect(snapshot.state.accepted["demo-k:demo-helsinki:mince"]).toEqual([
    "mince-chicken",
  ]);
  // A prepared approval belongs to the earlier choice.
  expect(snapshot.review).toBeNull();
  // Using it once saves no preference.
  expect(snapshot.state.categoryPreferences).toEqual([]);
  expect(entries.get("state")).toEqual(service.state);
  expect(provider.writes).toBe(0);

  // The choice and its price survive a restart without a read, and can be swapped back.
  const restarted = new Service(storage);
  restarted.developmentMode = true;
  await restarted.init();
  expect(restarted.basket).toEqual(service.basket);
  expect(
    (restarted.registry.get("demo-k") as DemoProvider).searchRequests,
  ).toBe(0);
  await choose(service, "mince");
  expect(line().product?.id).toBe("mince");
  expect(provider.searchRequests).toBe(0);
});

test("a product not read for this row, an excluded one, a busy list and a failed save change nothing", async () => {
  const { service, provider, line, entries, failNext } = await priced();
  const state = structuredClone(service.state);
  const basket = structuredClone(service.basket);
  // Never offered for this row in this store.
  await expect(choose(service, "milk")).rejects.toThrow("unresolved");
  await expect(choose(service, "invented")).rejects.toThrow("unresolved");
  await expect(
    service.accept({ ingredientId: "nope", productId: "mince" }),
  ).rejects.toThrow("unresolved");
  service.busy = true;
  await expect(choose(service, "mince-chicken")).rejects.toThrow("busy");
  service.busy = false;
  failNext("before");
  await expect(choose(service, "mince-chicken")).rejects.toThrow(
    "storageFailed",
  );
  failNext(null);
  expect(service.state).toEqual(state);
  expect(service.basket).toEqual(basket);
  expect(entries.get("state")).toEqual(state);
  expect(line().product?.id).toBe("mince");
  expect([provider.searchRequests, provider.writes]).toEqual([0, 0]);

  // An exclusion added since the prices were read still applies to the cached candidate.
  await service.save({
    ...service.state,
    household: { ...service.state.household, exclusions: "kanan" },
  });
  await expect(choose(service, "mince-chicken")).rejects.toThrow("unresolved");
});

test("without a quote the choice is saved and nothing is priced until the shopper asks", async () => {
  const { service, provider } = await priced();
  // A store change on a priced list reads the new store; that quote is what a choice needs.
  const before = provider.searchRequests;
  const unquoted = new Service(memoryStorage().storage);
  unquoted.developmentMode = true;
  await unquoted.init();
  await expect(
    unquoted.accept({ ingredientId: "mince", productId: "mince-chicken" }),
  ).rejects.toThrow("unresolved");
  expect(provider.searchRequests).toBe(before);
  expect(service.quotedAt).not.toBeNull();
});
