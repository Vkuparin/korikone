import {
  test,
  expect,
  _electron as electron,
  type Page,
} from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const environment = async (name: string) => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_DATA = await mkdtemp(join(tmpdir(), `korikone-${name}-`));
  env.KORIKONE_TEST_HIDDEN = "1";
  return env;
};
const load = async (page: Page) =>
  (await page.evaluate(() => window.korikone.load())).value;
const counters = async (page: Page) => {
  const value = await load(page);
  return [
    value.developmentCatalogueRequests,
    value.developmentRequests,
    value.developmentStoreWrites,
  ];
};
/** Every status text shown from the first moment of the next page load. */
const recordStatuses = (page: Page) =>
  page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { statuses: string[] }).statuses = seen;
    const read = () => {
      for (const el of document.querySelectorAll('[role="status"]')) {
        const text = el.textContent?.trim();
        if (text && !seen.includes(text)) seen.push(text);
      }
    };
    new MutationObserver(read).observe(document, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    document.addEventListener("DOMContentLoaded", read);
  });
const statuses = (page: Page) =>
  page.evaluate(() => (window as unknown as { statuses: string[] }).statuses);
const working = /Käsitellään|Working/;

test("an empty profile opens to its first screen without any work in progress", async () => {
  const app = await electron.launch({
    args: ["."],
    env: await environment("startup-empty"),
  });
  try {
    const page = await app.firstWindow();
    await expect(
      page.getByRole("button", { name: "Aloita tyhjästä viikosta" }),
    ).toBeVisible();
    await expect(page.locator('[data-operation-status="global"]')).toHaveCount(
      0,
    );
    expect(await counters(page)).toEqual([0, 0, 0]);
    await recordStatuses(page);
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Aloita tyhjästä viikosta" }),
    ).toBeVisible();
    expect((await statuses(page)).filter((s) => working.test(s))).toEqual([]);
    expect(await counters(page)).toEqual([0, 0, 0]);
  } finally {
    await app.close();
  }
});

test("a saved list is restored on launch and on return to the list with no generation, search or transfer", async () => {
  const env = await environment("startup-saved");
  let app = await electron.launch({ args: ["."], env });
  try {
    let page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Aloita tyhjästä viikosta" })
      .click();
    await page.evaluate(async () => {
      const api = window.korikone;
      let saved = { ok: false, error: "draftStale" } as Awaited<
        ReturnType<typeof api.save>
      >;
      for (let i = 0; i < 20 && !saved.ok; i++) {
        const state = (await api.load()).value.state;
        saved = await api.save({
          ...state,
          note: "Tomaattipasta ja maitoa",
          meals: [
            {
              id: "m-pasta",
              recipeId: "pasta",
              day: 0,
              servings: 4,
              leftovers: false,
            },
          ],
          extras: [{ id: "milk", name: "Maito", amount: 1000, unit: "ml" }],
        });
      }
      if (!saved.ok) throw new Error(saved.error);
    });
    const saved = await load(page);
    expect(saved.quotedAt).not.toBeNull();
    await app.close();

    const started = Date.now();
    app = await electron.launch({ args: ["."], env });
    page = await app.firstWindow();
    await expect(page.locator(".grocery-row").first()).toBeVisible();
    const elapsed = Date.now() - started;
    // The saved list, its prices and its reading time are back, and nothing was started.
    const restored = await load(page);
    expect(restored.state.meals).toEqual(saved.state.meals);
    expect(restored.basket).toEqual(saved.basket);
    expect(restored.quotedAt).toBe(saved.quotedAt);
    expect(restored.planning).toBeNull();
    expect(await counters(page)).toEqual([0, 0, 0]);
    await expect(page.locator('[data-operation-status="global"]')).toHaveCount(
      0,
    );
    // Recorded, not asserted as a speed claim: process start to the first visible row.
    test.info().annotations.push({
      type: "launch-to-list-ms",
      description: String(elapsed),
    });

    // The same in the renderer from its first moment: only the local opening notice may show.
    await recordStatuses(page);
    await page.reload();
    await expect(page.locator(".grocery-row").first()).toBeVisible();
    const shown = await statuses(page);
    expect(shown.filter((s) => working.test(s))).toEqual([]);
    for (const text of shown.filter((s) => /Avataan|Opening/.test(s)))
      expect(text).toBe("Avataan tallennettua listaa…");

    // Leaving the list and returning to it starts nothing either.
    await page.getByRole("button", { name: "Asetukset", exact: true }).click();
    await page.getByRole("button", { name: "Reseptit", exact: true }).click();
    await page.getByRole("button", { name: "Ostoslista", exact: true }).click();
    await expect(page.locator(".grocery-row").first()).toBeVisible();
    await expect(page.locator('[data-operation-status="global"]')).toHaveCount(
      0,
    );
    expect(await counters(page)).toEqual([0, 0, 0]);
    expect((await load(page)).quotedAt).toBe(saved.quotedAt);
    expect((await statuses(page)).filter((s) => working.test(s))).toEqual([]);
  } finally {
    await app.close();
  }
});

