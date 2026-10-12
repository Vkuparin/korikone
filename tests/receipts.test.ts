import { test, expect } from "vitest";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { readReceipt, readReceiptDetailed } from "../src/receipts/read";
import { parseReceipt } from "../src/receipts/parsers";
import { receiptLimits } from "../src/receipts/ocr-assets";

const worker = pathToFileURL(
  join(process.cwd(), "dist/main/receipt-worker.js"),
);
import { receiptPDF as pdf } from "./fixtures/receipt";

test("extracts PDF receipt text locally and rejects empty or broken PDFs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "korikone-receipt-"));
  const path = join(directory, "receipt.PDF");
  await writeFile(path, pdf("K-Market  Yogurtti 2.49  Banaani 1.99"));
  expect(await readReceipt(path, worker)).toContain("Yogurtti 2.49");
  await writeFile(path, pdf(""));
  await expect(readReceipt(path, worker)).rejects.toThrow("receiptNoText");
  await writeFile(path, "not a PDF");
  await expect(readReceipt(path, worker)).rejects.toThrow("receiptUnreadable");
}, 30000);

const scan = (name: string) =>
  join(process.cwd(), "tests/fixtures/receipts", name);
test("offline Finnish OCR reads a synthetic scan and preserves uncertain money as incomplete", async () => {
  const clean = await readReceiptDetailed(scan("ocr-k-clean.pdf"), {
    workerURL: worker,
  });
  expect(clean.ocrPages).toEqual([1]);
  expect(clean.text).toContain("JÄÄTELÖ");
  const parsed = parseReceipt(clean.text);
  expect(parsed.outcome).toBe("event");
  if (parsed.outcome !== "event") throw new Error("Expected receipt");
  expect(parsed.facts.reconciliation).toMatchObject({ status: "balanced" });
  expect(parsed.facts.printed.find((p) => p.role === "total")?.amount).toBe(
    667,
  );
  expect(
    parsed.facts.lines.filter((l) => l.role === "product").map((l) => l.gross),
  ).toEqual([129, 319, 249]);
  const uncertain = parseReceipt(
    (
      await readReceiptDetailed(scan("ocr-s-uncertain.pdf"), {
        workerURL: worker,
      })
    ).text,
  );
  expect(uncertain.outcome).toBe("event");
  if (uncertain.outcome !== "event") throw new Error("Expected receipt");
  expect(uncertain.facts.reconciliation.status).toBe("incomplete");
  expect(uncertain.facts.lines.some((line) => line.gross === null)).toBe(true);
  expect(uncertain.facts.printed.find((p) => p.role === "total")?.amount).toBe(
    837,
  );
}, 30000);

test("OCR rejects missing and corrupt local assets without falling back; text PDFs need no model", async () => {
  const assets = await mkdtemp(join(tmpdir(), "korikone-ocr-assets-"));
  await expect(
    readReceiptDetailed(scan("ocr-k-clean.pdf"), { workerURL: worker, assets }),
  ).rejects.toThrow("receiptUnreadable");
  const model = await readFile("vendor/ocr/fin.traineddata");
  model[0] ^= 1;
  await writeFile(join(assets, "fin.traineddata"), model);
  await expect(
    readReceiptDetailed(scan("ocr-k-clean.pdf"), { workerURL: worker, assets }),
  ).rejects.toThrow("receiptUnreadable");
  const path = join(assets, "text.pdf");
  await writeFile(path, pdf("Kuitti 2,49 €"));
  expect(
    await readReceiptDetailed(path, { workerURL: worker, assets }),
  ).toEqual({ text: "Kuitti 2,49 €", ocrPages: [] });
}, 30000);

test("receipt deadline terminates real OCR work and the next import still succeeds", async () => {
  expect(receiptLimits.timeoutMs).toBe(30000);
  const directory = await mkdtemp(join(tmpdir(), "korikone-ocr-timeout-"));
  const breadcrumb = join(directory, "ocr-started");
  const heartbeat = join(directory, "child-heartbeat");
  const child = join(directory, "child.cjs");
  await writeFile(
    child,
    `const fs = require('node:fs');
    setInterval(() => fs.writeFileSync(${JSON.stringify(heartbeat)}, String(Date.now())), 50);
    require(${JSON.stringify(join(process.cwd(), "dist/main/receipt-ocr-worker.cjs"))});`,
  );
  const stalled = join(directory, "stalled.cjs");
  // Start the real engine in the real PDF worker, then stall its recognition boundary.
  await writeFile(
    stalled,
    `const fs = require('node:fs');
    const engine = require(${JSON.stringify(join(process.cwd(), "node_modules/tesseract.js"))});
    const create = engine.createWorker;
    engine.createWorker = async (...args) => {
      args[2] = { ...args[2], workerPath: ${JSON.stringify(child)} };
      const instance = await create(...args);
      instance.recognize = async () => { fs.writeFileSync(${JSON.stringify(breadcrumb)}, 'started'); await new Promise(() => {}); };
      return instance;
    };
    import(${JSON.stringify(worker.href)});`,
  );
  const started = performance.now();
  await expect(
    readReceiptDetailed(scan("ocr-k-clean.pdf"), {
      workerURL: pathToFileURL(stalled),
      timeoutMs: 2000,
    }),
  ).rejects.toThrow("receiptUnreadable");
  expect(await readFile(breadcrumb, "utf8")).toBe("started");
  const stopped = await readFile(heartbeat, "utf8");
  await new Promise((resolve) => setTimeout(resolve, 350));
  expect(await readFile(heartbeat, "utf8")).toBe(stopped);
  expect(performance.now() - started).toBeLessThan(4000);
  expect(
    (await readReceiptDetailed(scan("ocr-k-clean.pdf"), { workerURL: worker }))
      .ocrPages,
  ).toEqual([1]);
}, 30000);

