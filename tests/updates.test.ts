import { test, expect } from "vitest";
import {
  UPDATE_INTERVAL_MS,
  acceptsPrereleases,
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

test("ignores drafts and release pages outside the project, and pre-releases once stable", async () => {
  for (const reply of [
    release("v9.0.0", { draft: true }),
    { tag_name: "v9.0.0", html_url: "https://example.com/get-it" },
  ])
    expect(
      await checkForUpdate("0.2.0", memory(), async () => reply),
    ).toBeNull();
  expect(
    await checkForUpdate("1.0.0", memory(), async () =>
      release("v1.1.0-beta.1", { prerelease: true }),
    ),
  ).toBeNull();
});

test("offers pre-releases to 0.x and pre-release installations only", () => {
  expect(acceptsPrereleases("0.11.3")).toBe(true);
  expect(acceptsPrereleases("1.0.0-rc.1")).toBe(true);
  expect(acceptsPrereleases("1.0.0")).toBe(false);
  expect(acceptsPrereleases("2.3.1")).toBe(false);
  expect(acceptsPrereleases("nonsense")).toBe(false);
});

test("finds the newest release in a list where every release is a pre-release (B6.1)", async () => {
  // The shape GitHub returns for /releases: newest first, all marked as pre-releases. The old
  // /releases/latest endpoint answered 404 for this list, so no installation saw an update.
  const list = [
    release("v0.12.0", { draft: true, prerelease: true }),
    release("v0.11.4", { prerelease: true }),
    release("v0.11.3", { prerelease: true }),
    { tag_name: "v0.11.9", html_url: "https://example.com/elsewhere" },
    { nonsense: true },
    release("v0.11.2", { prerelease: true }),
  ];
  let asked = "";
  const found = await checkForUpdate("0.11.3", memory(), async (url) => {
    asked = url;
    return list;
  });
  expect(asked).toBe(
    "https://api.github.com/repos/Vkuparin/korikone/releases?per_page=20",
  );
  expect(found).toEqual({
    version: "0.11.4",
    url: "https://github.com/Vkuparin/korikone/releases/tag/v0.11.4",
  });
  // List order does not matter: the highest eligible version wins.
  expect(
    (await checkForUpdate("0.11.2", memory(), async () => [...list].reverse()))
      ?.version,
  ).toBe("0.11.4");
  expect(await checkForUpdate("0.11.4", memory(), async () => list)).toBeNull();
  // A stable installation skips the pre-releases and takes the newest stable release.
  expect(
    (
      await checkForUpdate("1.0.0", memory(), async () => [
        release("v1.2.0-rc.1", { prerelease: true }),
        release("v1.1.0"),
        release("v1.0.1"),
      ])
    )?.version,
  ).toBe("1.1.0");
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
