import { clearRowCorrections } from "../domain/corrections";
import { DraftError, draftFailureReasons } from "../domain/draft-errors";
import { z } from "zod";
import {
  contextSchema,
  ingredientSchema,
  stateSchema,
  type AppState,
  type BasketLine,
  type Requirement,
} from "../domain/model";
import { categorySchema, provenanceSchema } from "../domain/categories";
import { matchRequirement, matchingReasonSchema } from "../domain/matching";
import { exclusionTerms, pieceQuote } from "../domain/planner";
import { validateDraft, type MealDraft } from "../ai/draft";
import {
  InferenceError,
  InferenceSession,
  modelIdentitySchema,
  type InferenceModel,
  type InferenceProvider,
} from "../ai/provider";
import { pricingKey } from "./quotes";
import {
  intentResultSchema,
  projectIntentMappings,
  mapIntentResults,
  pendingIntentResults,
  type IntentMapping,
} from "../domain/intents";

export const planningLimits = Object.freeze({
  aiCalls: 3,
  requirements: 100,
  inputRequirements: 500,
  searches: 200,
  searchesPerRequirement: 3,
  concurrency: 2,
  candidates: 60,
  outputCharacters: 100_000,
  eventCharacters: 200_000,
  timeoutMs: 180_000,
});
export const planningPhaseSchema = z.enum([
  "discovering",
  "interpreting",
  "interpreted",
  "searching",
  "resolving",
  "ready",
  "committing",
  "committed",
  "failed",
  "cancelled",
  "obsolete",
]);
export type PlanningPhase = z.infer<typeof planningPhaseSchema>;
export const planningFailureSchema = z.enum([
  "invalid-output",
  "provider",
  "limit",
  "incomplete",
  "timeout",
  "cancelled",
  "source-changed",
  "superseded",
  "search",
  "commit",
]);
export type PlanningFailure = z.infer<typeof planningFailureSchema>;
const requirementKeySchema = z.string().min(1).max(110);
const previewRowSchema = z
  .object({
    requirementKey: requirementKeySchema,
    name: ingredientSchema.shape.name,
    amount: ingredientSchema.shape.amount,
    unit: ingredientSchema.shape.unit,
    category: categorySchema.nullable(),
    provenance: z.enum([...provenanceSchema.options, "legacy-name"]).nullable(),
    status: z.enum(["pending", "resolved", "approval-required", "unresolved"]),
    reason: matchingReasonSchema.nullable(),
    product: z
      .object({
        id: z.string().min(1).max(100),
        name: z.string().min(1).max(500),
      })
      .strict()
      .nullable(),
    packs: z.number().nonnegative(),
    total: z.number().nonnegative().nullable(),
    approximate: z.boolean().optional(),
    orderUnit: z.literal("kpl").optional(),
  })
  .strict();
