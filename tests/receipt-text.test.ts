import { expect, test } from "vitest";
import { Service } from "../src/application/service";
import { memoryStorage } from "./helpers/purchase-fixtures";

test("receipt text saves only against the text the edit started from, without touching the list", async () => {
  const { storage, entries } = memoryStorage();
  const service = new Service(storage);
  service.developmentMode = true;
  await service.init();
  await service.save({
    ...service.state,
    staples: [],
    extras: [{ id: "milk", name: "Maito", amount: 1000, unit: "ml" }],
  });
  await service.buildBasket();
  await service.prepare({ allowMissing: true });
  const review = service.review;
  const revision = service.state.revision;
  const quotedAt = service.quotedAt;
  const saved = await service.setReceiptText({ text: "rivi 1", base: "" });
  expect(saved.state.receiptText).toBe("rivi 1");
  // Not a list change: revision, quote and the prepared review all stay.
  expect([saved.state.revision, saved.quotedAt, saved.review]).toEqual([
    revision,
    quotedAt,
    review,
  ]);
  expect((entries.get("state") as { receiptText: string }).receiptText).toBe(
    "rivi 1",
  );
  // An edit that started from older text is refused and nothing is overwritten.
  await expect(
    service.setReceiptText({ text: "vanha muokkaus", base: "" }),
  ).rejects.toThrow("receiptTextStale");
  expect(service.state.receiptText).toBe("rivi 1");
  // A failed write keeps the saved text; the caller still has its own copy to retry with.
  const set = storage.set;
  storage.set = async () => {
    throw new Error("storageFailed");
  };
  await expect(
    service.setReceiptText({ text: "rivi 2", base: "rivi 1" }),
  ).rejects.toThrow("storageFailed");
  storage.set = set;
  expect(service.state.receiptText).toBe("rivi 1");
  await service.setReceiptText({ text: "rivi 2", base: "rivi 1" });
  const restarted = new Service(storage);
  await restarted.init();
  expect(restarted.state.receiptText).toBe("rivi 2");
  for (const invalid of [
    { text: "x".repeat(50_001), base: "rivi 2" },
    { text: "x" },
    { text: "x", base: "rivi 2", revision: 1 },
  ])
    await expect(service.setReceiptText(invalid)).rejects.toThrow();
});
