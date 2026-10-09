import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initialState } from "../../src/domain/model";

async function launch() {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_HIDDEN = "1";
  env.KORIKONE_TEST_DATA = await mkdtemp(join(tmpdir(), "korikone-redesign-"));
  return electron.launch({ args: ["."], env });
}

test("shopping workspace adds recipes, marks home items, removes rows, schedules and clears", async () => {
  const app = await launch();
  try {
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "Kokeile esimerkkiä" }).click();
    await expect(page.locator(".grocery-row")).toHaveCount(6);
    await expect(page.locator(".shopping-total .warning")).toHaveCount(0);
    await page.screenshot({
      path: "test-results/redesign-desktop.png",
      fullPage: true,
    });
    await page
      .getByRole("heading", { name: "Tomaattipasta", exact: true })
      .click();
    await expect(page.locator(".grocery-row.highlighted")).toHaveCount(2);
    await page
      .getByRole("button", { name: "Löytyy kotoa: Pasta", exact: true })
      .click();
    await expect(page.locator(".grocery-row.at-home")).toHaveCount(1);
    await page
      .getByRole("button", { name: "Poista: Tomaattimurska", exact: true })
      .click();
    await expect(page.locator(".grocery-row")).toHaveCount(5);
    await page
      .getByRole("button", { name: "Löytyy kotoa: Pasta", exact: true })
      .click();
    await expect(page.locator(".grocery-row.at-home")).toHaveCount(0);
    await expect(page.locator(".grocery-row")).toHaveCount(5);
    await page
      .getByRole("button", { name: "Lisää: Pasta", exact: true })
      .click();
    await expect(
      page.locator(".grocery-row").filter({ hasText: "Pasta 500 g" }),
    ).toContainText("900 g");
    await page.getByText("Lisää valmiita reseptejä", { exact: true }).click();
    await page.getByLabel("Resepti", { exact: true }).selectOption("porridge");
    await page
      .getByRole("button", { name: "Lisää resepti ostoslistaan" })
      .click();
    await expect(page.locator(".interpretation")).toHaveCount(3);
    await page
      .getByRole("button", { name: "Viikkosuunnitelma", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Luonnostele viikko", exact: true })
      .click();
    await expect(page.locator(".schedule-grid article")).toHaveCount(7);
    await page.getByRole("button", { name: "Ostoslista", exact: true }).click();
    await page.setViewportSize({ width: 720, height: 900 });
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
    await page.screenshot({
      path: "test-results/redesign-narrow.png",
      fullPage: true,
    });
    await page.getByLabel("Listan toiminnot").click();
    await page.getByRole("button", { name: "Tyhjennä ostoslista" }).click();
    await expect(page.locator(".grocery-row")).toHaveCount(0);
    await expect(page.locator(".interpretation")).toHaveCount(0);
    await page.screenshot({
      path: "test-results/redesign-empty.png",
      fullPage: true,
    });
  } finally {
    await app.close();
  }
});

test("debounced notes discard an obsolete response and apply only the latest note", async () => {
  const app = await launch();
  try {
    const page = await app.firstWindow();
    const state = initialState();
    state.onboarded = true;
    state.setupComplete = true;
    state.staples = [];
    await app.evaluate(({ ipcMain }, state) => {
      const snapshot = {
        state,
        basket: [],
        journal: null,
        review: null,
        storeResults: [],
        storeLogin: "notStarted",
        ai: { state: "connected", email: "test", models: [], error: null },
        draft: null,
      };
      let request = "";
      const methods: Record<string, (input: any) => Promise<void>> = {
        load: async () => {},
        generate: async (input) => {
          request = input.prompt;
          await new Promise((resolve) => setTimeout(resolve, 900));
        },
        approveDraft: async () => {
          snapshot.state.note = request;
          snapshot.state.revision++;
          snapshot.state.extras = [
            { id: "pizza", name: request, amount: 700, unit: "g" },
          ];
        },
        buildBasket: async () => {},
      };
      for (const [name, handler] of Object.entries(methods)) {
        ipcMain.removeHandler(`app:${name}`);
        ipcMain.handle(`app:${name}`, async (_event, input) => {
          await handler(input);
          return { ok: true, value: snapshot };
        });
      }
    }, state);
    await page.reload();
    const note = page.getByLabel("Mitä haluaisit valmistaa?");
    await note.fill("Old note");
    await note.press("Control+Enter");
    await expect(page.locator(".note-box")).toHaveClass(/is-working/);
    await note.fill("Pakastepizza");
    await expect(page.locator(".grocery-description")).toContainText(
      "Pakastepizza",
      { timeout: 10000 },
    );
    await expect(note).toHaveValue("Pakastepizza");
    await expect(page.locator(".grocery-description")).not.toContainText(
      "Old note",
    );
  } finally {
    await app.close();
  }
});

// Exercises the Electron IPC and its built PDF worker, not only the Node helper.
test("PDF receipt import reaches settings and invalid import preserves saved text", async () => {
  const app = await launch();
  try {
    const page = await app.firstWindow();
    const directory = await mkdtemp(join(tmpdir(), "korikone-pdf-ui-"));
    const path = join(directory, "receipt.pdf");
    const { writeFile } = await import("node:fs/promises");
    const { receiptPDF } = await import("../fixtures/receipt");
    await writeFile(path, receiptPDF("K-Market Yogurtti 2.49 Banaani 1.99"));
    await page
      .getByRole("button", { name: "Aloita tyhjästä viikosta" })
      .click();
    await page.getByRole("button", { name: "Asetukset", exact: true }).click();
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path],
      });
    }, path);
    await page
      .getByRole("button", {
        name: "Tuo kuitti (PDF, teksti tai CSV)",
        exact: true,
      })
      .click();
    await expect(page.getByLabel("Kuittien ostosrivit")).toContainText(
      "Yogurtti 2.49",
    );
    await writeFile(path, "broken PDF");
    await page
      .getByRole("button", {
        name: "Tuo kuitti (PDF, teksti tai CSV)",
        exact: true,
      })
      .click();
    await expect(page.getByRole("alert")).toContainText(
      "Kuitin lukeminen epäonnistui",
    );
    await expect(page.getByLabel("Kuittien ostosrivit")).toContainText(
      "Yogurtti 2.49",
    );
  } finally {
    await app.close();
  }
});
