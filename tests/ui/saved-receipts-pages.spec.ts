import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initialState } from "../../src/domain/model";
import { fixtureText, receiptFixtures } from "../fixtures/receipts";
import { settingsCategory } from "./settings-helper";

const fixture = (id: string) => receiptFixtures.find((f) => f.id === id)!;

test("Saved receipts show the latest 10 by month, with backups above them (B7.6)", async () => {
  const data = await mkdtemp(join(tmpdir(), "korikone-saved-receipts-"));
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  Object.assign(env, { KORIKONE_TEST_DATA: data, KORIKONE_TEST_HIDDEN: "1" });
  const text = fixtureText(fixture("s-basic-campaign"));
  // Twelve distinct receipts: six in September and six in October 2026.
  const paths: string[] = [];
  for (let i = 0; i < 12; i++) {
    const day = String(10 + (i % 6)).padStart(2, "0");
    const month = i < 6 ? "09" : "10";
    const path = join(data, `receipt-${i}.txt`);
    await writeFile(
      path,
      text
        .replace("12.10.2026", `${day}.${month}.2026`)
        .replace("Kuitti 0417", `Kuitti ${String(500 + i).padStart(4, "0")}`),
    );
    paths.push(path);
  }
  const app = await electron.launch({ args: ["."], env });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState("load");
    const state = initialState();
    state.language = "fi";
    state.onboarded = state.setupComplete = true;
    await page.evaluate(async (state) => {
      await window.korikone.save(state);
      await window.korikone.setLanguage("fi");
    }, state);
    await page.reload();
    await app.evaluate(({ dialog }, paths) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: paths,
      });
    }, paths);
    await page.getByRole("button", { name: "Asetukset", exact: true }).click();
    await settingsCategory(page, "data", "Tiedot");
    await page
      .getByRole("button", {
        name: "Tuo kuitteja (PDF, teksti tai CSV)",
        exact: true,
      })
      .click();
    await expect(page.locator(".receipt-intake-summary")).toContainText(
      "12 kuittia tallennettu",
    );
    const months = page.locator(".receipt-month");
    await expect(page.locator(".receipt-card")).toHaveCount(10);
    await expect(months.first().locator("h5")).toHaveText("Lokakuu 2026");
    await expect(months.first().locator(".receipt-card")).toHaveCount(6);
    await expect(months.nth(1).locator("h5")).toHaveText("Syyskuu 2026");
    await expect(page.locator(".receipt-more")).toContainText(
      "Näytetään 10 uusinta 12 kuitista.",
    );
    // Backups come before the receipt list.
    const backup = page.locator("details", { hasText: "Varmuuskopi" }).first();
    expect((await backup.boundingBox())!.y).toBeLessThan(
      (await page.locator("#saved-receipts").boundingBox())!.y,
    );
    await page
      .getByRole("button", { name: "Näytä lisää", exact: true })
      .click();
    await expect(page.locator(".receipt-card")).toHaveCount(12);
    await expect(page.locator(".receipt-more")).toHaveCount(0);
  } finally {
    await app.close();
  }
});
