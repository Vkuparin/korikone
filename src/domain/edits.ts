import {
  merchandiseAttributeKinds,
  merchandiseIntentSchema,
  merchandiseLimits,
} from "./merchandise";
import { z } from "zod";
import { inferredClassification } from "./categories";
import {
  ingredientSchema,
  recipeSchema,
  stateSchema,
  unitSchema,
  type AppState,
  type Requirement,
  type Unit,
} from "./model";
import { requirements } from "./planner";

/** Version of the edit operation and intent shapes below. */
export const EDIT_VERSION = 1;
export const editLimits = Object.freeze({
  operations: 20,
  instructionCharacters: 2000,
  ambiguities: 10,
  candidates: 8,
  packs: 100,
});

/** A shopping row is its requirement key, `${ingredientId}:${unit}`; a meal is its saved `meals[].id`. */
export const editRowKeySchema = z.string().min(3).max(110);
export const editMealIdSchema = z.string().min(1).max(100);
export const editTargetIdSchema = z
  .string()
  .min(5)
  .max(120)
  .regex(/^(?:row|meal):.+$/s);
export type EditTargetId = `row:${string}` | `meal:${string}`;
export const rowTargetId = (key: string): EditTargetId => `row:${key}`;
export const mealTargetId = (id: string): EditTargetId => `meal:${id}`;
export const requirementKey = (r: { id: string; unit: Unit }) =>
  `${r.id}:${r.unit}`;

/** Packs count the currently quoted product of an existing row; they never guess a pack size. */
export const editQuantitySchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("amount"),
      amount: z.number().int().positive().max(10_000_000),
      unit: unitSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("packs"),
      count: z.number().int().positive().max(editLimits.packs),
    })
    .strict(),
]);
export type EditQuantity = z.infer<typeof editQuantitySchema>;

export const editOperationSchema = z.discriminatedUnion("op", [
  // Adds to an existing row by key, or to the grocery identity that a name and unit select.
  z
    .object({
      op: z.literal("addItem"),
      rowKey: editRowKeySchema.optional(),
      name: z.string().trim().min(1).max(200).optional(),
      quantity: editQuantitySchema,
      // Makes a new named row a non-food request (F22.4). Ignored for a row that exists.
      merchandise: merchandiseIntentSchema.optional(),
    })
    .strict()
    .refine((o) => (o.rowKey === undefined) !== (o.name === undefined)),
  z.object({ op: z.literal("removeItem"), rowKey: editRowKeySchema }).strict(),
  z
    .object({
      op: z.literal("replaceMeal"),
      mealId: editMealIdSchema,
      replacement: z.discriminatedUnion("kind", [
        z
          .object({
            kind: z.literal("saved"),
            recipeId: z.string().min(1).max(200),
          })
          .strict(),
        // A new recipe is already normalized by its producer: unused ID, shared ingredient identities.
        z.object({ kind: z.literal("new"), recipe: recipeSchema }).strict(),
      ]),
      servings: z.number().int().min(1).max(100).optional(),
    })
    .strict(),
  // Adds a dish to the list. A dish already on the list is not added twice.
  z
    .object({
      op: z.literal("addMeal"),
      recipe: z.discriminatedUnion("kind", [
        z
          .object({
            kind: z.literal("saved"),
            recipeId: z.string().min(1).max(200),
          })
          .strict(),
        z.object({ kind: z.literal("new"), recipe: recipeSchema }).strict(),
      ]),
      servings: z.number().int().min(1).max(100).optional(),
    })
    .strict(),
  // Says what an existing row should be: a product, brand or type name. The row keeps its
  // amount, unit and sources; an empty difference from the row's own name removes the wording.
  z
    .object({
      op: z.literal("specifyItem"),
      rowKey: editRowKeySchema,
      name: z.string().trim().min(1).max(200),
    })
    .strict(),
  // Takes a dish off the list. Its recipe stays saved; rows it shared keep the other shares.
  z.object({ op: z.literal("removeMeal"), mealId: editMealIdSchema }).strict(),
  // States the amount wanted of a named grocery: sets its row, or adds it when it has none.
  z
    .object({
      op: z.literal("setItem"),
      name: z.string().trim().min(1).max(200),
      quantity: editQuantitySchema,
      merchandise: merchandiseIntentSchema.optional(),
    })
    .strict(),
  // Gives a non-food row one attribute the shopper stated, such as the size that was missing.
  z
    .object({
      op: z.literal("setAttribute"),
      rowKey: editRowKeySchema,
      kind: z.enum(merchandiseAttributeKinds),
      value: z.string().trim().min(1).max(merchandiseLimits.valueCharacters),
    })
    .strict(),
  z
    .object({
      op: z.literal("changeServings"),
      mealId: editMealIdSchema,
      servings: z.number().int().min(1).max(100),
    })
    .strict(),
  z
    .object({
      op: z.literal("changeQuantity"),
      rowKey: editRowKeySchema,
      quantity: editQuantitySchema,
    })
    .strict(),
  z
    .object({
      op: z.literal("markAtHome"),
      rowKey: editRowKeySchema,
      atHome: z.boolean(),
    })
    .strict(),
]);
export type EditOperation = z.infer<typeof editOperationSchema>;

