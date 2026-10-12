import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixtureText, receiptFixtures } from "../fixtures/receipts";
import { receiptTextPDF } from "../fixtures/receipts/pdf";
import { settingsCategory } from "./settings-helper";

const fixture = (id: string) => receiptFixtures.find((f) => f.id === id)!;

for (const language of ["fi", "en"] as const) {
  test(`local receipt import, review, correction, deletion and optional enrichment in ${language}`, async () => {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        (e): e is [string, string] => typeof e[1] === "string",
      ),
    );
    delete env.ELECTRON_RUN_AS_NODE;
    const data = await mkdtemp(join(tmpdir(), "korikone-receipt-ui-"));
    env.KORIKONE_TEST_DATA = data;
    env.KORIKONE_TEST_HIDDEN = "1";
    const files = {
      basic: join(data, "basic.txt"),
      basicPdf: join(data, "basic.pdf"),
      missing: join(data, "missing.txt"),
      k: join(data, "k.txt"),
      broken: join(data, "broken.pdf"),
    };
    await writeFile(
      files.basic,
      fixtureText(fixture("s-basic-campaign")),
      "utf8",
    );
    await writeFile(
      files.basicPdf,
      receiptTextPDF(fixture("s-basic-campaign").pages),
    );
    await writeFile(
      files.missing,
      fixtureText(fixture("partial-missing-price")),
      "utf8",
    );
    await writeFile(files.k, fixtureText(fixture("k-weighed")), "utf8");
    await writeFile(files.broken, "not a pdf");
    const app = await electron.launch({ args: ["."], env });
    try {
      const page = await app.firstWindow();
      const fi = language === "fi";
      const tr = (a: string, b: string) => (fi ? a : b);
      await page
        .getByRole("button", { name: "Kokeile esimerkkiä", exact: true })
        .click();
      await page.evaluate(async (language) => {
        await window.korikone.setLanguage(language);
        await window.korikone.signInAI();
      }, language);
      await page.reload();
      const load = () =>
        page.evaluate(async () => (await window.korikone.load()).value);
      await expect.poll(async () => (await load()).quotedAt).not.toBeNull();
      const before = await load();
      await page
        .getByRole("button", { name: tr("Asetukset", "Settings"), exact: true })
        .click();
      await settingsCategory(page, "data", tr("Tiedot", "Data"));
      const importButton = page.getByRole("button", {
        name: tr(
          "Tuo kuitti (PDF, teksti tai CSV)",
          "Import receipt (PDF, text or CSV)",
        ),
        exact: true,
      });
      const pick = async (path: string) => {
        await app.evaluate(({ dialog }, path) => {
          dialog.showOpenDialog = async () => ({
            canceled: false,
            filePaths: [path],
          });
        }, path);
        await importButton.click();
      };
      const cards = page.locator(".receipt-card");

      // Zero-model import: the summary, the printed balance and no request of any kind.
      await pick(files.basic);
      await expect(
        page
          .getByRole("status")
          .filter({ hasText: tr("Kuitti tuotiin", "Receipt imported") }),
      ).toBeVisible();
      await expect(cards).toHaveCount(1);
      await expect(cards.first().locator("summary")).toContainText(
        tr("Summa täsmää", "Total matches"),
      );
      await expect(cards.first().locator("summary")).toContainText(/7[,.]47/);
      // The same trip as a PDF is a duplicate and adds nothing.
      await pick(files.basicPdf);
      await expect(
        page.getByText(
          tr(
            "Tämä kuitti on jo tuotu. Mitään ei lisätty.",
            "This receipt was already imported. Nothing was added.",
          ),
        ),
      ).toBeVisible();
      await expect(cards).toHaveCount(1);

      // A broken file fails visibly and leaves the list as it was.
      await pick(files.broken);
      await expect(page.getByRole("alert")).toBeVisible();
      await expect(cards).toHaveCount(1);

      // A missing price is shown in one review group and corrected there.
      await pick(files.missing);
      await expect(cards).toHaveCount(2);
      const review = page.locator(".receipt-review");
      await expect(review).toHaveCount(1);
      await expect(review).toContainText(tr("Hinta puuttuu", "Amount missing"));
      await review.getByLabel(tr("Hinta (€)", "Amount (€)")).fill("1,99");
      await review
        .getByRole("button", {
          name: tr("Tallenna hinta", "Save amount"),
          exact: true,
        })
        .click();
      await expect(
        page
          .locator(".receipt-card")
          .filter({ hasText: "OMENA PUNAINEN" })
          .locator("summary"),
      ).toContainText(tr("Summa täsmää", "Total matches"));

      // Neither import nor correction touched the shopping list or any request counter.
      const afterLocal = await load();
      expect(afterLocal.state).toEqual(before.state);
      expect(afterLocal.basket).toEqual(before.basket);
      expect([
        afterLocal.developmentRequests,
        afterLocal.developmentStoreWrites,
      ]).toEqual([0, 0]);

      // The correction survives a restart-like reload of the screen.
      await page.reload();
      await page
        .getByRole("button", { name: tr("Asetukset", "Settings"), exact: true })
        .click();
      await settingsCategory(page, "data", tr("Tiedot", "Data"));
      await expect(
        page
          .locator(".receipt-card")
          .filter({ hasText: "OMENA PUNAINEN" })
          .locator("summary"),
      ).toContainText(tr("Summa täsmää", "Total matches"));

      // Optional enrichment: consent starts off, one receipt is one explicit request.
      await pick(files.k);
      await expect(cards).toHaveCount(3);
      const consent = page.getByLabel(
        new RegExp(
          tr(
            "Tarkenna uudet kuitit automaattisesti",
            "Enrich new receipts automatically",
          ),
        ),
      );
      await expect(consent).not.toBeChecked();
      await expect(
        page.getByText(
          tr(
            "Tarkennetaanko uudet kuitit",
            "Enrich new receipts automatically from now on?",
          ),
        ),
      ).toBeVisible();
      expect((await load()).developmentRequests).toBe(0);
      const kCard = cards.filter({ hasText: "BANAANI" });
      await kCard
        .getByRole("button", {
          name: new RegExp(
            tr("Tarkenna vain tämä kuitti", "Enrich this receipt only"),
          ),
        })
        .click();
      await expect(page.locator(".receipt-enrichment")).toContainText(
        tr("Tarkennus valmis", "Enrichment finished"),
      );
      expect((await load()).developmentRequests).toBe(1);
      // A usage limit leaves the facts alone and offers an explicit retry.
      await page.evaluate(() =>
        window.korikone.developmentScenario("usageLimit"),
      );
      const factsBefore = (await load()).state;
      await kCard
        .getByRole("button", {
          name: new RegExp(
            tr(
              "Tarkenna vain tämä kuitti|Yritä tarkennusta uudelleen",
              "Enrich this receipt only|Retry enrichment",
            ),
          ),
        })
        .click();
      await expect(page.locator(".receipt-enrichment")).toContainText(
        tr("Tarkennus epäonnistui", "Enrichment failed"),
      );
      expect((await load()).state).toEqual(factsBefore);
      expect(
        await kCard
          .getByRole("button", {
            name: tr("Yritä tarkennusta uudelleen", "Retry enrichment"),
          })
          .count(),
      ).toBe(1);

      // Durable consent is explicit, named for the provider and revocable.
      await consent.click();
      await expect(consent).toBeChecked();
      await consent.click();
      await expect(consent).not.toBeChecked();

      // Deletion removes the purchase and its data without changing the list.
      await cards
        .filter({ hasText: "BANAANI" })
        .getByRole("button", { name: tr("Poista ostos", "Delete purchase") })
        .click();
      await page
        .getByRole("button", {
          name: tr(
            "Poista kuitti ja sen tiedot",
            "Delete receipt and its data",
          ),
        })
        .click();
      await expect(cards).toHaveCount(2);
      expect((await load()).state).toEqual(before.state);

      // Narrow layout stays usable without horizontal scrolling.
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
