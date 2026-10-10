import { expect, test } from "vitest";
import { Database } from "../src/persistence/database";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  categoryPreferenceSchema,
  categoryPreferencesSchema,
  type CategoryPreference,
} from "../src/domain/preferences";
import { initialState, stateSchema } from "../src/domain/model";
import { Service } from "../src/application/service";
import { requirementQueryHints } from "../src/domain/matching";
import { diagnostics } from "../src/application/diagnostics";
import { pricingKey } from "../src/application/quotes";
import { buildCompactContext } from "../src/ai/context";
import { interpretShopping } from "../src/ai/output";
import { validateDraft } from "../src/ai/draft";
import { InferenceSession } from "../src/ai/provider";
import { ScriptedInferenceProvider } from "./helpers/inference";
import {
  createFixtureService,
  type FixtureChain,
} from "./fixtures/ai-shopping/environment";

const rule = (
  value = "skimmed",
  strength: CategoryPreference["strength"] = "required",
): CategoryPreference => ({
  category: "milk",
  qualifiers: [{ kind: "fat", value }],
  strength,
});
const inventory = [
  { id: "whole", name: "Laktoositon täysmaito 1 l", price: 1 },
  { id: "skim", name: "Laktoositon rasvaton maito 1 l", price: 2 },
  { id: "semi", name: "Kevytmaito 1 l", price: 1.5 },
];
async function fixture(chain: FixtureChain) {
  const catalogue = { "*": [...inventory], inventory };
  const env = await createFixtureService(chain, catalogue);
  await env.service.save({
    ...env.service.state,
    extras: [{ id: "milk", name: "Maito", amount: 1000, unit: "ml" }],
  });
  await env.service.buildBasket();
  return { ...env, catalogue };
}
const remember = (service: Service, preference = rule(), productId = "skim") =>
  service.rememberCategoryPreference({
    revision: service.state.revision,
    requirementKey: "milk:ml",
    productId,
    preference,
  });

test("old profiles default to no rules; the portable array rejects duplicate, inapplicable and private fields", () => {
  const { categoryPreferences: _preferences, ...legacy } = initialState();
  expect(stateSchema.parse(legacy).categoryPreferences).toEqual([]);
  expect(categoryPreferenceSchema.safeParse(rule()).success).toBe(true);
  for (const invalid of [
    [rule(), rule()],
    Array(9).fill(rule()),
    [{ ...rule(), qualifiers: [] }],
    [{ ...rule(), category: "eggs" }],
    [{ ...rule(), qualifiers: [{ kind: "coffee", value: "beans" }] }],
    [
      {
        ...rule(),
        qualifiers: [
          { kind: "fat", value: "skimmed" },
          { kind: "fat", value: "whole" },
        ],
      },
    ],
    [{ ...rule(), productId: "private" }],
    [{ ...rule(), provenance: "model-assumed" }],
    [
      {
        ...rule(),
        qualifiers: [{ kind: "fat", value: "skimmed", evidence: "private" }],
      },
    ],
  ])
    expect(categoryPreferencesSchema.safeParse(invalid).success).toBe(false);
});

test.each(["k-ruoka", "s-kaupat"] as const)(
  "%s: saved type supplies a bounded alias after the generic query misses",
  async (chain) => {
    const catalogue = {
      Maito: [...inventory],
      "rasvaton maito": [inventory[1]],
      inventory,
    };
    const { service, tools } = await createFixtureService(chain, catalogue);
    await service.save({
      ...service.state,
      extras: [{ id: "milk", name: "Maito", amount: 1000, unit: "ml" }],
    });
    await service.buildBasket();
    await remember(service);
    catalogue.Maito = [inventory[0]];
    const reads = tools.filter((t) => t === "search_products").length;
    await service.buildBasket();
    expect(service.basket[0].product?.id).toBe("skim");
    expect(tools.filter((t) => t === "search_products").length - reads).toBe(2);
    expect((await service.operationMetrics()).at(-1)?.searches).toBe(2);
  },
);

