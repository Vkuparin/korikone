import { lstat, open } from "node:fs/promises";
import { basename, extname, isAbsolute } from "node:path";
import type { IntakeFile } from "../application/receipt-intake";
import { receiptLimits } from "./ocr-assets";
import { readReceiptDetailed, type ReceiptExtraction } from "./read";

const formats = { ".pdf": "pdf", ".txt": "txt", ".csv": "csv" } as const;

/**
 * Checks one path the main process was given by its own file picker or by the operating system's
 * drop, before anything is read: an absolute path to a regular file (not a folder, link or
 * device) of a supported type, non-empty, within the per-file size bound, whose first bytes are
 * what the type says. A refused file is reported by name with a fixed code and never opened by
 * the reader. The renderer never supplies a path.
 */
export async function intakeFile(
  path: unknown,
  read: (path: string) => Promise<ReceiptExtraction> = (p) =>
    readReceiptDetailed(p),
): Promise<IntakeFile> {
  if (
    typeof path !== "string" ||
    !path ||
    path.length > 4096 ||
    path.includes("\0") ||
    !isAbsolute(path)
  )
    return { name: "", refused: "receiptUnreadable" };
  const name = basename(path).slice(0, 200);
  const format =
    formats[extname(path).toLowerCase() as keyof typeof formats] ?? null;
  if (!format) return { name, refused: "receiptUnsupported" };
  let bytes: number;
  try {
    const info = await lstat(path);
    if (!info.isFile()) return { name, refused: "receiptUnreadable" };
    bytes = info.size;
  } catch {
    return { name, refused: "receiptUnreadable" };
  }
  if (bytes > receiptLimits.bytes) return { name, refused: "receiptTooLarge" };
  if (bytes === 0) return { name, refused: "receiptNoText" };
  try {
    const handle = await open(path, "r");
    try {
      const head = Buffer.alloc(Math.min(bytes, 1024));
      await handle.read(head, 0, head.length, 0);
      // A PDF says so in its first bytes; text has no NUL byte.
      if (
        format === "pdf"
          ? head.subarray(0, 5).toString("latin1") !== "%PDF-"
          : head.includes(0)
      )
        return { name, refused: "receiptUnsupported" };
    } finally {
      await handle.close();
    }
  } catch {
    return { name, refused: "receiptUnreadable" };
  }
  return { name, format, bytes, read: () => read(path) };
}
