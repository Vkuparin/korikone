import type { PlanningPhase } from "../application/planning";

const labels: Record<PlanningPhase, [string, string]> = {
  discovering: [
    "Etsitään käytettävää AI-mallia…",
    "Finding an available AI model…",
  ],
  interpreting: ["Tulkitaan pyyntöä…", "Interpreting your request…"],
  interpreted: [
    "Pyyntö tulkittu. Valmistellaan tuotehakua…",
    "Request interpreted. Preparing product searches…",
  ],
  searching: ["Haetaan tuotteita ja hintoja…", "Getting products and prices…"],
  resolving: [
    "Tarkistetaan epäselviä tuotteita…",
    "Checking uncertain products…",
  ],
  ready: ["Lista valmis tallennettavaksi…", "List ready to save…"],
  committing: ["Tallennetaan listaa…", "Saving the list…"],
  committed: ["Lista päivitetty", "List updated"],
  failed: [
    "Listan päivitys epäonnistui. Aiempi lista säilyy.",
    "List update failed. Your previous list is retained.",
  ],
  cancelled: [
    "Listan päivitys peruutettu. Aiempi lista säilyy.",
    "List update cancelled. Your previous list is retained.",
  ],
  obsolete: [
    "Pyyntö muuttui. Päivitä lista uudelleen.",
    "The request changed. Update the list again.",
  ],
};

export function planningPhaseLabel(
  phase: PlanningPhase,
  language: string,
): string {
  return labels[phase][language === "fi" ? 0 : 1];
}
