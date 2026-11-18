import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { completeFixtureLogin, fixtureTab } from "./store-helpers";

for (const [chain, name, destination] of [
  ["k-ruoka", "K-Ruoka", "/kauppa/ostoskori"],
  ["s-kaupat", "S-kaupat", "/ostoslistat/lista-1"],
])
  test(`${name}: return from a verified transfer and send a forgotten grocery once`, async () => {
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
      await page
        .getByLabel("Mitä haluaisit valmistaa?")
        .fill("500 g suodatinjauhettua kahvia ja testimarja");
      // Typing has no side effects; only the update button submits the note.
      expect(
        (await page.evaluate(async () => (await window.korikone.load()).value))
          .developmentRequests,
      ).toBe(0);
      await click("Taio ostoslista");
      await expect(page.locator(".grocery-row .row-name")).toHaveCount(1);
      await expect(page.locator(".transfer-summary")).toContainText(
        "testimarja",
      );
      await click(
        chain === "s-kaupat"
          ? /^Siirrä ja avaa S-kaupat-lista/
          : /^Siirrä ja avaa K-Ruoan ostoskori/,
      );
      expect(clicks).toBe(10);
      await expect(
        page.getByRole("button", { name: "Kauppa", exact: true }),
      ).toHaveAttribute("aria-current", "page");
      const handoff = page.getByRole("region", { name: "Siirto kauppaan" });
      await expect(handoff).toContainText(
        chain === "s-kaupat" ? "S-kauppojen ostoskoriin" : "viimeistele tilaus",
      );
      await expect(
        handoff.getByText("testimarja", { exact: true }),
      ).toBeVisible();
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
      await handoff
        .getByRole("button", { name: "Palaa listaan lisäämään tuote" })
        .click();
      const input = page.getByLabel("Lisää tuote", { exact: true });
      await expect(input).toBeFocused();
      const read = async () =>
        (await page.evaluate(() => window.korikone.load())).value;
      expect((await read()).developmentStoreWrites).toBe(
        snapshot.developmentStoreWrites,
      );
      await input.fill("Maito");
      await page.getByLabel("Tuotteen yksikkö").selectOption("l");
      await click("Lisää tuote listaan");
      await click("Näytä siirrettävät tuotteet");
      await expect(page.locator(".transfer-result")).toHaveCount(0);
      const send = page.getByRole("button", {
        name: "Siirrä lisäykset kauppaan",
        exact: true,
      });
      await expect(send).toBeFocused();
      const summary = page.locator(".transfer-summary");
      await expect(summary).toContainText(
        /Lisäykset edellisen siirron jälkeen.*[Mm]aito.*× 1/,
      );
      await expect(summary.locator("p").first()).not.toContainText(
        snapshot.journal!.review.targets[0].name,
      );
      // The details sit in the collapsed transfer summary (B7.1).
      await summary.locator("> summary").click();
      await summary.getByText(/Siirretty aiemmin tältä listalta/).click();
      await expect(summary.getByRole("listitem")).toHaveText(
        `${snapshot.journal!.review.targets[0].name} × 1`,
      );
      expect((await read()).developmentStoreWrites).toBe(
        snapshot.developmentStoreWrites,
      );
      await send.click();
      await expect(handoff).toContainText(
        /Lisätty tällä kertaa.*[Mm]aito.*× 1/,
      );
      const updated = await read();
      expect(updated.journal?.review.targets).toEqual([
        expect.objectContaining({ productId: "milk", quantity: 1, before: 0 }),
      ]);
      expect(updated.journal?.review.alreadySent).toEqual([
        expect.objectContaining({
          productId: snapshot.journal!.review.targets[0].productId,
          quantity: 1,
        }),
      ]);
      expect(updated.developmentStoreWrites).toBe(
        snapshot.developmentStoreWrites + 1,
      );
      expect(updated.developmentRequests).toBe(snapshot.developmentRequests);
      await click("Palaa ostoslistaan");
      const result = page.getByRole("region", { name: "Siirron tulos" });
      await result
        .getByRole("button", { name: "Lisää unohtunut tuote" })
        .click();
      await expect(input).toBeFocused();
      await result.getByRole("button", { name: "Sulje", exact: true }).click();
      await click("Avaa kauppa uudelleen");
      await expect(handoff).toBeVisible();
      expect((await read()).developmentStoreWrites).toBe(
        updated.developmentStoreWrites,
      );
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
