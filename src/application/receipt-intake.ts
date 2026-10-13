import type {
  BatchEnrichmentStatus,
  ReceiptAI,
  ReceiptImportCoordinator,
} from "./receipt-import";

/**
 * Bounds of one intake action, beside the reader's own per-file bounds (20 MiB, 100 PDF pages,
 * 50 000 characters, 30 seconds). Files beyond a bound are reported and never read.
 */
export const intakeLimits = Object.freeze({
  files: 20,
  bytes: 60 * 1024 * 1024,
  deadlineMs: 180_000,
});
/** A file the main process has already checked. `read` yields its text, or throws a reader code. */
export type IntakeFile = {
  /** Base name only, for the local result list. Never written to diagnostics. */
  name: string;
} & (
  | {
      format: "pdf" | "txt" | "csv";
      bytes: number;
      read: () => Promise<{ text: string; ocrPages: number[] }>;
    }
  /** Refused before reading: the code says why. */
  | { refused: string }
);
export type IntakeOutcome =
  "added" | "updated" | "duplicate" | "unsupported" | "failed" | "cancelled";
export type IntakeFileResult = {
  name: string;
  outcome: IntakeOutcome;
  /** A fixed code for a failed, unsupported or cancelled file; null otherwise. */
  code: string | null;
  eventId: string | null;
};
export type IntakeProgress = {
  operationId: string;
  /** What is running now. `interpreting` appears only when a request is actually made. */
  stage: "reading" | "saving" | "interpreting" | "done";
  /** One-based position of the file being handled, and how many there are. */
  file: number;
  files: number;
  /** Files finished so far, in order. Each is durable the moment it is listed. */
  results: IntakeFileResult[];
  cancellable: boolean;
};
export type IntakeResult = {
  operationId: string;
  files: IntakeFileResult[];
  counts: Record<IntakeOutcome, number>;
  /** Purchases added or updated by this action. */
  eventIds: string[];
  cancelled: boolean;
  /** The one optional request of the action, or null when none was made or allowed. */
  enrichment: BatchEnrichmentStatus | null;
  /** Set when the shopper may be invited to let a model name these purchases. */
  invitation: {
    providerId: string;
    scope: number;
    eventIds: string[];
    rows: number;
    omitted: number;
  } | null;
};
const readerCodes = ["receiptTooLarge", "receiptNoText", "receiptUnreadable"];

/**
 * One import action over several files. Files are read one at a time and each is saved on its
 * own, so a damaged file fails alone and a cancelled action keeps what was already saved. Only
 * after everything is saved may one request name the new purchases, and only with saved consent
 * for the selected provider. Nothing here touches the shopping list, a quote or a store.
 */
export class ReceiptIntake {
  constructor(private receipts: ReceiptImportCoordinator) {}

  async run(
    files: IntakeFile[],
    options: {
      operationId: string;
      keepOriginal?: boolean;
      ai?: ReceiptAI | null;
      signal?: AbortSignal;
      onProgress?: (progress: IntakeProgress) => void;
      now?: () => number;
    },
  ): Promise<IntakeResult> {
    const now = options.now ?? Date.now;
    const started = now();
    const results: IntakeFileResult[] = [];
    const report = (stage: IntakeProgress["stage"], file: number) => {
      try {
        options.onProgress?.({
          operationId: options.operationId,
          stage,
          file,
          files: files.length,
          results: structuredClone(results),
          cancellable: stage !== "done",
        });
      } catch {
        /* A listener cannot change the import. */
      }
    };
    const stopped = () =>
      options.signal?.aborted
        ? "cancelled"
        : now() - started > intakeLimits.deadlineMs
          ? "receiptDeadline"
          : null;
    let bytes = 0;
    for (const [index, file] of files.entries()) {
      const done = (
        outcome: IntakeOutcome,
        code: string | null = null,
        eventId: string | null = null,
      ) => results.push({ name: file.name, outcome, code, eventId });
      const stop = stopped();
      if (stop) {
        done("cancelled", stop);
        continue;
      }
      if (index >= intakeLimits.files) {
        done("failed", "receiptBatchLimit");
        continue;
      }
      if ("refused" in file) {
        done(
          file.refused === "receiptUnsupported" ? "unsupported" : "failed",
          file.refused,
        );
        continue;
      }
      if (bytes + file.bytes > intakeLimits.bytes) {
        done("failed", "receiptBatchLimit");
        continue;
      }
      bytes += file.bytes;
      report("reading", index + 1);
      let read: { text: string; ocrPages: number[] };
      try {
        read = await new Promise((resolve, reject) => {
          const cancel = () => reject(new Error("cancelled"));
          options.signal?.addEventListener("abort", cancel, { once: true });
          file
            .read()
            .then(resolve, reject)
            .finally(() =>
              options.signal?.removeEventListener("abort", cancel),
            );
        });
      } catch (error) {
        const code = error instanceof Error ? error.message : "";
        if (code === "cancelled") done("cancelled", "cancelled");
        else
          done(
            "failed",
            readerCodes.includes(code) ? code : "receiptUnreadable",
          );
        continue;
      }
      // A file whose reading finished after the action was cancelled is not saved.
      if (options.signal?.aborted) {
        done("cancelled", "cancelled");
        continue;
      }
      report("saving", index + 1);
      try {
        const { receipt } = await this.receipts.import(read.text, file.format, {
          keepOriginal: options.keepOriginal,
          ocrPages: read.ocrPages,
          ai: null,
        });
        done(
          receipt.outcome,
          receipt.outcome === "unsupported" ? "receiptUnsupported" : null,
          receipt.eventId,
        );
      } catch (error) {
        done(
          "failed",
          error instanceof Error && /^[a-zA-Z]{1,40}$/.test(error.message)
            ? error.message
            : "receiptUnreadable",
        );
      }
    }
    const eventIds = [
      ...new Set(
        results.flatMap((r) =>
          (r.outcome === "added" || r.outcome === "updated") && r.eventId
            ? [r.eventId]
            : [],
        ),
      ),
    ];
    let enrichment: BatchEnrichmentStatus | null = null;
    let invitation: IntakeResult["invitation"] = null;
    const cancelled = !!options.signal?.aborted;
    if (eventIds.length && options.ai && !cancelled) {
      let asked = false;
      const status = await this.receipts.enrichBatch(eventIds, {
        ...options.ai,
        session: async () => {
          asked = true;
          report("interpreting", files.length);
          return options.ai!.session();
        },
      });
      // Without saved consent nothing was asked of anyone; the shopper may be invited instead.
      if (status.status === "skipped" && status.reason === "consent")
        invitation = await this.receipts.invitation(eventIds, options.ai);
      else if (asked || status.status !== "skipped") enrichment = status;
    }
    report("done", files.length);
    const counts = {
      added: 0,
      updated: 0,
      duplicate: 0,
      unsupported: 0,
      failed: 0,
      cancelled: 0,
    };
    for (const result of results) counts[result.outcome]++;
    return {
      operationId: options.operationId,
      files: results,
      counts,
      eventIds,
      cancelled: cancelled || results.some((r) => r.outcome === "cancelled"),
      enrichment,
      invitation,
    };
  }
}
