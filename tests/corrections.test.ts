import { expect, test } from "vitest";
import { createFixtureService } from "./fixtures/ai-shopping/environment";
import { Service } from "../src/application/service";
import { correctRowSchema } from "../src/domain/corrections";
import { stateSchema } from "../src/domain/model";
import { readMetrics } from "../src/application/metrics";

const milk = [
  { id: "whole", name: "Täysmaito 1 l", price: 1 },
  { id: "skim", name: "Rasvaton maito 1 l", price: 2 },
  { id: "unavailable", name: "Kevytmaito 1 l", price: 1.5, available: false },
  { id: "wrong", name: "Maitosuklaa 200 g", price: 0.5 },
];
async function fixture(chain: "k-ruoka" | "s-kaupat") {
  const env = await createFixtureService(chain, {
    Maito: milk,
    "*": [{ id: "pasta", name: "Makaroni 400 g", price: 1 }],
  });
  await env.service.save({
    ...env.service.state,
    extras: [
      { id: "milk", name: "Maito", amount: 1000, unit: "ml" },
      { id: "pasta", name: "Makaroni", amount: 400, unit: "g" },
    ],
  });
  await env.service.buildBasket();
  return env;
}
const replace = (
  service: Service,
  replacementProductId: string | null,
  reason = "wrong-product-type" as
    "wrong-product-type" | "unsuitable-alternative",
) => ({
  revision: service.state.revision,
  requirementKey: "milk:ml",
  reason,
  replacementProductId,
});

test.each(["k-ruoka", "s-kaupat"] as const)(
  "%s: corrections preserve other rows, quote age and memory, with no external reads or writes",
  async (chain) => {
    const { service, tools, storage } = await fixture(chain);
    const other = structuredClone(service.basket[1]);
    const age = service.snapshot().quotedAt;
    const calls = tools.length;
    await service.correctRow(replace(service, "skim"));
    expect(service.basket[0].product?.id).toBe("skim");
    expect(service.state.categoryPreferences).toEqual([]);
    expect(service.basket[1]).toEqual(other);
    expect(service.snapshot().quotedAt).toBe(age);
    await service.correctRow({
      revision: service.state.revision,
      requirementKey: "milk:ml",
      reason: "wrong-quantity",
      amount: 2300,
    });
    expect(service.basket[0]).toMatchObject({
      requirement: { amount: 2300 },
      packs: 3,
      total: 600,
    });
    expect(service.basket[1]).toEqual(other);
    await service.correctRow(
      replace(service, "unavailable", "unsuitable-alternative"),
    );
    expect(service.basket[0]).toMatchObject({
      product: null,
      total: null,
      matching: { reason: "owner-correction", status: "unresolved" },
    });
    const restored = new Service(storage);
    restored.registry.register(service.registry.get(chain));
    await restored.init();
    expect(restored.basket).toEqual(service.basket);
    expect(restored.state.correctionHolds).toHaveLength(1);
    await restored.correctRow(replace(restored, "whole"));
    expect(restored.basket[0].product?.id).toBe("whole");
    expect(restored.state.correctionHolds).toEqual([]);
    expect(tools).toHaveLength(calls);
    const metrics = await service.operationMetrics();
    const corrections = metrics.filter((m) => m.kind === "correction");
    expect(corrections.map((m) => m.corrections)).toEqual([
      { "wrong-product-type": 1 },
      { "wrong-quantity": 1 },
      { "unsuitable-alternative": 1 },
      { "wrong-product-type": 1 },
    ]);
    expect(corrections.every((m) => m.aiCalls === 0 && m.searches === 0)).toBe(
      true,
    );
    expect(JSON.stringify(corrections)).not.toMatch(
      /Täysmaito|skim|milk:ml|synthetic-store/,
    );
  },
);

test("explicit Remember reuses evidence validation; quantity and one-time corrections never create memory", async () => {
  const { service, tools } = await fixture("k-ruoka");
  const other = structuredClone(service.basket[1]);
  const remember = {
    category: "milk",
    qualifiers: [{ kind: "fat", value: "skimmed" }],
    strength: "required",
  };
  const before = structuredClone(service.state);
  await expect(
    service.correctRow({ ...replace(service, "whole"), remember }),
  ).rejects.toThrow("unresolved");
  expect(service.state).toEqual(before);
  const calls = tools.length;
  await service.correctRow({ ...replace(service, "skim"), remember });
  expect(service.state.categoryPreferences).toEqual([remember]);
  expect(service.basket[1]).toEqual(other);
  expect(tools).toHaveLength(calls);
});

