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
  const item = ingredientSchema.parse({
    id: existing?.id ?? identity(cleanName),
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
