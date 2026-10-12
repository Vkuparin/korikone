import { expect, test } from "vitest";
import { stockCubePackageContent } from "../src/domain/package-content";
import { matchRequirement } from "../src/domain/matching";
import { transferableLine } from "../src/domain/planner";
import { createFixtureService } from "./fixtures/ai-shopping/environment";
import { Service } from "../src/application/service";
import type { Requirement } from "../src/domain/model";
const req: Requirement = {
  id: "cube",
  name: "Lihaliemikuutio",
  amount: 2,
  unit: "pcs",
  sources: ["meal"],
};
test.each([
  ["Knorr Lihaliemikuutio 12 x 10 g", 12, 120],
  ["Knorr Lihaliemikuutiot 12 kpl 120 g", 12, 120],
  ["Beef stock cubes 6 pcs 60 g", 6, 60],
] as const)(
  "explicit cube contents %s distinguish count from total weight",
  (name, count, weightGrams) => {
    expect(stockCubePackageContent(name)).toMatchObject({ count, weightGrams });
  },
);
test.each([
  "Lihaliemikuutio 120 g",
  "Lihaliemikuutio",
  "Lihaliemikuutio 12 kpl 10 kpl 120 g",
  "Lihaliemikuutio 12 x 10 g 6 kpl",
  "Lihaliemijauhe 120 g",
  "Lihaliemikuutio keitto 120 g",
  "Lihaliemikuutio 2.5 kpl 120 g",
])("missing/conflicting cube count is never inferred: %s", (name) => {
  expect(stockCubePackageContent(name)).toBeUndefined();
});
test.each(["k-ruoka", "s-kaupat"] as const)(
  "%s known count uses actual normalization and enough whole packs for count and weight",
  async (chain) => {
    const env = await createFixtureService(chain, {
      Lihaliemikuutio: [
        {
          id: "cube-pack",
          name: "Knorr Lihaliemikuutio 12 x 10 g",
          price: 2.49,
        },
      ],
    });
    await env.service.save({
      ...env.service.state,
      extras: [{ ...req, sources: undefined }],
    });
    await env.service.buildBasket();
    const line = env.service.basket[0];
    expect(line).toMatchObject({
      packs: 1,
      total: 249,
      product: { packAmount: 120, unit: "g", packageContent: { count: 12 } },
    });
    expect(transferableLine(line)).toBe(true);
    expect(
      matchRequirement(
        req,
        line.candidates.map((p) => ({ ...p, available: false })),
      ).product,
    ).toBeNull();
    expect(
      matchRequirement({ ...req, amount: 13 }, line.candidates),
    ).toMatchObject({ packs: 2, total: 498 });
    expect(
      matchRequirement({ ...req, amount: 121, unit: "g" }, line.candidates),
    ).toMatchObject({ packs: 2, total: 498 });
    expect(
      matchRequirement({ ...req, name: "Kasvisliemikuutio" }, line.candidates)
        .product,
    ).toBeNull();
    expect(
      matchRequirement({ ...req, unit: "ml" }, line.candidates).product,
    ).toBeNull();
    await expect(
      env.service.setPackSize({
        productId: "cube-pack",
        amount: 1,
        unit: "pcs",
      }),
    ).rejects.toThrow("unresolved");
  },
);
test.each(["k-ruoka", "s-kaupat"] as const)(
  "%s gram-only stock cube count can be explicitly confirmed and retained without guessing",
  async (chain) => {
    const env = await createFixtureService(chain, {
      Lihaliemikuutio: [
        { id: "unknown", name: "Knorr Lihaliemikuutio 120 g", price: 2.49 },
      ],
    });
    await env.service.save({
      ...env.service.state,
      extras: [{ ...req, sources: undefined }],
    });
    await env.service.buildBasket();
    expect(env.service.basket[0]).toMatchObject({
      product: null,
      total: null,
      matching: { reason: "pack" },
      candidates: [{ id: "unknown", packAmount: 120, unit: "g" }],
    });
    await expect(
      env.service.setPackSize({ productId: "unknown", amount: 120, unit: "g" }),
    ).rejects.toThrow("unresolved");
    await expect(
      env.service.setPackSize({
        productId: "foreign",
        amount: 12,
        unit: "pcs",
      }),
    ).rejects.toThrow("unresolved");
    await env.service.setPackSize({
      productId: "unknown",
      amount: 12,
      unit: "pcs",
    });
    await expect(
      env.service.setPackSize({ productId: "unknown", amount: 120, unit: "g" }),
    ).rejects.toThrow("unresolved");
    expect(env.service.basket[0]).toMatchObject({
      packs: 1,
      total: 249,
      product: { packAmount: 12, unit: "pcs" },
    });
    expect(env.service.state.packSizes.unknown).toEqual({
      amount: 12,
      unit: "pcs",
    });
    const restarted = new Service(env.storage);
    restarted.developmentMode = true;
    restarted.registry.register(env.service.registry.get(chain));
    await restarted.init();
    expect(restarted.basket[0]).toMatchObject({
      packs: 1,
      total: 249,
      product: { packAmount: 12, unit: "pcs" },
    });
    expect(transferableLine(restarted.basket[0])).toBe(true);
    expect(restarted.state.categoryPreferences).toEqual([]);
    expect(
      env.tools.every((tool) =>
        ["search_products", "check_basket", "get_delivery_options"].includes(
          tool,
        ),
      ),
    ).toBe(true);
  },
);
