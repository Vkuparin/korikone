import {
  test,
  expect,
  _electron as electron,
  type Page,
} from "@playwright/test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** An invented S-market style receipt whose product names no local rule recognises. */
const receipt = (day: number, rows: [string, string][]) => {
  const total = rows.reduce(
    (sum, [, price]) => sum + Math.round(Number(price.replace(",", ".")) * 100),
    0,
  );
  const money = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");
  return [
    "S-market Esimerkki",
    "Testikatu 1, 00100 Helsinki",
    `${day}.10.2026 10:05  Kassa 2  Kuitti 0${day}00`,
    "--------------------------------",
    ...rows.map(([label, price]) => `${label.padEnd(28)} ${price}`),
    "--------------------------------",
    `${"YHTEENSÄ".padEnd(28)} ${money(total)}`,
  ].join("\n");
};

async function launch(data: string) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_DATA = data;
  env.KORIKONE_TEST_HIDDEN = "1";
  return electron.launch({ args: ["."], env });
}
const load = (page: Page) =>
  page.evaluate(async () => (await window.korikone.load()).value);
const consentOf = async (page: Page) =>
  (
    (await page.evaluate(() => window.korikone.listPurchases()))
      .value as unknown as {
      receipts: {
        consent: { automatic: unknown; declined?: unknown } | null;
        purchases: unknown[];
      };
    }
  ).receipts;
async function start(data: string, language: "fi" | "en", signIn = false) {
  const app = await launch(data);
  const page = await app.firstWindow();
  const example = page.getByRole("button", {
    name: "Kokeile esimerkkiä",
    exact: true,
  });
  await example.or(page.getByRole("navigation").first()).first().waitFor();
  if (await example.count()) await example.click();
  await page.evaluate(
    async ({ language, signIn }) => {
      await window.korikone.setLanguage(language);
      if (signIn) await window.korikone.signInAI();
    },
    { language, signIn },
  );
  await page.reload();
  return { app, page };
}
const stub = (app: Awaited<ReturnType<typeof launch>>, paths: string[]) =>
  app.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: paths,
    });
  }, paths);