export const planningSnapshotSchema = z
  .object({
    operationId: z.uuid(),
    sequence: z.number().int().positive(),
    phase: planningPhaseSchema,
    source: z
      .object({
        revision: z.number().int().nonnegative(),
        context: contextSchema.strict(),
        note: z.string().min(1).max(10_000),
        modelPreference: z.string().min(1).max(200),
      })
      .strict(),
    model: modelIdentitySchema.strict().nullable(),
    provisional: z
      .object({
        meals: z
          .array(
            z
              .object({
                recipeId: z.string().min(1).max(200),
                name: z.string().min(1).max(200),
                day: z.number().int().min(0).max(6),
                servings: z.number().int().min(1).max(100),
                leftovers: z.boolean(),
              })
              .strict(),
          )
          .max(100),
        rows: z.array(previewRowSchema).max(planningLimits.requirements),
      })
      .strict(),
    coverage: z
      .array(
        z
          .object({
            requirementKey: requirementKeySchema,
            status: z.enum(["pending", "searched", "bounded-out"]),
          })
          .strict(),
      )
      .max(planningLimits.inputRequirements),
    intents: z.array(intentResultSchema).max(100),
    counters: z
      .object({
        aiCalls: z.number().int().min(0).max(3),
        searches: z.number().int().min(0).max(planningLimits.searches),
      })
      .strict(),
    failure: planningFailureSchema.nullable(),
    /** Why the reply was refused, for `invalid-output` only: a fixed code and a position. */
    failureCause: z
      .object({
        reason: z.enum(draftFailureReasons),
        path: z.string().max(80).nullable(),
      })
      .strict()
      .nullable()
      .optional(),
    committedRevision: z.number().int().nonnegative().nullable(),
    transferEligible: z.literal(false),
  })
  .strict()
  .superRefine((value, ctx) => {
    const issue = () =>
      ctx.addIssue({
        code: "custom",
        message: "Invalid planning ownership or phase",
      });
    if (
      !["discovering", "failed", "cancelled", "obsolete"].includes(
        value.phase,
      ) &&
      !value.model
    )
      issue();
    if (
      value.phase === "committed"
        ? value.committedRevision !== value.source.revision + 1
        : value.committedRevision !== null
    )
      issue();
    if (["failed", "cancelled", "obsolete"].includes(value.phase)) {
      if (
        !value.failure ||
        value.provisional.meals.length ||
        value.provisional.rows.length ||
        value.coverage.length ||
        value.intents.length
      )
        issue();
    } else if (value.failure) issue();
    if (value.phase === "cancelled" && value.failure !== "cancelled") issue();
    if (
      value.phase === "obsolete" &&
      !["source-changed", "superseded"].includes(value.failure ?? "")
    )
      issue();
    if (
      ["ready", "committing", "committed"].includes(value.phase) &&
      value.coverage.some((row) => row.status === "pending")
    )
      issue();
    if (
      new Set(value.coverage.map((row) => row.requirementKey)).size !==
        value.coverage.length ||
      new Set(value.provisional.rows.map((row) => row.requirementKey)).size !==
        value.provisional.rows.length
    )
      issue();
    for (const row of value.provisional.rows) {
      if (
        !value.coverage.some(
          (entry) => entry.requirementKey === row.requirementKey,
        )
      )
        issue();
      if (
        row.status === "resolved"
          ? !row.product ||
            row.total === null ||
            (row.approximate
              ? row.orderUnit === "kpl"
                ? !Number.isSafeInteger(row.packs) ||
                  row.packs <= 0 ||
                  row.packs > 100
                : row.packs !== 0
              : row.packs <= 0 || row.orderUnit !== undefined)
          : row.product !== null ||
            row.total !== null ||
            row.packs !== 0 ||
            row.approximate === true ||
            row.orderUnit !== undefined
      )
        issue();
    }
  })
  .refine(
    (value) => JSON.stringify(value).length <= planningLimits.eventCharacters,
  );
export type PlanningSnapshot = z.infer<typeof planningSnapshotSchema>;
export const planningControlSchema = z
  .object({
    operationId: z.uuid(),
    reason: z
      .enum(["note-changed", "store-changed", "source-changed"])
      .optional(),
  })
  .strict();
export type PlanningControl = z.infer<typeof planningControlSchema>;
export type PlanningIPC = {
  cancelPlanning(
    input: PlanningControl,
  ): Promise<{ ok: boolean; value?: unknown; error?: string }>;
  invalidatePlanning(
    input: PlanningControl,
  ): Promise<{ ok: boolean; value?: unknown; error?: string }>;
  onPlanningChange(callback: (value: PlanningSnapshot) => void): () => void;
};
const terminal = new Set<PlanningPhase>([
  "committed",
  "failed",
  "cancelled",
  "obsolete",
]);
const key = (r: Requirement) => `${r.id}:${r.unit}`;
const sourceKey = (state: AppState) =>
  JSON.stringify({
    revision: state.revision,
    note: state.note,
    model: state.aiModel,
    resolverEnabled: state.resolverEnabled,
    language: state.language,
    household: state.household,
    recipes: state.recipes,
    quantities: state.quantities,
    pricing: pricingKey(state),
  });
