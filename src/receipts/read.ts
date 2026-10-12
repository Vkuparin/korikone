import { stat, readFile } from "node:fs/promises";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { receiptLimits } from "./ocr-assets";

export type ReceiptExtraction = { text: string; ocrPages: number[] };
export async function readReceiptDetailed(
  path: string,
  options: { workerURL?: URL; assets?: string; timeoutMs?: number } = {},
): Promise<ReceiptExtraction> {
  if ((await stat(path)).size > receiptLimits.bytes)
    throw new Error("receiptTooLarge");
  let result: ReceiptExtraction;
  if (extname(path).toLowerCase() === ".pdf") {
    const deadline = Math.min(
      options.timeoutMs ?? receiptLimits.timeoutMs,
      receiptLimits.timeoutMs,
    );
    if (!Number.isFinite(deadline) || deadline < 1)
      throw new Error("receiptUnreadable");
    result = await new Promise<ReceiptExtraction>((resolve, reject) => {
      const worker = new Worker(
        options.workerURL ?? new URL("./receipt-worker.js", import.meta.url),
        {
          workerData: {
            path,
            assets:
              options.assets ??
              fileURLToPath(new URL("../../vendor/ocr/", import.meta.url)),
          },
        },
      );
      let settled = false;
      const finish = (error?: string, value?: ReceiptExtraction) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        // Terminating the parent worker also terminates its Tesseract child worker.
        void worker.terminate().then(
          () => {
            if (error) reject(new Error(error));
            else resolve(value!);
          },
          () => reject(new Error("receiptUnreadable")),
        );
      };
      const timer = setTimeout(() => finish("receiptUnreadable"), deadline);
      worker.once("message", (message: unknown) => {
        const value = message as Partial<ReceiptExtraction> & {
          error?: string;
        };
        if (value?.error)
          return finish(
            ["receiptTooLarge", "receiptNoText"].includes(value.error)
              ? value.error
              : "receiptUnreadable",
          );
        if (
          typeof value?.text !== "string" ||
          !Array.isArray(value.ocrPages) ||
          value.ocrPages.length > receiptLimits.pages ||
          value.ocrPages.some(
            (page, index) =>
              !Number.isInteger(page) ||
              page < 1 ||
              page > receiptLimits.pages ||
              (index > 0 && page <= value.ocrPages![index - 1]),
          )
        )
          return finish("receiptUnreadable");
        finish(undefined, value as ReceiptExtraction);
      });
      worker.once("error", () => finish("receiptUnreadable"));
      worker.once("exit", () => {
        if (!settled) finish("receiptUnreadable");
      });
    });
  } else if ([".txt", ".csv"].includes(extname(path).toLowerCase())) {
    result = { text: await readFile(path, "utf8"), ocrPages: [] };
  } else throw new Error("receiptUnreadable");
  if (!result.text.trim()) throw new Error("receiptNoText");
  if (result.text.length > receiptLimits.characters)
    throw new Error("receiptTooLarge");
  return { ...result, text: result.text.trim() };
}
/** Existing callers that only need text retain the same API and limits. */
export async function readReceipt(
  path: string,
  workerURL?: URL,
): Promise<string> {
  return (await readReceiptDetailed(path, { workerURL })).text;
}
