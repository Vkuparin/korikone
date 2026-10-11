import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, expect } from "@playwright/test";
import { createDashboardServer } from "./server.mjs";
import { fixtureFiles, tasksFixture } from "./fixtures.mjs";

test("browser refreshes source changes, preserves filters/drafts and shows evidence and errors", async () => {
  const root = await mkdtemp(join(tmpdir(), "korikone-dashboard-ui-"));
  await mkdir(join(root, "docs/tasks"), { recursive: true });
  for (const [path, text] of Object.entries(fixtureFiles))
    await writeFile(join(root, path), text);
  const secondRoot = join(root, "second-project");
  await mkdir(join(secondRoot, "docs/tasks"), { recursive: true });
  for (const [path, text] of Object.entries(fixtureFiles))
    await writeFile(
      join(secondRoot, path),
      text.replaceAll("Better product matching", "Second project goal"),
    );
  const server = createDashboardServer({
    root,
    registryFile: join(root, "preferences/projects.json"),
    picker: async () => secondRoot,
    git: async () => ({ commit: "fixture", dirty: false }),
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch(
      process.env.KORIKONE_DASHBOARD_BROWSER_CHANNEL
        ? { channel: process.env.KORIKONE_DASHBOARD_BROWSER_CHANNEL }
        : {},
    );
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1050 },
    });
    const errors = [];
    const external = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (!request.url().startsWith("http://127.0.0.1:"))
        external.push(request.url());
    });
    const url = `http://127.0.0.1:${server.address().port}`;
    await page.goto(url);
    await expect(page.locator(".spotlight h2")).toHaveText("v0.7.0");
    await expect(page.locator(".big-number")).toHaveText("40%");
    await page.locator("nav [data-view='work']").click();
    await page.locator("#filter-search").fill("F15.2");
    await page.locator("#status-select").selectOption("active");
    await expect(page.locator(".task-card")).toHaveCount(1);
    await page.locator(".task-card").click();
    await expect(page.locator("#task-dialog")).toBeVisible();
    await expect(page.locator("#task-detail")).toContainText("Agent One");
    await writeFile(
      join(root, "docs/tasks/0.7.0.md"),
      tasksFixture.replace(
        "In progress: Agent One, branch codex/matcher",
        "Done: fixture merge; owner acceptance pending",
      ),
    );
    await expect(page.locator("#task-detail")).toContainText(
      "owner acceptance pending",
      { timeout: 8000 },
    );
    await expect(page.locator("#task-dialog")).toBeVisible();
    await page.locator("#close-detail").click();
    await expect(page.locator(".task-card")).toHaveCount(0, { timeout: 8000 });
    await expect(page.locator("#filter-search")).toHaveValue("F15.2");
    await expect(page.locator("#status-select")).toHaveValue("active");
    await page.locator("#status-select").selectOption("done");
    await page.locator(".task-card").click();
    await expect(page.locator("#task-detail")).toContainText(
      "owner acceptance pending",
    );
    await page.locator("#close-detail").click();
    await page.locator("#filter-search").fill("");
    await page.locator("#status-select").selectOption("all");
    if (!(await page.locator(".feature").evaluate((element) => element.open))) {
      await page.locator(".feature > summary").click();
    }
    await expect(page.locator(".feature")).toHaveAttribute("open", "");
    await page.locator("#filter-search").focus();
    await writeFile(
      join(root, "docs/tasks/0.7.0.md"),
      tasksFixture.replace(
        "Resolve general groceries",
        "Resolve food categories",
      ),
    );
    await expect(page.locator(".feature h2")).toHaveText(
      "Resolve food categories",
      { timeout: 8000 },
    );
    await expect(page.locator(".feature")).toHaveAttribute("open", "");
    await expect(page.locator("#filter-search")).toBeFocused();
    await page.locator("nav [data-view='roadmap']").click();
    await writeFile(
      join(root, "docs/roadmap.md"),
      fixtureFiles["docs/roadmap.md"].replace(
        "Better product matching",
        "A newly updated goal",
      ),
    );
    await expect(
      page
        .locator(".release-card h3")
        .filter({ hasText: "A newly updated goal" }),
    ).toBeVisible({ timeout: 8000 });
    await writeFile(
      join(root, "docs/tasks/0.7.0.md"),
      tasksFixture.replace("Planned |", "Mystery state |"),
    );
    await expect(page.locator("#source-issues")).toBeVisible({ timeout: 8000 });
    await page.locator("#source-issues summary").click();
    await expect(page.locator("#source-issues")).toContainText(
      "unrecognized status",
    );
    const firstProject = await page.locator("#project-select").inputValue();
    await page.locator("#add-project").click();
    await page.locator("#project-path").fill(root + "/missing-project");
    await page.locator("#save-project").click();
    await expect(page.locator("#project-error")).toContainText(
      "docs/roadmap.md",
    );
    await page.locator("#browse-project").click();
    await expect(page.locator("#project-path")).toHaveValue(secondRoot);
    await page.locator("#save-project").click();
    await expect(page.locator("#project-dialog")).not.toBeVisible();
    await expect(
      page
        .locator(".release-card h3")
        .filter({ hasText: "Second project goal" }),
    ).toBeVisible();
    await expect(page.locator("#source-issues")).not.toBeVisible();
    await expect(page).toHaveTitle("second-project · Development dashboard");
    await page.reload();
    await expect(
      page.locator(".spotlight p").filter({ hasText: "Second project goal" }),
    ).toBeVisible();
    await page.locator("#project-select").selectOption(firstProject);
    await expect(page.locator("#source-issues")).toBeVisible();
    await page.locator("nav [data-view='roadmap']").click();
    await expect(
      page
        .locator(".release-card h3")
        .filter({ hasText: "A newly updated goal" }),
    ).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      true,
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await expect(page.locator("#load-error")).toContainText(
      "last loaded snapshot",
      { timeout: 8000 },
    );
  } finally {
    await browser?.close();
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
