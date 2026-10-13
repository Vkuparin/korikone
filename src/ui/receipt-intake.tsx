import React, { useCallback, useEffect, useRef, useState } from "react";
import type { IntakeProgress } from "../application/receipt-intake";
import type { Snapshot } from "../application/service";

type Outcome = {
  ok: boolean;
  value?: Snapshot;
  error?: string;
};

/**
 * Multi-file receipt intake for the app shell (F27.4, F27.5). One hook owns the picker, the
 * temporary drop overlay, the progress of the running import and the invitation. Nothing here
 * goes through the app-wide busy state, so shopping and navigation stay usable, and nothing
 * contacts a model while files are only dragged over the window.
 */
export function useReceiptIntake({
  snapshot,
  apply,
  suppressed,
}: {
  snapshot: Snapshot;
  apply: (snapshot: Snapshot) => void;
  /** True where a retailer page owns the window and its own drops. */
  suppressed: boolean;
}) {
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<IntakeProgress | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [answering, setAnswering] = useState(false);
  const running = useRef(false);
  // How the names of this import read, from the local purchase view: never "all identified".
  const [names, setNames] = useState<{
    readable: number;
    plain: number;
    issues: number;
  } | null>(null);
  const importId = snapshot.receiptIntake?.operationId ?? null;
  useEffect(() => {
    const ids = snapshot.receiptIntake?.eventIds ?? [];
    if (!importId || !ids.length) {
      setNames(null);
      return;
    }
    let live = true;
    void window.korikone.listPurchases().then((result) => {
      if (!live || !result.ok) return;
      const { purchases } = (
        result.value as unknown as {
          receipts: {
            purchases: {
              eventId: string;
              issueCount: number;
              names: {
                user: number;
                named: number;
                general: number;
                raw: number;
              };
            }[];
          };
        }
      ).receipts;
      const mine = purchases.filter((p) => ids.includes(p.eventId));
      setNames({
        readable: mine.reduce((n, p) => n + p.names.user + p.names.named, 0),
        plain: mine.reduce((n, p) => n + p.names.general + p.names.raw, 0),
        issues: mine.reduce((n, p) => n + p.issueCount, 0),
      });
    });
    return () => {
      live = false;
    };
    // The import and its enrichment settle the names; the ID of the import is the key.
  }, [importId, snapshot.receiptIntake?.enrichment?.status]);

  const accept = useCallback(
    (outcome: Outcome) => {
      if (outcome.ok && outcome.value) {
        setError("");
        apply(outcome.value);
      } else setError(outcome.error ?? "operationFailed");
    },
    [apply],
  );
  useEffect(
    () =>
      window.korikone.onReceiptIntake((value) =>
        setProgress(value.stage === "done" ? null : value),
      ),
    [],
  );
  useEffect(
    () => window.korikone.onReceiptDrop((outcome) => accept(outcome)),
    [accept],
  );
  useEffect(() => {
    // Drag-over only draws the overlay; it never calls the application.
    const hasFiles = (event: DragEvent) =>
      !!event.dataTransfer && [...event.dataTransfer.types].includes("Files");
    const enter = (event: DragEvent) => {
      if (!suppressed && hasFiles(event)) setDragging(true);
    };
    const leave = (event: DragEvent) => {
      if (event.relatedTarget === null) setDragging(false);
    };
    const clear = () => setDragging(false);
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDragging(false);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", clear);
    window.addEventListener("dragend", clear);
    window.addEventListener("blur", clear);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", clear);
      window.removeEventListener("dragend", clear);
      window.removeEventListener("blur", clear);
      window.removeEventListener("keydown", escape);
    };
  }, [suppressed]);

  const pick = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setError("");
    try {
      accept(
        (await window.korikone.importReceipts({
          keepOriginal: false,
        })) as Outcome,
      );
    } finally {
      running.current = false;
      setProgress(null);
    }
  }, [accept]);
  const cancel = useCallback(async () => {
    const id = progress?.operationId ?? snapshot.receiptIntakeRunning;
    if (id) await window.korikone.cancelReceiptIntake({ operationId: id });
  }, [progress, snapshot.receiptIntakeRunning]);
  const answer = useCallback(
    async (choice: "enable" | "once" | "decline") => {
      const invitation = snapshot.receiptIntake?.invitation;
      if (!invitation || answering) return;
      setAnswering(true);
      try {
        accept(
          (await window.korikone.receiptConsentAction({
            choice,
            providerId: invitation.providerId,
            scope: invitation.scope,
            eventIds: invitation.eventIds,
          })) as Outcome,
        );
      } finally {
        setAnswering(false);
      }
    },
    [snapshot.receiptIntake, answering, accept],
  );
  const result = snapshot.receiptIntake;
  return {
    dragging,
    progress,
    running: progress !== null || snapshot.receiptIntakeRunning !== null,
    names,
    result: result && result.operationId !== dismissed ? result : null,
    error,
    answering,
    pick,
    cancel,
    answer,
    dismiss: () => {
      setError("");
      if (snapshot.receiptIntake)
        setDismissed(snapshot.receiptIntake.operationId);
    },
  };
}

