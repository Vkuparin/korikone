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
 * One import action over several files. Files are read one at a time, then everything read is
 * saved in one ledger write (B7.11): a damaged file fails alone, and a cancelled action still
 * saves what it had read. Only
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
    const report = (
      stage: IntakeProgress["stage"],
      file: number,
      results: IntakeFileResult[],
    ) => {
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
    // Outcomes by file position. A read file waits in `pending` and is listed only once the one
    // ledger write of the batch has committed it, so every listed file is durable (B7.11).
    const slots: (IntakeFileResult | undefined)[] = [];
    const listed = () => slots.filter((r): r is IntakeFileResult => !!r);
    const pending: {
      index: number;
      name: string;
      text: string;
      format: "pdf" | "txt" | "csv";
      ocrPages: number[];
    }[] = [];
    let bytes = 0;
    for (const [index, file] of files.entries()) {
      const done = (
        outcome: IntakeOutcome,
        code: string | null = null,
        eventId: string | null = null,
      ) => (slots[index] = { name: file.name, outcome, code, eventId });
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
      report("reading", index + 1, listed());
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
      pending.push({
        index,
        name: file.name,
        text: read.text,
        format: file.format,
        ocrPages: read.ocrPages,
      });
    }
    // Everything read before a cancel or the deadline is still saved, in one write.
    if (pending.length) {
      report("saving", pending.at(-1)!.index + 1, listed());
      let saved: Awaited<ReturnType<ReceiptImportCoordinator["importMany"]>>;
      try {
        saved = await this.receipts.importMany(
          pending.map((p) => ({
            text: p.text,
            format: p.format,
            ocrPages: p.ocrPages,
            keepOriginal: options.keepOriginal,
          })),
        );
      } catch (error) {
        saved = pending.map(() => ({ error }));
      }
      for (const [i, item] of pending.entries()) {
        const outcome = saved[i];
        slots[item.index] =
          "error" in outcome
            ? {
                name: item.name,
                outcome: "failed",
                code:
                  outcome.error instanceof Error &&
                  /^[a-zA-Z]{1,40}$/.test(outcome.error.message)
                    ? outcome.error.message
                    : "receiptUnreadable",
                eventId: null,
              }
            : {
                name: item.name,
                outcome: outcome.outcome,
                code:
                  outcome.outcome === "unsupported"
                    ? "receiptUnsupported"
                    : null,
                eventId: outcome.eventId,
              };
      }
    }
    const results = listed();
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
          report("interpreting", files.length, results);
          return options.ai!.session();
        },
      });
      // Without saved consent nothing was asked of anyone; the shopper may be invited instead.
      if (status.status === "skipped" && status.reason === "consent")
        invitation = await this.receipts.invitation(eventIds, options.ai);
      else if (asked || status.status !== "skipped") enrichment = status;
    }
    report("done", files.length, results);
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
