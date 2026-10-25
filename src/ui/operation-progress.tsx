import React from "react";
import {
  terminalOperation,
  type OperationProgress,
} from "../application/operation-progress";

export function operationStageLabel(
  progress: OperationProgress,
  language: string,
): string {
  const fi = language === "fi";
  const labels: Record<OperationProgress["stage"], [string, string]> = {
    queued: ["Odotetaan vuoroa", "Waiting to start"],
    working: ["Käsitellään pyyntöä", "Processing request"],
    discovering: [
      "Selvitetään tekoälyn käytettävyyttä",
      "Checking AI availability",
    ],
    generating: ["Odotetaan tekoälyn vastausta", "Waiting for the AI response"],
    repairing: [
      "Odotetaan tekoälyn korjattua vastausta",
      "Waiting for the corrected AI response",
    ],
    searching: ["Haetaan tuotteita", "Searching for products"],
    resolving: [
      "Sovitetaan tuotteita ostoslistaan",
      "Matching products to the shopping list",
    ],
    saving: ["Tallennetaan muutoksia", "Saving changes"],
    checking: [
      "Tarkistetaan tuotteita ja hintoja",
      "Checking products and prices",
    ],
    transferring: [
      "Siirretään tuotteita kauppaan",
      "Transferring products to the store",
    ],
    verifying: ["Varmistetaan kaupan ostoskoria", "Verifying the store basket"],
    opening: ["Avataan kaupan sivua", "Opening the store page"],
    cancelling: ["Perutaan toimintoa", "Cancelling operation"],
    done: ["Valmis", "Done"],
    failed: ["Toiminto epäonnistui", "Operation failed"],
    cancelled: ["Toiminto peruttu", "Operation cancelled"],
  };
  const label = labels[progress.stage][fi ? 0 : 1];
  const counted = [
    "searching",
    "checking",
    "transferring",
    "verifying",
  ].includes(progress.stage);
  return counted && progress.completed !== null && progress.total !== null
    ? `${label}: ${progress.completed}/${progress.total}`
    : label;
}

export function OperationProgressBody({
  progress,
  language,
  elapsedSeconds,
  showElapsed = false,
}: {
  progress: OperationProgress;
  language: string;
  elapsedSeconds: number;
  showElapsed?: boolean;
}) {
  const fi = language === "fi";
  const active = !terminalOperation(progress);
  const waiting =
    active &&
    elapsedSeconds >= 15 &&
    ["discovering", "generating", "repairing"].includes(progress.stage);
  const determinate = progress.completed !== null && progress.total !== null;
  return (
    <span className="operation-progress-body">
      <span className="operation-stage">
        {operationStageLabel(progress, language)}
      </span>
      {active && (
        <progress
          className="operation-meter"
          aria-label={fi ? "Toiminnon eteneminen" : "Operation progress"}
          {...(determinate
            ? { value: progress.completed!, max: progress.total! }
            : {})}
        />
      )}
      {waiting && (
        <span className="operation-wait">
          {fi
            ? `Palveluntarjoajan vastausta odotetaan edelleen.${progress.cancellable ? " Voit perua toiminnon." : ""}`
            : `Still waiting for the provider to respond.${progress.cancellable ? " You can cancel the operation." : ""}`}
        </span>
      )}
      {showElapsed && (
        <span className="operation-elapsed" aria-hidden="true">
          {fi
            ? `${Math.max(0, Math.floor(elapsedSeconds))} s kulunut`
            : `${Math.max(0, Math.floor(elapsedSeconds))} s elapsed`}
        </span>
      )}
    </span>
  );
}
