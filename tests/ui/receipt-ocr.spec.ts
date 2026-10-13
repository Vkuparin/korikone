import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { settingsCategory } from "./settings-helper";

test("offline scanned receipts show OCR review provenance and persist through restart", async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_DATA = await mkdtemp(join(tmpdir(), "korikone-ocr-ui-"));
  env.KORIKONE_TEST_HIDDEN = "1";
  let app = await electron.launch({ args: ["."], env });
  try {
    let page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Kokeile esimerkkiä", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.korikone.load())).value.quotedAt,
      )
      .not.toBeNull();
    const before = (await page.evaluate(() => window.korikone.load())).value;
    const openData = async () => {
      await page
        .getByRole("navigation")
        .getByRole("button", { name: "Asetukset", exact: true })
        .click();
      await settingsCategory(page, "data", "Tiedot");
    };
    await openData();
    const pick = async (file: string) => {
      await app.evaluate(
        ({ dialog }, file) => {
          dialog.showOpenDialog = async () => ({
            canceled: false,
            filePaths: [file],
          });
        },
        join(process.cwd(), "tests/fixtures/receipts", file),
      );
      await page
        .getByRole("button", {
          name: "Tuo kuitti (PDF, teksti tai CSV)",
          exact: true,
        })
        .click();
    };
    const cards = () => page.locator(".receipt-card");
    await pick("ocr-k-clean.pdf");
    await expect(cards()).toHaveCount(1);
    const k = cards().filter({ hasText: "K-Market Kokeilu" });
    await expect(k.locator(".receipt-ocr-notice")).toContainText(
      "Tarkista määrät ja hinnat",
    );
    await expect(k.locator(":scope > summary")).toContainText("Summa täsmää");
    await expect(k.locator(":scope > summary")).toContainText("6,67");
    await expect(k.locator(".receipt-ocr-notice")).toContainText("Sivut: 1");
    await pick("ocr-k-clean.pdf");
    await expect(cards()).toHaveCount(1);
    await expect(
      page.getByRole("status").filter({ hasText: "Tämä kuitti on jo tuotu" }),
    ).toBeVisible();
    await pick("ocr-s-uncertain.pdf");
    await expect(cards()).toHaveCount(2);
    const s = cards().filter({ hasText: "S-market Koekylä" });
    await expect(s.locator(":scope > summary")).toContainText("Summa on vajaa");
    // The card says it was read by OCR; the full notice sits in the optional details.
    await expect(s.locator(":scope > summary")).toContainText(/OCR/);
    await s.locator(":scope > summary").click();
    await s.locator(".receipt-more summary").click();
    await expect(s.locator(".receipt-ocr-notice")).toBeVisible();
    const after = (await page.evaluate(() => window.korikone.load())).value;
    expect(after.state).toEqual(before.state);
    expect(after.developmentRequests).toBe(0);
    expect(after.developmentStoreWrites).toBe(0);
    expect(after.developmentCatalogueRequests).toBe(
      before.developmentCatalogueRequests,
    );
    await app.close();
    app = await electron.launch({ args: ["."], env });
    page = await app.firstWindow();
    await openData();
    await expect(cards()).toHaveCount(2);
    await expect(cards().locator(".receipt-ocr-notice")).toHaveCount(2);
    // The older file-import API also keeps OCR provenance while saving its legacy text.
    await app.evaluate(
      ({ dialog }, file) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [file],
        });
      },
      join(process.cwd(), "tests/fixtures/receipts/ocr-k-clean.pdf"),
    );
    const legacy = await page.evaluate(() => window.korikone.importReceipt());
    expect(legacy.ok).toBe(true);
    expect(legacy.value.purchaseImport).toMatchObject({
      outcome: "duplicate",
      ocrPages: [1],
    });
    expect(legacy.value.state.receiptText).toContain("JÄÄTELÖ");
    expect(legacy.value.state.revision).toBe(before.state.revision + 1);
    expect({
      ...legacy.value.state,
      receiptText: before.state.receiptText,
      revision: before.state.revision,
    }).toEqual(before.state);
    expect(legacy.value.developmentRequests).toBe(0);
    await page.evaluate(() => window.korikone.setLanguage("en"));
    await page.reload();
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "Settings", exact: true })
      .click();
    await settingsCategory(page, "data", "Data");
    await expect(cards().first().locator(".receipt-ocr-notice")).toContainText(
      "Check quantities and prices",
    );
  } finally {
    await app.close();
  }
});
