import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("verified transfer retains its result on opening failure and retries only the handoff", async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_DATA = await mkdtemp(join(tmpdir(), "korikone-transfer-"));
  env.KORIKONE_TEST_HIDDEN = "1";
  const app = await electron.launch({
    args: process.env.KORIKONE_EXECUTABLE ? [] : ["."],
    env,
    ...(process.env.KORIKONE_EXECUTABLE
      ? { executablePath: process.env.KORIKONE_EXECUTABLE }
      : {}),
  });
  try {
    const page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Kokeile esimerkkiä", exact: true })
      .click();
    await expect(page.getByLabel("Mitä haluaisit valmistaa?")).toBeVisible();
    const result = await page.evaluate(async () => {
      const api = window.korikone;
      let initial = (await api.load()).value;
      // A coffee-only batch avoids the fixture cart's existing pasta.
      const saved = await api.save({
        ...initial.state,
        meals: [],
        extras: [],
        staples: initial.state.staples.map((item) => ({
          ...item,
          enabled: true,
        })),
      });
      if (!saved.ok) throw new Error(saved.error);
      initial = saved.value;
      initial = (await api.buildBasket()).value;
      await api.developmentScenario("handoffFailed");
      const failed = await api.transferDisplayed({
        revision: initial.state.revision,
        quotedAt: initial.quotedAt,
        batchKey: initial.transferBatchKey,
      });
      if (!failed.ok) throw new Error(failed.error);
      const journal = failed.value.journal;
      await api.developmentScenario("success");
      const opened = await api.openStoreCart();
      const repeated = await api.transferDisplayed({
        revision: initial.state.revision,
        quotedAt: initial.quotedAt,
        batchKey: initial.transferBatchKey,
      });
      return {
        failed: failed.value,
        opened: opened.value,
        repeated: repeated.value,
        journal,
      };
    });
    expect(result.failed.transferException).toBeNull();
    expect(result.failed.journal?.status).toBe("verified");
    expect(result.failed.handoffError).toBe("operationFailed");
    expect(result.failed.developmentHandoffs).toEqual([]);
    expect(result.opened.developmentHandoffs).toHaveLength(1);
    expect(result.opened.journal).toEqual(result.journal);
    expect(result.repeated.journal).toEqual(result.journal);
    expect(result.repeated.developmentHandoffs).toHaveLength(2);
  } finally {
    await app.close();
  }
});