/** The unit of atomic application: every operation applies to `revision`, or none does. */
export const editBatchSchema = z
  .object({
    version: z.literal(EDIT_VERSION),
    revision: z.number().int().nonnegative(),
    operations: z.array(editOperationSchema).min(1).max(editLimits.operations),
  })
  .strict();
export type EditBatch = z.infer<typeof editBatchSchema>;

/** An instruction part that names several known targets. The shopper chooses; code never does. */
export const editAmbiguitySchema = z
  .object({
    phrase: z.string().min(1).max(200),
    candidates: z
      .array(editTargetIdSchema)
      .min(2)
      .max(editLimits.candidates)
      .refine((ids) => new Set(ids).size === ids.length),
  })
  .strict();
export type EditAmbiguity = z.infer<typeof editAmbiguitySchema>;

/** What an interpreter returns for one instruction. Any ambiguity or unsupported part blocks the batch. */
export const editIntentSchema = z
  .object({
    version: z.literal(EDIT_VERSION),
    operations: z.array(editOperationSchema).max(editLimits.operations),
    ambiguities: z.array(editAmbiguitySchema).max(editLimits.ambiguities),
    unsupported: z
      .array(z.object({ phrase: z.string().min(1).max(200) }).strict())
      .max(editLimits.ambiguities),
  })
  .strict()
  .refine(
    (i) => i.operations.length + i.ambiguities.length + i.unsupported.length,
  );
export type EditIntent = z.infer<typeof editIntentSchema>;

export type EditErrorCode =
  | "staleEdit"
  | "unknownTarget"
  | "duplicateTarget"
  | "ambiguousTarget"
  | "invalidUnit"
  | "packSizeUnknown"
  | "unsupportedEdit"
  | "invalidEdit"
  | "noChange";
/** The message is the code; `operation` is the zero-based index of the rejected operation, when one. */
export class EditError extends Error {
  constructor(
    readonly code: EditErrorCode,
    readonly operation: number | null = null,
  ) {
    super(code);
    this.name = "EditError";
  }
}

export type EditRowTarget = {
  targetId: EditTargetId;
  key: string;
  name: string;
  amount: number;
  unit: Unit;
  sources: string[];
  atHome: boolean;
};
export type EditMealTarget = {
  targetId: EditTargetId;
  mealId: string;
  recipeId: string;
  name: string;
  servings: number;
  leftovers: boolean;
};
export type EditTargets = { rows: EditRowTarget[]; meals: EditMealTarget[] };

/** Every target an edit may name: visible rows, rows marked at home, and the list's meals. */
export function editTargets(state: AppState, now = new Date()): EditTargets {
  return {
    rows: requirements(state, now, true).map((r) => {
      const key = requirementKey(r);
      return {
        targetId: rowTargetId(key),
        key,
        name: r.name,
        amount: r.amount,
        unit: r.unit,
        sources: r.sources,
        atHome: state.skipped.includes(key),
      };
    }),
    meals: state.meals.map((meal) => ({
      targetId: mealTargetId(meal.id),
      mealId: meal.id,
      recipeId: meal.recipeId,
      name:
        state.recipes.find((r) => r.id === meal.recipeId)?.name ??
        meal.recipeId,
      servings: meal.servings,
      leftovers: meal.leftovers,
    })),
  };
}