const clone = <T>(value: T): T => structuredClone(value);
function immutable<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(immutable);
    Object.freeze(value);
  }
  return value;
}
export function planningFailure(error: unknown): PlanningFailure {
  const code =
    error instanceof InferenceError
      ? error.code
      : error instanceof Error
        ? error.message
        : "";
  if (["cancelled", "aiCancelled"].includes(code)) return "cancelled";
  if (["invalidDraft", "invalidOutput"].includes(code)) return "invalid-output";
  if (
    ["requestLimit", "planningLimit", "usageLimit", "rateLimit"].includes(code)
  )
    return "limit";
  if (["incomplete", "incompleteDraft"].includes(code)) return "incomplete";
  if (code === "timeout") return "timeout";
  if (["draftStale", "resolutionStale"].includes(code)) return "source-changed";
  if (
    ["storeUnavailable", "contextChanged", "invalidCandidates"].includes(code)
  )
    return "search";
  return "provider";
}

/** Server-owned lifecycle only. Events never enter saved state, quote approval or retailer tools. */
export class PlanningLifecycle {
  onChange: (value: PlanningSnapshot) => void = () => {};
  private run: PlanningRun | null = null;
  constructor(private current: () => AppState) {}
  start(note: string): PlanningRun {
    this.run?.assertCommitMutable();
    z.string().trim().min(1).max(10_000).parse(note);
    this.run?.stop("obsolete", "superseded");
    const run = new PlanningRun(
      clone(this.current()),
      note,
      () => this.current(),
      (candidate) => this.run === candidate,
      (value) => {
        try {
          this.onChange(value);
        } catch {
          /* UI delivery cannot change ownership. */
        }
      },
    );
    this.run = run;
    run.publish();
    return run;
  }
  snapshot(): PlanningSnapshot | null {
    this.run?.reconcile();
    return this.run?.snapshot() ?? null;
  }
  currentReady(operationId: string): PlanningRun {
    if (
      !this.run ||
      this.run.operationId !== operationId ||
      this.snapshot()?.phase !== "ready"
    )
      throw new Error("planningStale");
    this.run.assertCurrent();
    return this.run;
  }
  invalidateFor(state: AppState) {
    this.run?.assertCommitMutable();
    if (this.run?.differs(state)) this.run.stop("obsolete", "source-changed");
  }
  invalidate() {
    this.run?.assertCommitMutable();
    this.run?.stop("obsolete", "source-changed");
  }
  cancel() {
    this.run?.assertCommitMutable();
    this.run?.stop("cancelled", "cancelled");
  }
  cancelForShutdown() {
    this.run?.cancelForShutdown();
  }
  /**
   * Ends and forgets the current run for a list reset: its preview disappears and a reply that
   * arrives later belongs to no run. Refused while the run is committing.
   */
  discard() {
    if (!this.run) return;
    this.run.assertCommitMutable();
    this.run.stop("obsolete", "source-changed");
    this.run = null;
  }
  control(input: unknown, obsolete = false) {
    const control = planningControlSchema.parse(input);
    if (!this.run || this.run.operationId !== control.operationId)
      throw new Error("planningStale");
    this.run.assertCommitMutable();
    this.run.stop(
      obsolete ? "obsolete" : "cancelled",
      obsolete ? "source-changed" : "cancelled",
    );
  }
}

