import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("backup export and restore preserve recipes and reject broken references", async () => {
  const path = await mkdtemp(join(tmpdir(), "korikone-backup-"));
  const backupPath = join(path, "backup.json");
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_DATA = path;
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
      .getByRole("button", { name: "Aloita tyhjästä viikosta" })
      .click();
    await page.getByLabel("Kieli", { exact: true }).selectOption("en");
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
          return JSON.parse(await readFile(backupPath, "utf8")).version;
        } catch {
          return null;
        }
      })
      .toBe(1);
    const exported = JSON.parse(await readFile(backupPath, "utf8"));
    expect(exported.recipes.length).toBeGreaterThan(0);
    expect(Object.keys(exported)).not.toContain("chatgpt-credentials");
    exported.recipes[0].name = "Restored pasta";
    await writeFile(backupPath, JSON.stringify(exported));
    await page.getByRole("button", { name: "Restore backup" }).click();
    await page.getByRole("button", { name: "Recipes", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Restored pasta" }),
    ).toBeVisible();
    exported.meals = [
      {
        id: "broken",
        day: 0,
        recipeId: "missing",
        servings: 2,
        leftovers: false,
      },
    ];
    await writeFile(backupPath, JSON.stringify(exported));
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByText("Backups and data", { exact: true }).click();
    await page.getByRole("button", { name: "Restore backup" }).click();
    await expect(page.getByRole("alert")).toContainText(
      "recipe that no longer exists",
    );
    await page.getByRole("button", { name: "Recipes", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Restored pasta" }),
    ).toBeVisible();
  } finally {
    await app.close();
  }
});