/** Pack size of the product currently quoted for a row, by requirement key. */
export type EditPackSizes = Record<string, { amount: number; unit: Unit }>;
export type EditOptions = { now?: Date; packSizes?: EditPackSizes };

export type AppliedEdit = {
  op: EditOperation["op"];
  targetId: EditTargetId;
  /** Row or meal name before the edit; the replacement name is in `to`. */
  name: string;
  to?: string;
  unit?: Unit;
  before?: number;
  after?: number;
};
export type EditResult = {
  /** The edited plan at the same revision; the caller advances the revision when it saves. */
  state: AppState;
  applied: AppliedEdit[];
  /** Requirement keys whose row appeared, disappeared or changed amount or at-home state. */
  changedKeys: string[];
};

const identity = (value: string) =>
  value.trim().replace(/\s+/g, " ").toLocaleLowerCase("fi");
/** Amounts from meals, due recurring items and extras alone, without row flags or overrides. */
function baseRows(state: AppState, now: Date): Map<string, Requirement> {
  return new Map(
    requirements(
      { ...state, skipped: [], removed: [], quantities: {} },
      now,
      true,
    ).map((r) => [requirementKey(r), r]),
  );
}
function resolveAmount(
  quantity: EditQuantity,
  key: string,
  unit: Unit,
  packSizes: EditPackSizes,
  index: number,
): number {
  if (quantity.kind === "amount") {
    if (quantity.unit !== unit) throw new EditError("invalidUnit", index);
    return quantity.amount;
  }
  const pack = packSizes[key];
  if (
    !pack ||
    pack.unit !== unit ||
    !Number.isSafeInteger(pack.amount) ||
    pack.amount <= 0
  )
    throw new EditError("packSizeUnknown", index);
  const amount = pack.amount * quantity.count;
  if (amount > 10_000_000) throw new EditError("invalidEdit", index);
  return amount;
}

/**
 * Applies a whole batch to a clone, or throws an `EditError` and changes nothing. Targets are exact
 * keys and IDs validated against the supplied plan; no operation searches by similarity.
 */
/** The non-food intent of the extra that already has this row key, if any. */
const previousMerchandise = (state: AppState, key: string) =>
  state.extras.find((i) => `${i.id}:${i.unit}` === key)?.merchandise;
