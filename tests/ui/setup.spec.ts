import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("guided setup allows manual planning and remembers completion", async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_HIDDEN = "1";
  env.KORIKONE_TEST_DATA = await mkdtemp(join(tmpdir(), "korikone-setup-"));
  let app = await electron.launch({ args: ["."], env });
  try {
    const page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Ota käyttöön", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Missä teet ruokaostokset?" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Ohita toistaiseksi" }).click();
    await expect(
      page.getByRole("heading", { name: "Apua aterioiden suunnitteluun" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Ohita toistaiseksi" }).click();
    await expect(
      page.getByRole("button", { name: "Lisää ateria" }),
    ).toBeVisible();
    await app.close();
    app = await electron.launch({ args: ["."], env });
    await expect(
      (await app.firstWindow()).getByRole("button", { name: "Lisää ateria" }),
    ).toBeVisible();
  } finally {
    await app.close();
  }
});
