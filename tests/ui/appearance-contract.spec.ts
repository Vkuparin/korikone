import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("saved appearance is synchronously available before async snapshots and sets the initial native frame", async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_HIDDEN = "1";
  env.KORIKONE_TEST_DATA = await mkdtemp(
    join(tmpdir(), "korikone-appearance-bootstrap-"),
  );
  const options = {
    args: process.env.KORIKONE_EXECUTABLE ? [] : ["."],
    env,
    ...(process.env.KORIKONE_EXECUTABLE
      ? { executablePath: process.env.KORIKONE_EXECUTABLE }
      : {}),
  };
  let app = await electron.launch(options);
  try {
    let page = await app.firstWindow();
    await page.waitForFunction(() => !!window.korikone);
    const info = await page.evaluate(async () => window.korikone.getAppInfo());
    expect(info.ok).toBe(true);
    expect(info.value.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(info.value.developmentLocked).toBe(true);
    const disabled = await page.evaluate(async () =>
      window.korikone.setDevelopmentMode(false),
    );
    expect(disabled.ok).toBe(false);
    expect(disabled.error).toBe("developmentRequired");
    expect(
      await page.evaluate(
        async () => (await window.korikone.setAppearance("dark")).ok,
      ),
    ).toBe(true);
    await app.close();
    app = await electron.launch(options);
    page = await app.firstWindow();
    await page.addInitScript(() => {
      requestAnimationFrame(() => {
        (window as unknown as { firstAppearance: unknown }).firstAppearance = {
          theme: document.documentElement.dataset.theme,
          background: getComputedStyle(document.documentElement)
            .backgroundColor,
        };
      });
    });
    await page.reload();
    await page.waitForFunction(() => !!window.korikone);
    expect(
      await page.evaluate(() => window.korikone.getAppearanceBootstrap()),
    ).toEqual({ preference: "dark", resolved: "dark" });
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { firstAppearance: unknown }).firstAppearance,
        ),
      )
      .toEqual({ theme: "dark", background: "rgb(20, 28, 24)" });
    const built = await readFile("dist/ui/index.html", "utf8");
    expect(built.indexOf('src="./appearance-bootstrap.js"')).toBeLessThan(
      built.indexOf('rel="stylesheet"'),
    );
    expect(built.indexOf('src="./appearance-bootstrap.js"')).toBeLessThan(
      built.indexOf('type="module"'),
    );
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].getBackgroundColor().toLowerCase(),
      ),
    ).toBe("#141c18");
    await app.evaluate(({ nativeTheme }) => {
      nativeTheme.themeSource = "light";
    });
    expect(
      await page.evaluate(() => window.korikone.getAppearanceBootstrap()),
    ).toEqual({ preference: "dark", resolved: "dark" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page
      .getByRole("button", { name: "Kokeile esimerkkiä", exact: true })
      .click();
    const note = page.getByLabel("Mitä haluaisit valmistaa?");
    await note.fill("Retained unsaved input");
    const before = (await page.evaluate(async () => window.korikone.load()))
      .value;
    await page.evaluate(() => {
      const probe = window as unknown as {
        appearanceEvents: number;
        stopAppearanceProbe: () => void;
      };
      probe.appearanceEvents = 0;
      probe.stopAppearanceProbe = window.korikone.onAppearanceChange(() => {
        probe.appearanceEvents++;
      });
    });
    expect(
      await page.evaluate(
        async () => (await window.korikone.setAppearance("system")).ok,
      ),
    ).toBe(true);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await app.evaluate(({ nativeTheme }) => {
      nativeTheme.themeSource = "dark";
    });
    expect(
      await page.evaluate(() => window.korikone.getAppearanceBootstrap()),
    ).toEqual({ preference: "system", resolved: "dark" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator("html")).toHaveAttribute(
      "data-appearance",
      "system",
    );
    await expect(note).toHaveValue("Retained unsaved input");
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { appearanceEvents: number })
              .appearanceEvents,
        ),
      )
      .toBe(2);
    await page.evaluate(() => window.korikone.setAppearance("system"));
    await app.evaluate(({ nativeTheme }) => nativeTheme.emit("updated"));
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { appearanceEvents: number }).appearanceEvents,
      ),
    ).toBe(2);
    await page.evaluate(() =>
      (
        window as unknown as { stopAppearanceProbe: () => void }
      ).stopAppearanceProbe(),
    );
    await page.evaluate(() => window.korikone.setAppearance("light"));
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await app.evaluate(({ nativeTheme }) => (nativeTheme.themeSource = "dark"));
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { appearanceEvents: number }).appearanceEvents,
      ),
    ).toBe(2);
    await page.evaluate(() => window.korikone.setAppearance("system"));
    expect(
      await page.evaluate(
        async () => (await window.korikone.setAppearance("sepia")).ok,
      ),
    ).toBe(false);
    const snapshot = await page.evaluate(
      async () => (await window.korikone.load()).value,
    );
    expect(snapshot.state.appearance).toBe("system");
    expect(snapshot.state.meals).toEqual(before.state.meals);
    expect(snapshot.state.revision).toBe(before.state.revision);
    expect(snapshot.developmentRequests).toBe(0);
    expect(snapshot.developmentCatalogueRequests).toBe(
      before.developmentCatalogueRequests,
    );
  } finally {
    await app.close();
  }
});