export function applyEdits(
  state: AppState,
  input: unknown,
  options: EditOptions = {},
): EditResult {
  const parsed = editBatchSchema.safeParse(input);
  if (!parsed.success) throw new EditError("unsupportedEdit");
  const batch = parsed.data;
  if (batch.revision !== state.revision) throw new EditError("staleEdit");
  const now = options.now ?? new Date();
  const packSizes = options.packSizes ?? {};
  const next = structuredClone(state);
  const rows = new Map(
    requirements(state, now, true).map((r) => [requirementKey(r), r]),
  );
  const meals = new Map(state.meals.map((m) => [m.id, m]));
  const recipeName = (id: string, from = state) =>
    from.recipes.find((r) => r.id === id)?.name ?? id;

  // Validate every target before any mutation; one target may carry one operation.
  type Planned = {
    index: number;
    operation: EditOperation;
    key?: string;
    /** For `addMeal`: the recipe the dish resolves to, and its definition when it is new. */
    recipeId?: string;
    newRecipe?: AppState["recipes"][number];
  };
  const planned: Planned[] = [];
  const seen = new Set<string>();
  const claim = (id: EditTargetId, index: number) => {
    if (seen.has(id)) throw new EditError("duplicateTarget", index);
    seen.add(id);
  };
  const newRecipes = new Set<string>();
  batch.operations.forEach((operation, index) => {
    if (
      operation.op === "replaceMeal" ||
      operation.op === "changeServings" ||
      operation.op === "removeMeal"
    ) {
      if (!meals.has(operation.mealId))
        throw new EditError("unknownTarget", index);
      claim(mealTargetId(operation.mealId), index);
      if (operation.op === "replaceMeal") {
        const r = operation.replacement;
        if (r.kind === "saved") {
          if (!state.recipes.some((recipe) => recipe.id === r.recipeId))
            throw new EditError("unknownTarget", index);
        } else if (
          state.recipes.some((recipe) => recipe.id === r.recipe.id) ||
          newRecipes.has(r.recipe.id)
        )
          throw new EditError("invalidEdit", index);
        else newRecipes.add(r.recipe.id);
      }
      planned.push({ index, operation });
      return;
    }
    if (operation.op === "addMeal") {
      const source = operation.recipe;
      let recipeId: string;
      let newRecipe: Planned["newRecipe"];
      if (source.kind === "saved") {
        if (!state.recipes.some((recipe) => recipe.id === source.recipeId))
          throw new EditError("unknownTarget", index);
        recipeId = source.recipeId;
      } else {
        // A new dish with the name of a saved recipe is that recipe, not a second copy.
        const sameName = state.recipes.find(
          (recipe) => identity(recipe.name) === identity(source.recipe.name),
        );
        if (sameName) recipeId = sameName.id;
        else if (
          state.recipes.some((recipe) => recipe.id === source.recipe.id) ||
          newRecipes.has(source.recipe.id)
        )
          throw new EditError("invalidEdit", index);
        else {
          newRecipes.add(source.recipe.id);
          recipeId = source.recipe.id;
          newRecipe = source.recipe;
        }
      }
      claim(`meal:recipe:${recipeId}`, index);
      planned.push({ index, operation, recipeId, newRecipe });
      return;
    }
    let key: string;
    if (
      (operation.op === "addItem" || operation.op === "setItem") &&
      operation.name !== undefined
    ) {
      const quantity = operation.quantity;
      const wanted = identity(operation.name);
      const matches = (unit: Unit | null) => [
        ...new Set(
          [
            ...state.recipes.flatMap((r) => r.ingredients),
            ...state.extras,
            ...state.staples,
          ]
            .filter(
              (i) =>
                identity(i.name) === wanted &&
                (unit === null || i.unit === unit),
            )
            .map(requirementKey),
        ),
      ];
      const known = matches(quantity.kind === "amount" ? quantity.unit : null);
      const listed = known.filter((k) => rows.has(k));
      if (listed.length > 1 || (!listed.length && known.length > 1))
        throw new EditError("ambiguousTarget", index);
      if (quantity.kind === "packs" && !listed.length)
        throw new EditError("packSizeUnknown", index);
      key =
        listed[0] ??
        known[0] ??
        `${wanted}:${(quantity as { unit: Unit }).unit}`;
    } else {
      key = (operation as { rowKey: string }).rowKey;
      if (!rows.has(key)) throw new EditError("unknownTarget", index);
    }
    claim(rowTargetId(key), index);
    planned.push({ index, operation, key });
  });

  // Meal operations first: they decide which rows exist for the row operations.
  const baseBefore = baseRows(state, now);
  const applied: AppliedEdit[] = [];
  // Rows whose wording changed need a new search even when their amount did not.
  const respecified = new Set<string>();
  for (const { operation, recipeId, newRecipe } of planned) {
    if (operation.op === "addMeal") {
      const onList = next.meals.find((m) => m.recipeId === recipeId);
      if (onList) {
        // Naming a dish that is already planned changes it only if servings were stated.
        if (
          operation.servings !== undefined &&
          onList.servings !== operation.servings
        ) {
          applied.push({
            op: operation.op,
            targetId: mealTargetId(onList.id),
            name: recipeName(onList.recipeId, next),
            before: onList.servings,
            after: operation.servings,
          });
          onList.servings = operation.servings;
        }
        continue;
      }
      if (newRecipe) next.recipes.push(structuredClone(newRecipe));
      const meal = {
        id: crypto.randomUUID(),
        day: Math.min(next.meals.length, 6),
        recipeId: recipeId!,
        servings: operation.servings ?? state.household.servings,
        leftovers: false,
      };
      next.meals.push(meal);
      applied.push({
        op: operation.op,
        targetId: mealTargetId(meal.id),
        name: recipeName(meal.recipeId, next),
        before: 0,
        after: meal.servings,
      });
      continue;
    }
    if (operation.op === "removeMeal") {
      const removed = meals.get(operation.mealId)!;
      next.meals = next.meals.filter((m) => m.id !== removed.id);
      for (const day of Object.values(next.calendar))
        day.mealIds = day.mealIds.filter((id) => id !== removed.id);
      // The shopper took the requested dish off: its request is settled, not missing.
      if (!next.meals.some((m) => m.recipeId === removed.recipeId))
        next.requestIntents = next.requestIntents.filter(
          (mapping) => mapping.recipeId !== removed.recipeId,
        );
      applied.push({
        op: operation.op,
        targetId: mealTargetId(removed.id),
        name: recipeName(removed.recipeId),
        before: removed.servings,
        after: 0,
      });
      continue;
    }
    if (operation.op !== "replaceMeal" && operation.op !== "changeServings")
      continue;
    const meal = next.meals.find((m) => m.id === operation.mealId)!;
    const before = meals.get(meal.id)!;
    if (operation.op === "changeServings") {
      meal.servings = operation.servings;
      applied.push({
        op: operation.op,
        targetId: mealTargetId(meal.id),
        name: recipeName(before.recipeId),
        before: before.servings,
        after: meal.servings,
      });
      continue;
    }
    const r = operation.replacement;
    if (r.kind === "new") next.recipes.push(structuredClone(r.recipe));
    meal.recipeId = r.kind === "saved" ? r.recipeId : r.recipe.id;
    meal.servings = operation.servings ?? before.servings;
    applied.push({
      op: operation.op,
      targetId: mealTargetId(meal.id),
      name: recipeName(before.recipeId),
      to: recipeName(meal.recipeId, next),
      before: before.servings,
      after: meal.servings,
    });
    // The shopper replaced the requested dish, so its request now maps to the replacement.
    if (!next.meals.some((m) => m.recipeId === before.recipeId)) {
      const recipe = next.recipes.find((x) => x.id === meal.recipeId)!;
      next.requestIntents = next.requestIntents.map((mapping) =>
        mapping.recipeId === before.recipeId
          ? {
              ...mapping,
              recipeId: recipe.id,
              requirementKeys: meal.leftovers
                ? []
                : [...new Set(recipe.ingredients.map(requirementKey))],
            }
          : mapping,
      );
    }
  }
  let baseAfter: Map<string, Requirement>;
  try {
    baseAfter = baseRows(next, now);
  } catch {
    throw new EditError("invalidEdit");
  }
  // A shared row keeps the shopper's explicit quantity, moved by what the meals now contribute.
  for (const [key, before] of baseBefore) {
    const after = baseAfter.get(key);
    if (!after) {
      // The row has no source left; its flags must not attach to a later, unrelated row.
      next.skipped = next.skipped.filter((k) => k !== key);
      next.removed = next.removed.filter((k) => k !== key);
      delete next.quantities[key];
    } else if (
      next.quantities[key] !== undefined &&
      after.amount !== before.amount
    ) {
      const moved = next.quantities[key] + after.amount - before.amount;
      if (moved > 0 && moved <= 10_000_000) next.quantities[key] = moved;
      else delete next.quantities[key];
    }
  }

  const current = () =>
    new Map(requirements(next, now, true).map((r) => [requirementKey(r), r]));
  for (const { index, operation, key } of planned) {
    if (key === undefined) continue;
    const [id, unit] = [
      key.slice(0, key.lastIndexOf(":")),
      key.slice(key.lastIndexOf(":") + 1) as Unit,
    ];
    const row = current().get(key);
    const existing = rows.get(key);
    if (operation.op === "addItem") {
      const amount = resolveAmount(
        operation.quantity,
        key,
        unit,
        packSizes,
        index,
      );
      const known = [
        ...next.recipes.flatMap((r) => r.ingredients),
        ...next.extras,
        ...next.staples,
      ].find((i) => requirementKey(i) === key);
      const name = row?.name ?? known?.name ?? operation.name?.trim() ?? id;
      // A new named row may be a non-food request, counted in pieces; an existing row keeps
      // whatever it already is.
      const merchandise =
        !row && !known && operation.op === "addItem"
          ? operation.merchandise
          : previousMerchandise(next, key);
      if (merchandise && unit !== "pcs")
        throw new EditError("invalidEdit", index);
      // An existing identity keeps its own constraints, or the row could not add together.
      const classification = merchandise
        ? undefined
        : row || known
          ? (row?.classification ?? known?.classification)
          : inferredClassification(name, "model-assumed");
      const previous = next.extras.filter((i) => requirementKey(i) === key);
      const extra = ingredientSchema.safeParse({
        id,
        name,
        unit,
        amount: previous.reduce((sum, i) => sum + i.amount, amount),
        ...(classification ? { classification } : {}),
        ...(merchandise ? { merchandise } : {}),
      });
      if (!extra.success) throw new EditError("invalidEdit", index);
      next.extras = [
        ...next.extras.filter((i) => requirementKey(i) !== key),
        extra.data,
      ];
      // An explicit row quantity otherwise masks the addition.
      if (next.quantities[key] !== undefined) {
        const total = next.quantities[key] + amount;
        if (total > 10_000_000) throw new EditError("invalidEdit", index);
        next.quantities[key] = total;
      }
      next.removed = next.removed.filter((k) => k !== key);
      applied.push({
        op: operation.op,
        targetId: rowTargetId(key),
        name,
        unit,
        before: existing?.amount ?? 0,
        after: (existing?.amount ?? 0) + amount,
      });
      continue;
    }
    if (operation.op === "setItem") {
      const amount = resolveAmount(
        operation.quantity,
        key,
        unit,
        packSizes,
        index,
      );
      if (row) {
        // The grocery has a row: the stated amount is what the row should hold.
        if (row.amount === amount) continue;
        next.quantities[key] = amount;
        applied.push({
          op: operation.op,
          targetId: rowTargetId(key),
          name: row.name,
          unit,
          before: existing?.amount ?? row.amount,
          after: amount,
        });
        continue;
      }
      const known = [
        ...next.recipes.flatMap((r) => r.ingredients),
        ...next.extras,
        ...next.staples,
      ].find((i) => requirementKey(i) === key);
      const name = known?.name ?? operation.name.trim();
      const merchandise = known
        ? previousMerchandise(next, key)
        : operation.merchandise;
      if (merchandise && unit !== "pcs")
        throw new EditError("invalidEdit", index);
      const classification = merchandise
        ? undefined
        : known
          ? known.classification
          : inferredClassification(name, "model-assumed");
      const extra = ingredientSchema.safeParse({
        id,
        name,
        unit,
        amount,
        ...(classification ? { classification } : {}),
        ...(merchandise ? { merchandise } : {}),
      });
      if (!extra.success) throw new EditError("invalidEdit", index);
      // Not on the list (new, or removed earlier): it returns with exactly this amount.
      next.extras = [
        ...next.extras.filter((i) => requirementKey(i) !== key),
        extra.data,
      ];
      next.removed = next.removed.filter((k) => k !== key);
      delete next.quantities[key];
      applied.push({
        op: operation.op,
        targetId: rowTargetId(key),
        name,
        unit,
        before: 0,
        after: amount,
      });
      continue;
    }
    // A meal operation in the same batch may have removed the row this operation names.
    if (!row || !existing) throw new EditError("unknownTarget", index);
    if (operation.op === "setAttribute") {
      // Only a non-food row the shopper added has attributes to set.
      const item = next.extras.find((i) => requirementKey(i) === key);
      if (!item?.merchandise) throw new EditError("invalidEdit", index);
      const intent = merchandiseIntentSchema.safeParse({
        ...item.merchandise,
        attributes: [
          ...item.merchandise.attributes.filter(
            (a) => a.kind !== operation.kind,
          ),
          {
            kind: operation.kind,
            value: operation.value,
            provenance: "clarified",
          },
        ],
        missing: item.merchandise.missing.filter((k) => k !== operation.kind),
      });
      if (!intent.success) throw new EditError("invalidEdit", index);
      // Stating the value the row already has is not a change.
      if (JSON.stringify(intent.data) === JSON.stringify(item.merchandise))
        continue;
      item.merchandise = intent.data;
      respecified.add(key);
      applied.push({
        op: operation.op,
        targetId: rowTargetId(key),
        name: row.name,
        to: `${operation.kind}: ${operation.value}`,
        unit,
      });
      continue;
    }
    if (operation.op === "specifyItem") {
      const own = row.specifiedFrom ?? row.name;
      const name = operation.name.trim();
      const same = (a: string, b: string) =>
        a.toLocaleLowerCase("fi") === b.toLocaleLowerCase("fi");
      // Naming what the row already is changes nothing and is not reported.
      if (same(name, row.name)) continue;
      if (same(name, own)) delete next.specifications[key];
      else next.specifications[key] = name;
      respecified.add(key);
      applied.push({
        op: operation.op,
        targetId: rowTargetId(key),
        name: row.name,
        to: name,
        unit,
      });
      continue;
    }
    if (operation.op === "changeQuantity") {
      const amount = resolveAmount(
        operation.quantity,
        key,
        unit,
        packSizes,
        index,
      );
      // Stating the amount the row already has is not a change and is not reported as one.
      if (row.amount === amount) continue;
      next.quantities[key] = amount;
      applied.push({
        op: operation.op,
        targetId: rowTargetId(key),
        name: row.name,
        unit,
        before: existing.amount,
        after: amount,
      });
    } else if (operation.op === "markAtHome") {
      if (operation.atHome !== next.skipped.includes(key))
        next.skipped = operation.atHome
          ? [...next.skipped, key]
          : next.skipped.filter((k) => k !== key);
      applied.push({
        op: operation.op,
        targetId: rowTargetId(key),
        name: row.name,
        unit,
        before: existing.amount,
        after: operation.atHome ? 0 : row.amount,
      });
    } else if (operation.op === "removeItem") {
      next.removed.push(key);
      applied.push({
        op: operation.op,
        targetId: rowTargetId(key),
        name: row.name,
        unit,
        before: existing.amount,
        after: 0,
      });
    }
  }

  const validated = stateSchema.safeParse(next);
  if (!validated.success) throw new EditError("invalidEdit");
  let after: Requirement[];
  try {
    after = requirements(validated.data, now);
  } catch {
    // For example an added grocery whose category constraints conflict with the row it would join.
    throw new EditError("invalidEdit");
  }
  const visibleBefore = new Map(
    requirements(state, now).map((r) => [requirementKey(r), r.amount]),
  );
  const visibleAfter = new Map(after.map((r) => [requirementKey(r), r.amount]));
  const changedKeys = [
    ...new Set([...visibleBefore.keys(), ...visibleAfter.keys()]),
  ].filter(
    (key) =>
      visibleBefore.get(key) !== visibleAfter.get(key) || respecified.has(key),
  );
  if (
    JSON.stringify(validated.data) === JSON.stringify(stateSchema.parse(state))
  )
    throw new EditError("noChange");
  return { state: validated.data, applied, changedKeys };
}

