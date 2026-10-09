import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("calendar backup uses real export and restore handlers", async () => {
  const directory = await mkdtemp(join(tmpdir(), "korikone-calendar-ui-"));
  const backupPath = join(directory, "backup.json");
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_DATA = directory;
  env.KORIKONE_TEST_HIDDEN = "1";
  const app = await electron.launch({ args: ["."], env });
  try {
    const page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Aloita tyhjästä viikosta" })
      .click();
    await page.getByLabel("Kieli", { exact: true }).click();
    await page.getByRole("option", { name: "English", exact: true }).click();
    const calendar = {
      "2026-10-09": { mealIds: ["meal-pasta"], leftovers: false },
      "2026-10-10": { mealIds: [], leftovers: true },
    };
    // F9.2 supplies the editor; seed its saved data through the existing app API.
    await page.evaluate(async (calendar) => {
      const snapshot = await window.korikone.load();
      if (!snapshot.ok) throw new Error(snapshot.error);
      const saved = await window.korikone.save({
        ...snapshot.value.state,
        calendar,
      });
      if (!saved.ok) throw new Error(saved.error);
    }, calendar);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByText("Backups and data", { exact: true }).click();
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [filePath],
      });
    }, backupPath);
    await page.getByRole("button", { name: "Export backup" }).click();
    await expect
      .poll(async () => {
        try {
          return JSON.parse(await readFile(backupPath, "utf8")).calendar;
        } catch {
          return null;
        }
      })
      .toEqual(calendar);
    const backup = JSON.parse(await readFile(backupPath, "utf8"));
    await page.evaluate(async () => {
      const snapshot = await window.korikone.load();
      if (!snapshot.ok) throw new Error(snapshot.error);
      const saved = await window.korikone.save({
        ...snapshot.value.state,
        calendar: {},
      });
      if (!saved.ok) throw new Error(saved.error);
    });
    await page.getByRole("button", { name: "Restore backup" }).click();
    const readCalendar = () =>
      page.evaluate(
        async () => (await window.korikone.load()).value.state.calendar,
      );
    await expect.poll(readCalendar).toEqual(calendar);
    await writeFile(
      backupPath,
      JSON.stringify({
        ...backup,
        calendar: { "2026-02-30": { mealIds: [], leftovers: false } },
      }),
    );
    await page.getByRole("button", { name: "Restore backup" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    expect(await readCalendar()).toEqual(calendar);
    // Restoring a backup from before F9.1 produces the schema default.
    delete backup.calendar;
    await writeFile(backupPath, JSON.stringify(backup));
    await page.getByRole("button", { name: "Restore backup" }).click();
    await expect.poll(readCalendar).toEqual({});
  } finally {
    await app.close();
  }
});
