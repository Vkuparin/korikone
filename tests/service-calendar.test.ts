import { expect, test } from "vitest";
import { Service } from "../src/application/service";

async function prepared() {
  const entries = new Map<string, unknown>();
  const storage = {
    get: async (key: string) => structuredClone(entries.get(key)),
    set: async (key: string, value: unknown) => {
      entries.set(key, structuredClone(value));
    },
  };
  const service = new Service(storage);
  service.developmentMode = true;
  await service.init();
  await service.buildBasket();
  await service.prepare();
  return { service, storage };
}

test("calendar edits preserve the shopping list, quoted total and approval revision", async () => {
  const { service, storage } = await prepared();
  const before = structuredClone(service.snapshot());
  const calendar = { "2026-10-09": { mealIds: [], leftovers: true } };
  await service.save({ ...service.state, calendar });
  expect(service.state).toEqual({ ...before.state, calendar });
  expect(service.basket).toEqual(before.basket);
  expect(service.review).toEqual(before.review);
  expect(await storage.get("state")).toEqual(service.state);
  // A real shopping edit still invalidates the quotes and their approval.
  await service.save({
    ...service.state,
    household: { ...service.state.household, servings: 2 },
  });
  expect(service.state.revision).toBe(before.state.revision + 1);
  expect(service.basket).toEqual([]);
  expect(service.review).toBeNull();
});

test("failed calendar persistence keeps the current calendar and basket", async () => {
  const { service, storage } = await prepared();
  const before = structuredClone(service.snapshot());
  storage.set = async () => {
    throw new Error("storageFailed");
  };
  await expect(
    service.save({
      ...service.state,
      calendar: { "2026-10-09": { mealIds: [], leftovers: true } },
    }),
  ).rejects.toThrow("storageFailed");
  expect(service.snapshot()).toEqual(before);
});
