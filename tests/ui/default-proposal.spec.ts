import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { composer, updateName } from "./composer-helper";

for (const language of ["fi", "en"] as const) {
  const fi = language === "fi";
  const tr = (a: string, b: string) => (fi ? a : b);

  test(`a vague proposal shows its assumptions, real products and a side change that keeps other rows, then sends in one click in ${language}`, async () => {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
    delete env.ELECTRON_RUN_AS_NODE;
    env.KORIKONE_TEST_DATA = await mkdtemp(join(tmpdir(), "korikone-prop-"));
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

      // A vague note: one dish named alone and one grocery without an amount.
      await composer(page).fill("Uunimakkaraa, maitoa");
      await page.getByRole("button", { name: updateName }).click();
      await expect
        .poll(async () => (await load()).state.meals.length, {
          timeout: 20000,
        })
        .toBe(1);
      const planned = await load();
      expect(planned.proposal.sides).toMatchObject([
        { dish: "Uunimakkara", side: "Perunamuusi" },
      ]);

      // The assumptions are shown beside the actual selected products.
      const panel = page.getByRole("region", {
        name: tr("Mitä oletin", "What I assumed"),
      });
      await expect(panel).toBeVisible();
      await expect(panel).toContainText("Perunamuusi");
      await expect(panel).toContainText(
        tr("oletin 1000 ml", "assumed 1000 ml"),
      );
      await expect(panel).toContainText("Maito 1 l");
      await expect(panel).toContainText(
        tr(
          "Mitään ei tallenneta tuleville listoille ilman erillistä valintaasi",
          "Nothing is saved for future lists unless you choose to remember it",
        ),
      );
      // Inspecting the real products opens the existing row details.
      await panel
        .getByRole("button", {
          name: `${tr("Näytä tuotteet", "Show products")}: maitoa`,
        })
        .click();
      await expect(
        page
          .locator('[data-row-key="milk:ml"] .candidates, .candidates')
          .first(),
      ).toBeVisible();

      // Change the side through the composer, focused on its dish; other rows stay as quoted.
      const before = planned.basket.filter(
        (l) => l.requirement.id !== "potato",
      );
      await panel
        .getByRole("button", {
          name: `${tr("Muuta lisuketta", "Change the side")}: Uunimakkara`,
        })
        .click();
      await expect(page.locator(".composer-focus")).toContainText(
        "Uunimakkara",
      );
      await composer(page).fill(tr("Poista peruna", "Remove peruna"));
      await page.getByRole("button", { name: updateName }).click();
      await expect
        .poll(
          async () =>
            (await load()).basket.some((l) => l.requirement.id === "potato"),
          { timeout: 20000 },
        )
        .toBe(false);
      const edited = await load();
      expect(edited.state.meals).toEqual(planned.state.meals);
      for (const line of before) {
        expect(
          edited.basket.find(
            (l) =>
              l.requirement.id === line.requirement.id &&
              l.requirement.unit === line.requirement.unit,
          )?.product?.id,
        ).toBe(line.product?.id);
      }
      // Nothing is remembered unless it was chosen.
      expect(edited.state.categoryPreferences).toEqual(
        planned.state.categoryPreferences,
      );

      // The two-action handoff: one click sends the proposal.
      await page.locator(".transfer-button").click();
      await expect
        .poll(async () => (await load()).journal?.status, { timeout: 20000 })
        .toBe("verified");
      const sent = await load();
      expect(sent.transferException).toBeNull();
      expect(sent.developmentStoreWrites).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });
}