test("an unreadable graphic page cannot silently disappear from a mixed receipt", async () => {
  const directory = await mkdtemp(join(tmpdir(), "korikone-ocr-unreadable-"));
  const path = join(directory, "mixed.pdf");
  await writeFile(
    path,
    pdf(["Kuitti 2,49", ""], "Helvetica", "0 0 0 rg 50 50 300 50 re f"),
  );
  await expect(
    readReceiptDetailed(path, { workerURL: worker }),
  ).rejects.toThrow("receiptNoText");
}, 30000);

test("mixed PDF pages preserve text-layer extraction, OCR page numbers and page separators", async () => {
  const mixed = await readReceiptDetailed(scan("ocr-mixed.pdf"), {
    workerURL: worker,
  });
  expect(mixed.ocrPages).toEqual([2]);
  const pages = mixed.text.split("\f").map((page) => page.trim());
  expect(pages).toHaveLength(3);
  expect(pages[0]).toBe("Tekstisivu 1,23 euro");
  expect(pages[1]).toContain("Yhteensä 6,67");
  expect(pages[2]).toBe(pages[0]);
}, 30000);

test("image-only PDF raster dimensions are bounded before allocation and text output stays bounded", async () => {
  const directory = await mkdtemp(join(tmpdir(), "korikone-ocr-bounds-"));
  const path = join(directory, "large.pdf");
  await writeFile(path, pdf("").replace("900 200", "900000 200000"));
  await expect(
    readReceiptDetailed(path, { workerURL: worker }),
  ).rejects.toThrow("receiptTooLarge");
  await writeFile(
    path,
    pdf("a".repeat(50001)).replace("/F1 12 Tf", "/F1 0.001 Tf"),
  );
  await expect(
    readReceiptDetailed(path, { workerURL: worker }),
  ).rejects.toThrow("receiptTooLarge");
}, 30000);

test("text receipt import preserves Finnish text and rejects oversized input", async () => {
  const directory = await mkdtemp(join(tmpdir(), "korikone-receipt-"));
  const path = join(directory, "receipt.txt");
  await writeFile(path, "Jäätelö 3,99 €\nRuisleipä 2,49 €", "utf8");
  expect(await readReceipt(path, worker)).toContain("Jäätelö 3,99 €");
  await writeFile(path, "a".repeat(50001));
  await expect(readReceipt(path, worker)).rejects.toThrow("receiptTooLarge");
});

test("PDF fixtures preserve Finnish WinAnsi text, punctuation and page order in both fonts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "korikone-receipt-fonts-"));
  const path = join(directory, "receipt.pdf");
  for (const font of ["Helvetica", "Courier"] as const) {
    await writeFile(
      path,
      pdf(["Jäätelö (vanilja) 3,99 €", "Ruisleipä 2,49 €"], font),
    );
    const text = await readReceipt(path, worker);
    const words = text.replace(/\s+/g, " ");
    expect(words).toContain("Jäätelö (vanilja) 3,99 €");
    expect(words).toContain("Ruisleipä 2,49 €");
    expect(text.indexOf("Jäätelö")).toBeLessThan(text.indexOf("Ruisleipä"));
  }
}, 30000);

test("PDF page and file limits reject oversized fixtures before using their text", async () => {
  const directory = await mkdtemp(join(tmpdir(), "korikone-receipt-limits-"));
  const path = join(directory, "receipt.pdf");
  await writeFile(path, pdf(Array.from({ length: 101 }, () => "Kuitti")));
  await expect(readReceipt(path, worker)).rejects.toThrow("receiptTooLarge");
  await writeFile(path, Buffer.alloc(20 * 1024 * 1024 + 1));
  await expect(readReceipt(path, worker)).rejects.toThrow("receiptTooLarge");
}, 30000);
