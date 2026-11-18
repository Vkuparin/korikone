import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("quick-added milk in pieces offers one pack, and the next milk starts in litres (B7.3)", async () => {
  const path = await mkdtemp(join(tmpdir(), "korikone-quick-pack-"));
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_DATA = path;
  env.KORIKONE_TEST_HIDDEN = "1";
  const app = await electron.launch({ args: ["."], env });
  try {
    const page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Aloita tyhjästä viikosta" })
      .click();
    const name = page.getByLabel("Lisää tuote", { exact: true });
    await name.fill("Maito");
    await page
      .getByRole("button", { name: "Lisää tuote listaan", exact: true })
      .click();
    const row = page.locator('.grocery-row[data-row-key="maito:pcs"]');
    const offer = row.getByRole("button", {
      name: /^Ota 1 pakkaus: Maito 1 l/,
    });
    await expect(offer).toBeVisible();
    await expect(offer).toContainText("1,19");
    // The unit message is replaced by the offer itself.
    await expect(row).not.toContainText("Tuotteen yksikkö ei vastaa");
    await offer.click();
    const taken = page.locator('.grocery-row[data-row-key="maito:ml"]');
    await expect(taken).toBeVisible();
    await expect(taken.locator(".row-name")).toHaveText("Maito 1 l");
    await expect(
      page.locator('.grocery-row[data-row-key="maito:pcs"]'),
    ).toHaveCount(0);
    // Typing the name again starts from the amount now on the list. (Typed in two steps: the
    // field was reset to empty, and one fill of the same text is not seen as a change.)
    await name.fill("M");
    await name.fill("Maito");
    await expect(page.getByLabel("Tuotteen määrä")).toHaveValue("1");
    await expect(page.getByLabel("Tuotteen yksikkö")).toHaveValue("l");
    await name.fill("Rusinat");
    await expect(page.getByLabel("Tuotteen yksikkö")).toHaveValue("pcs");
  } finally {
    await app.close();
  }
});
