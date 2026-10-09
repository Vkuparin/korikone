import { expect, test } from "vitest";
import {
  calendarDays,
  moveCalendarMeal,
  planCalendar,
} from "../src/domain/calendar";

test("calendar shows seven local dates across month, year and clock changes", () => {
  expect(calendarDays(new Date(2026, 11, 29, 23))).toEqual([
    "2026-12-29",
    "2026-12-30",
    "2026-12-31",
    "2027-01-01",
    "2027-01-02",
    "2027-01-03",
    "2027-01-04",
  ]);
  expect(calendarDays(new Date(2026, 9, 24))).toEqual([
    "2026-10-24",
    "2026-10-25",
    "2026-10-26",
    "2026-10-27",
    "2026-10-28",
    "2026-10-29",
    "2026-10-30",
  ]);
});

test("moving a meal removes previous dates and keeps leftovers and other meals", () => {
  const calendar = {
    "2026-10-09": { mealIds: ["pasta", "soup"], leftovers: true },
    "2026-10-10": { mealIds: ["pasta"], leftovers: false },
  };
  const before = structuredClone(calendar);
  const moved = moveCalendarMeal(calendar, "pasta", "2026-10-11");
  expect(moved).toEqual({
    "2026-10-09": { mealIds: ["soup"], leftovers: true },
    "2026-10-10": { mealIds: [], leftovers: false },
    "2026-10-11": { mealIds: ["pasta"], leftovers: false },
  });
  expect(calendar).toEqual(before);
  expect(moveCalendarMeal(moved, "pasta", null)["2026-10-11"].mealIds).toEqual(
    [],
  );
});

test("planning keeps exactly seven dates with multiple meals and no duplicate IDs", () => {
  const days = calendarDays(new Date(2026, 9, 9));
  const ids = Array.from({ length: 9 }, (_, index) => `meal-${index}`);
  const planned = planCalendar({}, [...ids, ids[0]], days);
  expect(Object.keys(planned)).toEqual(days);
  expect(planned[days[0]].mealIds).toEqual(["meal-0", "meal-7"]);
  expect(planned[days[1]].mealIds).toEqual(["meal-1", "meal-8"]);
  expect(Object.values(planned).flatMap((day) => day.mealIds)).toHaveLength(9);
  expect(planCalendar(planned, [], days)).toEqual(planned);
});
