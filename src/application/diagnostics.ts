import type { ErrorEntry } from "./errors";
import type { Snapshot } from "./service";
import { readMetrics } from "./metrics";
/**
 * A support report without personal data: no recipes, product names, account IDs,
 * e-mail addresses, prompts, tokens or store sessions.
 */
export function diagnostics(
  snapshot: Snapshot,
  runtime: Record<string, string>,
  errors: ErrorEntry[] = [],
  operationMetrics: unknown = [],
) {
  const { state, journal } = snapshot;
  return {
    generatedAt: new Date().toISOString(),
    operationMetrics: readMetrics(operationMetrics),
    runtime,
    developmentMode: snapshot.developmentMode,
    language: state.language,
    setupComplete: state.setupComplete,
    store: {
      providerId: state.context.providerId,
      fulfillment: state.context.fulfillment,
      login: snapshot.storeLogin,
    },
    counts: {
      recipes: state.recipes.length,
      meals: state.meals.length,
      staples: state.staples.length,
      skipped: state.skipped.length,
      earlierWeeks: state.history.length,
      basketLines: snapshot.basket.length,
      unresolvedLines: snapshot.basket.filter((l) => !l.product).length,
    },
    transfer: journal
      ? {
          providerId: journal.review.context.providerId,
          status: journal.status,
          error: journal.error,
          targets: journal.review.targets.length,
          verified: journal.verified.length,
          uncertain: journal.uncertain !== null,
          createdAt: journal.review.createdAt,
        }
      : null,
    ai: { state: snapshot.ai.state, error: snapshot.ai.error },
    // Code, time and view only; never the text of an error.
    errors: errors.map(({ code, time, view }) => ({ code, time, view })),
  };
}
