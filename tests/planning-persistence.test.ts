import { expect, test, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Database } from "../src/persistence/database";
import { Service, type Storage } from "../src/application/service";
import { createService } from "../src/application/development";
import { DemoProvider } from "../src/stores/demo";
import { ScriptedInferenceProvider } from "./helpers/inference";
import { inferenceTasks } from "../src/ai/tasks";
import { planningFixtureReply } from "../src/ai/planning-fixtures";
import { initialState, stateSchema } from "../src/domain/model";
import { restoredQuote } from "../src/application/quotes";
import { diagnostics } from "../src/application/diagnostics";
import type { PlanningRun } from "../src/application/planning";

const worker = pathToFileURL(join(process.cwd(), "dist/main/worker.js"));
const note = "1 l maitoa ja kahvia";
test("F4.3 neutral inference previews piece quantities and commits their metadata through SQLite restart", async () => {
  const env = await fixture();
  let restarted: Database | undefined;
  try {
    const id = await ready(env.service, "500 g banaania");
    expect(env.service.planning.snapshot()!.provisional.rows).toEqual([
      expect.objectContaining({
        status: "resolved",
        approximate: true,
        packs: 3,
        orderUnit: "kpl",
        total: 120,
      }),
    ]);
    await env.service.commitPlanning({ operationId: id });
    await env.db.close();
    restarted = new Database(env.path, worker);
    const restored = new Service(restarted);
    await restored.init();
    expect(restored.basket[0]).toMatchObject({
      approximate: true,
      packs: 3,
      total: 120,
      product: { pieceOrdering: { estimatedWeightGrams: 175 } },
    });
    await restored.prepare();
    expect(restored.review!.targets[0]).toMatchObject({
      quantity: 3,
      unit: "kpl",
      price: 120,
    });
    expect(writes(restored)).toBe(0);
  } finally {
    await (restarted ?? env.db).close();
  }
});
test("weighed estimates commit and restart honestly but cannot become transfer targets", async () => {
  const env = await fixture();
  let restarted: Database | undefined;
  try {
    const id = await ready(env.service, "500 g omenaa ja 1 l maitoa");
    expect(
      env.service.planning
        .snapshot()!
        .provisional.rows.some((row) => row.approximate),
    ).toBe(true);
    const committed = await env.service.commitPlanning({ operationId: id });
    const estimated = committed.basket.find((line) => line.approximate)!;
    expect(estimated).toMatchObject({
      total: 125,
      packs: 0,
      product: { price: null, increment: 0 },
    });
    await expect(env.service.prepare()).rejects.toThrow("unresolved");
    const partial = await env.service.prepare({ allowMissing: true });
    expect(partial.review!.targets).toHaveLength(1);
    expect(partial.review!.unresolved).toContainEqual(estimated.requirement);
    expect(writes(env.service)).toBe(0);
    const quote = await env.db.get("last-quote");
    quote.basket.find(
      (line: { approximate?: boolean }) => line.approximate,
    ).approximate = false;
    expect(restoredQuote(quote, env.service.state)).toBeNull();
    await env.db.close();
    restarted = new Database(env.path, worker);
    const restored = new Service(restarted);
    await restored.init();
    expect(restored.basket).toEqual(committed.basket);
    await expect(restored.prepare()).rejects.toThrow("unresolved");
    expect(writes(restored)).toBe(0);
  } finally {
    await (restarted ?? env.db).close();
  }
});
function session(request = note, output?: unknown) {
  const provider = new ScriptedInferenceProvider(
    "atomic-fixture",
    async () => ({
      completion: "complete",
      text: JSON.stringify(output ?? planningFixtureReply(request, 4)),
    }),
  );
  provider.models[0].capabilities.tasks = inferenceTasks;
  return async (run: PlanningRun) =>
    run.bindInference(provider, (await provider.discoverModels(run.signal))[0]);
}
async function fixture(storage?: (db: Database) => Storage) {
  const directory = await mkdtemp(join(tmpdir(), "korikone-planning-commit-"));
  const path = join(directory, "state.sqlite");
  const db = new Database(path, worker);
  const service = new Service(storage?.(db) ?? db);
  service.developmentMode = true;
  await service.init();
  await service.save({
    ...service.state,
    onboarded: true,
    staples: [],
    note: "Old committed plan",
    extras: [{ id: "coffee", name: "Kahvi", amount: 500, unit: "g" }],
  });
  await service.buildBasket();
  return {
    db,
    path,
    service,
    before: structuredClone(service.snapshot()),
    quote: await db.get("last-quote"),
  };
}
async function ready(service: Service, request = note, output?: unknown) {
  const reply = await service.planShopping(
    { prompt: request, consent: true },
    session(request, output),
  );
  return reply.planning!.operationId;
}
function writes(service: Service) {
  return (service.registry.get("demo-k") as DemoProvider).writes;
}

