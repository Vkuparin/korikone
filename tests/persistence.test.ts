import { test, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Database } from "../src/persistence/database";

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
});

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
