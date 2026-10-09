import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("the transfer is confirmed and reported in the list column", async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_DATA = await mkdtemp(join(tmpdir(), "korikone-confirm-"));
  env.KORIKONE_TEST_HIDDEN = "1";
  const app = await electron.launch({
    args: process.env.KORIKONE_EXECUTABLE ? [] : ["."],
    env,
    ...(process.env.KORIKONE_EXECUTABLE
      ? { executablePath: process.env.KORIKONE_EXECUTABLE }
      : {}),
  });
  try {
    const page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Ota käyttöön", exact: true })
      .click();
    await page.getByRole("textbox").fill("Helsinki");
    await page.getByRole("button", { name: "Etsi", exact: true }).click();
    await page
      .getByRole("button", {
        name: "S-kaupat · Helsinki (fixture)",
        exact: true,
      })
      .click();
    await page.getByRole("button", { name: "Kirjaudu kauppaan" }).click();
    await page.getByRole("button", { name: "Jatka", exact: true }).click();
    await page.getByRole("button", { name: "Continue with ChatGPT" }).click();
    await page.getByRole("button", { name: "Suunnittele viikko" }).click();
    const note = page.getByLabel("Mitä haluaisit valmistaa?");
    await note.fill("Makaronilaatikko");
    await note.press("Control+Enter");
    const list = page.getByRole("complementary");
    await expect(list.getByRole("heading", { level: 2 })).toHaveText(
      "Ostoslista · 7",
      { timeout: 15000 },
    );
    const bar = list.getByRole("region", { name: "Yhteensä ja siirto" });
    const transfer = bar.getByRole("button", {
      name: /^Siirrä ja avaa S-kaupat-lista/,
    });
    const panel = bar.getByRole("region", { name: "Siirron vahvistus" });
    const confirm = panel.getByRole("button", {
      name: /^Vahvista: 7 tuotetta → S-kaupat · \d+,\d\d €$/,
    });
    const setBudget = async (euros: string) => {
      await page
        .getByRole("button", { name: "Asetukset", exact: true })
        .click();
      const budget = page.getByLabel("Viikkobudjetti (€)");
      await budget.fill(euros);
      await page
        .locator("form", { has: budget })
        .getByRole("button", { name: "Tallenna" })
        .click();
      await page
        .getByRole("button", { name: "Ostoslista", exact: true })
        .click();
      await expect(transfer).toBeEnabled({ timeout: 10000 });
    };

    // Over budget: the panel says so and asks for a separate acceptance.
    await setBudget("1");
    await transfer.click();
    await expect(panel).toContainText("Viikkobudjetti ylittyy");
    await expect(confirm).toBeDisabled();
    await panel.getByLabel("Hyväksyn näytetyn budjetin ylityksen.").check();
    await expect(confirm).toBeEnabled();
    await panel.getByRole("button", { name: "Peru" }).click();
    await expect(panel).toHaveCount(0);
    expect(
      await page.evaluate(
        async () => (await window.korikone.load()).value.journal,
      ),
    ).toBeNull();

    // The initial click approves a normal batch and opens the destination.
    await setBudget("1000");
    await transfer.click();
    const result = bar.getByRole("region", { name: "Siirron tulos" });
    await expect(result.getByRole("status")).toHaveText(
      "Ostoskori päivitetty ja tarkistettu",
    );
    await expect(panel).toHaveCount(0);
    const evidence = await page.evaluate(
      async () => (await window.korikone.load()).value,
    );
    expect(evidence.developmentHandoffs).toEqual(["s-kaupat:list"]);
    await expect(result).toContainText("Oikeaa kaupan ikkunaa ei avata.");
    await expect(result).toContainText("Testatut avaukset: 1");
    await result
      .getByRole("button", { name: "Avaa S-kaupat-lista uudelleen" })
      .click();
    await expect(result).toContainText("Testatut avaukset: 2");
    const reopened = await page.evaluate(
      async () => (await window.korikone.load()).value,
    );
    expect(reopened.journal).toEqual(evidence.journal);

    await expect(result.getByRole("status")).toHaveText(
      "Ostoskori päivitetty ja tarkistettu",
    );
    await expect(result).toContainText("7 / 7");
    await expect(
      result.getByRole("button", { name: "Avaa S-kaupat-lista uudelleen" }),
    ).toBeVisible();
    await result.getByRole("button", { name: "Sulje" }).click();
    await expect(result).toHaveCount(0);
  } finally {
    await app.close();
  }
});
