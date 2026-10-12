import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

for (const language of ["fi", "en"] as const) {
  test(`the list text export shows one QR code, or several numbered ones, in ${language}`, async () => {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        (e): e is [string, string] => typeof e[1] === "string",
      ),
    );
    delete env.ELECTRON_RUN_AS_NODE;
    env.KORIKONE_TEST_DATA = await mkdtemp(join(tmpdir(), "korikone-qr-"));
    env.KORIKONE_TEST_HIDDEN = "1";
    const app = await electron.launch({ args: ["."], env });
    try {
      const page = await app.firstWindow();
      const fi = language === "fi";
      const tr = (a: string, b: string) => (fi ? a : b);
      await page
        .getByRole("button", { name: "Aloita tyhjästä viikosta" })
        .click();
      const seed = (count: number) =>
        page.evaluate(
          async ({ count, language }) => {
            const api = window.korikone;
            await api.setLanguage(language);
            const state = (await api.load()).value.state;
            const saved = await api.save({
              ...state,
              staples: [],
              meals: [],
              extras: Array.from({ length: count }, (_, i) => ({
                id: `qr-${i}`,
                name: `Äänekäs tuote ${i + 1}`,
                amount: 100 + i,
                unit: "g" as const,
              })),
            });
            if (!saved.ok) throw new Error(saved.error);
          },
          { count, language },
        );
      const show = page.getByRole("button", {
        name: tr("Näytä QR-koodi", "Show QR code"),
        exact: true,
      });
      const before = (await page.evaluate(() => window.korikone.load())).value;

      // A short list is one code with no numbering.
      await seed(3);
      await page.reload();
      await show.focus();
      await page.keyboard.press("Enter");
      await expect(page.locator(".qr-code")).toHaveCount(1);
      await expect(page.locator(".qr-code svg")).toBeVisible();
      await expect(page.locator(".qr-export figcaption")).toHaveCount(0);

      // A list over 1,000 bytes becomes three numbered codes.
      await seed(60);
      await page.reload();
      await show.click();
      await expect(page.locator(".qr-code")).toHaveCount(3);
      await expect(page.locator(".qr-export figcaption")).toHaveText([
        `${tr("Koodi", "Code")} 1/3`,
        `${tr("Koodi", "Code")} 2/3`,
        `${tr("Koodi", "Code")} 3/3`,
      ]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setSize(800, 700),
      );
      await expect(page.locator(".qr-code").first()).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);

      // Hiding and showing change nothing and send nothing.
      await page
        .getByRole("button", {
          name: tr("Piilota QR-koodi", "Hide QR code"),
          exact: true,
        })
        .click();
      await expect(page.locator(".qr-code")).toHaveCount(0);
      const after = (await page.evaluate(() => window.korikone.load())).value;
      expect(after.developmentRequests).toBe(before.developmentRequests);
      expect(after.developmentStoreWrites).toBe(0);
    } finally {
      await app.close();
    }
  });
}