test("query hints combine saved fields but preserve current explicit overrides and ignore model-added specificity", () => {
  const req = {
    id: "milk",
    name: "Maito",
    amount: 1000,
    unit: "ml" as const,
    sources: ["extra"],
  };
  const preference: CategoryPreference = {
    ...rule("whole"),
    qualifiers: [
      { kind: "fat", value: "whole" },
      { kind: "lactose", value: "free" },
    ],
  };
  expect(requirementQueryHints(req, { preferences: [preference] })).toEqual([
    "laktoositon täysmaito",
  ]);
  const note = "Rasvaton maito",
    evidence = { start: 0, end: note.length, quote: note };
  expect(
    requirementQueryHints(
      {
        ...req,
        classification: {
          category: "milk",
          provenance: "explicit-note",
          evidence,
          qualifiers: [
            {
              kind: "fat",
              value: "skimmed",
              provenance: "explicit-note",
              evidence,
            },
          ],
        },
      },
      { preferences: [preference], sourceNote: note },
    ),
  ).toEqual(["laktoositon rasvaton maito"]);
  expect(
    requirementQueryHints(
      {
        ...req,
        classification: {
          category: "milk",
          provenance: "model-assumed",
          qualifiers: [
            { kind: "fat", value: "whole", provenance: "model-assumed" },
          ],
        },
      },
      { preferences: [rule()] },
    ),
  ).toEqual(["rasvaton maito"]);
});

test.each(["k-ruoka", "s-kaupat"] as const)(
  "%s: only explicit Remember writes memory, then Edit/Forget/Reset refresh matching",
  async (chain) => {
    const { service, tools } = await fixture(chain);
    const before = structuredClone(service.state);
    await expect(
      service.save({ ...before, categoryPreferences: [rule()] }),
    ).rejects.toThrow("preferenceActionRequired");
    expect(service.state).toEqual(before);
    await service.accept({ ingredientId: "milk", productId: "skim" });
    expect(service.state.categoryPreferences).toEqual([]);
    await remember(service);
    expect(service.state.categoryPreferences).toEqual([rule()]);
    expect(service.basket[0].product?.id).toBe("skim");
    expect(service.state.revision).toBeGreaterThan(before.revision);
    await service.editCategoryPreference({
      revision: service.state.revision,
      preference: rule("whole"),
    });
    expect(service.basket[0].product?.id).toBe("whole");
    expect(service.state.accepted).toEqual({});
    await service.forgetCategoryPreference({
      revision: service.state.revision,
      category: "milk",
    });
    expect(service.state.categoryPreferences).toEqual([]);
    await remember(service);
    await service.resetCategoryPreferences({
      revision: service.state.revision,
    });
    expect(service.state.categoryPreferences).toEqual([]);
    expect(tools.some((t) => /add|set|create|execute/.test(t))).toBe(false);
  },
);

test.each(["k-ruoka", "s-kaupat"] as const)(
  "%s: unavailable Required stays unresolved and Preferred alternatives need approval",
  async (chain) => {
    const { service, catalogue } = await fixture(chain);
    await remember(service);
    catalogue["*"] = [inventory[0], inventory[2]];
    await service.buildBasket();
    expect(service.basket[0].product).toBeNull();
    await expect(
      service.accept({ ingredientId: "milk", productId: "whole" }),
    ).rejects.toThrow("unresolved");
    await service.editCategoryPreference({
      revision: service.state.revision,
      preference: rule("skimmed", "preferred"),
    });
    expect(service.basket[0].product).toBeNull();
    expect(service.basket[0].matching?.reason).toBe("preference-missing");
    await service.accept({ ingredientId: "milk", productId: "whole" });
    expect(service.basket[0].product?.id).toBe("whole");
    expect(service.state.categoryPreferences).toEqual([
      rule("skimmed", "preferred"),
    ]);
    catalogue["*"] = [];
    await service.buildBasket();
    expect(service.basket[0].product).toBeNull();
    expect(service.state.categoryPreferences).toEqual([
      rule("skimmed", "preferred"),
    ]);
  },
);

