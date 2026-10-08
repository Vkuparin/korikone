import { test, expect } from "vitest";
import { Service } from "../src/application/service";
import { DemoProvider } from "../src/stores/demo";
function memory() {
  const entries = new Map<string, unknown>();
  return {
    get: async (key: string) => structuredClone(entries.get(key)),
    set: async (key: string, value: unknown) => {
      entries.set(key, structuredClone(value));
    },
  };
}
async function ready(service: Service) {
  await service.init();
  await service.buildBasket();
  for (const line of [...service.basket])
    await service.accept({
      ingredientId: line.requirement.id,
      productId: line.candidates.find((p) => p.available)!.id,
    });
  await service.prepare();
}
test("language-only changes preserve the approval and quantities", async () => {
  const service = new Service(memory());
  await ready(service);
  const review = structuredClone(service.review);
  const revision = service.state.revision;
  await service.setLanguage("en");
  expect(service.review).toEqual(review);
  expect(service.state.revision).toBe(revision);
});
test("store switching preserves meals and invalidates review without writing carts", async () => {
  const service = new Service(memory());
  await ready(service);
  const meals = structuredClone(service.state.meals);
  await service.save({
    ...service.state,
    context: { ...service.state.context, providerId: "demo-s" },
  });
  expect(service.state.meals).toEqual(meals);
  expect(service.review).toBeNull();
  expect((service.registry.get("demo-k") as DemoProvider).writes).toBe(0);
  expect((service.registry.get("demo-s") as DemoProvider).writes).toBe(0);
});
test("transfer does not advance staple cadence; purchase confirmation does", async () => {
  const service = new Service(memory());
  await ready(service);
  await service.execute({ id: service.review!.id, acknowledged: false });
  expect(service.journal?.status).toBe("verified");
  expect(service.state.staples[0].lastPurchased).toBeNull();
  await service.confirmPurchase();
  const purchased = service.state.staples[0].lastPurchased;
  expect(purchased).not.toBeNull();
  await service.confirmPurchase();
  expect(service.state.staples[0].lastPurchased).toBe(purchased);
});
test("rejects stale and duplicate approvals and enforces budget acknowledgement", async () => {
  const service = new Service(memory());
  await service.init();
  service.state.household.budget = 0;
  await ready(service);
  const id = service.review!.id;
  await expect(service.execute({ id, acknowledged: false })).rejects.toThrow(
    "acknowledgeReview",
  );
  await service.execute({ id, acknowledged: true });
  await expect(service.execute({ id, acknowledged: true })).rejects.toThrow(
    "reviewRequired",
  );
});
test("restart retains partial operations and reconciles successful timeout writes", async () => {
  const storage = memory();
  const service = new Service(storage);
  await ready(service);
  (service.registry.get("demo-k") as DemoProvider).failAfter = 1;
  await service.execute({ id: service.review!.id, acknowledged: false });
  expect(service.journal?.status).toBe("partial");
  const resumed = new Service(storage);
  await resumed.init();
  await resumed.recover();
  expect(resumed.review?.targets).toHaveLength(0);
  await resumed.execute({ id: resumed.review!.id, acknowledged: false });
  expect(resumed.journal?.status).toBe("verified");
});
