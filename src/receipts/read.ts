import { stat, readFile } from "node:fs/promises";
import { extname } from "node:path";
import { Worker } from "node:worker_threads";

export async function readReceipt(
  path: string,
  workerURL = new URL("./receipt-worker.js", import.meta.url),
): Promise<string> {
  const info = await stat(path);
  if (info.size > 20 * 1024 * 1024) throw new Error("receiptTooLarge");
  let text: string;
  if (extname(path).toLowerCase() === ".pdf") {
    text = await new Promise<string>((resolve, reject) => {
      const worker = new Worker(workerURL, { workerData: path });
      let settled = false;
      const finish = (error?: string, result?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        void worker.terminate();
        if (error) reject(new Error(error));
        else resolve(result!);
      };
      const timer = setTimeout(() => finish("receiptUnreadable"), 30000);
      worker.once("message", (message: { text?: string; error?: string }) =>
        finish(message.error, message.text),
      );
      worker.once("error", () => finish("receiptUnreadable"));
      worker.once("exit", () => {
        if (!settled) finish("receiptUnreadable");
      });
    });
  } else if ([".txt", ".csv"].includes(extname(path).toLowerCase())) {
    text = await readFile(path, "utf8");
  } else throw new Error("receiptUnreadable");
  if (!text.trim()) throw new Error("receiptNoText");
  if (text.length > 50000) throw new Error("receiptTooLarge");
  return text.trim();
}
