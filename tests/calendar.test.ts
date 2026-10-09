import { expect, test } from "vitest";
import {
  calendarDays,
  calendarText,
  moveCalendarMeal,
  planCalendar,
} from "../src/domain/calendar";
import { initialState } from "../src/domain/model";

test("week text includes seven dated lines, meals and leftovers in Finnish and English", () => {
  const state = initialState();
  state.meals = [
    {
      id: "pasta-meal",
      recipeId: "pasta",
      day: 0,
      servings: 4,
      leftovers: false,
    },
    {
      id: "soup-meal",
      recipeId: "soup",
      day: 0,
      servings: 4,
      leftovers: false,
    },
  ];
  state.calendar = {
    "2026-10-09": { mealIds: ["soup-meal", "pasta-meal"], leftovers: true },
    "2026-10-10": { mealIds: [], leftovers: true },
  };
  const before = structuredClone(state);
  const now = new Date(2026, 9, 9);
  const fi = calendarText(state, now).split("\n");
  expect(fi).toHaveLength(7);
  expect(fi[0]).toBe(
    "perjantai 2026-10-09: Tomaattipasta, Peruna-porkkanakeitto, Tähteitä",
  );
  expect(fi[1]).toBe("lauantai 2026-10-10: Tähteitä");
  expect(fi[2]).toBe("sunnuntai 2026-10-11: Vapaa");
  expect(fi[6]).toBe("torstai 2026-10-15: Vapaa");
  expect(state).toEqual(before);
  state.language = "en";
  const en = calendarText(state, now).split("\n");
  expect(en[0]).toBe(
    "Friday 2026-10-09: Tomaattipasta, Peruna-porkkanakeitto, Leftovers",
  );
  expect(en[1]).toBe("Saturday 2026-10-10: Leftovers");
  expect(en[2]).toBe("Sunday 2026-10-11: Open");
  expect(en[6]).toBe("Thursday 2026-10-15: Open");
});

test("week text omits removed, unscheduled, ready and leftovers meals and old dates", () => {
  const state = initialState();
  state.recipes.push({
    ...state.recipes[0],
    id: "ready",
    name: "Ready food",
    kind: "ready",
  });
  state.meals = [
    {
      id: "unscheduled",
      recipeId: "pasta",
      day: 0,
      servings: 4,
      leftovers: false,
    },
    { id: "leftovers", recipeId: "soup", day: 0, servings: 4, leftovers: true },
    { id: "ready", recipeId: "ready", day: 0, servings: 4, leftovers: false },
    {
      id: "missing-recipe",
      recipeId: "missing",
      day: 0,
      servings: 4,
      leftovers: false,
    },
  ];
  state.calendar = {
    "2026-10-08": { mealIds: ["unscheduled"], leftovers: true },
    "2026-10-09": {
      mealIds: ["removed", "leftovers", "ready", "missing-recipe"],
      leftovers: false,
    },
  };
  const text = calendarText(state, new Date(2026, 9, 9));
  expect(text.split("\n")).toHaveLength(7);
  expect(text).not.toMatch(
    /2026-10-08|Tomaattipasta|Peruna-porkkanakeitto|Ready food|Tähteitä/,
  );
  expect(text.split("\n").every((line) => line.endsWith(": Vapaa"))).toBe(true);
});

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