test("atomic partial commit retains unknown requests, clears approval and restores a validated quote without reads", async () => {
  const env = await fixture();
  let restarted: Database | undefined;
  try {
    await env.service.prepare();
    const oldReview = env.service.review!.id;
    const id = await ready(env.service);
    await env.service.setAppearance("dark");
    const reply = await env.service.commitPlanning({ operationId: id });
    expect(reply.planning).toMatchObject({
      phase: "committed",
      committedRevision: env.before.state.revision + 1,
    });
    expect(reply.state.appearance).toBe("dark");
    expect(reply.state.note).toBe(note);
    expect(reply.review).toBeNull();
    expect(reply.planningIncomplete).toBe(true);
    expect(
      reply.committedIntents.map((intent) => [intent.status, intent.reason]),
    ).toEqual([
      ["resolved", null],
      ["unresolved", "unknown-quantity"],
    ]);
    expect(reply.basket).toHaveLength(1);
    expect(reply.basket[0].total).not.toBeNull();
    expect(
      (await env.service.priceHistory()).some(
        (entry) => entry.productId === reply.basket[0].product!.id,
      ),
    ).toBe(true);
    expect(JSON.stringify(diagnostics(reply, {}))).not.toMatch(
      /kahvia|requestIntents|evidence/,
    );
    expect(writes(env.service)).toBe(0);
    await expect(
      env.service.execute({ id: oldReview, acknowledged: true }),
    ).rejects.toThrow();
    await expect(env.service.prepare()).rejects.toThrow("unresolved");
    await env.service.prepare({ allowMissing: true });
    expect(env.service.review!.unresolvedIntents![0].intent.label).toBe(
      "kahvia",
    );
    expect(writes(env.service)).toBe(0);
    const persisted = await env.db.get("state"),
      quote = await env.db.get("last-quote");
    expect(persisted).toEqual(reply.state);
    expect(restoredQuote(quote, reply.state)?.basket).toEqual(reply.basket);
    await env.db.close();
    restarted = new Database(env.path, worker);
    const restored = new Service(restarted);
    await restored.init();
    expect(restored.snapshot().committedIntents).toEqual(
      reply.committedIntents,
    );
    expect(restored.state).toEqual(reply.state);
    expect(restored.basket).toEqual(reply.basket);
    expect(restored.planning.snapshot()).toBeNull();
    expect(
      (restored.registry.get("demo-k") as DemoProvider).searchRequests,
    ).toBe(0);
    const backup = await restored.exportBackup();
    await restored.importBackup(backup);
    expect(restored.state.requestIntents).toEqual(reply.state.requestIntents);
    expect(restored.snapshot().committedIntents[1].reason).toBe(
      "unknown-quantity",
    );
  } finally {
    await (restarted ?? env.db).close();
  }
});