test("current explicit qualifier overrides one saved field through real draft validation without changing memory", async () => {
  const { service } = await fixture("k-ruoka");
  const saved: CategoryPreference = {
    ...rule("whole"),
    qualifiers: [
      { kind: "fat", value: "whole" },
      { kind: "lactose", value: "free" },
    ],
  };
  await remember(service, saved, "whole");
  const note = "Rasvaton maito";
  const evidence = { start: 0, end: note.length, quote: note };
  service.draft = validateDraft(
    JSON.stringify({
      items: [
        {
          id: "milk",
          name: "Maito",
          amount: 1000,
          unit: "ml",
          classification: {
            category: "milk",
            provenance: "explicit-note",
            evidence,
            qualifiers: [
              {
                kind: "fat",
                value: "skimmed",
                provenance: "explicit-note",
                evidence,
              },
            ],
          },
        },
      ],
    }),
    service.state,
    note,
  );
  service.draftRevision = service.state.revision;
  service.draftNote = note;
  await service.approveDraft();
  await service.buildBasket();
  expect(service.basket[0].product?.id).toBe("skim");
  expect(service.state.categoryPreferences).toEqual([saved]);
  await service.save({
    ...service.state,
    household: { ...service.state.household, exclusions: "rasvaton" },
  });
  await service.buildBasket();
  expect(service.basket[0].product).toBeNull();
  expect(service.state.categoryPreferences).toEqual([saved]);
});

test("portable backup applies to a different chain's SKU, without copying the chosen product identity into the rule", async () => {
  const source = await fixture("k-ruoka");
  await remember(source.service);
  const backup = await source.service.exportBackup();
  const target = await createFixtureService("s-kaupat", {
    "*": inventory.map((p) => ({ ...p, id: "s-" + p.id })),
  });
  await target.service.importBackup({
    ...backup,
    context: target.service.state.context,
    stores: {},
  });
  await target.service.buildBasket();
  expect(target.service.basket[0].product?.id).toBe("s-skim");
  expect(target.service.state.categoryPreferences).toEqual([rule()]);
  expect(JSON.stringify(target.service.state.categoryPreferences)).not.toMatch(
    /productId|storeId|k-ruoka|s-skim/,
  );
});

test("SQLite restart and backup round trip retain explicit rules and invalidate incompatible quotes", async () => {
  const env = await fixture("k-ruoka");
  const path = join(
    await mkdtemp(join(tmpdir(), "korikone-preferences-")),
    "saved.sqlite",
  );
  const worker = pathToFileURL(join(process.cwd(), "dist/main/worker.js"));
  let db = new Database(path, worker);
  try {
    let service = new Service(db);
    service.developmentMode = true;
    service.registry.register(env.service.registry.get("k-ruoka"));
    const { categoryPreferences: _rules, ...legacy } = env.service.state;
    await db.set("state", legacy);
    const oldKey = JSON.parse(pricingKey(env.service.state));
    oldKey.matchingVersion = 1;
    delete oldKey.categoryPreferences;
    await db.set("last-quote", {
      key: JSON.stringify(oldKey),
      context: legacy.context,
      quotedAt: "2026-01-01T00:00:00.000Z",
      pickupFee: null,
      basket: env.service.basket,
    });
    await service.init();
    expect(service.state.categoryPreferences).toEqual([]);
    expect(service.basket).toEqual([]);
    await service.save({
      ...env.service.state,
      revision: service.state.revision,
    });
    await service.buildBasket();
    const key = pricingKey(service.state);
    await remember(service);
    expect(pricingKey(service.state)).not.toBe(key);
    const backup = await service.exportBackup();
    const basket = structuredClone(service.basket);
    await db.close();
    db = new Database(path, worker);
    service = new Service(db);
    service.developmentMode = true;
    service.registry.register(env.service.registry.get("k-ruoka"));
    await service.init();
    expect(service.state.categoryPreferences).toEqual([rule()]);
    expect(service.basket).toEqual(basket);
    await service.resetCategoryPreferences({
      revision: service.state.revision,
    });
    await service.importBackup(backup);
    expect(service.state.categoryPreferences).toEqual([rule()]);
    expect(service.basket).toEqual([]);
    const before = structuredClone(service.state);
    await expect(
      service.importBackup({
        ...backup,
        categoryPreferences: [rule(), rule()],
      }),
    ).rejects.toThrow();
    expect(service.state).toEqual(before);
    expect(JSON.stringify(diagnostics(service.snapshot(), {}))).not.toContain(
      "categoryPreferences",
    );
  } finally {
    await db.close();
  }
});

