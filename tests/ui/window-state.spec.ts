import { test, expect, _electron as electron } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const environment = async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_DATA = await mkdtemp(join(tmpdir(), "korikone-window-"));
  env.KORIKONE_TEST_HIDDEN = "1";
  return env;
};

test("the window opens again at the size and place it was left at (B6.3)", async () => {
  const env = await environment();
  const first = await electron.launch({ args: ["."], env });
  try {
    await first.firstWindow();
    await first.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setBounds({
        x: 40,
        y: 30,
        width: 900,
        height: 700,
      }),
    );
  } finally {
    // Quitting saves the place even within the half second before a resize is saved anyway.
    await first.close();
  }
  const second = await electron.launch({ args: ["."], env });
  try {
    await second.firstWindow();
    expect(
      await second.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].getBounds(),
      ),
    ).toEqual({ x: 40, y: 30, width: 900, height: 700 });
  } finally {
    await second.close();
  }
});

test("launching Korikone again brings the open window forward instead of a second copy (B6.3)", async () => {
  const env = await environment();
  const app = await electron.launch({ args: ["."], env });
  try {
    await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      const seen: string[] = [];
      (globalThis as unknown as { seen: string[] }).seen = seen;
      window.focus = () => void seen.push("focus");
    });
    const electronPath = (await import("electron"))
      .default as unknown as string;
    const again = spawn(electronPath, [".", "--no-sandbox"], {
      env,
      stdio: "ignore",
    });
    // The second launch hands over to the running one and ends.
    expect(
      await new Promise<number | null>((resolve, reject) => {
        const timer = setTimeout(() => {
          again.kill();
          reject(new Error("The second launch kept running"));
        }, 30000);
        again.on("exit", (code) => {
          clearTimeout(timer);
          resolve(code);
        });
      }),
    ).toBe(0);
    await expect
      .poll(() =>
        app.evaluate(() => (globalThis as unknown as { seen: string[] }).seen),
      )
      .toEqual(["focus"]);
    expect(
      await app.evaluate(
        ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
      ),
    ).toBe(1);
  } finally {
    await app.close();
  }
});
