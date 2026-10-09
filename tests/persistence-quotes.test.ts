import { test, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Database } from "../src/persistence/database";
import { Service } from "../src/application/service";
import { DemoProvider } from "../src/stores/demo";

test("SQLite retains quotes across restart and rejects them after a changed saved list", async () => {
  const directory = await mkdtemp(join(tmpdir(), "korikone-quotes-db-"));
  const path = join(directory, "korikone.sqlite");
  const workerURL = pathToFileURL(join(process.cwd(), "dist/main/worker.js"));
  let db = new Database(path, workerURL);
  try {
    const service = new Service(db);
    await service.init();
    await service.save(service.state);
    await service.buildBasket();
    const basket = structuredClone(service.basket);
    const quotedAt = service.quotedAt;
    await db.close();
    db = new Database(path, workerURL);
    const restarted = new Service(db);
    await restarted.init();
    expect(restarted.basket).toEqual(basket);
    expect(restarted.quotedAt).toBe(quotedAt);
    expect(
      (restarted.registry.get("demo-k") as DemoProvider).searchRequests,
    ).toBe(0);
    await restarted.save({
      ...restarted.state,
      quantities: { "coffee:g": 1000 },
    });
    await db.close();
    db = new Database(path, workerURL);
    const changed = new Service(db);
    await changed.init();
    expect(changed.basket).toEqual([]);
    expect(changed.quotedAt).toBeNull();
    expect(
      (changed.registry.get("demo-k") as DemoProvider).searchRequests,
    ).toBe(0);
  } finally {
    await db.close();
  }
});
