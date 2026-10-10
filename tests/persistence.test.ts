import { test, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
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
import { stateSchema, initialState, type Product } from "../src/domain/model";

const workerURL = pathToFileURL(join(process.cwd(), "dist/main/worker.js"));
test("appearance defaults old profiles to System and survives save, restart and backup in every mode", async () => {
  const directory = await mkdtemp(join(tmpdir(), "korikone-appearance-"));
  const path = join(directory, "saved.sqlite");
  let database = new Database(path, workerURL);
  try {
    const { appearance: _appearance, ...legacy } = initialState();
    await database.set("state", legacy);
    let service = new Service(database);
    service.developmentMode = true;
    await service.init();
    expect(service.state.appearance).toBe("system");
    expect(stateSchema.parse(legacy).appearance).toBe("system");
    for (const appearance of ["dark", "light", "system"] as const) {
      const revision = service.state.revision;
      await service.save({ ...service.state, appearance });
      expect(service.state.revision).toBe(revision);
      const backup = JSON.parse(JSON.stringify(await service.exportBackup()));
      await database.close();
      database = new Database(path, workerURL);
      service = new Service(database);
      service.developmentMode = true;
      await service.init();
      expect(service.state.appearance).toBe(appearance);
      await service.setAppearance(appearance === "light" ? "dark" : "light");
      await service.importBackup(backup);
      expect(service.state.appearance).toBe(appearance);
      expect((await database.get("state")).appearance).toBe(appearance);
    }
  } finally {
    await database.close();
  }
});

test("invalid appearance values leave the saved profile and backup state intact", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "korikone-appearance-invalid-"),
  );
  const database = new Database(join(directory, "saved.sqlite"), workerURL);
  try {
    const service = new Service(database);
    service.developmentMode = true;
    await service.init();
    await service.setAppearance("dark");
    const before = structuredClone(service.state);
    for (const appearance of ["sepia", "Dark", "", null, false, 1, {}]) {
      await expect(
        service.save({ ...service.state, appearance }),
      ).rejects.toThrow();
      await expect(service.setAppearance(appearance)).rejects.toThrow();
      await expect(
        service.importBackup({ ...service.state, appearance }),
      ).rejects.toThrow();
      expect(service.state).toEqual(before);
      expect(await database.get("state")).toEqual(before);
    }
  } finally {
    await database.close();
  }
});

test("appearance preference changes preserve the priced list, approval and revision", async () => {
  const directory = await mkdtemp(join(tmpdir(), "korikone-appearance-list-"));
  const database = new Database(join(directory, "saved.sqlite"), workerURL);
  try {
    const service = new Service(database);
    service.developmentMode = true;
    await service.init();
    await service.save({
      ...service.state,
      meals: [
        {
          id: "meal",
          recipeId: "pasta",
          day: 0,
          servings: 4,
          leftovers: false,
        },
      ],
    });
    await service.buildBasket();
    await service.prepare();
    const before = service.snapshot();
    await service.save({ ...service.state, appearance: "dark" });
    expect(service.basket).toBe(before.basket);
    expect(service.review).toBe(before.review);
    expect(service.quotedAt).toBe(before.quotedAt);
    expect(service.state.revision).toBe(before.state.revision);
    // Preference writes can run while planning is busy, without replacing its state.
    service.busy = true;
    await service.setAppearance("light");
    expect(service.state.appearance).toBe("light");
    expect(service.basket).toBe(before.basket);
    expect(service.review).toBe(before.review);
    expect(service.state.revision).toBe(before.state.revision);
  } finally {
    await database.close();
  }
});

test("model preference migrates and survives SQLite and backup restore", async () => {
  const directory = await mkdtemp(join(tmpdir(), "korikone-model-backup-"));
  const path = join(directory, "saved.sqlite");
  let database = new Database(path, workerURL);
  try {
    const { aiModel: _aiModel, ...legacy } = initialState();
    await database.set("state", legacy);
    const service = new Service(database);
    await service.init();
    expect(service.state.aiModel).toBe("auto");
    await service.setAIModel("fixture-large");
    const backup = JSON.stringify(service.state);
    await database.close();
    database = new Database(path, workerURL);
    const restarted = new Service(database);
    await restarted.init();
    expect(restarted.state.aiModel).toBe("fixture-large");
    await restarted.setAIModel("auto");
    await restarted.save({
      ...stateSchema.parse(JSON.parse(backup)),
      revision: restarted.state.revision,
    });
    expect(restarted.state.aiModel).toBe("fixture-large");
  } finally {
    await database.close();
  }
});

test("calendar defaults to empty when an older profile or backup loads", async () => {
  const directory = await mkdtemp(join(tmpdir(), "korikone-calendar-legacy-"));
  const database = new Database(join(directory, "saved.sqlite"), workerURL);
  try {
    const { calendar: _calendar, ...legacy } = initialState();
    await database.set("state", legacy);
    const service = new Service(database);
    service.developmentMode = true;
    await service.init();
    expect(service.state.calendar).toEqual({});
    expect(
      stateSchema.parse(JSON.parse(JSON.stringify(legacy))).calendar,
    ).toEqual({});
  } finally {
    await database.close();
  }
});