export type EditIntentOutcome =
  | { status: "applied"; result: EditResult }
  | {
      status: "clarification";
      ambiguities: EditAmbiguity[];
      unsupported: string[];
    };

/**
 * Applies an interpreted instruction only when it is wholly clear. An ambiguous or unsupported
 * part returns a clarification and leaves the plan untouched; its candidates must be real targets.
 */
export function applyEditIntent(
  state: AppState,
  input: unknown,
  options: EditOptions = {},
): EditIntentOutcome {
  const parsed = editIntentSchema.safeParse(input);
  if (!parsed.success) throw new EditError("unsupportedEdit");
  const intent = parsed.data;
  const targets = editTargets(state, options.now);
  const known = new Set<string>([
    ...targets.rows.map((r) => r.targetId),
    ...targets.meals.map((m) => m.targetId),
  ]);
  for (const ambiguity of intent.ambiguities)
    if (ambiguity.candidates.some((id) => !known.has(id)))
      throw new EditError("unknownTarget");
  if (intent.ambiguities.length || intent.unsupported.length)
    return {
      status: "clarification",
      ambiguities: intent.ambiguities,
      unsupported: intent.unsupported.map((u) => u.phrase),
    };
  return {
    status: "applied",
    result: applyEdits(
      state,
      {
        version: EDIT_VERSION,
        revision: state.revision,
        operations: intent.operations,
      },
      options,
    ),
  };
}
