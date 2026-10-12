import { expect, test } from "vitest";
import { Service } from "../src/application/service";
import { transfer } from "../src/application/transfer";
import { DemoProvider } from "../src/stores/demo";
import { memoryStorage } from "./helpers/purchase-fixtures";

type Chain = "k-ruoka" | "s-kaupat";
const rows = [
  { id: "milk", name: "Maito", amount: 2000, unit: "ml" as const },
  { id: "pasta", name: "Pasta", amount: 500, unit: "g" as const },
  { id: "tomato", name: "Tomaattimurska", amount: 400, unit: "g" as const },
  { id: "potato", name: "Peruna", amount: 1000, unit: "g" as const },
  { id: "oats", name: "Kaurahiutale", amount: 1000, unit: "g" as const },
];
/** A priced five-row list whose store boundary counts every call and answers after `delay` ms. */
async function measured(chain: Chain, delay = 0) {
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
    extras: rows,
  });
  await service.buildBasket();
  const calls = { search: 0, basket: 0, write: 0 };
  const log: string[] = [];
  const wait = () =>
    delay ? new Promise((done) => setTimeout(done, delay)) : null;
  for (const [name, counter] of [
    ["searchProducts", "search"],
    ["getCart", "basket"],
    ["setQuantity", "write"],
  ] as const) {
    const original = (
      provider[name] as (...args: never[]) => Promise<unknown>
    ).bind(provider);
    (provider as unknown as Record<string, unknown>)[name] = async (
      ...args: never[]
    ) => {
      calls[counter]++;
      log.push(counter);
      await wait();
      return original(...args);
    };
  }
  const click = () =>
    service.transferDisplayed({
      revision: service.state.revision,
      quotedAt: service.quotedAt!,
      batchKey: service.snapshot().transferBatchKey,
    });
  return { ...memory, service, provider, calls, log, click };
}

for (const chain of ["k-ruoka", "s-kaupat"] as const)
  test(`${chain}: a five-row transfer reads each product once and the basket once per write`, async () => {
    const { calls, log, click, service } = await measured(chain);
    const started = performance.now();
    await click();
    const elapsed = performance.now() - started;
    expect(service.journal?.status).toBe("verified");
    // Before B2.10 the same transfer made 10 product reads, 18 basket reads and 5 writes (33
    // calls): every product was read again right after the review had read it, and the basket
    // was read before and after each write and once more at the end. Five of the basket reads
    // here are the store adapter's own check inside each write, which both real adapters also do.
    expect(calls).toEqual({ search: 5, basket: 12, write: 5 });
    // Order: the basket and every product for the review, the basket once more, then one write
    // at a time, each with the adapter's check before it and a read-back after it. No write
    // happens before its checks and none run in parallel.
    expect(log).toEqual([
      "basket",
      ...Array(5).fill("search"),
      "basket",
      ...Array(5).fill(["write", "basket", "basket"]).flat(),
    ]);
    expect(elapsed).toBeLessThan(5000);
  });

test("with 20 ms per store call the measured time follows the call count", async () => {
  const { calls, click, service } = await measured("s-kaupat", 20);
  const started = performance.now();
  await click();
  const elapsed = performance.now() - started;
  expect(service.journal?.status).toBe("verified");
  const total = calls.search + calls.basket + calls.write;
  expect(total).toBe(22);
  // Sequential calls of about 20 ms each. Measured on the development PC on 13 October 2026:
  // 33 calls and 1035 ms before the change, 22 calls and 694 ms after it. Timer granularity
  // makes each wait longer than 20 ms, so only the lower bound is asserted.
  expect(elapsed).toBeGreaterThanOrEqual(22 * 20 - 5);
});

test("an external basket change is still caught before the next write, and the journal stays recoverable", async () => {
  const { service, provider, calls, click } = await measured("s-kaupat");
  const setQuantity = provider.setQuantity.bind(provider);
  let writes = 0;
  provider.setQuantity = async (context, target) => {
    await setQuantity(context, target);
    // Someone else changes the basket right after the second write.
    if (++writes === 2) {
      const cart = await new DemoProvider("s-kaupat").getCart.call(
        provider,
        context,
      );
      cart.lines.push({
        productId: "foreign",
        name: "Muu tuote",
        quantity: 1,
        unit: "kpl",
      });
      provider.carts.set(JSON.stringify(context), cart);
    }
  };
  await click();
  expect(service.journal).toMatchObject({
    status: "partial",
    error: "verificationFailed",
  });
  // The read-back after the second write saw the foreign item; the third write never ran.
  expect(writes).toBe(2);
  expect(service.journal!.verified).toHaveLength(1);
  expect(service.journal!.uncertain).not.toBeNull();
  expect(calls.write).toBe(2);
  const next = await click();
  expect(next.transferException).toBe("recoverFirst");
  expect(writes).toBe(2);
});

test("a review the shopper looked at reads its products again before writing; cancellation writes nothing more", async () => {
  const { service, calls } = await measured("k-ruoka");
  await service.setReviewBeforeTransfer({ enabled: true });
  await service.transferDisplayed({
    revision: service.state.revision,
    quotedAt: service.quotedAt!,
    batchKey: service.snapshot().transferBatchKey,
  });
  expect(calls).toEqual({ search: 5, basket: 1, write: 0 });
  // The confirmation is a separate step, so every product is checked again before the writes.
  await service.execute({ id: service.review!.id, acknowledged: true });
  expect(service.journal?.status).toBe("verified");
  expect(calls).toEqual({ search: 10, basket: 12, write: 5 });

  // A cancelled transfer stops before its next write and stays recoverable.
  const cancelled = await measured("s-kaupat");
  await cancelled.service.setReviewBeforeTransfer({ enabled: true });
  await cancelled.service.transferDisplayed({
    revision: cancelled.service.state.revision,
    quotedAt: cancelled.service.quotedAt!,
    batchKey: cancelled.service.snapshot().transferBatchKey,
  });
  const controller = new AbortController();
  const write = cancelled.provider.setQuantity.bind(cancelled.provider);
  cancelled.provider.setQuantity = async (context, target) => {
    await write(context, target);
    controller.abort();
  };
  const stopped = await transfer(
    cancelled.provider,
    {
      review: cancelled.service.review!,
      status: "ready",
      verified: [],
      uncertain: null,
      error: null,
    },
    () => {},
    controller.signal,
  );
  expect(stopped).toMatchObject({ status: "partial", error: "cancelled" });
  expect(stopped.verified).toHaveLength(1);
  expect(cancelled.calls.write).toBe(1);
});