test("calendar survives SQLite restart and a JSON backup round trip", async () => {
  const directory = await mkdtemp(join(tmpdir(), "korikone-calendar-backup-"));
  const path = join(directory, "saved.sqlite");
  const backupPath = join(directory, "backup.json");
  let database = new Database(path, workerURL);
  const calendar = {
    "2026-10-09": { mealIds: ["meal-pasta", "meal-soup"], leftovers: false },
    "2026-10-10": { mealIds: [], leftovers: true },
  };
  try {
    const service = new Service(database);
    service.developmentMode = true;
    await service.init();
    await service.save({ ...service.state, calendar });
    await writeFile(backupPath, JSON.stringify(service.state), "utf8");
    await database.close();
    database = new Database(path, workerURL);
    const restarted = new Service(database);
    restarted.developmentMode = true;
    await restarted.init();
    expect(restarted.state.calendar).toEqual(calendar);
    const backup = stateSchema.parse(
      JSON.parse(await readFile(backupPath, "utf8")),
    );
    await restarted.save({ ...restarted.state, calendar: {} });
    await restarted.save({ ...backup, revision: restarted.state.revision });
    expect(restarted.state.calendar).toEqual(calendar);
    expect((await database.get("state")).calendar).toEqual(calendar);
  } finally {
    await database.close();
  }
});

test("invalid calendar data is rejected without replacing the saved profile", async () => {
  const directory = await mkdtemp(join(tmpdir(), "korikone-calendar-invalid-"));
  const database = new Database(join(directory, "saved.sqlite"), workerURL);
  try {
    const service = new Service(database);
    service.developmentMode = true;
    await service.init();
    await service.save(service.state);
    const before = structuredClone(service.state);
    for (const calendar of [
      { "2026-02-30": { mealIds: [], leftovers: false } },
      { "09.10.2026": { mealIds: [], leftovers: false } },
      { "2026-10-09": { mealIds: [""], leftovers: false } },
      { "2026-10-09": { mealIds: [1], leftovers: false } },
      { "2026-10-09": { mealIds: [], leftovers: "yes" } },
    ]) {
      await expect(
        service.save({ ...service.state, calendar }),
      ).rejects.toThrow();
      expect(service.state).toEqual(before);
      expect(await database.get("state")).toEqual(before);
    }
  } finally {
    await database.close();
  }
});

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

test("a profile saved before pack sizes existed still loads, and confirmed sizes survive a backup", async () => {
  const { packSizes: _omitted, ...older } = initialState();
  expect(stateSchema.parse(older).packSizes).toEqual({});
  const directory = await mkdtemp(join(tmpdir(), "korikone-packs-"));
  const database = new Database(join(directory, "saved.sqlite"), workerURL);
  try {
    const service = new Service(database);
    service.developmentMode = true;
    await service.init();
    await service.save({
      ...service.state,
      extras: [{ id: "mince", name: "Jauheliha", amount: 400, unit: "g" }],
    });
    await service.buildBasket();
    const line = service.basket.find((l) => l.requirement.id === "mince");
    expect(line?.candidates.map((p) => p.id)).toContain("mince-unlabelled");
    await service.setPackSize({
      productId: "mince-unlabelled",
      amount: 500,
      unit: "g",
    });
    const confirmed = service.basket.find((l) => l.requirement.id === "mince");
    // At 500 g and 299 c the confirmed pack is now the cheapest way to buy 400 g.
    expect(confirmed?.product?.id).toBe("mince-unlabelled");
    const backup = JSON.parse(JSON.stringify(await service.exportBackup()));
    expect(backup.packSizes).toEqual({
      "mince-unlabelled": { amount: 500, unit: "g" },
    });
    const restored = new Service(database);
    await restored.init();
    expect(restored.state.packSizes).toEqual(backup.packSizes);
    await expect(
      service.setPackSize({ productId: "missing", amount: 1, unit: "g" }),
    ).rejects.toThrow("unresolved");
    await expect(
      service.setPackSize({
        productId: "mince-unlabelled",
        amount: 0,
        unit: "g",
      }),
    ).rejects.toThrow();
  } finally {
    await database.close();
  }
}, 30000);

test("a profile saved before the calendar existed loads, and a calendar survives a backup", async () => {
  const { calendar: _omitted, ...older } = initialState();
  expect(stateSchema.parse(older).calendar).toEqual({});
  expect(() =>
    stateSchema.parse({
      ...older,
      calendar: { tomorrow: { mealIds: [], leftovers: false } },
    }),
  ).toThrow();
  const directory = await mkdtemp(join(tmpdir(), "korikone-calendar-"));
  const database = new Database(join(directory, "saved.sqlite"), workerURL);
  try {
    const service = new Service(database);
    service.developmentMode = true;
    await service.init();
    const calendar = {
      "2026-10-12": { mealIds: ["a", "b"], leftovers: false },
      "2026-10-13": { mealIds: [], leftovers: true },
    };
    await service.save({ ...service.state, calendar });
    const backup = JSON.parse(JSON.stringify(await service.exportBackup()));
    expect(backup.calendar).toEqual(calendar);
    await service.save({ ...service.state, calendar: {} });
    await service.importBackup(backup);
    expect(service.state.calendar).toEqual(calendar);
    const restored = new Service(database);
    await restored.init();
    expect(restored.state.calendar).toEqual(calendar);
  } finally {
    await database.close();
  }
}, 30000);
