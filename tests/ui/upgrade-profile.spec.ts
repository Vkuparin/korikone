import { test, expect, _electron as electron } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fixtureTab } from "./store-helpers";

test("reopening an existing profile retains encrypted ChatGPT credentials and both store sessions", async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  const profile = await mkdtemp(join(tmpdir(), "korikone-upgrade-profile-"));
  env.KORIKONE_TEST_DATA = profile;
  env.KORIKONE_TEST_HIDDEN = "1";
  const credential = JSON.stringify({
    clientId: "synthetic-client",
    subject: "synthetic-user",
    email: "fixture@example.invalid",
    accessToken: "synthetic-access",
    refreshToken: "synthetic-refresh",
    idToken: "synthetic-id",
    expiresAt: 1,
    scopes: ["chatgpt.tokens.use.direct"],
  });
  let app = await electron.launch({ args: ["."], env });
  let closed = false;
  try {
    let page = await app.firstWindow();
    await page.evaluate(() => window.korikone.load());
    const encrypted = await app.evaluate(({ safeStorage }, credential) => {
      if (!safeStorage.isEncryptionAvailable())
        throw new Error("Encryption unavailable");
      return safeStorage.encryptString(credential).toString("base64");
    }, credential);
    for (const chain of ["k-ruoka", "s-kaupat"] as const) {
      const shown = await page.evaluate(
        (chain) =>
          window.korikone.storeView({
            chain,
            area: { x: 0, y: 0, width: 800, height: 600 },
          }),
        chain,
      );
      expect(shown.ok).toBe(true);
      const tab = await fixtureTab(app, chain);
      const signedIn = await app.evaluate(
        ({ webContents }, id) =>
          webContents
            .fromId(id)!
            .executeJavaScript(
              'fetch("kirjaudu", {method:"POST"}).then(r => r.text()).then(t => t.includes("Kirjautunut"))',
            ),
        tab.id,
      );
      expect(signedIn).toBe(true);
    }
    // Native/legacy worker profiles also live under userData, outside the install folder.
    for (const folder of ["retailers/k-ruoka/profile", "retailers/s-kaupat"]) {
      await mkdir(join(profile, folder), { recursive: true });
      await writeFile(
        join(profile, folder, "synthetic-session.txt"),
        "retained",
      );
    }
    await app.close();
    closed = true;
    const db = new DatabaseSync(join(profile, "korikone.sqlite"));
    const values = {
      "chatgpt-credentials": encrypted,
      "chatgpt-host": "urn:uuid:synthetic-host",
      "chatgpt-registration": { clientId: "synthetic-client" },
    };
    for (const [key, value] of Object.entries(values))
      db.prepare("INSERT OR REPLACE INTO documents VALUES (?,?)").run(
        key,
        JSON.stringify(value),
      );
    db.close();

    app = await electron.launch({ args: ["."], env });
    closed = false;
    page = await app.firstWindow();
    await page.evaluate(() => window.korikone.load());
    expect(
      await app.evaluate(({ app }) => [
        app.getPath("userData"),
        app.getPath("sessionData"),
      ]),
    ).toEqual([profile, profile]);
    for (const chain of ["k-ruoka", "s-kaupat"] as const) {
      await page.evaluate(
        (chain) =>
          window.korikone.storeView({
            chain,
            area: { x: 0, y: 0, width: 800, height: 600 },
          }),
        chain,
      );
      const tab = await fixtureTab(app, chain);
      await expect
        .poll(() =>
          app.evaluate(
            ({ webContents }, id) =>
              webContents
                .fromId(id)!
                .executeJavaScript(
                  'document.body.innerText.includes("Kirjautunut")',
                ),
            tab.id,
          ),
        )
        .toBe(true);
    }
    expect(
      await app.evaluate(
        ({ safeStorage }, { encrypted, credential }) =>
          safeStorage.decryptString(Buffer.from(encrypted, "base64")) ===
          credential,
        { encrypted, credential },
      ),
    ).toBe(true);
    const snapshot = (await page.evaluate(() => window.korikone.load())).value;
    expect(snapshot.developmentRequests).toBe(0);
    expect(snapshot.developmentStoreWrites).toBe(0);
    await app.close();
    closed = true;
    const reopened = new DatabaseSync(join(profile, "korikone.sqlite"));
    for (const [key, value] of Object.entries(values))
      expect(
        JSON.parse(
          (
            reopened
              .prepare("SELECT value FROM documents WHERE key=?")
              .get(key) as { value: string }
          ).value,
        ),
      ).toEqual(value);
    reopened.close();
    for (const folder of ["retailers/k-ruoka/profile", "retailers/s-kaupat"])
      expect(
        await readFile(join(profile, folder, "synthetic-session.txt"), "utf8"),
      ).toBe("retained");
  } finally {
    if (!closed) await app.close();
  }
});
