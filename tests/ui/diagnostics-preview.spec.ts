import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initialState } from "../../src/domain/model";
import { settingsCategory } from "./settings-helper";

test("the diagnostic report is read in Settings and saving writes exactly that text (B6.9)", async () => {
  const directory = await mkdtemp(join(tmpdir(), "korikone-diagnostics-"));
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  Object.assign(env, {
    KORIKONE_TEST_DATA: directory,
    KORIKONE_TEST_HIDDEN: "1",
  });
  const app = await electron.launch({ args: ["."], env });
  const file = join(directory, "report.json");
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
    await page.setViewportSize({ width: 1000, height: 700 });
    // A system message box would show the report in a window that cannot scroll.
    await app.evaluate(({ dialog }) => {
      const seen = { messageBoxes: 0, saveTarget: "" };
      Object.assign(globalThis, { seen });
      dialog.showMessageBox = async () => {
        seen.messageBoxes++;
        return { response: 1, checkboxChecked: false };
      };
      dialog.showSaveDialog = async () =>
        seen.saveTarget
          ? { canceled: false, filePath: seen.saveTarget }
          : { canceled: true, filePath: "" };
    });
    await page.getByRole("button", { name: "Asetukset", exact: true }).click();
    await settingsCategory(page, "advanced", "Lisäasetukset");
    const open = page.getByRole("button", {
      name: "Tallenna vianetsintätiedot (ei henkilötietoja)",
    });
    const preview = page.getByRole("region", { name: "Vianetsintätiedot" });
    const content = preview.getByLabel("Raportin sisältö");
    await open.click();
    await expect(preview).toBeVisible();
    await expect(content).toContainText('"generatedAt"');
    // The report stays within the window and scrolls inside its own box.
    const box = await content.evaluate((el) => ({
      height: el.getBoundingClientRect().height,
      bottom: el.getBoundingClientRect().bottom,
      scrolls: el.scrollHeight > el.clientHeight,
    }));
    expect(box.height).toBeLessThanOrEqual(350);
    expect(box.bottom).toBeLessThanOrEqual(700);
    expect(box.scrolls).toBe(true);
    await page.screenshot({
      path: "test-results/b6-9-diagnostics-preview.png",
    });

    // Closing the save dialog keeps the report open.
    await preview.getByRole("button", { name: "Tallenna…" }).click();
    await expect(preview).toBeVisible();

    await app.evaluate((_, path) => {
      (
        globalThis as unknown as { seen: { saveTarget: string } }
      ).seen.saveTarget = path;
    }, file);
    const shown = await content.textContent();
    await preview.getByRole("button", { name: "Tallenna…" }).click();
    await expect(
      page.getByText("Vianetsintätiedot tallennettu."),
    ).toBeVisible();
    await expect(preview).toBeHidden();
    expect(await readFile(file, "utf8")).toBe(shown);

    await open.click();
    await expect(preview).toBeVisible();
    await preview.getByRole("button", { name: "Peruuta" }).click();
    await expect(preview).toBeHidden();
    expect(
      await app.evaluate(
        () =>
          (globalThis as unknown as { seen: { messageBoxes: number } }).seen
            .messageBoxes,
      ),
    ).toBe(0);
  } finally {
    await app.close();
  }
});
