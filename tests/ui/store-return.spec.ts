import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("leaving the Kauppa view keeps each chain's page and pending sign-in, and the navigation offers the way back", async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_DATA = await mkdtemp(
    join(tmpdir(), "korikone-store-return-"),
  );
  env.KORIKONE_TEST_HIDDEN = "1";
  const app = await electron.launch({ args: ["."], env });
  // Every store page, seen from the main process.
  const tabs = () =>
    app.evaluate(({ webContents }) =>
      webContents
        .getAllWebContents()
        .filter((c) => c.getURL().startsWith("http://127.0.0.1"))
        .map((c) => ({ id: c.id, url: c.getURL() }))
        .sort((a, b) => a.id - b.id),
    );
  const run = (id: number, script: string) =>
    app.evaluate(
      ({ webContents }, { id, script }) =>
        webContents.fromId(id)!.executeJavaScript(script),
      { id, script },
    );
  try {
    const page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Kokeile esimerkkiä", exact: true })
      .click();
    // Both chains get a fixture store through the real context APIs; S-kaupat is active.
    await page.evaluate(async () => {
      const api = window.korikone;
      const search = (await api.searchStores("Helsinki")).value;
      const k = search.storeResults.find((c) => c.providerId === "k-ruoka")!;
      const s = search.storeResults.find((c) => c.providerId === "s-kaupat")!;
      const first = await api.changeContext({
        context: k,
        revision: search.state.revision,
      });
      const second = await api.changeContext({
        context: s,
        revision: first.value.state.revision,
      });
      if (!first.ok || !second.ok) throw new Error("context");
    });
    await page.reload();
    const nav = (name: string | RegExp) =>
      page.getByRole("navigation").getByRole("button", { name });
    const store = nav(/^Kauppa/);
    await expect(store).not.toHaveClass(/store-open/);

    await store.click();
    await expect(
      page.getByRole("tab", { name: "S-kaupat", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect.poll(async () => (await tabs()).length).toBe(1);
    const s = (await tabs())[0];
    // A half-finished sign-in: the login page is open and marked, nothing is submitted.
    await run(s.id, "location.href = 'kirjaudu'");
    await expect
      .poll(async () => (await tabs())[0].url)
      .toMatch(/\/s-kaupat\/kirjaudu$/);
    await run(s.id, "window.returnMarker = 'pending sign-in'; 1");

    await page.getByRole("tab", { name: "K-Ruoka", exact: true }).click();
    await expect.poll(async () => (await tabs()).length).toBe(2);
    const k = (await tabs()).find((tab) => tab.id !== s.id)!;
    await run(k.id, "location.href = 'tuote'");
    await expect
      .poll(async () => (await tabs()).find((t) => t.id === k.id)!.url)
      .toMatch(/\/k-ruoka\/tuote$/);
    await run(k.id, "window.returnMarker = 'product page'; 1");

    // Away to Settings: the entry says which store is open and how to return.
    await nav("Asetukset").click();
    await expect(store).toHaveClass(/store-open/);
    await expect(store).toContainText("K-Ruoka · palaa");
    await nav("Ostoslista").click();
    await expect(store).toHaveClass(/store-open/);

    await store.click();
    await expect(store).toHaveAttribute("aria-current", "page");
    await expect(store).not.toHaveClass(/store-open/);
    await expect(
      page.getByRole("tab", { name: "K-Ruoka", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    // The same two pages, not reloaded and not duplicated.
    expect(await tabs()).toEqual(
      [
        { id: s.id, url: expect.stringMatching(/\/s-kaupat\/kirjaudu$/) },
        { id: k.id, url: expect.stringMatching(/\/k-ruoka\/tuote$/) },
      ].sort((a, b) => a.id - b.id),
    );
    expect(await run(k.id, "window.returnMarker")).toBe("product page");
    await page.getByRole("tab", { name: "S-kaupat", exact: true }).click();
    expect(await run(s.id, "window.returnMarker")).toBe("pending sign-in");

    // Finishing the sign-in there, leaving and returning keeps the session.
    await run(s.id, "document.querySelector('form').submit()");
    await expect
      .poll(() => run(s.id, "document.body.textContent"))
      .toContain("Kirjautunut");
    for (let i = 0; i < 3; i++) {
      await nav("Asetukset").click();
      await store.click();
    }
    expect((await tabs()).map((tab) => tab.id).sort()).toEqual(
      [s.id, k.id].sort(),
    );
    expect(await run(s.id, "fetch('session').then((r) => r.json())")).toEqual({
      accountId: "fixture:s-kaupat",
    });
    // The other chain's session is separate and was never signed in.
    expect(await run(k.id, "fetch('session').then((r) => r.json())")).toEqual({
      accountId: null,
    });
    const snapshot = (await page.evaluate(() => window.korikone.load())).value;
    expect(snapshot.developmentStoreWrites).toBe(0);
    expect(snapshot.developmentRequests).toBe(0);
    expect(snapshot.state.context.providerId).toBe("s-kaupat");
  } finally {
    await app.close();
  }
});