for (const language of ["fi", "en"] as const) {
  const fi = language === "fi";
  const tr = (a: string, b: string) => (fi ? a : b);
  const nav = (page: Page, name: string) =>
    page
      .getByRole("navigation")
      .first()
      .getByRole("button", { name, exact: true });

  test(`History imports several receipts in one action with one status, a grouped summary and a failed-file retry, and drag-over makes no call in ${language}`, async () => {
    const data = await mkdtemp(join(tmpdir(), "korikone-surface-"));
    const good = join(data, "a.txt");
    const copy = join(data, "kopio.txt");
    const bad = join(data, "rikki.pdf");
    const image = join(data, "kuva.png");
    const text = receipt(14, [
      ["XYZ HERKKU 200G", "1,50"],
      ["ABC PUURO 500G", "2,00"],
    ]);
    await writeFile(good, text, "utf8");
    await writeFile(copy, text, "utf8");
    await writeFile(bad, "%PDF-1.4 1 0 obj << /Broken true >> endobj");
    await writeFile(image, "png");
    const { app, page } = await start(data, language);
    try {
      await expect.poll(async () => (await load(page)).quotedAt).not.toBeNull();
      const before = await load(page);
      // A shopping draft typed before importing is still there afterwards.
      await page.getByRole("textbox").first().fill("Kahvia");

      await nav(page, tr("Historia", "History")).click();
      const importButton = page.getByRole("button", {
        name: tr("Tuo kuitteja", "Import receipts"),
        exact: true,
      });
      await expect(importButton).toBeVisible();

      // Drag-over shows the temporary overlay and calls nothing; leaving clears it.
      const overlay = page.locator(".receipt-drop-overlay");
      const drag = (type: string, related = false) =>
        page.evaluate(
          ({ type, related }) => {
            const transfer = new DataTransfer();
            transfer.items.add(new File(["x"], "vale.txt"));
            window.dispatchEvent(
              new DragEvent(type, {
                dataTransfer: transfer,
                bubbles: true,
                cancelable: true,
                relatedTarget: related ? document.body : null,
              }),
            );
          },
          { type, related },
        );
      await drag("dragenter");
      await expect(overlay).toBeVisible();
      await expect(overlay).toContainText(
        tr("Pudota kuitit tähän", "Drop receipts here"),
      );
      expect((await load(page)).developmentRequests).toBe(0);
      await drag("dragleave");
      await expect(overlay).toHaveCount(0);
      await drag("dragenter");
      await page.keyboard.press("Escape");
      await expect(overlay).toHaveCount(0);

      // A retailer page owns its own drops: no overlay there.
      await nav(page, tr("Kauppa", "Store")).click();
      await drag("dragenter");
      await expect(overlay).toHaveCount(0);
      await nav(page, tr("Historia", "History")).click();

      // Mixed picker import: one saved, one duplicate, one unsupported, one failed.
      await stub(app, [good, copy, image, bad]);
      await importButton.focus();
      await page.keyboard.press("Enter");
      const surface = page.getByRole("region", {
        name: tr("Kuittien tuonti", "Receipt import"),
      });
      await expect(surface).toContainText(
        tr("1 kuittia tallennettu", "1 receipt saved"),
      );
      await expect(surface).toContainText(
        tr("1 oli jo tuotu", "1 already imported"),
      );
      await expect(surface).toContainText(tr("1 ei tuettu", "1 not supported"));
      await expect(surface).toContainText(tr("1 epäonnistui", "1 failed"));
      await expect(surface).toContainText("rikki.pdf");
      await expect(surface.getByRole("status").first()).toBeVisible();
      // The retry names only the failed file and reopens the picker.
      await stub(app, [bad]);
      await surface
        .getByRole("button", {
          name: tr("Yritä epäonnistuneita uudelleen", "Retry the failed files"),
        })
        .click();
      await expect(surface).toContainText(tr("1 epäonnistui", "1 failed"));
      await surface
        .getByRole("button", { name: tr("Sulje", "Close"), exact: true })
        .click();
      await expect(surface).toHaveCount(0);

      // Narrow and dark layouts stay usable; the draft and the list are untouched.
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setSize(800, 700),
      );
      await page.emulateMedia({ colorScheme: "dark" });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await nav(page, tr("Ostoslista", "Shopping list")).click();
      await expect(page.getByRole("textbox").first()).toHaveValue("Kahvia");
      const after = await load(page);
      expect(after.state).toEqual(before.state);
      expect(after.basket).toEqual(before.basket);
      expect([after.developmentRequests, after.developmentStoreWrites]).toEqual(
        [0, 0],
      );
      expect((await consentOf(page)).purchases).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  test(`the invitation after an import offers enable, just this import or not now, and each choice behaves as named in ${language}`, async () => {
    const data = await mkdtemp(join(tmpdir(), "korikone-invite-"));
    const files = [14, 15, 16, 17].map((day) => join(data, `${day}.txt`));
    for (const [i, file] of files.entries())
      await writeFile(
        file,
        receipt(14 + i, [
          [`XYZ HERKKU ${i + 1}00G`, "1,50"],
          [`ABC PUURO ${i + 1}00G`, "2,00"],
        ]),
        "utf8",
      );
    let { app, page } = await start(data, language, true);
    try {
      const open = () =>
        nav(page, tr("Historia", "History"))
          .click()
          .then(() =>
            page
              .getByRole("button", {
                name: tr("Tuo kuitteja", "Import receipts"),
                exact: true,
              })
              .click(),
          );
      const surface = () =>
        page.getByRole("region", {
          name: tr("Kuittien tuonti", "Receipt import"),
        });
      const button = (name: string) =>
        surface().getByRole("button", { name, exact: true });

      // First import: local success, an invitation and no request, no modal.
      await stub(app, [files[0]]);
      await open();
      await expect(surface()).toContainText(
        tr("1 kuittia tallennettu", "1 receipt saved"),
      );
      await expect(
        button(tr("Salli jatkossakin", "Enable for future imports")),
      ).toBeVisible();
      await expect(page.getByRole("alertdialog")).toHaveCount(0);
      expect((await load(page)).developmentRequests).toBe(0);
      expect((await consentOf(page)).consent?.automatic ?? null).toBeNull();

      // Just this import: one request, no saved permission, and it is offered again next time.
      await button(tr("Vain tämä tuonti", "Just this import")).click();
      await expect
        .poll(async () => (await load(page)).developmentRequests)
        .toBe(1);
      expect((await consentOf(page)).consent?.automatic ?? null).toBeNull();
      await stub(app, [files[1]]);
      await open();
      await expect(
        button(tr("Vain tämä tuonti", "Just this import")),
      ).toBeVisible();
      expect((await load(page)).developmentRequests).toBe(1);

      // Not now: nothing is sent, the pair is remembered across a restart.
      await button(tr("Ei nyt", "Not now")).click();
      await expect(
        button(tr("Vain tämä tuonti", "Just this import")),
      ).toHaveCount(0);
      expect((await load(page)).developmentRequests).toBe(1);
      expect((await consentOf(page)).consent?.declined).toBeTruthy();
      await app.close();
      ({ app, page } = await start(data, language, true));
      await stub(app, [files[2]]);
      await open();
      await expect(surface()).toContainText(
        tr("1 kuittia tallennettu", "1 receipt saved"),
      );
      await expect(
        button(tr("Vain tämä tuonti", "Just this import")),
      ).toHaveCount(0);
      expect((await load(page)).developmentRequests).toBe(0);
    } finally {
      await app.close();
    }
  });

  test(`enabling saves the permission and names the same import; later imports ask nothing in ${language}`, async () => {
    const data = await mkdtemp(join(tmpdir(), "korikone-enable-"));
    const files = [14, 15].map((day) => join(data, `${day}.txt`));
    for (const [i, file] of files.entries())
      await writeFile(
        file,
        receipt(20 + i, [
          [`XYZ HERKKU ${i + 3}00G`, "1,50"],
          [`ABC PUURO ${i + 3}00G`, "2,00"],
        ]),
        "utf8",
      );
    const { app, page } = await start(data, language, true);
    try {
      const surface = page.getByRole("region", {
        name: tr("Kuittien tuonti", "Receipt import"),
      });
      const open = async () => {
        await nav(page, tr("Historia", "History")).click();
        await page
          .getByRole("button", {
            name: tr("Tuo kuitteja", "Import receipts"),
            exact: true,
          })
          .click();
      };
      await stub(app, [files[0]]);
      await open();
      await surface
        .getByRole("button", {
          name: tr("Salli jatkossakin", "Enable for future imports"),
          exact: true,
        })
        .click();
      await expect
        .poll(async () => (await load(page)).developmentRequests)
        .toBe(1);
      expect((await consentOf(page)).consent?.automatic).toBeTruthy();
      // The next import is named without a question.
      await stub(app, [files[1]]);
      await open();
      await expect
        .poll(async () => (await load(page)).developmentRequests)
        .toBe(2);
      await expect(
        surface.getByRole("button", {
          name: tr("Salli jatkossakin", "Enable for future imports"),
        }),
      ).toHaveCount(0);
      expect((await load(page)).developmentStoreWrites).toBe(0);
    } finally {
      await app.close();
    }
  });
}
