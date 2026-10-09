import { test, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Database } from "../src/persistence/database";
import { Service } from "../src/application/service";
import {
  MAX_PRICE_ENTRIES,
  PRICE_KEY,
  limitPrices,
  recordPrices,
  type PriceObservation,
} from "../src/domain/prices";
import type { Product } from "../src/domain/model";

const workerURL = pathToFileURL(join(process.cwd(), "dist/main/worker.js"));

test("migration backup includes committed WAL data and survives restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "korikone-migration-"));
  const path = join(directory, "saved.sqlite");
  const legacy = new DatabaseSync(path);
  legacy.exec(
    "PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE documents (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
  );
  legacy
    .prepare("INSERT INTO documents VALUES (?, ?)")
    .run("recipe", JSON.stringify({ name: "Keitto" }));
  let database = new Database(path, workerURL);
  try {
    expect(await database.get("recipe")).toEqual({ name: "Keitto" });
    const backup = new DatabaseSync(`${path}.before-v1`, { readOnly: true });
    try {
      expect(
        backup.prepare("SELECT value FROM documents WHERE key='recipe'").get()
          ?.value,
      ).toBe(JSON.stringify({ name: "Keitto" }));
      expect(backup.prepare("PRAGMA user_version").get()?.user_version).toBe(0);
    } finally {
      backup.close();
    }
    await database.set("recipe", { name: "Uusi keitto" });
    await database.close();
    database = new Database(path, workerURL);
    expect(await database.get("recipe")).toEqual({ name: "Uusi keitto" });
  } finally {
    await database.close();
    legacy.close();
  }
}, 30000);

test("worker startup failure rejects subsequent requests instead of hanging", async () => {
  const directory = await mkdtemp(join(tmpdir(), "korikone-invalid-db-"));
  const path = join(directory, "invalid.sqlite");
  await writeFile(path, "not a database");
  const database = new Database(path, workerURL);
  try {
    await expect(database.get("state")).rejects.toThrow("storageFailed");
    await expect(database.set("state", {})).rejects.toThrow("storageFailed");
  } finally {
    await database.close();
  }
});

const product = (id: string, price: number | null): Product => ({
  id,
  providerId: "demo-k",
  storeId: "demo-helsinki",
  name: id,
  ingredientId: id,
  packAmount: 500,
  unit: "g",
  price,
  available: true,
  deposit: 0,
  nativeUnit: "kpl",
  increment: 1,
  observedAt: "2026-10-09T00:00:00.000Z",
});
const seen = (date: string, n: number): PriceObservation => ({
  productId: `p${n}`,
  providerId: "demo-k",
  storeId: "demo-helsinki",
  date,
  price: 100,
  unitPrice: 0.2,
});

test("price history keeps one entry per product and day and skips unpriced products", () => {
  const now = new Date("2026-10-09T10:00:00Z");
  const first = recordPrices([], [product("a", 200), product("b", null)], now);
  expect(first).toEqual([
    {
      productId: "a",
      providerId: "demo-k",
      storeId: "demo-helsinki",
      date: "2026-10-09",
      price: 200,
      unitPrice: 0.4,
    },
  ]);
  const again = recordPrices(first, [product("a", 250)], now);
  expect(again).toHaveLength(1);
  expect(again[0].price).toBe(250);
  const nextDay = recordPrices(
    again,
    [product("a", 250)],
    new Date("2026-10-10T10:00:00Z"),
  );
  expect(nextDay).toHaveLength(2);
});

test("price history drops entries older than 365 days, then the oldest beyond 20,000", () => {
  const now = new Date("2026-10-09T10:00:00Z");
  const kept = limitPrices(
    [seen("2025-10-09", 1), seen("2025-10-10", 2), seen("2026-10-09", 3)],
    now,
  );
  expect(kept.map((o) => o.productId)).toEqual(["p2", "p3"]);
  const many = Array.from({ length: MAX_PRICE_ENTRIES + 5 }, (_, n) =>
    seen(n < 5 ? "2026-01-01" : "2026-06-01", n),
  );
  const limited = limitPrices(many, now);
  expect(limited).toHaveLength(MAX_PRICE_ENTRIES);
  expect(limited.some((o) => o.date === "2026-01-01")).toBe(false);
});

test("price history survives a backup round trip and an older backup leaves it alone", async () => {
  const directory = await mkdtemp(join(tmpdir(), "korikone-prices-"));
  const database = new Database(join(directory, "saved.sqlite"), workerURL);
  try {
    const service = new Service(database);
    service.developmentMode = true;
    await service.init();
    await service.buildBasket();
    const history = await service.priceHistory();
    expect(history.length).toBeGreaterThan(0);
    expect(await database.get(PRICE_KEY)).toEqual(history);
    const backup = JSON.parse(JSON.stringify(await service.exportBackup()));
    expect(backup.priceHistory).toEqual(history);

    await database.set(PRICE_KEY, []);
    await service.importBackup(backup);
    expect(await service.priceHistory()).toEqual(history);

    const { priceHistory: _omitted, ...older } = backup;
    await service.importBackup(older);
    expect(await service.priceHistory()).toEqual(history);

    await expect(
      service.importBackup({ ...backup, priceHistory: [{ price: -1 }] }),
    ).rejects.toThrow();
  } finally {
    await database.close();
  }
}, 30000);