/** The overlay, the one activity surface and the grouped summary of the intake. */
export function ReceiptIntakeSurface({
  intake,
  language,
  openHistory,
}: {
  intake: ReturnType<typeof useReceiptIntake>;
  language: string;
  openHistory: () => void;
}) {
  const fi = language === "fi";
  const tr = (a: string, b: string) => (fi ? a : b);
  const { progress, result, dragging, error } = intake;
  const stage = progress
    ? {
        reading: tr("Luetaan kuittia", "Reading receipt"),
        saving: tr("Tallennetaan kuittia", "Saving receipt"),
        interpreting: tr("Nimetään rivejä", "Naming rows"),
        done: "",
      }[progress.stage]
    : "";
  const counts = result?.counts;
  const failed = result?.files.filter(
    (f) => f.outcome === "failed" || f.outcome === "cancelled",
  );
  const unsupported = result?.files.filter((f) => f.outcome === "unsupported");
  const saved = (counts?.added ?? 0) + (counts?.updated ?? 0);
  const duplicateOnly =
    !!counts &&
    saved === 0 &&
    counts.duplicate > 0 &&
    counts.failed + counts.unsupported + counts.cancelled === 0;
  const summary = counts
    ? duplicateOnly
      ? tr(
          "Kaikki kuitit oli jo tuotu. Mitään ei lisätty.",
          "Every receipt was already imported. Nothing was added.",
        )
      : [
          saved > 0 &&
            `${saved} ${tr("kuittia tallennettu", saved === 1 ? "receipt saved" : "receipts saved")}`,
          counts.duplicate > 0 &&
            `${counts.duplicate} ${tr("oli jo tuotu", "already imported")}`,
          counts.unsupported > 0 &&
            `${counts.unsupported} ${tr("ei tuettu", "not supported")}`,
          counts.failed > 0 &&
            `${counts.failed} ${tr("epäonnistui", "failed")}`,
          counts.cancelled > 0 &&
            `${counts.cancelled} ${tr("peruttiin", "cancelled")}`,
        ]
          .filter(Boolean)
          .join(" · ")
    : "";
  const invitation = result?.invitation ?? null;
  const provider =
    invitation?.providerId === "chatgpt" ? "ChatGPT" : invitation?.providerId;
  const enrichment = result?.enrichment;
  return (
    <>
      {dragging && (
        <div className="receipt-drop-overlay" role="status">
          <strong>{tr("Pudota kuitit tähän", "Drop receipts here")}</strong>
          <span>PDF, TXT, CSV</span>
        </div>
      )}
      {(progress || result || error) && (
        <section
          className="receipt-intake-surface"
          aria-label={tr("Kuittien tuonti", "Receipt import")}
        >
          {progress && (
            <p role="status" aria-live="polite">
              {stage} {progress.file}/{progress.files}
              {progress.results.length > 0 &&
                ` · ${progress.results.length} ${tr("valmiina", "done")}`}{" "}
              {progress.cancellable && (
                <button
                  className="text"
                  type="button"
                  onClick={() => void intake.cancel()}
                >
                  {tr("Peruuta tuonti", "Cancel import")}
                </button>
              )}
            </p>
          )}
          {error && !progress && (
            <p role="alert" className="warning">
              {error === "receiptIntakeBusy"
                ? tr(
                    "Edellinen tuonti on vielä kesken.",
                    "The previous import is still running.",
                  )
                : tr(
                    "Kuittien tuonti ei onnistunut. Mitään ei muutettu.",
                    "Receipt import did not complete. Nothing was changed.",
                  )}
            </p>
          )}
          {result && !progress && (
            <div role="status" className="receipt-intake-summary">
              <p>{summary}</p>
              {!!unsupported?.length && (
                <p className="muted">
                  {tr("Ei tuettu", "Not supported")}:{" "}
                  {unsupported.map((f) => f.name).join(", ")}
                </p>
              )}
              {!!failed?.length && (
                <p className="muted">
                  {tr("Uudelleen yritettävät", "To try again")}:{" "}
                  {failed.map((f) => f.name).join(", ")}
                </p>
              )}
              {intake.names && saved > 0 && (
                <p className="muted receipt-intake-names">
                  {tr(
                    `Nimet: ${intake.names.readable} luettavaa, ${intake.names.plain} näkyy sellaisenaan tai yleisellä nimellä`,
                    `Names: ${intake.names.readable} readable, ${intake.names.plain} shown as printed or with a general name`,
                  )}
                  {intake.names.issues > 0
                    ? tr(
                        `; ${intake.names.issues} riviä vaatii tarkistuksen (hinta tai määrä puuttuu).`,
                        `; ${intake.names.issues} rows need a look (amount or quantity missing).`,
                      )
                    : "."}
                </p>
              )}
              {enrichment?.status === "enriched" && (
                <p className="muted">
                  {tr(
                    `Nimiä tarkennettu: ${enrichment.accepted}.`,
                    `Names improved: ${enrichment.accepted}.`,
                  )}
                </p>
              )}
              {enrichment &&
                enrichment.status !== "enriched" &&
                enrichment.status !== "skipped" && (
                  <p className="muted">
                    {tr(
                      "Nimien tarkennus ei onnistunut. Kuitit ovat tallessa.",
                      "Name improvement did not run. The receipts are saved.",
                    )}
                  </p>
                )}
            </div>
          )}
          {invitation && !progress && (
            <div className="receipt-invitation">
              <p>
                {tr(
                  `Annetaanko ${provider} nimetä ${invitation.rows} riviä luettavammin? Vain puhdistetut rivinimet ja varmennetut määrät lähetetään, ei kauppaa, päiväystä, hintoja tai tunnisteita.`,
                  `Let ${provider} write ${invitation.rows} rows more readably? Only sanitized row names and verified quantities are sent: no store, date, prices or identifiers.`,
                )}
              </p>
              <div className="actions">
                <button
                  type="button"
                  disabled={intake.answering}
                  onClick={() => void intake.answer("enable")}
                >
                  {tr("Salli jatkossakin", "Enable for future imports")}
                </button>
                <button
                  className="secondary"
                  type="button"
                  disabled={intake.answering}
                  onClick={() => void intake.answer("once")}
                >
                  {tr("Vain tämä tuonti", "Just this import")}
                </button>
                <button
                  className="text"
                  type="button"
                  disabled={intake.answering}
                  onClick={() => void intake.answer("decline")}
                >
                  {tr("Ei nyt", "Not now")}
                </button>
              </div>
            </div>
          )}
          {!progress && (
            <div className="actions">
              {saved > 0 && (
                <button type="button" onClick={openHistory}>
                  {tr("Näytä historia", "View history")}
                </button>
              )}
              {!!failed?.length && (
                <button
                  className="secondary"
                  type="button"
                  onClick={() => void intake.pick()}
                >
                  {tr(
                    "Yritä epäonnistuneita uudelleen",
                    "Retry the failed files",
                  )}
                </button>
              )}
              <button
                className="text"
                type="button"
                onClick={() => intake.dismiss()}
              >
                {tr("Sulje", "Close")}
              </button>
            </div>
          )}
        </section>
      )}
    </>
  );
}
