import type { IntentResult } from "../domain/intents";
import type { Review } from "../domain/model";

/** Other unresolved requests are already represented by their shopping rows. */
export const requestWithoutRow = (result: IntentResult) =>
  result.status !== "resolved" &&
  (result.intent.unresolvedReason !== null ||
    result.reason === "missing-requirement");

export const omittedReviewItems = (review: Review) => [
  ...(review.unresolved ?? []).map((row) => row.name),
  ...(review.unresolvedIntents ?? [])
    .filter(requestWithoutRow)
    .map((result) => result.intent.label),
];
