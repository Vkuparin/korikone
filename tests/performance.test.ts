import { expect, test } from "vitest";
import { Service } from "../src/application/service";
import { DemoProvider } from "../src/stores/demo";
import { mapConcurrent } from "../src/application/concurrent";
import { memoryStorage } from "./helpers/purchase-fixtures";
import { editPlan } from "./helpers/edit-plan";
import { purchaseInsightsKey } from "../src/ui/insights";
import { OperationTracker } from "../src/application/operation-progress";

test("bounded reads settle failures, preserve order and stop scheduling new work", async () => {
  const started: number[] = [],
    settled: number[] = [];
  await expect(
    mapConcurrent([0, 1, 2, 3], async (item) => {
      started.push(item);
      if (item === 0) throw new Error("readFailed");
      await new Promise((r) => setTimeout(r, 5));
      settled.push(item);
      return item;
    }),
  ).rejects.toThrow("readFailed");
  expect(started).toEqual([0, 1]);
  expect(settled).toEqual([1]);
  expect(
    await mapConcurrent([0, 1, 2], async (i) => {
      await new Promise((r) => setTimeout(r, 3 - i));
      return i;
    }),
  ).toEqual([0, 1, 2]);
});

async function fixture(serial = false) {
  const store = memoryStorage();
  const service = new Service(store.storage);
  await store.storage.set("state", editPlan());
  await service.init();
  const provider = service.registry.get("demo-k") as DemoProvider;
  const search = provider.searchProducts.bind(provider);
  let active = 0,
    maximum = 0,
    reads = 0;
  let queue = Promise.resolve();
  provider.searchProducts = async (...args) => {
    const perform = async () => {
      active++;
      maximum = Math.max(maximum, active);
      reads++;
      try {
        await new Promise((r) => setTimeout(r, 15));
        return await search(...args);
      } finally {
        active--;
      }
    };
    if (!serial) return perform();
    const pending = queue.then(perform);
    queue = pending.then(() => undefined);
    return pending;
  };
  return { service, provider, counts: () => ({ active, maximum, reads }) };
}

test("pricing overlaps only two reads and keeps every quote in input order; preparation keeps fresh checks", async () => {
  const baseline = await fixture(true),
    current = await fixture();
  let at = performance.now();
  await baseline.service.buildBasket();
  const serialMs = performance.now() - at;
  const events: { stage: string; completed?: number }[] = [];
  current.service.onActivity = (event) => events.push(event);
  at = performance.now();
  await current.service.buildBasket();
  const boundedMs = performance.now() - at;
  const quoted = (s: Service) =>
    s.basket.map((l) => [l.requirement.id, l.product?.id, l.packs, l.total]);
  expect(quoted(current.service)).toEqual(quoted(baseline.service));
  expect(current.counts().reads).toBe(baseline.counts().reads);
  expect(current.counts().maximum).toBe(2);
  expect(
    events.filter((e) => e.completed !== undefined).map((e) => e.completed),
  ).toEqual(
    Array.from({ length: current.service.basket.length + 1 }, (_, i) => i),
  );
  const before = current.counts().reads;
  await current.service.prepare({ allowMissing: true });
  expect(current.counts().reads).toBeGreaterThan(before);
  expect(current.counts().maximum).toBe(2);
  expect(current.provider.writes).toBe(0);
  console.log(
    `Pricing fixture: serial ${Math.round(serialMs)} ms, bounded ${Math.round(boundedMs)} ms, ${before} reads; max concurrency ${current.counts().maximum}.`,
  );
});

test("unrelated cloned snapshots do not invalidate purchase views", () => {
  const service = new Service(memoryStorage().storage);
  const before = service.snapshot();
  const next = structuredClone(before);
  next.state.revision++;
  next.state.language = "en";
  next.state.quantities = { "milk:ml": 2000 };
  next.basket = [];
  expect(purchaseInsightsKey(next)).toBe(purchaseInsightsKey(before));
  next.state.staples = [];
  expect(purchaseInsightsKey(next)).not.toBe(purchaseInsightsKey(before));
});

test("pricing an empty list reports valid progress and stores an empty quote", async () => {
  const service = new Service(memoryStorage().storage);
  await service.init();
  await service.newWeek();
  const tracker = new OperationTracker(() => {});
  const id = tracker.start("buildBasket");
  service.onActivity = (step) => tracker.update(id, step);
  await service.buildBasket();
  expect(service.basket).toEqual([]);
  expect(service.quotedAt).not.toBeNull();
  expect(tracker.current).toMatchObject({ stage: "searching", total: null });
});
