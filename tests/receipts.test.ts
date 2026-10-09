import { test, expect } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { readReceipt } from "../src/receipts/read";

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
