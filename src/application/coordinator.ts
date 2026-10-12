import { clearRowCorrections } from "../domain/corrections";
import { z } from "zod";
import { interpretPlanning } from "../ai/output";
import type { ObservedSummary } from "../ai/context";
import { observationsApply } from "../domain/memory";
import type { MealDraft } from "../ai/draft";
import { InferenceError, type InferenceSession } from "../ai/provider";
import { resolveCandidates } from "../ai/resolve";
import {
  stateSchema,
  type AppState,
  type BasketLine,
  type Requirement,
} from "../domain/model";
import {
  applyPackSizes,
  exclusionTerms,
  requirements,
} from "../domain/planner";
import {
  matchRequirement,
  requirementQueryHints,
  selectableCandidate,
  type MatchingOptions,
} from "../domain/matching";
import {
  buildResolutionBatch,
  type ResolutionSuggestion,
} from "../domain/resolution";
import { searchCandidates } from "../stores/candidates";
import type { StoreProvider } from "../stores/provider";
import {
  planningFailure,
  planningLimits,
  type PlanningFailure,
  type PlanningRun,
  type PlanningSnapshot,
} from "./planning";

export const planningRequestSchema = z
  .object({
    prompt: z.string().trim().min(1).max(10_000),
    consent: z.literal(true),
  })
  .strict();
export type PlanningRequest = z.infer<typeof planningRequestSchema>;
export const coordinatorLimits = Object.freeze({ searchTimeoutMs: 60_000 });
export type PlanningResult = {
  operationId: string;
  draft: MealDraft;
  /** Local prospective state at the source revision; commit owns its revision/history change. */
  state: AppState;
  lines: BasketLine[];
  requirements: Requirement[];
  coverage: PlanningSnapshot["coverage"];
  intents: PlanningSnapshot["intents"];
  resolver: {
    status: "skipped" | "completed" | "unavailable";
    failure: PlanningFailure | null;
    suggestions: ResolutionSuggestion[];
  };
};
export type PlanningDependencies = {
  session: (run: PlanningRun) => Promise<InferenceSession>;
  provider: StoreProvider;
  resolverEnabled?: boolean;
  /** Purchase-history hints; used only when the note asks for what is usually bought. */
  observedSummaries?: ObservedSummary[];
  onResolverStart?: (interpretationCalls: number) => void;
};

