import {
  ingredientSchema,
  parseAmount,
  type AppState,
  type Unit,
} from "./model";

/** Add a manual grocery to the same row as an existing ingredient, when possible. */
export function addGrocery(
  state: AppState,
  name: string,
  rawAmount: string,
  inputUnit: Unit | "kg" | "l",
): AppState {
  const unit = inputUnit === "kg" ? "g" : inputUnit === "l" ? "ml" : inputUnit;
  const cleanName = name.trim().replace(/\s+/g, " ");
  const identity = (value: string) =>
    value.trim().replace(/\s+/g, " ").toLocaleLowerCase("fi");
  const existing = [
    ...state.recipes.flatMap((r) => r.ingredients),
    ...state.extras,
    ...state.staples,
  ].find((i) => i.unit === unit && identity(i.name) === identity(cleanName));
  const id = existing?.id ?? identity(cleanName);
  if (!cleanName || !ingredientSchema.shape.id.safeParse(id).success)
    throw new Error("invalidGroceryName");
  const item = ingredientSchema.parse({
    id,
    name: existing?.name ?? cleanName,
    amount: parseAmount(rawAmount, inputUnit),
    unit,
  });
  const key = `${item.id}:${unit}`;
  const previous = state.extras.filter(
    (i) => i.id === item.id && i.unit === unit,
  );
  const combined = ingredientSchema.parse({
    ...item,
    amount: previous.reduce((sum, i) => sum + i.amount, item.amount),
  });
  const quantities = { ...state.quantities };
  // An explicit row quantity otherwise masks ingredients added to that row.
  if (quantities[key] !== undefined)
    quantities[key] = parseAmount(String(quantities[key] + item.amount), unit);
  return {
    ...state,
    extras: [
      ...state.extras.filter((i) => i.id !== item.id || i.unit !== unit),
      combined,
    ],
    removed: state.removed.filter((k) => k !== key),
    quantities,
  };
}

/**
 * The amount and unit last used for a grocery of this name: from the latest transferred lists,
 * then the current list and regular items (B7.3). Quick add starts from it instead of "1 kpl",
 * so milk typed after an earlier "1 l" is asked for in litres. Null when the name is new.
 */
export function lastGroceryAmount(
  state: AppState,
  name: string,
): { amount: string; unit: Unit | "kg" | "l" } | null {
  const identity = (value: string) =>
    value.trim().replace(/\s+/g, " ").toLocaleLowerCase("fi");
  const wanted = identity(name);
  if (!wanted) return null;
  const found = [
    ...state.listHistory.flatMap(
      (entry) => entry.sentGroceries ?? entry.extras,
    ),
    ...state.extras,
    ...state.staples,
  ].find((item) => identity(item.name) === wanted);
  if (!found) return null;
  const whole = (n: number) => String(n).replace(".", ",");
  if (found.unit === "ml" && found.amount % 100 === 0 && found.amount >= 1000)
    return { amount: whole(found.amount / 1000), unit: "l" };
  if (found.unit === "g" && found.amount % 100 === 0 && found.amount >= 1000)
    return { amount: whole(found.amount / 1000), unit: "kg" };
  return { amount: whole(found.amount), unit: found.unit };
}
