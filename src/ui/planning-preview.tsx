import type { PlanningSnapshot } from "../application/planning";
import { unitLabel } from "./i18n";
import { matchingReasonLabel } from "./matching-reasons";
import { planningActivityPending } from "./planning-status";
import { useLayoutEffect, useRef, type ReactNode } from "react";

export function PlanningPreviewFocus({
  children,
  onReleaseFocus,
}: {
  children: ReactNode;
  onReleaseFocus: () => void;
}) {
  const element = useRef<HTMLDivElement>(null);
  const release = useRef(onReleaseFocus);
  release.current = onReleaseFocus;
  useLayoutEffect(
    () => () => {
      if (element.current?.contains(document.activeElement))
        requestAnimationFrame(() => release.current());
    },
    [],
  );
  return <div ref={element}>{children}</div>;
}

export function PlanningPreview({
  planning,
  language,
}: {
  planning: PlanningSnapshot | null;
  language: string;
}) {
  const fi = language === "fi";
  const tr = (a: string, b: string) => (fi ? a : b);
  const money = (value: number) =>
    new Intl.NumberFormat(fi ? "fi-FI" : "en-FI", {
      style: "currency",
      currency: "EUR",
    }).format(value / 100);
  const unresolved = planning?.intents.filter(
    (result) =>
      result.status === "unresolved" && !result.requirementKeys.length,
  );
  return (
    <section
      className="planning-preview"
      aria-labelledby="planning-preview-title"
      aria-busy={planningActivityPending(planning?.phase ?? "starting")}
      data-planning-phase={planning?.phase ?? "starting"}
    >
      <h2 id="planning-preview-title">
        {tr("Muodostuva lista", "List in progress")}
      </h2>
      <p className="muted">
        {tr(
          "Alustavat tulokset. Tallennettu lista ja sen hinnat säilyvät päivityksen loppuun asti.",
          "Provisional results. Your saved list and its prices remain until the update completes.",
        )}
      </p>
      <div className="planning-preview-results" tabIndex={0}>
        {!planning?.intents.length && (
          <p>{tr("Odotetaan tulkintaa.", "Waiting for interpretation.")}</p>
        )}
        {planning?.provisional.meals.map((meal) => (
          <p key={`${meal.recipeId}:${meal.day}`} className="preview-meal">
            <strong>{meal.name}</strong> · {meal.servings}{" "}
            {tr("annosta", "servings")}
          </p>
        ))}
        <ul>
          {planning?.provisional.rows.map((row) => (
            <li key={row.requirementKey} data-preview-status={row.status}>
              <strong>{row.name}</strong> · {row.amount}{" "}
              {unitLabel(row.unit, language)}
              <span>
                {row.status === "pending"
                  ? tr("Tuotehaku odottaa", "Product search pending")
                  : (row.product?.name ??
                    tr("Ei sopivaa tuotetta", "No suitable product"))}
                {row.total !== null && row.status !== "pending" && (
                  <>
                    {" "}
                    · {row.approximate ? tr("noin ", "about ") : ""}
                    {money(row.total)}
                  </>
                )}
              </span>
              {row.status === "approval-required" && (
                <small>{tr("Vaatii hyväksynnän", "Approval required")}</small>
              )}
              {row.reason && row.status !== "resolved" && (
                <small>{matchingReasonLabel(row.reason, language)}</small>
              )}
            </li>
          ))}
        </ul>
        {!!unresolved?.length && (
          <div className="warning">
            <h3>{tr("Ratkaisemattomat pyynnöt", "Unresolved requests")}</h3>
            <ul>
              {unresolved.map((result) => (
                <li key={result.intent.id}>
                  <strong>{result.intent.label}</strong>
                  <span>
                    {tr(
                      "Määrä tai sopiva tulos puuttuu. Ei hinnoiteltu.",
                      "Quantity or a suitable result is missing. Not priced.",
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
