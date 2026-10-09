import type { AppState } from "./model";

export type MealCalendar = AppState["calendar"];

/** Local dates stay on the shopper's day, including across daylight-saving changes. */
export function calendarDays(now = new Date()): string[] {
  return Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + offset,
      12,
    );
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  });
}

/** A meal appears on one date at most. Moving it keeps each day's leftovers flag. */
export function moveCalendarMeal(
  calendar: MealCalendar,
  mealId: string,
  date: string | null,
): MealCalendar {
  const next = Object.fromEntries(
    Object.entries(calendar).map(([day, entry]) => [
      day,
      { ...entry, mealIds: entry.mealIds.filter((id) => id !== mealId) },
    ]),
  );
  if (date) {
    const entry = next[date] ?? { mealIds: [], leftovers: false };
    next[date] = { ...entry, mealIds: [...entry.mealIds, mealId] };
  }
  return next;
}

/** Distribute all current cooked meals over seven dates, including more than seven meals. */
export function planCalendar(
  calendar: MealCalendar,
  mealIds: string[],
  days: string[],
): MealCalendar {
  if (!days.length) return calendar;
  return [...new Set(mealIds)].reduce(
    (next, id, index) => moveCalendarMeal(next, id, days[index % days.length]),
    calendar,
  );
}
