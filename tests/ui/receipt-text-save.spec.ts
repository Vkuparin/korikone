import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { receiptFixtures } from "../fixtures/receipts";
import { receiptTextPDF } from "../fixtures/receipts/pdf";
import { settingsCategory } from "./settings-helper";

test("a PDF import and an edited receipt text each give a clear result and survive navigation and restart", async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  const data = await mkdtemp(join(tmpdir(), "korikone-receipt-text-"));
  env.KORIKONE_TEST_DATA = data;
  env.KORIKONE_TEST_HIDDEN = "1";
  const pdf = join(data, "kuitti.pdf");
  await writeFile(
    pdf,
    receiptTextPDF(
      receiptFixtures.find((f) => f.id === "s-basic-campaign")!.pages,
    ),
  );
  let app = await electron.launch({ args: ["."], env });
  try {
    let page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Kokeile esimerkkiä", exact: true })
      .click();
    const openData = async () => {
      await page
        .getByRole("navigation")
        .getByRole("button", { name: "Asetukset", exact: true })
        .click();
      await settingsCategory(page, "data", "Tiedot");
    };
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.korikone.load())).value.quotedAt,
      )
      .not.toBeNull();
    const before = (await page.evaluate(() => window.korikone.load())).value;
    await openData();
    const text = page.getByLabel("Kuittien ostosrivit");
    const section = page.locator(".settings-content");

    // A cancelled file dialog changes nothing and typed text stays.
    await text.fill("Oma muistiinpano");
    await app.evaluate(({ dialog }) => {
      dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
    });
    await section
      .getByRole("button", { name: "Tuo kuitti (PDF, teksti tai CSV)" })
      .click();
    await expect(text).toHaveValue("Oma muistiinpano");
    await expect(
      section.getByText("Kuittien muutoksia ei ole tallennettu."),
    ).toBeVisible();

    // The PDF is read locally and its result is stated; the typed text is still there.
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path],
      });
    }, pdf);
    await section
      .getByRole("button", { name: "Tuo kuitti (PDF, teksti tai CSV)" })
      .click();
    await expect(section.locator(".receipt-summary")).toContainText(
      "summa täsmää",
    );
    await expect(text).toHaveValue("Oma muistiinpano");

    // Saving the edited text says so only once it is stored.
    await section
      .getByRole("button", { name: "Tallenna", exact: true })
      .click();
    await expect(section.getByText("Kuittiteksti tallennettu.")).toBeVisible();
    await expect(
      section.getByText("Kuittien muutoksia ei ole tallennettu."),
    ).toBeHidden();
    expect(
      (await page.evaluate(() => window.korikone.load())).value.state
        .receiptText,
    ).toBe("Oma muistiinpano");

    // The saved text changes underneath an unsaved edit: the edit is kept and nothing is overwritten.
    await text.fill("Oma muistiinpano, jatkettu");
    await page.evaluate(() =>
      window.korikone.setReceiptText({
        text: "Toisaalla tallennettu",
        base: "Oma muistiinpano",
      }),
    );
    await section
      .getByRole("button", { name: "Tallenna", exact: true })
      .click();
    await expect(
      page.getByText(/Tallennettu kuittiteksti muuttui muokkauksen aikana/),
    ).toBeVisible();
    await expect(text).toHaveValue("Oma muistiinpano, jatkettu");
    expect(
      (await page.evaluate(() => window.korikone.load())).value.state
        .receiptText,
    ).toBe("Toisaalla tallennettu");
    // Having been told, the shopper saves again to replace it knowingly.
    await page.evaluate(() => window.korikone.load());
    await section
      .getByRole("button", { name: "Tallenna", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.korikone.load())).value.state
            .receiptText,
      )
      .toBe("Oma muistiinpano, jatkettu");

    // Away and back, then a restart: the text and the imported purchase are both there.
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "Ostoslista", exact: true })
      .click();
    await openData();
    await expect(page.getByLabel("Kuittien ostosrivit")).toHaveValue(
      "Oma muistiinpano, jatkettu",
    );
    const after = (await page.evaluate(() => window.korikone.load())).value;
    // Receipt work is not shopping work: same list, revision and quote, no outside call.
    expect(after.state.revision).toBe(before.state.revision);
    expect(after.quotedAt).toBe(before.quotedAt);
    expect([
      after.developmentRequests,
      after.developmentStoreWrites,
      after.developmentCatalogueRequests - before.developmentCatalogueRequests,
    ]).toEqual([0, 0, 0]);
    await app.close();
    app = await electron.launch({ args: ["."], env });
    page = await app.firstWindow();
    const restarted = await page.evaluate(async () => ({
      text: (await window.korikone.load()).value.state.receiptText,
      purchases: (
        (await window.korikone.listPurchases()).value as unknown as {
          receipts: { purchases: unknown[] };
        }
      ).receipts.purchases.length,
    }));
    expect(restarted).toEqual({
      text: "Oma muistiinpano, jatkettu",
      purchases: 1,
    });
  } finally {
    await app.close();
  }
});
