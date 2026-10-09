import { test, expect } from "vitest";
import {
  UPDATE_INTERVAL_MS,
  checkForUpdate,
  isNewer,
} from "../src/application/updates";

function memory() {
  const entries = new Map<string, unknown>();
  return {
    get: async (key: string) => structuredClone(entries.get(key)),
    set: async (key: string, value: unknown) => {
      entries.set(key, structuredClone(value));
    },
  };
}
const release = (tag: string, extra = {}) => ({
  tag_name: tag,
  html_url: `https://github.com/Vkuparin/korikone/releases/tag/${tag}`,
  ...extra,
});

test("compares versions, with a release newer than its own prerelease", () => {
  expect(isNewer("v0.3.0", "0.2.0-alpha.3")).toBe(true);
  expect(isNewer("0.2.0", "0.2.0-alpha.3")).toBe(true);
  expect(isNewer("0.2.0-alpha.4", "0.2.0-alpha.3")).toBe(true);
  expect(isNewer("0.2.0-alpha.10", "0.2.0-alpha.9")).toBe(true);
  expect(isNewer("0.2.0-alpha.3", "0.2.0-alpha.3")).toBe(false);
  expect(isNewer("0.2.0-alpha.3", "0.2.0")).toBe(false);
  expect(isNewer("0.1.9", "0.2.0-alpha.3")).toBe(false);
  expect(isNewer("nonsense", "0.2.0")).toBe(false);
});

test("reports a newer release, ignores the same one, and survives a failed check", async () => {
  const newer = await checkForUpdate("0.2.0", memory(), async () =>
    release("v0.3.0"),
  );
  expect(newer).toEqual({
    version: "0.3.0",
    url: "https://github.com/Vkuparin/korikone/releases/tag/v0.3.0",
  });
  expect(
    await checkForUpdate("0.3.0", memory(), async () => release("v0.3.0")),
  ).toBeNull();
  expect(
    await checkForUpdate("0.2.0", memory(), async () => {
      throw new Error("offline");
    }),
  ).toBeNull();
  expect(
    await checkForUpdate("0.2.0", memory(), async () => ({ nonsense: true })),
  ).toBeNull();
});

test("ignores drafts, prereleases and release pages outside the project", async () => {
  for (const reply of [
    release("v9.0.0", { draft: true }),
    release("v9.0.0", { prerelease: true }),
    { tag_name: "v9.0.0", html_url: "https://example.com/get-it" },
  ])
    expect(
      await checkForUpdate("0.2.0", memory(), async () => reply),
    ).toBeNull();
});

test("asks at most once a day and reuses the saved answer in between", async () => {
  const db = memory();
  let asked = 0;
  const fetchJson = async () => {
    asked++;
    return release("v0.3.0");
  };
  const start = 1_000_000;
  expect((await checkForUpdate("0.2.0", db, fetchJson, start))?.version).toBe(
    "0.3.0",
  );
  const later = start + UPDATE_INTERVAL_MS - 1;
  expect((await checkForUpdate("0.2.0", db, fetchJson, later))?.version).toBe(
    "0.3.0",
  );
  expect(asked).toBe(1);
  // After installing it, the saved answer no longer counts as an update.
  expect(await checkForUpdate("0.3.0", db, fetchJson, later)).toBeNull();
  await checkForUpdate("0.2.0", db, fetchJson, start + UPDATE_INTERVAL_MS);
  expect(asked).toBe(2);
  // A failure is remembered too, so an offline start does not retry every launch.
  const offline = memory();
  let tries = 0;
  const failing = async () => {
    tries++;
    throw new Error("offline");
  };
  await checkForUpdate("0.2.0", offline, failing, start);
  await checkForUpdate("0.2.0", offline, failing, start + 1000);
  expect(tries).toBe(1);
});
