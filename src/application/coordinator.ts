import { clearRowCorrections } from "../domain/corrections";
import { z } from "zod";
import { interpretPlanning } from "../ai/output";
import type { ObservedSummary } from "../ai/context";
import { observationsApply } from "../domain/memory";
import type { MealDraft } from "../ai/draft";
import type { OfferIdeaProduct } from "../ai/offers";
import { InferenceError, type InferenceSession } from "../ai/provider";
import { resolveCandidates } from "../ai/resolve";
import { fallbackDraft } from "../ai/fallback";
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
    offerIdeaIds: z.array(z.string().max(100)).max(4).default([]),
  })
  .strict();
export type PlanningRequest = z.input<typeof planningRequestSchema>;
export const coordinatorLimits = Object.freeze({
  searchTimeoutMs: 60_000,
  /** One requirement's reads; a slower row is left unsearched instead of holding a worker. */
  rowTimeoutMs: 20_000,
});
/** Search errors that end a request: the shopper must sign in, choose or unblock a store. */
export const terminalSearchErrors = [
  "loginRequired",
  "storeBlocked",
  "chooseStore",
  "contextChanged",
];
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
  /** Rows left unsearched after a failed or slow read or the catalogue deadline. */
  unsearched: number;
  /** The interpretation gave nothing usable and the note was used as it is. */
  fallback: boolean;
};
export type PlanningDependencies = {
  offers?: OfferIdeaProduct[];
  verifyOffers?: () => Promise<void>;
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
    let interpreted: MealDraft;
    let fallback = false;
    try {
      interpreted = await interpretPlanning(
        session,
        note,
        {
          ...source,
          observedSummaries: observationsApply(note)
            ? (dependencies.observedSummaries ?? [])
            : [],
        },
        dependencies.offers,
      );
    } catch (error) {
      run.assertCurrent();
      // B4.3: a reply that gave nothing usable still puts the note's requests on the list.
      // Provider, account and usage errors, and offer selections, fail as before.
      const local =
        !dependencies.offers?.length &&
        ["invalid-output", "incomplete", "timeout"].includes(
          planningFailure(error),
        )
          ? fallbackDraft(note, source)
          : null;
      if (!local) throw error;
      interpreted = local;
      fallback = true;
    }
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
      recurringPaused: false,
      offerBindings: {},
      ...clearRowCorrections(source),
    });
    for (const use of draft.offerUses ?? []) {
      const product = dependencies.offers?.find(
        (p) => p.productId === use.productId,
      );
      const rows = requirements(state).filter(
        (r) => r.name === use.ingredientName,
      );
      if (!product || rows.length !== 1)
        throw new Error("offerSelectionExpired");
      const key = `${rows[0].id}:${rows[0].unit}`;
      if (state.offerBindings[key]) throw new Error("offerSelectionExpired");
      state.offerBindings[key] = {
        providerId: source.context.providerId,
        storeId: source.context.storeId,
        productId: product.productId,
        name: product.name,
      };
    }
    const wanted = requirements(state);
    run.setRequirements(wanted);
    const active = wanted.slice(0, planningLimits.requirements);
    const options: MatchingOptions = {
      context: source.context,
      sourceNote: note,
      preferences: source.categoryPreferences,
      exclusions: exclusionTerms(source.household.exclusions),
      productPreference: source.productPreference,
      priceBasis: source.priceBasis,
    };
    const deadline = AbortSignal.timeout(coordinatorLimits.searchTimeoutMs);
    const signal = AbortSignal.any([run.signal, deadline]);
    const lines = new Map<string, BasketLine>();
    let position = 0;
    let workerFailure: unknown;
    // B4.2: a row whose read fails or is slow stays unsearched; the deadline stops new reads.
    let unsearched = 0;
    const worker = async () => {
      while (position < active.length && !workerFailure && !deadline.aborted) {
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
              requirement.offerProduct
                ? { ...requirement, name: requirement.offerProduct.name }
                : requirement,
              {
                signal: AbortSignal.any([
                  signal,
                  AbortSignal.timeout(coordinatorLimits.rowTimeoutMs),
                ]),
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
          // Account and store errors need the shopper; every other row failure is that row's.
          if (
            error instanceof Error &&
            terminalSearchErrors.includes(error.message)
          ) {
            workerFailure = new Error(error.message);
            run.fail(workerFailure);
            throw workerFailure;
          }
          unsearched++;
          run.boundOutRequirement(key);
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
      throw workerFailure ?? new Error("storeUnavailable");
    }
    run.assertCurrent();
    // Rows the deadline left unread stay on the list as unsearched rows that pricing can retry.
    for (const requirement of active.slice(position)) {
      unsearched++;
      run.boundOutRequirement(`${requirement.id}:${requirement.unit}`);
    }
    if (unsearched)
      state.assumptions = [
        state.assumptions,
        source.language === "fi"
          ? `Kaupan haku ei ehtinyt tai onnistunut ${unsearched} rivillä. Ne ovat listalla ilman tuotetta; päivitä hinnat hakeaksesi ne uudelleen.`
          : `The store search did not finish or failed for ${unsearched} rows. They are on the list without a product; update prices to search them again.`,
      ]
        .filter(Boolean)
        .join(" ")
        .slice(0, 5000);
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
    // A local fallback has no usable session left to resolve with.
    if (!fallback && dependencies.resolverEnabled !== false && batch.request) {
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
    await dependencies.verifyOffers?.();
    run.assertCurrent();
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
      unsearched,
      fallback,
    });
  } catch (error) {
    run.fail(error);
    if (run.snapshot().phase === "obsolete") throw new Error("draftStale");
    if (run.snapshot().phase === "cancelled") throw new Error("aiCancelled");
    throw error;
  }
}
