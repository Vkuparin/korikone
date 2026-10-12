// Focused packaging check: ASAR worker, native canvas, local WASM/model and real receipt IPC.
import { _electron as electron } from "@playwright/test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
const env = Object.fromEntries(
  Object.entries(process.env).filter(([, value]) => typeof value === "string"),
);
delete env.ELECTRON_RUN_AS_NODE;
env.KORIKONE_TEST_DATA = await mkdtemp(join(tmpdir(), "korikone-ocr-package-"));
env.KORIKONE_TEST_HIDDEN = "1";
const executablePath = resolve(
  process.argv[2] ?? "release/win-unpacked/Korikone.exe",
);
const app = await electron.launch({ executablePath, args: [], env });
try {
  assert.equal(await app.evaluate(({ app }) => app.isPackaged), true);
  const expectedVersion = JSON.parse(
    await readFile("package.json", "utf8"),
  ).version;
  assert.equal(
    await app.evaluate(({ app }) => app.getVersion()),
    expectedVersion,
  );
  const page = await app.firstWindow();
  await page.waitForFunction(() => !!window.korikone);
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [path],
    });
  }, resolve("tests/fixtures/receipts/ocr-k-clean.pdf"));
  const result = await page.evaluate(() =>
    window.korikone.importPurchaseReceipt(),
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.value.purchaseImport.ocrPages, [1]);
  assert.equal(result.value.purchaseImport.reconciliation, "balanced");
  assert.equal(result.value.developmentRequests, 0);
  assert.equal(result.value.developmentStoreWrites, 0);
  const listed = await page.evaluate(() => window.korikone.listPurchases());
  assert.deepEqual(listed.value.receipts.purchases[0].ocrPages, [1]);
  console.log(
    `Packaged ${expectedVersion}: local OCR import, total and saved provenance passed; zero AI/retailer writes.`,
  );
} finally {
  await app.close();
}
