import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initialState } from "../../src/domain/model";
import { fixtureText, receiptFixtures } from "../fixtures/receipts";

const fixture = (id: string) => receiptFixtures.find((f) => f.id === id)!;

test("files over the 20-receipt limit are explained and History does not offer itself (B7.9)", async () => {
  const data = await mkdtemp(join(tmpdir(), "korikone-receipt-limit-"));
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  Object.assign(env, { KORIKONE_TEST_DATA: data, KORIKONE_TEST_HIDDEN: "1" });
  const text = fixtureText(fixture("s-basic-campaign"));
  const paths: string[] = [];
  for (let i = 0; i < 22; i++) {
    const path = join(data, `receipt-${i}.txt`);
    await writeFile(path, text);
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
    await page.getByRole("button", { name: "Historia", exact: true }).click();
    await page
      .getByRole("button", { name: "Tuo kuitteja", exact: true })
      .click();
    const summary = page.locator(".receipt-intake-summary");
    await expect(summary).toContainText(
      "2 jäi tuomatta: enintään 20 kuittia kerrallaan",
    );
    await expect(summary).not.toContainText("epäonnistui");
    const surface = page.locator(".receipt-intake-surface");
    await expect(
      surface.getByRole("button", { name: "Tuo loput 2", exact: true }),
    ).toBeVisible();
    await expect(
      surface.getByRole("button", { name: "Näytä historia" }),
    ).toHaveCount(0);
  } finally {
    await app.close();
  }
});
