import type { ElectronApplication, Page } from "@playwright/test";

// The main process creates the window before it loads the app page. A reload issued
// before that load is aborted by it, so wait until the app page itself has loaded.
export async function appWindow(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  await page.waitForURL(/^file:/);
  await page.waitForLoadState("load");
  return page;
}
