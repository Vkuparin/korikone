import { expect, test } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Database } from "../src/persistence/database";
import { Service } from "../src/application/service";
import { initialState, stateSchema } from "../src/domain/model";
import { PlanningLifecycle } from "../src/application/planning";

test("resolver defaults enabled for old profiles and rejects untyped settings", () => {
  const old = { ...initialState() } as Partial<ReturnType<typeof initialState>>;
  delete old.resolverEnabled;
  expect(stateSchema.parse(old).resolverEnabled).toBe(true);
  expect(
    stateSchema.safeParse({ ...old, resolverEnabled: "false" }).success,
  ).toBe(false);
});

test("resolver setting persists in real SQLite, survives backup parsing and preserves the saved quote", async () => {
  const path = join(
    await mkdtemp(join(tmpdir(), "korikone-resolver-setting-")),
    "state.sqlite",
  );
  const worker = pathToFileURL(resolve("dist/main/worker.js"));
  let db = new Database(path, worker);
  try {
    let service = new Service(db);
    service.developmentMode = true;
    await service.init();
    await service.save({
      ...service.state,
      staples: [],
      extras: [{ id: "milk", name: "Maito", amount: 1000, unit: "ml" }],
    });
    await service.buildBasket();
    const quote = structuredClone(service.basket);
    const date = service.quotedAt;
    await service.save({ ...service.state, resolverEnabled: false });
    expect(service.basket).toEqual(quote);
    expect(service.quotedAt).toBe(date);
    expect(stateSchema.parse(await db.get("state")).resolverEnabled).toBe(
      false,
    );
    await db.close();
    db = new Database(path, worker);
    service = new Service(db);
    service.developmentMode = true;
    await service.init();
    expect(service.state.resolverEnabled).toBe(false);
    expect(service.basket).toEqual(quote);
    expect(service.quotedAt).toBe(date);
  } finally {
    await db.close();
  }
});

test("resolver preference changes invalidate the owned run even without a revision change", () => {
  let state = initialState();
  const lifecycle = new PlanningLifecycle(() => state);
  const run = lifecycle.start("200 ml kermaa");
  state = { ...state, resolverEnabled: false };
  expect(() => run.assertCurrent()).toThrow("draftStale");
  expect(run.snapshot().phase).toBe("obsolete");
});