test("a profile with an interrupted transfer opens truthfully: the list is kept and the interruption is reported, with no new write", async () => {
  const env = await environment("startup-interrupted");
  let app = await electron.launch({ args: ["."], env });
  try {
    let page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Aloita tyhjästä viikosta" })
      .click();
    await page.evaluate(async () => {
      const api = window.korikone;
      let saved = { ok: false, error: "draftStale" } as Awaited<
        ReturnType<typeof api.save>
      >;
      for (let i = 0; i < 20 && !saved.ok; i++) {
        const state = (await api.load()).value.state;
        saved = await api.save({
          ...state,
          extras: [
            { id: "milk", name: "Maito", amount: 1000, unit: "ml" },
            { id: "pasta", name: "Pasta", amount: 500, unit: "g" },
          ],
        });
      }
      if (!saved.ok) throw new Error(saved.error);
      // The development store fails its second write, as an interrupted transfer would.
      await api.scenario("interrupt");
      const value = saved.value;
      await api.transferDisplayed({
        revision: value.state.revision,
        quotedAt: value.quotedAt!,
        batchKey: value.transferBatchKey,
      });
    });
    const interrupted = await load(page);
    expect(interrupted.journal?.status).toBe("partial");
    const writes = interrupted.developmentStoreWrites;
    await app.close();

    app = await electron.launch({ args: ["."], env });
    page = await app.firstWindow();
    await expect(page.locator(".grocery-row").first()).toBeVisible();
    const reopened = await load(page);
    // The saved list and the evidence of the partial transfer are both there.
    expect(reopened.basket.map((l) => l.requirement.id)).toEqual([
      "milk",
      "pasta",
    ]);
    expect(reopened.journal).toMatchObject({
      status: "partial",
      verified: interrupted.journal!.verified,
    });
    // Nothing was retried or started by opening the app.
    expect(reopened.developmentStoreWrites).toBe(0);
    expect(reopened.developmentCatalogueRequests).toBe(0);
    expect(reopened.developmentRequests).toBe(0);
    expect(writes).toBeGreaterThan(0);
    await expect(page.locator('[data-operation-status="global"]')).toHaveCount(
      0,
    );
    // The interruption is stated where the transfer is, not hidden behind a loading state.
    await expect(page.locator(".shopping-total")).toContainText(
      /keskeyty|tarkist/i,
    );
  } finally {
    await app.close();
  }
});

test("a database that cannot be opened ends the process with a startup error log instead of leaving it windowless", async () => {
  const { writeFile, readFile } = await import("node:fs/promises");
  const { spawn } = await import("node:child_process");
  const env = await environment("broken-db");
  const original = "this is not an SQLite database".repeat(200);
  await writeFile(join(env.KORIKONE_TEST_DATA, "korikone.sqlite"), original);
  const electronPath = (await import("electron")).default as unknown as string;
  const child = spawn(electronPath, [".", "--no-sandbox"], { env, stdio: "ignore" });
  const code = await new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Korikone kept running after a failed startup"));
    }, 30000);
    child.on("exit", (exitCode) => {
      clearTimeout(timer);
      resolve(exitCode);
    });
  });
  expect(code).toBe(1);
  expect(
    await readFile(join(env.KORIKONE_TEST_DATA, "startup-error.log"), "utf8"),
  ).not.toBe("");
  // Nothing is reset or deleted.
  expect(
    await readFile(join(env.KORIKONE_TEST_DATA, "korikone.sqlite"), "utf8"),
  ).toBe(original);
});
