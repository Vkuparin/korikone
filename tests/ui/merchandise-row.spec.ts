import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { composer, updateName } from "./composer-helper";

for (const language of ["fi", "en"] as const) {
  const fi = language === "fi";
  const tr = (a: string, b: string) => (fi ? a : b);

  test(`a non-food row asks for its missing size once, answers through one edit and explains the store statement without touching groceries in ${language}`, async () => {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        (e): e is [string, string] => typeof e[1] === "string",
      ),
    );
    delete env.ELECTRON_RUN_AS_NODE;
    env.KORIKONE_TEST_DATA = await mkdtemp(join(tmpdir(), "korikone-nonfood-"));
    env.KORIKONE_TEST_HIDDEN = "1";
    const app = await electron.launch({ args: ["."], env });
    try {
      const page = await app.firstWindow();
      await page
        .getByRole("button", { name: "Aloita tyhjästä viikosta" })
        .click();
      await page.evaluate(async (language) => {
        await window.korikone.setLanguage(language);
        const signedIn = await window.korikone.signInAI();
        if (!signedIn.ok) throw new Error(signedIn.error);
      }, language);
      await page.reload();
      const load = async () =>
        (await page.evaluate(() => window.korikone.load())).value;

      // One note with a grocery and boots without a size.
      await composer(page).fill(
        tr("Maitoa, kumisaappaat", "Maitoa, rubber boots"),
      );
      await page.getByRole("button", { name: updateName }).click();
      const boots = page.locator(".merchandise-row");
      await expect(boots).toHaveCount(1, { timeout: 20000 });
      const planned = await load();
      const bootRow = planned.state.extras.find(
        (e) => e.merchandise?.missing.length,
      );
      expect(bootRow?.merchandise?.missing).toEqual(["size"]);
      const milk = planned.basket.find((l) =>
        /maito/i.test(l.requirement.name),
      );
      expect(milk?.product).toBeTruthy();

      // The missing size is asked for; typing alone makes no request.
      await expect(boots).toContainText(
        tr("Tarvitaan vielä koko", "The size is still needed"),
      );
      const before = (await load()).developmentRequests;
      const field = boots.getByLabel(tr("Koko", "Size"));
      await field.pressSequentially("32", { delay: 10 });
      expect((await load()).developmentRequests).toBe(before);

      // One explicit answer is one edit; the grocery row is untouched.
      await boots
        .getByRole("button", { name: tr("Lisää tieto", "Add it") })
        .click();
      await expect
        .poll(
          async () =>
            (await load()).state.extras.find((e) => e.merchandise)?.merchandise
              ?.missing,
          { timeout: 20000 },
        )
        .toEqual([]);
      const answered = await load();
      expect(
        answered.state.extras.find((e) => e.merchandise)?.merchandise
          ?.attributes,
      ).toMatchObject([{ kind: "size", value: "32", provenance: "clarified" }]);
      expect(answered.developmentRequests - before).toBe(1);
      expect(
        answered.basket.find((l) => /maito/i.test(l.requirement.name))?.product
          ?.id,
      ).toBe(milk!.product!.id);

      // The development store cannot search non-food: said plainly, with the manual hand-off.
      await expect(boots).toContainText(
        "koko 32".replace("koko", tr("koko", "size")),
      );
      await expect(boots.locator(".merchandise-status")).toContainText(
        tr(
          "ei tue ei-ruokatuotteiden hakua",
          "does not support searching non-food products",
        ),
      );
      await expect(boots.locator(".merchandise-manual")).toContainText(
        tr("ei siirretä automaattisesti", "not transferred automatically"),
      );
      // The attribute question is gone and the row is not offered a product search form.
      await expect(boots.locator("form")).toHaveCount(0);
      expect(answered.developmentStoreWrites).toBe(0);

      // Narrow layout stays usable.
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setSize(800, 700),
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    } finally {
      await app.close();
    }
  });
}