export class PlanningRun {
  readonly operationId = crypto.randomUUID();
  private controller = new AbortController();
  get signal() {
    return this.controller.signal;
  }
  private session: InferenceSession | null = null;
  private draft: MealDraft | null = null;
  private requirements = new Map<string, Requirement>();
  private allRequirements: Requirement[] = [];
  private mappings: IntentMapping[] = [];
  private resultLines: BasketLine[] = [];
  private searches = new Map<string, number>();
  private inFlight = 0;
  private expectedCommit: AppState | null = null;
  private commitLocked = false;
  assertCommitMutable() {
    if (this.commitLocked) throw new Error("busy");
  }
  cancelForShutdown() {
    if (!this.commitLocked) this.stop("cancelled", "cancelled");
  }
  private value: PlanningSnapshot;
  private sourceSignature: string;
  constructor(
    private state: AppState,
    note: string,
    private current: () => AppState,
    private owned: (run: PlanningRun) => boolean,
    private emit: (value: PlanningSnapshot) => void,
  ) {
    this.sourceSignature = sourceKey(state);
    this.value = {
      operationId: this.operationId,
      sequence: 1,
      phase: "discovering",
      source: {
        revision: state.revision,
        context: clone(state.context),
        note,
        modelPreference: state.aiModel,
      },
      model: null,
      provisional: { meals: [], rows: [] },
      coverage: [],
      intents: [],
      counters: { aiCalls: 0, searches: 0 },
      failure: null,
      committedRevision: null,
      transferEligible: false,
    };
  }
  sourceState(): AppState {
    return clone(this.state);
  }
  validatedDraft(): MealDraft {
    this.assertCurrent();
    if (!this.draft) throw new Error("planningPhase");
    return clone(this.draft);
  }
  differs(state: AppState) {
    return sourceKey(state) !== this.sourceSignature;
  }
  reconcile() {
    if (terminal.has(this.value.phase)) return;
    const committedState =
      this.value.phase === "committing" &&
      this.expectedCommit &&
      JSON.stringify(this.current()) === JSON.stringify(this.expectedCommit);
    if (!this.owned(this) || (!committedState && this.differs(this.current())))
      this.stop("obsolete", "source-changed");
  }
  assertCurrent() {
    this.reconcile();
    if (terminal.has(this.value.phase) || this.signal.aborted)
      throw new Error(
        this.value.phase === "obsolete" ? "draftStale" : "aiCancelled",
      );
  }
  snapshot(): PlanningSnapshot {
    const aiCalls = this.session?.callCount ?? 0;
    if (aiCalls !== this.value.counters.aiCalls)
      this.update({ counters: { ...this.value.counters, aiCalls } });
    return immutable(
      planningSnapshotSchema.parse({
        ...this.value,
        counters: {
          ...this.value.counters,
          aiCalls: this.session?.callCount ?? 0,
        },
      }),
    );
  }
  publish() {
    this.emit(this.snapshot());
  }
  private update(input: Partial<PlanningSnapshot>) {
    this.value = planningSnapshotSchema.parse({
      ...this.value,
      ...input,
      sequence: this.value.sequence + 1,
      counters: {
        ...this.value.counters,
        ...input.counters,
        aiCalls: this.session?.callCount ?? 0,
      },
    });
    this.publish();
  }
  stop(
    phase: "cancelled" | "obsolete" | "failed",
    failure: PlanningFailure,
    cause: PlanningSnapshot["failureCause"] = null,
  ) {
    if (terminal.has(this.value.phase)) return;
    this.controller.abort();
    this.draft = null;
    this.update({
      phase,
      failure,
      failureCause: cause,
      provisional: { meals: [], rows: [] },
      coverage: [],
      intents: [],
      committedRevision: null,
    });
  }
  fail(error: unknown) {
    const failure = planningFailure(error);
    this.stop(
      failure === "cancelled"
        ? "cancelled"
        : failure === "source-changed"
          ? "obsolete"
          : "failed",
      failure,
      error instanceof DraftError && failure === "invalid-output"
        ? { reason: error.reason, path: error.path }
        : null,
    );
  }
  bindInference(
    provider: InferenceProvider,
    model: InferenceModel,
  ): InferenceSession {
    this.assertCurrent();
    if (this.value.phase !== "discovering" || this.session)
      throw new Error("planningPhase");
    this.session = new InferenceSession(
      provider,
      model,
      {
        maxCalls: planningLimits.aiCalls,
        maxOutputCharacters: planningLimits.outputCharacters,
        timeoutMs: planningLimits.timeoutMs,
      },
      this.signal,
    );
    this.update({
      model: { providerId: model.providerId, modelId: model.modelId },
      phase: "interpreting",
    });
    return this.session;
  }
  publishDraft(draft: MealDraft) {
    this.assertCurrent();
    if (this.value.phase !== "interpreting") throw new Error("planningPhase");
    const validated = validateDraft(
      JSON.stringify(draft),
      this.state,
      this.value.source.note,
    );
    const meals = validated.meals.map((meal) => ({
      ...meal,
      name: [...this.state.recipes, ...validated.recipes].find(
        (recipe) => recipe.id === meal.recipeId,
      )!.name,
    }));
    this.mappings = validated.intents
      ? projectIntentMappings(validated.intents, validated, this.state.recipes)
      : [];
    this.update({
      phase: "interpreted",
      provisional: { meals, rows: [] },
      intents: pendingIntentResults(this.mappings),
    });
    this.draft = validated;
  }
  inferenceSession(): InferenceSession {
    this.assertCurrent();
    if (!this.session) throw new Error("planningPhase");
    return this.session;
  }
  setRequirements(input: Requirement[]) {
    this.assertCurrent();
    if (
      this.value.phase !== "interpreted" ||
      input.length > planningLimits.inputRequirements
    )
      throw new Error("planningLimit");
    const parsed = input.map((r) => ({
      ...ingredientSchema.parse(r),
      sources: clone(r.sources),
    }));
    if (new Set(parsed.map(key)).size !== parsed.length)
      throw new Error("invalidDraft");
    const active = parsed.slice(0, planningLimits.requirements);
    this.allRequirements = parsed;
    this.requirements = new Map(active.map((r) => [key(r), r]));
    this.update({
      phase: "searching",
      coverage: parsed.map((r, i) => ({
        requirementKey: key(r),
        status: i < planningLimits.requirements ? "pending" : "bounded-out",
      })),
      provisional: {
        ...this.value.provisional,
        rows: active.map((r) => ({
          requirementKey: key(r),
          name: r.name,
          amount: r.amount,
          unit: r.unit,
          category: r.classification?.category ?? null,
          provenance: r.classification?.provenance ?? null,
          status: "pending",
          reason: null,
          product: null,
          packs: 0,
          total: null,
        })),
      },
      intents: mapIntentResults(this.mappings, parsed, [], {
        boundedOut: parsed.slice(planningLimits.requirements).map(key),
      }),
    });
  }
  beginSearch(requirementKey: string): () => void {
    this.assertCurrent();
    if (
      this.value.phase !== "searching" ||
      !this.requirements.has(requirementKey)
    )
      throw new Error("planningPhase");
    if (this.inFlight >= planningLimits.concurrency)
      throw new Error("planningConcurrency");
    const used = this.searches.get(requirementKey) ?? 0;
    if (
      used >= planningLimits.searchesPerRequirement ||
      this.value.counters.searches >= planningLimits.searches
    )
      throw new Error("planningLimit");
    this.searches.set(requirementKey, used + 1);
    this.inFlight++;
    this.update({
      counters: {
        ...this.value.counters,
        searches: this.value.counters.searches + 1,
      },
    });
    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.inFlight--;
      }
    };
  }
  publishRow(line: BasketLine) {
    this.assertCurrent();
    if (!["searching", "resolving"].includes(this.value.phase))
      throw new Error("planningPhase");
    const requirement = this.requirements.get(key(line.requirement));
    if (
      !requirement ||
      JSON.stringify(requirement) !==
        JSON.stringify({
          ...ingredientSchema.parse(line.requirement),
          sources: line.requirement.sources,
        })
    )
      throw new Error("invalidDraft");
    const local = matchRequirement(requirement, line.candidates, {
      context: this.state.context,
      sourceNote: this.value.source.note,
      preferences: this.state.categoryPreferences,
      exclusions: exclusionTerms(this.state.household.exclusions),
      productPreference: this.state.productPreference,
      priceBasis: this.state.priceBasis,
      accepted:
        clearRowCorrections(this.state).accepted[
          `${this.state.context.providerId}:${this.state.context.storeId}:${requirement.id}`
        ] ?? [],
    });
    const rows = this.value.provisional.rows.map((row) =>
      row.requirementKey !== key(requirement)
        ? row
        : {
            ...row,
            category: local.matching!.category,
            provenance:
              requirement.classification?.provenance ??
              ("legacy-name" as const),
            status: local.matching!.status,
            reason: local.matching!.reason,
            product: local.product
              ? { id: local.product.id, name: local.product.name }
              : null,
            packs: local.packs,
            total: local.total,
            ...(local.approximate ? { approximate: true } : {}),
            ...(local.product && pieceQuote(requirement, local.product)
              ? { orderUnit: "kpl" as const }
              : {}),
          },
    );
    this.resultLines = [
      ...this.resultLines.filter(
        (row) => key(row.requirement) !== key(requirement),
      ),
      local,
    ];
    this.update({
      provisional: { ...this.value.provisional, rows },
      coverage: this.value.coverage.map((row) =>
        row.requirementKey === key(requirement)
          ? { ...row, status: "searched" }
          : row,
      ),
      intents: mapIntentResults(
        this.mappings,
        this.allRequirements,
        this.resultLines,
        {
          boundedOut: this.value.coverage
            .filter((row) => row.status === "bounded-out")
            .map((row) => row.requirementKey),
        },
      ),
    });
  }
  resolving() {
    this.assertCurrent();
    if (
      this.value.phase !== "searching" ||
      this.inFlight ||
      this.value.coverage.some((row) => row.status === "pending")
    )
      throw new Error("planningPhase");
    this.update({ phase: "resolving" });
  }
  boundOutRequirement(requirementKey: string) {
    this.assertCurrent();
    if (
      this.value.phase !== "searching" ||
      !this.value.coverage.some(
        (row) =>
          row.requirementKey === requirementKey && row.status === "pending",
      )
    )
      throw new Error("planningPhase");
    this.update({
      coverage: this.value.coverage.map((row) =>
        row.requirementKey === requirementKey
          ? { ...row, status: "bounded-out" }
          : row,
      ),
      provisional: {
        ...this.value.provisional,
        rows: this.value.provisional.rows.map((row) =>
          row.requirementKey === requirementKey
            ? { ...row, status: "unresolved" }
            : row,
        ),
      },
      intents: mapIntentResults(
        this.mappings,
        this.allRequirements,
        this.resultLines,
        {
          boundedOut: [
            ...this.value.coverage
              .filter((row) => row.status === "bounded-out")
              .map((row) => row.requirementKey),
            requirementKey,
          ],
        },
      ),
    });
  }
  ready() {
    this.assertCurrent();
    if (
      !["searching", "resolving"].includes(this.value.phase) ||
      this.inFlight ||
      this.value.coverage.some((row) => row.status === "pending")
    )
      throw new Error("planningPhase");
    this.update({
      phase: "ready",
      intents: mapIntentResults(
        this.mappings,
        this.allRequirements,
        this.resultLines,
        {
          complete: true,
          boundedOut: this.value.coverage
            .filter((row) => row.status === "bounded-out")
            .map((row) => row.requirementKey),
        },
      ),
    });
  }
  beginCommit(next: AppState) {
    this.assertCurrent();
    if (this.value.phase !== "ready") throw new Error("planningPhase");
    const parsed = stateSchema.parse(next);
    if (
      parsed.revision !== this.state.revision + 1 ||
      JSON.stringify(parsed.context) !== JSON.stringify(this.state.context) ||
      parsed.note !== this.value.source.note ||
      parsed.aiModel !== this.state.aiModel
    )
      throw new Error("draftStale");
    this.expectedCommit = parsed;
    this.commitLocked = true;
    this.update({ phase: "committing" });
  }
  committed() {
    this.assertCurrent();
    if (
      this.value.phase !== "committing" ||
      !this.expectedCommit ||
      JSON.stringify(this.current()) !== JSON.stringify(this.expectedCommit)
    )
      throw new Error("planningPhase");
    this.update({
      phase: "committed",
      committedRevision: this.expectedCommit.revision,
    });
    this.commitLocked = false;
  }
  commitFailed() {
    this.commitLocked = false;
    this.expectedCommit = null;
    this.stop("failed", "commit");
  }
}
