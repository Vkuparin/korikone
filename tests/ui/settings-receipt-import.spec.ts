import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initialState } from "../../src/domain/model";
import { fixtureText, receiptFixtures } from "../fixtures/receipts";
import { settingsCategory } from "./settings-helper";

const fixture = (id: string) => receiptFixtures.find((f) => f.id === id)!;

test("Settings imports several receipts the same way as History and keeps the source-text choice (B6.10)", async () => {
  const data = await mkdtemp(join(tmpdir(), "korikone-settings-receipts-"));
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  Object.assign(env, { KORIKONE_TEST_DATA: data, KORIKONE_TEST_HIDDEN: "1" });
  const files = {
    basic: join(data, "basic.txt"),
    k: join(data, "k.txt"),
    missing: join(data, "missing.txt"),
  };
  await writeFile(files.basic, fixtureText(fixture("s-basic-campaign")));
  await writeFile(files.k, fixtureText(fixture("k-weighed")));
  await writeFile(files.missing, fixtureText(fixture("partial-missing-price")));
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
    const choose = (paths: string[]) =>
      app.evaluate(({ dialog }, paths) => {
        dialog.showOpenDialog = async (...args: unknown[]) => {
          Object.assign(globalThis, { picked: args.at(-1) });
          return { canceled: false, filePaths: paths };
        };
      }, paths);
    const purchases = () =>
      page.evaluate(
        async () =>
          (
            (await window.korikone.listPurchases()).value as unknown as {
              receipts: {
                purchases: { retention: "sanitized" | "original" }[];
              };
            }
          ).receipts.purchases,
      );

    await page.getByRole("button", { name: "Asetukset", exact: true }).click();
    await settingsCategory(page, "data", "Tiedot");
    await page
      .getByLabel("Säilytä kuitin lähdeteksti paikallisesti (ei PDF-tiedostoa)")
      .check();
    await choose([files.basic, files.k]);
    await page
      .getByRole("button", {
        name: "Tuo kuitteja (PDF, teksti tai CSV)",
        exact: true,
      })
      .click();
    // The same picker, progress and summary as History: several files, one result box.
    await expect(page.locator(".receipt-intake-summary")).toContainText(
      "2 kuittia tallennettu",
    );
    expect(
      await app.evaluate(
        () => (globalThis as unknown as { picked: object }).picked,
      ),
    ).toMatchObject({ properties: ["openFile", "multiSelections"] });
    await expect(page.locator(".receipt-card")).toHaveCount(2);
    expect((await purchases()).map((p) => p.retention)).toEqual([
      "original",
      "original",
    ]);

    // History's own button never inherits the Settings choice.
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "Historia", exact: true })
      .click();
    await choose([files.missing]);
    await page
      .getByRole("button", { name: "Tuo kuitteja", exact: true })
      .click();
    await expect(page.locator(".receipt-intake-summary")).toContainText(
      "1 kuitti tallennettu",
    );
    expect((await purchases()).map((p) => p.retention).sort()).toEqual([
      "original",
      "original",
      "sanitized",
    ]);
  } finally {
    await app.close();
  }
});