test("SQLite failure on the quote rolls back the state too and keeps the previous in-memory plan and approval", async () => {
  const env = await fixture();
  try {
    await env.service.prepare();
    const review = structuredClone(env.service.review);
    const id = await ready(env.service);
    const sql = new DatabaseSync(env.path);
    sql.exec(
      "CREATE TRIGGER reject_quote BEFORE INSERT ON documents WHEN NEW.key='last-quote' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;",
    );
    sql.close();
    await expect(
      env.service.commitPlanning({ operationId: id }),
    ).rejects.toThrow("storageFailed");
    expect(env.service.state).toEqual(env.before.state);
    expect(env.service.basket).toEqual(env.before.basket);
    expect(env.service.review).toEqual(review);
    expect(await env.db.get("state")).toEqual(env.before.state);
    expect(await env.db.get("last-quote")).toEqual(env.quote);
    expect(env.service.planning.snapshot()).toMatchObject({
      phase: "failed",
      failure: "commit",
      source: { note },
    });
    expect(writes(env.service)).toBe(0);
  } finally {
    await env.db.close();
  }
});

test("lost commit acknowledgement confirms the durable pair without a second write, and restart restores it", async () => {
  let commits = 0;
  const env = await fixture((db) => ({
    get: (key) => db.get(key),
    set: (key, value) => db.set(key, value),
    setMany: async (entries) => {
      commits++;
      await db.setMany(entries);
      throw new Error("storageFailed");
    },
  }));
  let restarted: Database | undefined;
  try {
    const id = await ready(env.service);
    const committed = await env.service.commitPlanning({ operationId: id });
    expect(committed.planning!.phase).toBe("committed");
    expect(commits).toBe(1);
    expect(env.service.state.note).toBe(note);
    await env.db.close();
    restarted = new Database(env.path, worker);
    const restored = new Service(restarted);
    await restored.init();
    expect(restored.state.note).toBe(note);
    expect(restored.state.revision).toBe(env.before.state.revision + 1);
    expect(restored.snapshot().committedIntents[1].reason).toBe(
      "unknown-quantity",
    );
    expect(restored.basket).toHaveLength(1);
    expect(restored.planning.snapshot()).toBeNull();
    expect(restored.review).toBeNull();
    expect(writes(restored)).toBe(0);
  } finally {
    await (restarted ?? env.db).close();
  }
});

test("restart discards a ready provisional operation and retains the previous committed plan/quote", async () => {
  const env = await fixture();
  let restarted: Database | undefined;
  try {
    await ready(env.service);
    await env.db.close();
    restarted = new Database(env.path, worker);
    const restored = new Service(restarted);
    await restored.init();
    expect(restored.state).toEqual(env.before.state);
    expect(restored.basket).toEqual(env.before.basket);
    expect(restored.planning.snapshot()).toBeNull();
    expect(restored.snapshot().committedIntents).toEqual([]);
    expect(writes(restored)).toBe(0);
  } finally {
    await (restarted ?? env.db).close();
  }
});

test("unreadable acknowledgement blocks further changes/writes until restart establishes the complete saved pair", async () => {
  const env = await fixture((db) => ({
    get: (key) => db.get(key),
    set: (key, value) => db.set(key, value),
    setMany: async (entries) => {
      await db.setMany(entries);
      await db.close();
      throw new Error("storageFailed");
    },
  }));
  let restarted: Database | undefined;
  try {
    const id = await ready(env.service);
    await expect(
      env.service.commitPlanning({ operationId: id }),
    ).rejects.toThrow("commitUnknown");
    expect(env.service.state).toEqual(env.before.state);
    await expect(
      env.service.save({ ...env.service.state, note: "Would overwrite" }),
    ).rejects.toThrow("commitUnknown");
    await expect(env.service.prepare()).rejects.toThrow("commitUnknown");
    await expect(ready(env.service)).rejects.toThrow("commitUnknown");
    restarted = new Database(env.path, worker);
    const restored = new Service(restarted);
    await restored.init();
    expect(restored.state.note).toBe(note);
    expect(restored.basket).toHaveLength(1);
    expect(restored.snapshot().committedIntents[1].reason).toBe(
      "unknown-quantity",
    );
    expect(restored.planning.snapshot()).toBeNull();
    expect(writes(restored)).toBe(0);
  } finally {
    await (restarted ?? env.db).close();
  }
});

