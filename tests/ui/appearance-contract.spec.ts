import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
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
  let app = await electron.launch({ args: ["."], env });
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
    app = await electron.launch({ args: ["."], env });
    page = await app.firstWindow();
    await page.waitForFunction(() => !!window.korikone);
    expect(
      await page.evaluate(() => window.korikone.getAppearanceBootstrap()),
    ).toEqual({ preference: "dark", resolved: "dark" });
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
    expect(
      await page.evaluate(
        async () => (await window.korikone.setAppearance("system")).ok,
      ),
    ).toBe(true);
    await app.evaluate(({ nativeTheme }) => {
      nativeTheme.themeSource = "dark";
    });
    expect(
      await page.evaluate(() => window.korikone.getAppearanceBootstrap()),
    ).toEqual({ preference: "system", resolved: "dark" });
    expect(
      await page.evaluate(
        async () => (await window.korikone.setAppearance("sepia")).ok,
      ),
    ).toBe(false);
    const snapshot = await page.evaluate(
      async () => (await window.korikone.load()).value,
    );
    expect(snapshot.state.appearance).toBe("system");
    expect(snapshot.developmentRequests).toBe(0);
    expect(snapshot.developmentCatalogueRequests).toBe(0);
  } finally {
    await app.close();
  }
});
