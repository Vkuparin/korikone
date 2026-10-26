import { parentPort, workerData } from "node:worker_threads";
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
mkdirSync(dirname(workerData.path), { recursive: true });
// One transaction may replace a whole restore: state, prices, the purchase ledger and up to
// 2,000 kept plus the replaced receipt originals.
const MAX_BATCH = 5000;
const existed = existsSync(workerData.path);
const db = new DatabaseSync(workerData.path);
const version = (
  db.prepare("PRAGMA user_version").get() as { user_version: number }
).user_version;
if (version > 1) throw new Error("newerDatabase");
if (version < 1) {
  // SQLite creates a consistent snapshot, including committed WAL contents.
  if (existed) db.prepare("VACUUM INTO ?").run(`${workerData.path}.before-v1`);
  db.exec(
    "BEGIN; CREATE TABLE IF NOT EXISTS documents (key TEXT PRIMARY KEY, value TEXT NOT NULL); PRAGMA user_version=1; COMMIT;",
  );
}
db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
parentPort!.on("message", ({ id, op, key, value }) => {
  try {
    if (op === "get") {
      const row = db
        .prepare("SELECT value FROM documents WHERE key=?")
        .get(key) as { value: string } | undefined;
      parentPort!.postMessage({
        id,
        value: row ? JSON.parse(row.value) : null,
      });
    } else if (op === "set") {
      db.prepare(
        "INSERT INTO documents(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      ).run(key, JSON.stringify(value));
      parentPort!.postMessage({ id, value: true });
    } else if (op === "setMany") {
      if (
        !Array.isArray(value) ||
        value.length < 1 ||
        value.length > MAX_BATCH ||
        value.some(
          (entry) =>
            !entry ||
            typeof entry.key !== "string" ||
            !entry.key ||
            entry.key.length > 200,
        ) ||
        new Set(value.map((entry) => entry.key)).size !== value.length
      )
        throw new Error("invalidBatch");
      const serialized = value.map((entry) => {
        const json = JSON.stringify(entry.value);
        if (json === undefined) throw new Error("invalidBatch");
        return { key: entry.key, json };
      });
      db.exec("BEGIN IMMEDIATE;");
      try {
        const write = db.prepare(
          "INSERT INTO documents(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        );
        for (const entry of serialized) write.run(entry.key, entry.json);
        db.exec("COMMIT;");
      } catch (error) {
        db.exec("ROLLBACK;");
        throw error;
      }
      parentPort!.postMessage({ id, value: true });
    } else throw new Error("unsupported");
  } catch {
    parentPort!.postMessage({ id, error: "storageFailed" });
  }
});