/** One bound read-only run. This module cannot save state, install a quote or invoke a retailer write. */
export async function coordinatePlanning(
  run: PlanningRun,
  dependencies: PlanningDependencies,
): Promise<PlanningResult> {
  try {
    const source = run.sourceState();
    const note = run.snapshot().source.note;
    const session = await dependencies.session(run);
    run.assertCurrent();
    if (run.inferenceSession() !== session) throw new Error("planningPhase");
    const interpreted = await interpretPlanning(session, note, {
      ...source,
      observedSummaries: observationsApply(note)
        ? (dependencies.observedSummaries ?? [])
        : [],
    });
    run.publishDraft(interpreted);
    const draft = run.validatedDraft()!;
    const state = stateSchema.parse({
      ...source,
      note,
      requestIntents: run
        .snapshot()
        .intents.map(({ intent, recipeId, requirementKeys }) => ({
          intent,
          recipeId,
          requirementKeys,
        })),
      recipes: [...source.recipes, ...draft.recipes],
      meals: draft.meals.map((meal) => ({ ...meal, id: crypto.randomUUID() })),
      extras: draft.items,
      assumptions: draft.notes,
      quantities: {},
      removed: [],
      skipped: [],
      ...clearRowCorrections(source),
    });
    const wanted = requirements(state);
    run.setRequirements(wanted);
    const active = wanted.slice(0, planningLimits.requirements);
    const options: MatchingOptions = {
      context: source.context,
      sourceNote: note,
      preferences: source.categoryPreferences,
      exclusions: exclusionTerms(source.household.exclusions),
      productPreference: source.productPreference,
    };
    const deadline = AbortSignal.timeout(coordinatorLimits.searchTimeoutMs);
    const signal = AbortSignal.any([run.signal, deadline]);
    const lines = new Map<string, BasketLine>();
    let position = 0;
    let workerFailure: unknown;
    const worker = async () => {
      while (position < active.length && !workerFailure) {
        const requirement = active[position++];
        const key = `${requirement.id}:${requirement.unit}`;
        const rowOptions = {
          ...options,
          accepted:
            state.accepted[
              `${source.context.providerId}:${source.context.storeId}:${requirement.id}`
            ] ?? [],
        };
        try {
          const candidates = applyPackSizes(
            await searchCandidates(
              dependencies.provider,
              source.context,
              requirement,
              {
                signal,
                queryHints: requirementQueryHints(requirement, rowOptions),
                beginRead: () => run.beginSearch(key),
                isHit: (product) =>
                  selectableCandidate(
                    requirement,
                    applyPackSizes([product], source.packSizes)[0],
                    rowOptions,
                  ),
              },
            ),
            source.packSizes,
          );
          run.assertCurrent();
          const line = matchRequirement(requirement, candidates, rowOptions);
          run.publishRow(line);
          lines.set(key, line);
        } catch (error) {
          run.assertCurrent();
          if (error instanceof Error && error.message === "planningLimit") {
            run.boundOutRequirement(key);
            continue;
          }
          workerFailure = error;
          run.fail(
            deadline.aborted
              ? new InferenceError("timeout")
              : new Error("storeUnavailable"),
          );
          throw error;
        }
      }
    };
    // Wait for both workers to settle so no orphaned search can publish after ready/failure.
    const settled = await Promise.allSettled(
      Array.from({ length: Math.min(2, active.length) }, worker),
    );
    if (settled.some((result) => result.status === "rejected")) {
      if (run.snapshot().phase === "obsolete") throw new Error("draftStale");
      if (run.snapshot().phase === "cancelled") throw new Error("aiCancelled");
      throw deadline.aborted
        ? new InferenceError("timeout")
        : new Error("storeUnavailable");
    }
    run.assertCurrent();
    const resultLines = wanted.flatMap((requirement) => {
      const line = lines.get(`${requirement.id}:${requirement.unit}`);
      return line ? [line] : [];
    });
    const resolutionSource = {
      revision: source.revision,
      context: source.context,
    };
    const unresolvedLines = resultLines.filter(
      (line) => !line.product || line.total === null,
    );
    const batch = buildResolutionBatch(
      unresolvedLines,
      resolutionSource,
      options,
    );
    const resolver: PlanningResult["resolver"] = {
      status: "skipped",
      failure: null,
      suggestions: [],
    };
    if (dependencies.resolverEnabled !== false && batch.request) {
      run.resolving();
      dependencies.onResolverStart?.(session.callCount);
      try {
        resolver.suggestions = await resolveCandidates(session, batch, () => {
          run.assertCurrent();
          return { lines: unresolvedLines, source: resolutionSource, options };
        });
        resolver.status = "completed";
      } catch (error) {
        // An optional resolver failure keeps deterministic safe rows. Cancellation/staleness remain terminal.
        run.assertCurrent();
        if (error instanceof InferenceError && error.code === "cancelled")
          throw error;
        resolver.status = "unavailable";
        resolver.failure = planningFailure(error);
      }
    }
    run.ready();
    const preview = run.snapshot();
    return structuredClone({
      operationId: preview.operationId,
      draft,
      state,
      lines: resultLines,
      requirements: wanted,
      coverage: preview.coverage,
      intents: preview.intents,
      resolver,
    });
  } catch (error) {
    run.fail(error);
    if (run.snapshot().phase === "obsolete") throw new Error("draftStale");
    if (run.snapshot().phase === "cancelled") throw new Error("aiCancelled");
    throw error;
  }
}