test("commit lock rejects cancellation/replacement until acknowledgement and serializes appearance changes", async () => {
  let release: (() => void) | undefined;
  const env = await fixture((db) => ({
    get: (key) => db.get(key),
    set: (key, value) => db.set(key, value),
    setMany: async (entries) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return db.setMany(entries);
    },
  }));
  try {
    const id = await ready(env.service);
    const committing = env.service.commitPlanning({ operationId: id });
    await vi.waitFor(() => expect(release).toBeDefined());
    expect(env.service.planning.snapshot()!.phase).toBe("committing");
    expect(() => env.service.planning.control({ operationId: id })).toThrow(
      "busy",
    );
    await expect(ready(env.service, "kahvia")).rejects.toThrow("busy");
    const appearance = env.service.setAppearance("dark");
    release!();
    await committing;
    await appearance;
    expect(env.service.state.appearance).toBe("dark");
    expect(env.service.state.note).toBe(note);
    expect(env.service.planning.snapshot()!.phase).toBe("committed");
    expect(writes(env.service)).toBe(0);
  } finally {
    release?.();
    await env.db.close();
  }
});

test.each(["cancel", "stale", "forged"] as const)(
  "%s commit input cannot replace the saved plan",
  async (mode) => {
    const env = await fixture();
    try {
      const id = await ready(env.service);
      if (mode === "cancel") env.service.planning.cancel();
      if (mode === "stale")
        await env.service.save({
          ...env.service.state,
          note: "Owner's new note",
        });
      const state = structuredClone(env.service.state);
      await expect(
        env.service.commitPlanning(
          mode === "forged"
            ? { operationId: id, state: initialState() }
            : { operationId: id },
        ),
      ).rejects.toThrow();
      expect(env.service.state).toEqual(state);
      expect(await env.db.get("state")).toEqual(state);
      expect(writes(env.service)).toBe(0);
    } finally {
      await env.db.close();
    }
  },
);

test("old profiles default to no ledger; malformed backup evidence and ordinary ledger edits fail locally", async () => {
  const env = await fixture();
  try {
    const { requestIntents: _ledger, ...legacy } = initialState();
    expect(stateSchema.parse(legacy).requestIntents).toEqual([]);
    const id = await ready(env.service);
    await env.service.commitPlanning({ operationId: id });
    const backup = structuredClone(await env.service.exportBackup());
    backup.requestIntents[0].intent.evidence.start++;
    await expect(env.service.importBackup(backup)).rejects.toThrow();
    await expect(
      env.service.save({ ...env.service.state, requestIntents: [] }),
    ).rejects.toThrow("intentActionRequired");
    const original = structuredClone(env.service.state.requestIntents);
    await env.service.save({
      ...env.service.state,
      quantities: { [`${env.service.state.extras[0].id}:ml`]: 2000 },
    });
    expect(env.service.state.requestIntents).toEqual(original);
    await env.service.save({
      ...env.service.state,
      skipped: [`${env.service.state.extras[0].id}:ml`],
    });
    expect(env.service.snapshot().committedIntents[0].status).toBe("resolved");
    expect(env.service.snapshot().committedIntents[1].reason).toBe(
      "unknown-quantity",
    );
    await env.service.save({
      ...env.service.state,
      note: "A replacement note",
    });
    expect(env.service.state.requestIntents).toEqual([]);
  } finally {
    await env.db.close();
  }
});

test("retained quotes reject forged selection/total and cannot turn a budget omission into a priced product", async () => {
  const env = await fixture();
  try {
    const id = await ready(env.service);
    await env.service.commitPlanning({ operationId: id });
    const quote = await env.db.get("last-quote");
    const forged = structuredClone(quote);
    forged.basket[0].total++;
    expect(restoredQuote(forged, env.service.state)).toBeNull();
    forged.basket[0].total = quote.basket[0].total;
    forged.basket[0].matching.reason = "bounded-out";
    expect(restoredQuote(forged, env.service.state)).toBeNull();
    expect(restoredQuote(quote, env.service.state)).not.toBeNull();
  } finally {
    await env.db.close();
  }
});

