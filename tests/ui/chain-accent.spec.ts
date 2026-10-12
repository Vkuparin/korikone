import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chainPalette, basePalette } from "../fixtures/chain-palette";
import { composer } from "./composer-helper";
import { settingsCategory } from "./settings-helper";

const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1, 7), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};

test("chain accent roles follow the committed store in both modes and keep status and focus separate", async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_DATA = await mkdtemp(join(tmpdir(), "korikone-accent-"));
  env.KORIKONE_TEST_HIDDEN = "1";
  const app = await electron.launch({ args: ["."], env });
  try {
    const page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Kokeile esimerkkiä", exact: true })
      .click();
    await page.evaluate(() => window.korikone.signInAI());
    await page.reload();
    const html = page.locator("html");
    // The engine may serialise #ffffff as #fff; compare the long form.
    const variable = (name: string) =>
      page.evaluate((name) => {
        const value = getComputedStyle(document.documentElement)
          .getPropertyValue(name)
          .trim();
        return /^#[0-9a-f]{3}$/i.test(value)
          ? "#" + [...value.slice(1)].map((c) => c + c).join("")
          : value;
      }, name);
    const roles = async () => ({
      action: await variable("--kk-action"),
      onAction: await variable("--kk-on-action"),
      actionText: await variable("--kk-action-text"),
      actionSoft: await variable("--kk-action-soft"),
      focus: await variable("--kk-focus"),
      warning: await variable("--kk-warning"),
    });
    const expected = (theme: "light" | "dark", chain: "s" | "k") => ({
      ...chainPalette[theme][chain],
      focus: basePalette[theme].focus,
      warning: basePalette[theme].warning,
    });
    const load = () =>
      page.evaluate(async () => (await window.korikone.load()).value);
    const start = await load();

    for (const theme of ["light", "dark"] as const) {
      await page.evaluate(
        (theme) => window.korikone.setAppearance(theme),
        theme,
      );
      await expect(html).toHaveAttribute("data-theme", theme);
      await expect(html).toHaveAttribute("data-chain", "k");
      expect(await roles()).toEqual(expected(theme, "k"));
    }

    // A typed draft survives an open selector, and the accent does not change until commit.
    await composer(page).fill("Pasta");
    await page.getByRole("button", { name: /Vaihda kauppaa/ }).click();
    await expect(page.locator(".context-selector")).toBeVisible();
    await expect(html).toHaveAttribute("data-chain", "k");
    await expect(composer(page)).toHaveValue("Pasta");
    await page.keyboard.press("Escape");

    // The primary action takes the fill, and keyboard focus keeps its own colour.
    const update = page.locator(".update-note");
    await expect(update).toBeEnabled();
    expect(
      await update.evaluate((el) => getComputedStyle(el).backgroundColor),
    ).toBe(rgb(chainPalette.dark.k.action));
    await composer(page).focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    expect(
      await composer(page).evaluate((el) => getComputedStyle(el).outlineColor),
    ).toBe(rgb(basePalette.dark.focus));

    // Committing the other chain re-scopes every role without touching shopping data.
    const switched = await page.evaluate(async (revision) => {
      const api = window.korikone;
      const search = (await api.searchStores("alternate")).value;
      const s = search.storeResults.find((c) => c.providerId === "s-kaupat")!;
      return (
        await api.changeContext({
          context: s,
          revision: (await api.load()).value.state.revision ?? revision,
        })
      ).ok;
    }, start.state.revision);
    expect(switched).toBe(true);
    await expect(html).toHaveAttribute("data-chain", "s");
    expect(await roles()).toEqual(expected("dark", "s"));
    expect(
      await update.evaluate((el) => getComputedStyle(el).backgroundColor),
    ).toBe(rgb(chainPalette.dark.s.action));
    await page.evaluate(() => window.korikone.setAppearance("light"));
    await expect(html).toHaveAttribute("data-theme", "light");
    expect(await roles()).toEqual(expected("light", "s"));
    await expect(composer(page)).toHaveValue("Pasta");
    expect((await load()).developmentRequests).toBe(0);

    // Settings chain cards keep their own labelled identity beside the global accent.
    await page.getByRole("button", { name: "Asetukset", exact: true }).click();
    await settingsCategory(page, "stores", "Kaupat");
    const cards = page.locator("li.chain");
    await expect(cards.locator("strong")).toHaveCount(2);
    const cues = await cards.evaluateAll((items) =>
      items.map((li) => [
        li.querySelector("strong")?.textContent,
        li.getAttribute("data-chain-cue"),
      ]),
    );
    expect(cues).toEqual(
      expect.arrayContaining([
        ["K-Ruoka", "k"],
        ["S-kaupat", "s"],
      ]),
    );
    await expect(html).toHaveAttribute("data-chain", "s");
  } finally {
    await app.close();
  }
});
