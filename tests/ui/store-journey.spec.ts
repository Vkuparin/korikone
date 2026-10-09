import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { completeFixtureLogin, fixtureTab } from "./store-helpers";

for (const [chain, name, destination] of [
  ["k-ruoka", "K-Ruoka", "/kauppa/ostoskori"],
  ["s-kaupat", "S-kaupat", "/ostoslistat/lista-1"],
])
  test(`${name}: setup, explicit update and one transfer open the destination without another approval`, async () => {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
    delete env.ELECTRON_RUN_AS_NODE;
    env.KORIKONE_TEST_DATA = await mkdtemp(
      join(tmpdir(), "korikone-store-journey-"),
    );
    env.KORIKONE_TEST_HIDDEN = "1";
    const app = await electron.launch({
      args: process.env.KORIKONE_EXECUTABLE ? [] : ["."],
      env,
      ...(process.env.KORIKONE_EXECUTABLE
        ? { executablePath: process.env.KORIKONE_EXECUTABLE }
        : {}),
    });
    try {
      // Observe external openings without replacing any application handlers or hiding a call.
      await app.evaluate(({ shell }) => {
        (globalThis as any).externalCalls = [];
        const original = shell.openExternal;
        shell.openExternal = async (...args) => {
          (globalThis as any).externalCalls.push(args);
          return original(...args);
        };
      });
      const page = await app.firstWindow();
      let clicks = 0;
      const click = async (name: string | RegExp) => {
        await page
          .getByRole("button", { name, exact: typeof name === "string" })
          .click();
        clicks++;
      };
      await click("Ota käyttöön");
      await page.getByRole("textbox").fill("Helsinki");
      await click("Etsi");
      await click(`${name} · Helsinki (fixture)`);
      await click("Kirjaudu kauppaan");
      await completeFixtureLogin(app, page, chain);
      clicks += 2; // One fixture sign-in button and one return to setup.
      await click("Continue with ChatGPT");
      await click("Valmis");
      await page.getByLabel("Mitä haluaisit valmistaa?").fill("Kahvia");
      // Typing has no side effects; only the update button submits the note.
      expect(
        (await page.evaluate(async () => (await window.korikone.load()).value))
          .developmentRequests,
      ).toBe(0);
      await click("Päivitä lista");
      await expect(page.locator(".grocery-row .row-name")).toHaveCount(1);
      await click(
        chain === "s-kaupat"
          ? /^Siirrä ja avaa S-kaupat-lista/
          : /^Siirrä ja avaa K-Ruoan ostoskori/,
      );
      expect(clicks).toBe(10);
      await expect(
        page.getByRole("button", { name: "Kauppa", exact: true }),
      ).toHaveAttribute("aria-current", "page");
      expect((await fixtureTab(app, chain)).url).toContain(
        `/${chain}${destination}`,
      );
      const snapshot = await page.evaluate(
        async () => (await window.korikone.load()).value,
      );
      expect(snapshot.journal?.status).toBe("verified");
      expect(snapshot.journal?.verified).toHaveLength(1);
      expect(snapshot.developmentRequests).toBe(1);
      expect(snapshot.review).toBeNull();
      expect(snapshot.transferException).toBeNull();
      expect(
        await app.evaluate(
          ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
        ),
      ).toBe(1);
      expect(
        await app.evaluate(() => (globalThis as any).externalCalls),
      ).toEqual([]);
    } finally {
      await app.close();
    }
  });