test("stale, unsupported and invented Remember actions cannot change saved state or quotes", async () => {
  const { service } = await fixture("k-ruoka");
  const before = structuredClone(service.state),
    basket = structuredClone(service.basket);
  for (const bad of [
    {
      revision: before.revision + 1,
      requirementKey: "milk:ml",
      productId: "skim",
      preference: rule(),
    },
    {
      revision: before.revision,
      requirementKey: "other:ml",
      productId: "skim",
      preference: rule(),
    },
    {
      revision: before.revision,
      requirementKey: "milk:ml",
      productId: "semi",
      preference: rule(),
    },
    {
      revision: before.revision,
      requirementKey: "milk:ml",
      productId: "invented",
      preference: rule(),
    },
  ])
    await expect(service.rememberCategoryPreference(bad)).rejects.toThrow();
  await expect(
    service.editCategoryPreference({
      revision: before.revision,
      preference: rule(),
    }),
  ).rejects.toThrow("preferenceMissing");
  expect(service.state).toEqual(before);
  expect(service.basket).toEqual(basket);
});

test("a failed memory write preserves state and quote; a failed refresh retains an explicitly saved edit", async () => {
  const { service, storage, catalogue } = await fixture("k-ruoka");
  const before = structuredClone(service.state),
    basket = structuredClone(service.basket);
  const set = storage.set;
  storage.set = async (key, value) => {
    if (key === "state") throw new Error("storageFailed");
    return set(key, value);
  };
  await expect(remember(service)).rejects.toThrow("storageFailed");
  expect(service.state).toEqual(before);
  expect(service.basket).toEqual(basket);
  storage.set = set;
  await remember(service);
  catalogue["*"] = [inventory[0], inventory[0]];
  await service.editCategoryPreference({
    revision: service.state.revision,
    preference: rule("whole"),
  });
  expect(service.state.categoryPreferences).toEqual([rule("whole")]);
  expect((await storage.get("state")).categoryPreferences).toEqual([
    rule("whole"),
  ]);
  expect(service.basket).toEqual([]);
  expect(service.pricingError).not.toBeNull();
});

test("Forget without a saved rule changes nothing, and Remember preserves unrelated SKU choices", async () => {
  const { service } = await fixture("k-ruoka");
  const otherKey = "k-ruoka:synthetic-store:coffee";
  await service.save({
    ...service.state,
    accepted: { [otherKey]: ["coffee-choice"] },
  });
  await service.buildBasket();
  const before = structuredClone(service.state);
  await service.forgetCategoryPreference({
    revision: before.revision,
    category: "milk",
  });
  expect(service.state).toEqual(before);
  await remember(service);
  expect(service.state.accepted[otherKey]).toEqual(["coffee-choice"]);
});

test("task snapshot sends validated strength and remembered provenance without saving model-generated memory", async () => {
  const { service } = await fixture("k-ruoka");
  await remember(service);
  expect(
    buildCompactContext("Maito", service.state).categoryPreferences[0],
  ).toMatchObject({
    category: "milk",
    strength: "required",
    provenance: "remembered",
    qualifiers: [{ kind: "fat", value: "skimmed", provenance: "remembered" }],
  });
  const provider = new ScriptedInferenceProvider(
    "fixture-memory",
    async () => ({
      text: '{"items":[{"id":"milk","name":"Maito","amount":1000,"unit":"ml"}],"categoryPreferences":[{"category":"milk","qualifiers":[{"kind":"fat","value":"whole"}],"strength":"required"}]}',
      completion: "complete",
    }),
  );
  const session = new InferenceSession(
    provider,
    provider.models[0],
    { maxCalls: 2, maxOutputCharacters: 100000, timeoutMs: 1000 },
    new AbortController().signal,
  );
  const pending = interpretShopping(session, "Maito 1 l", service.state);
  const draft = await pending;
  expect(provider.calls[0].prompt).toContain('"strength":"required"');
  expect(provider.calls[0].prompt).toContain('"provenance":"remembered"');
  service.draft = draft;
  service.draftRevision = service.state.revision;
  service.draftNote = "Maito 1 l";
  await service.approveDraft();
  await service.buildBasket();
  expect(service.state.categoryPreferences).toEqual([rule()]);
  expect(service.basket[0].product?.id).toBe("skim");
});
