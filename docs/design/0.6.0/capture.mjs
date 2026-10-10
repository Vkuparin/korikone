import { _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

const output = resolve("docs/design/0.6.0/screens");
await mkdir(output, { recursive: true });
const env = {
  ...process.env,
  KORIKONE_TEST_DATA: await mkdtemp(join(tmpdir(), "korikone-design-")),
  KORIKONE_TEST_HIDDEN: "1",
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["."], env });
const manifest = [];
try {
  const page = await app.firstWindow();
  await page.getByRole("button", { name: "Kokeile esimerkkiä" }).click();
  for (const [width, height] of [
    [1280, 800],
    [800, 600],
  ]) {
    await page.setViewportSize({ width, height });
    await page.screenshot({
      path: join(output, `baseline-shopping-${width}.png`),
    });
  }
  await page.getByRole("button", { name: "Asetukset", exact: true }).click();
  await page.screenshot({ path: join(output, "baseline-settings-800.png") });
  for (const view of ["Shopping", "Settings"]) {
    for (const theme of ["light", "dark"]) {
      for (const [width, height] of [
        [1280, 800],
        [800, 600],
      ]) {
        for (const state of [
          "empty",
          "populated",
          "working",
          "unresolved",
          "exception",
        ]) {
          await page.setViewportSize({ width, height });
          const url = pathToFileURL(resolve("docs/design/0.6.0/layouts.html"));
          url.search = new URLSearchParams({
            page: view,
            theme,
            state,
            capture: "1",
          }).toString();
          await page.goto(url.href);
          const file = `${view.toLowerCase()}-${theme}-${width}-${state}.png`;
          await page.screenshot({ path: join(output, file) });
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          );
          if (overflow) throw new Error(`Horizontal overflow: ${file}`);
          if (width === 800 && view === "Shopping" && state !== "empty") {
            await page
              .locator(".content")
              .evaluate((el) => (el.scrollTop = el.scrollHeight));
            await page.screenshot({
              path: join(output, file.replace(".png", "-list.png")),
            });
          }
          manifest.push({
            view,
            theme,
            width,
            height,
            state,
            file,
            horizontalOverflow: overflow,
          });
        }
      }
    }
  }
  await writeFile(
    join(output, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  console.log(
    `Captured ${manifest.length} layouts plus narrow list views and baseline screens; no horizontal overflow.`,
  );
} finally {
  await app.close();
}
