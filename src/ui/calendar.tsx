import React, { useEffect, useRef, useState } from "react";
import type { AppState } from "../domain/model";
import {
  calendarDays,
  calendarMeals,
  calendarText,
  moveCalendarMeal,
  planCalendar,
  type MealCalendar,
} from "../domain/calendar";

export function MealCalendarView({
  state,
  busy,
  save,
  copy,
}: {
  state: AppState;
  busy: boolean;
  save: (state: AppState) => Promise<boolean>;
  copy: () => Promise<boolean>;
}) {
  const fi = state.language === "fi";
  const tr = (a: string, b: string) => (fi ? a : b);
  const days = calendarDays();
  const meals = calendarMeals(state);
  const dateLabel = (date: string) =>
    new Date(`${date}T12:00:00`).toLocaleDateString(fi ? "fi-FI" : "en-FI", {
      weekday: "long",
      day: "numeric",
      month: "numeric",
    });
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const weekText = calendarText(state);
  useEffect(() => setCopied(false), [weekText]);
  const pendingFocus = useRef<string | null>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const locked = busy || saving;
  useEffect(() => {
    if (pendingFocus.current) {
      buttons.current.get(pendingFocus.current)?.focus();
      pendingFocus.current = null;
    }
  }, [state.calendar, saving]);
  async function persist(calendar: MealCalendar, focus?: string) {
    if (locked) return false;
    setSaving(true);
    try {
      const ok = await save({ ...state, calendar });
      if (ok && focus) pendingFocus.current = focus;
      return ok;
    } finally {
      setSaving(false);
    }
  }
  async function move(id: string, date: string | null) {
    if (!meals.some((m) => m.id === id) || locked) return;
    const meal = meals.find((m) => m.id === id)!;
    const name = state.recipes.find((r) => r.id === meal.recipeId)!.name;
    if (await persist(moveCalendarMeal(state.calendar, id, date), id)) {
      setMessage(
        `${name}: ${date ? dateLabel(date) : tr("Ei päivää", "Unscheduled")}`,
      );
    }
  }
  const drop = (event: React.DragEvent, date: string | null) => {
    event.preventDefault();
    void move(event.dataTransfer.getData("application/x-korikone-meal"), date);
  };
  const mealButton = (meal: AppState["meals"][number], date: string | null) => {
    const recipe = state.recipes.find((r) => r.id === meal.recipeId)!;
    return (
      <button
        className="calendar-meal secondary"
        key={meal.id}
        data-meal-id={meal.id}
        ref={(element) => {
          if (element) buttons.current.set(meal.id, element);
          else buttons.current.delete(meal.id);
        }}
        aria-describedby="calendar-help"
        disabled={locked}
        draggable={!locked}
        onDragStart={(event) => {
          event.dataTransfer.setData("application/x-korikone-meal", meal.id);
          event.dataTransfer.effectAllowed = "move";
        }}
        onKeyDown={(event) => {
          if (event.key === "Delete") {
            event.preventDefault();
            void move(meal.id, null);
            return;
          }
          const direction = {
            ArrowLeft: -1,
            ArrowUp: -1,
            ArrowRight: 1,
            ArrowDown: 1,
          }[event.key];
          if (!direction) return;
          event.preventDefault();
          const index = date ? days.indexOf(date) : -1;
          const next = index < 0 ? 0 : index + direction;
          if (next >= 0 && next < days.length) void move(meal.id, days[next]);
        }}
      >
        <strong>{recipe.name}</strong>
        <span>
          {meal.servings} {tr("annosta", "portions")}
        </span>
      </button>
    );
  };
  const onVisibleDate = new Set(
    days.flatMap((date) => state.calendar[date]?.mealIds ?? []),
  );
  return (
    <section>
      <h1>{tr("Viikkosuunnitelma", "Meal schedule")}</h1>
      <p>
        {tr(
          "Jaa ostoslistan ateriat tuleville päiville. Suunnitelma ei muuta ostoslistaa.",
          "Place the shopping list's meals on upcoming days. The schedule does not change the shopping list.",
        )}
      </p>
      <p id="calendar-help" className="muted">
        {tr(
          "Vedä ateria päivälle tai siirrä sitä nuolinäppäimillä. Delete poistaa päivän. Muutokset tallentuvat automaattisesti.",
          "Drag a meal onto a day or move it with the arrow keys. Delete removes its date. Changes are saved automatically.",
        )}
      </p>
      <div className="actions">
        <button
          disabled={locked || !meals.length}
          onClick={() =>
            void persist(
              planCalendar(
                state.calendar,
                meals.map((m) => m.id),
                days,
              ),
            )
          }
        >
          {tr("Luonnostele viikko", "Plan the week")}
        </button>
        <button
          className="secondary"
          disabled={locked}
          onClick={async () => {
            if (await copy()) setCopied(true);
          }}
        >
          {copied
            ? tr("Viikko kopioitu", "Week copied")
            : tr("Kopioi viikko", "Copy week")}
        </button>
      </div>
      {!meals.length && (
        <p>
          {tr(
            "Lisää ensin aterioita ostoslistaan.",
            "Add meals to your shopping list first.",
          )}
        </p>
      )}
      <div
        className="calendar-unscheduled card"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => drop(event, null)}
      >
        <h2>{tr("Ei päivää", "Unscheduled")}</h2>
        {meals
          .filter((meal) => !onVisibleDate.has(meal.id))
          .map((meal) => mealButton(meal, null))}
      </div>
      <div className="schedule-grid">
        {days.map((date) => (
          <article
            className="card calendar-day"
            key={date}
            data-date={date}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => drop(event, date)}
          >
            <h2>{dateLabel(date)}</h2>
            <label>
              <input
                type="checkbox"
                disabled={locked}
                checked={state.calendar[date]?.leftovers ?? false}
                onChange={(event) =>
                  void persist({
                    ...state.calendar,
                    [date]: {
                      mealIds: state.calendar[date]?.mealIds ?? [],
                      leftovers: event.target.checked,
                    },
                  })
                }
              />
              {tr("Tähteitä", "Leftovers")}
            </label>
            {meals
              .filter((meal) => state.calendar[date]?.mealIds.includes(meal.id))
              .map((meal) => mealButton(meal, date))}
          </article>
        ))}
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {message}
      </p>
    </section>
  );
}
