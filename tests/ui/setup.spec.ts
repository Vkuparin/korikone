import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initialState } from "../../src/domain/model";

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
      page.getByText("Lisää valmiita reseptejä", { exact: true }),
    ).toBeVisible();
    await app.close();
    app = await electron.launch({ args: ["."], env });
    await expect(
      (await app.firstWindow()).getByText("Lisää valmiita reseptejä", {
        exact: true,
      }),
    ).toBeVisible();
  } finally {
    await app.close();
  }
});

test("setup can change branch and detects completed sign-in without a check button", async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_HIDDEN = "1";
  env.KORIKONE_TEST_DATA = await mkdtemp(
    join(tmpdir(), "korikone-setup-connected-"),
  );
  const app = await electron.launch({ args: ["."], env });
  try {
    const page = await app.firstWindow();
    // UI orchestration test only: no account, browser, catalogue or network calls.
    await app.evaluate(({ ipcMain }, state) => {
      const snapshot = {
        state,
        basket: [],
        journal: null,
        review: null,
        storeResults: [] as (typeof state.context)[],
        storeLogin: "notStarted",
        ai: { state: "disconnected", email: "", error: null, models: [] },
        draft: null,
      };
      const methods = {
        load: () => {},
        save: (input: typeof state) => {
          snapshot.state = input;
        },
        searchStores: () => {
          snapshot.storeResults = ["First", "Second"].map((name) => ({
            providerId: "k-ruoka",
            storeId: name,
            storeName: name,
            fulfillment: "pickup" as const,
          }));
        },
        loginStore: () => {
          snapshot.storeLogin = "waiting";
        },
        checkStoreLogin: () => {
          snapshot.storeLogin = "signedIn";
        },
        buildBasket: () => {},
        signInAI: () => {
          snapshot.ai.state = "connected";
        },
      };
      for (const [name, handler] of Object.entries(methods)) {
        ipcMain.removeHandler(`app:${name}`);
        ipcMain.handle(`app:${name}`, (_event, input) => {
          handler(input);
          return { ok: true, value: snapshot };
        });
      }
    }, initialState());
    await page
      .getByRole("button", { name: "Ota käyttöön", exact: true })
      .click();
    await page.getByRole("textbox").fill("Helsinki");
    await page.getByRole("button", { name: "Etsi", exact: true }).click();
    await page.getByRole("button", { name: "First", exact: true }).click();
    await page.getByRole("button", { name: "Valitse toinen kauppa" }).click();
    await page.getByRole("button", { name: "Second", exact: true }).click();
    await page.getByRole("button", { name: "Kirjaudu kauppaan" }).click();
    await expect(
      page.getByRole("button", { name: "Jatka", exact: true }),
    ).toBeVisible({ timeout: 10000 });
    await page.getByRole("button", { name: "Jatka", exact: true }).click();
    await page.getByRole("button", { name: "Continue with ChatGPT" }).click();
    await page.getByRole("button", { name: "Suunnittele viikko" }).click();
    await expect(page.locator(".context")).toContainText("Second");
    await expect(page.getByLabel("Mitä haluaisit valmistaa?")).toBeEnabled();
    await expect(page.locator('select[name="model"]')).not.toBeVisible();
  } finally {
    await app.close();
  }
});
