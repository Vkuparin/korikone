import { test, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Database } from "../src/persistence/database";
import { initialState, stateSchema } from "../src/domain/model";
import { Service } from "../src/application/service";

const workerURL = pathToFileURL(join(process.cwd(), "dist/main/worker.js"));
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