test("atomic batches reject duplicate/undefined values before writing any entry", async () => {
  const env = await fixture();
  try {
    await expect(
      env.db.setMany([
        { key: "state", value: "forged" },
        { key: "state", value: "duplicate" },
      ]),
    ).rejects.toThrow("storageFailed");
    await expect(
      env.db.setMany([
        { key: "state", value: "forged" },
        { key: "last-quote", value: undefined },
      ]),
    ).rejects.toThrow("storageFailed");
    expect(await env.db.get("state")).toEqual(env.before.state);
    expect(await env.db.get("last-quote")).toEqual(env.quote);
  } finally {
    await env.db.close();
  }
});

test("development commits atomically write only prefixed state/quote and keep the live profile intact", async () => {
  const env = await fixture();
  try {
    const liveState = await env.db.get("state"),
      liveQuote = await env.db.get("last-quote");
    const development = await createService(env.db, true, []);
    await development.save({ ...development.state, staples: [] });
    const id = await ready(development);
    const committed = await development.commitPlanning({ operationId: id });
    expect(await env.db.get("development:state")).toEqual(committed.state);
    expect(
      restoredQuote(await env.db.get("development:last-quote"), committed.state)
        ?.basket,
    ).toEqual(committed.basket);
    expect(await env.db.get("state")).toEqual(liveState);
    expect(await env.db.get("last-quote")).toEqual(liveQuote);
    expect(writes(development)).toBe(0);
  } finally {
    await env.db.close();
  }
});

test("bounded requirements retain explicit unresolved quote rows and intent coverage through commit/restart", async () => {
  const env = await fixture();
  let restarted: Database | undefined;
  try {
    const ingredients = (prefix: string) =>
      Array.from({ length: 100 }, (_, index) => ({
        id: `${prefix}-${index}`,
        name: `${prefix} food ${index}`,
        amount: 1,
        unit: "g",
      }));
    const request = "First dish ja Second dish";
    const output = {
      recipes: ["first", "second"].map((id) => ({
        id,
        name: `${id} dish`,
        servings: 4,
        ingredients: ingredients(id),
        instructions: "Synthetic recipe",
      })),
      meals: ["first", "second"].map((recipeId) => ({
        recipeId,
        servings: 4,
        leftovers: false,
      })),
      items: [],
      notes: "",
      intents: [
        {
          id: "first",
          kind: "meal",
          label: "First dish",
          evidence: { start: 0, end: 10, quote: "First dish" },
          provenance: "explicit-note",
          quantity: null,
          mealIndex: 0,
          itemIndex: null,
          unresolvedReason: null,
        },
        {
          id: "second",
          kind: "meal",
          label: "Second dish",
          evidence: { start: 14, end: 25, quote: "Second dish" },
          provenance: "explicit-note",
          quantity: null,
          mealIndex: 1,
          itemIndex: null,
          unresolvedReason: null,
        },
      ],
    };
    const id = await ready(env.service, request, output);
    expect(
      env.service.planning
        .snapshot()!
        .coverage.filter((row) => row.status === "bounded-out"),
    ).toHaveLength(100);
    const committed = await env.service.commitPlanning({ operationId: id });
    expect(committed.basket).toHaveLength(200);
    expect(
      committed.basket
        .slice(100)
        .every(
          (line) =>
            line.product === null &&
            line.total === null &&
            line.matching!.reason === "bounded-out",
        ),
    ).toBe(true);
    expect(committed.committedIntents[1].reason).toBe("bounded-out");
    expect(committed.planningIncomplete).toBe(true);
    expect(writes(env.service)).toBe(0);
    await env.db.close();
    restarted = new Database(env.path, worker);
    const restored = new Service(restarted);
    await restored.init();
    expect(restored.basket).toEqual(committed.basket);
    expect(restored.snapshot().committedIntents[1].reason).toBe("bounded-out");
    expect(
      (restored.registry.get("demo-k") as DemoProvider).searchRequests,
    ).toBe(0);
  } finally {
    await (restarted ?? env.db).close();
  }
});