test("stale, missing and malformed corrections cannot mutate a row; refused replacements stay held", async () => {
  const { service } = await fixture("k-ruoka");
  const before = structuredClone(service.state);
  await expect(
    service.correctRow({
      ...replace(service, "skim"),
      revision: service.state.revision - 1,
    }),
  ).rejects.toThrow("draftStale");
  await expect(service.correctRow(replace(service, "missing"))).rejects.toThrow(
    "unresolved",
  );
  expect(service.state).toEqual(before);
  expect(
    correctRowSchema.safeParse({
      ...replace(service, null),
      remember: {
        category: "milk",
        qualifiers: [{ kind: "fat", value: "skimmed" }],
        strength: "required",
      },
    }).success,
  ).toBe(false);
  expect(
    correctRowSchema.safeParse({ ...replace(service, "skim"), note: "private" })
      .success,
  ).toBe(false);
  await expect(service.correctRow(replace(service, "wrong"))).rejects.toThrow(
    "unresolved",
  );
  expect(service.state).toEqual(before);
  await service.correctRow(replace(service, null));
  expect(service.basket[0].product).toBeNull();
  await expect(
    service.save({ ...service.state, correctionHolds: [] }),
  ).rejects.toThrow("correctionActionRequired");
  await service.correctRow(replace(service, null));
  expect(service.basket[0].product).toBeNull();
  const legacy = { ...service.state } as Record<string, unknown>;
  delete legacy.correctionHolds;
  expect(stateSchema.parse(legacy).correctionHolds).toEqual([]);
  expect(
    readMetrics([
      {
        kind: "correction",
        outcome: "success",
        latencyMs: 0,
        aiCalls: 0,
        repairCalls: 0,
        payloadCharacters: 0,
        searches: 0,
        resolverCalls: 0,
        unresolved: {},
        corrections: { "private reason": 1 },
      },
    ]),
  ).toEqual([]);
});

test("atomic correction storage failure retains the old row and approval state", async () => {
  const { service, storage } = await fixture("k-ruoka");
  const before = structuredClone(service.snapshot());
  const saved = storage.setMany;
  storage.setMany = async () => {
    throw new Error("storageFailed");
  };
  await expect(service.correctRow(replace(service, "skim"))).rejects.toThrow(
    "storageFailed",
  );
  expect(service.state).toEqual(before.state);
  expect(service.basket).toEqual(before.basket);
  storage.setMany = saved;
});

test("new list clears one-time choices and holds; explicit remembered rules survive", async () => {
  const { service } = await fixture("k-ruoka");
  await service.correctRow(replace(service, "skim"));
  expect(service.state.correctionChoices).toHaveLength(1);
  await service.newWeek();
  expect(Object.values(service.state.accepted)).not.toContainEqual(["skim"]);
  expect(service.state.correctionChoices).toEqual([]);
  expect(service.state.correctionHolds).toEqual([]);
  await service.save({
    ...service.state,
    extras: [{ id: "milk", name: "Maito", amount: 1000, unit: "ml" }],
  });
  await service.buildBasket();
  expect(service.basket[0].product?.id).toBe("whole");
  const remember = {
    category: "milk",
    qualifiers: [{ kind: "fat", value: "skimmed" }],
    strength: "required",
  };
  await service.correctRow({ ...replace(service, "skim"), remember });
  expect(service.state.correctionChoices).toEqual([]);
  await service.newWeek();
  expect(service.state.categoryPreferences).toEqual([remember]);
  await service.save({
    ...service.state,
    extras: [{ id: "milk", name: "Maito", amount: 1000, unit: "ml" }],
  });
  await service.buildBasket();
  expect(service.basket[0].product?.id).toBe("skim");
  await service.correctRow(replace(service, null));
  await service.save({ ...service.state, note: "A new note" });
  expect(service.state.correctionHolds).toEqual([]);
});

test("a lost atomic reply is confirmed by readback; unreadable outcome blocks transfer", async () => {
  const { service, storage } = await fixture("k-ruoka");
  const write = storage.setMany!;
  storage.setMany = async (entries) => {
    await write(entries);
    throw new Error("storageFailed");
  };
  await service.correctRow(replace(service, "skim"));
  expect(service.basket[0].product?.id).toBe("skim");
  const read = storage.get;
  let written = false;
  storage.setMany = async (entries) => {
    await write(entries);
    written = true;
    throw new Error("storageFailed");
  };
  storage.get = async (key) => {
    if (written) throw new Error("storageFailed");
    return read(key);
  };
  await expect(service.correctRow(replace(service, null))).rejects.toThrow(
    "commitUnknown",
  );
  expect(() => service.assertNoProvisionalTransfer()).toThrow("commitUnknown");
});
