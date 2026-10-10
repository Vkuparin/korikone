import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("real IPC task repair and persisted diagnostics export contain only bounded operation counters", async () => {
  const directory = await mkdtemp(join(tmpdir(), "korikone-metrics-"));
  const env: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ),
    KORIKONE_TEST_DATA: directory,
    KORIKONE_TEST_HIDDEN: "1",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  let app = await electron.launch({ args: ["."], env });
  const filePath = join(directory, "diagnostics.json");
  try {
    let page = await app.firstWindow();
    await page.waitForFunction(() => !!window.korikone);
    await page.evaluate(async () => {
      const api = window.korikone;
      const initial = (await api.load()).value.state;
      initial.receiptText = "PRIVATE RECEIPT PAYMENT LOYALTY";
      initial.onboarded = initial.setupComplete = true;
      expectResult(await api.save(initial));
      expectResult(await api.signInAI());
      expectResult(await api.developmentScenario("invalidOnce"));
      expectResult(
        await api.generate({
          prompt: "Tomaattipastaa neljälle",
          consent: true,
        }),
      );
      expectResult(await api.approveDraft());
      function expectResult(result: { ok: boolean }) {
        if (!result.ok) throw new Error("Fixture IPC failed");
      }
    });
    await app.close();
    app = await electron.launch({ args: ["."], env });
    page = await app.firstWindow();
    await page.waitForFunction(() => !!window.korikone);
    await app.evaluate(({ dialog }, path) => {
      dialog.showMessageBox = async (...args: unknown[]) => {
        Object.assign(globalThis, {
          metricPreview: (args.at(-1) as { detail: string }).detail,
        });
        return { response: 0, checkboxChecked: false };
      };
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
    }, filePath);
    const result = await page.evaluate(() =>
      window.korikone.exportDiagnostics(),
    );
    expect(result.ok).toBe(true);
    const text = await readFile(filePath, "utf8");
    expect(text).toBe(
      await app.evaluate(
        () =>
          (globalThis as unknown as { metricPreview: string }).metricPreview,
      ),
    );
    const metrics = JSON.parse(text).operationMetrics;
    expect(metrics).toContainEqual(
      expect.objectContaining({
        kind: "interpretation",
        outcome: "success",
        aiCalls: 2,
        repairCalls: 1,
      }),
    );
    expect(metrics).toContainEqual(
      expect.objectContaining({
        kind: "pricing",
        outcome: "success",
        searches: expect.any(Number),
      }),
    );
    expect(text).not.toMatch(
      /PRIVATE|Tomaattipasta|receiptText|prompt|accountId|modelId|productName/,
    );
    const snapshot = await page.evaluate(() => window.korikone.load());
    expect(snapshot.value.developmentMode).toBe(true);
    expect(snapshot.value.developmentRequests).toBe(0);
  } finally {
    await app.close();
  }
});
