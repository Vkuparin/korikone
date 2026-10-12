import React from "react";
import { spendingWeeks } from "../domain/spending";
import type { Insights } from "./insights";

/**
 * Twelve weeks of actual spending from confirmed receipts and orders against the weekly budget,
 * as plain SVG with a text table that carries every figure. Unconfirmed transfers appear only as
 * a separate, outlined estimate; incomplete weeks are hatched and say how many totals are unknown.
 */
export function SpendingChart({
  insights,
  budget,
  language,
  now = new Date(),
}: {
  insights: Insights;
  /** Weekly budget in cents; 0 means none. */
  budget: number;
  language: string;
  now?: Date;
}) {
  const fi = language === "fi";
  const tr = (a: string, b: string) => (fi ? a : b);
  const spending = spendingWeeks(
    insights.actualPurchases,
    insights.transfers,
    now,
    {
      weeks: 12,
      confirmedTransferIds: insights.confirmedTransfers.map(
        (t) => t.transferId,
      ),
    },
  );
  const money = (cents: number) =>
    new Intl.NumberFormat(fi ? "fi-FI" : "en-FI", {
      style: "currency",
      currency: "EUR",
    }).format(cents / 100);
  const day = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString(fi ? "fi-FI" : "en-FI", {
      day: "numeric",
      month: "numeric",
      timeZone: "UTC",
    });
  const top = Math.max(
    budget,
    ...spending.weeks.map((w) => w.actual + w.transferEstimate.amount),
    1,
  );
  const width = 720;
  const height = 220;
  const left = 8;
  const bottom = 28;
  const plot = height - bottom - 8;
  const slot = (width - left * 2) / spending.weeks.length;
  const y = (cents: number) => 8 + plot - (cents / top) * plot;
  const hasAny =
    spending.weeks.some((w) => w.purchases || w.transferEstimate.transfers) ||
    spending.undated.purchases > 0;
  return (
    <section
      className="spending card"
      aria-label={tr("Viimeiset 12 viikkoa", "The last 12 weeks")}
    >
      <h2>{tr("Menot viikoittain", "Weekly spending")}</h2>
      <p className="muted">
        {tr(
          "Toteutuneet ostot: tuodut kuitit ja tilaukset, kukin ostos kerran. Päivämäärät ovat maanantaista sunnuntaihin. Siirrot ovat vain arvio eivätkä ole ostoja.",
          "Actual purchases: imported receipts and orders, each purchase once. Weeks run Monday to Sunday. Transfers are only an estimate and are not purchases.",
        )}
      </p>
      {!hasAny ? (
        <p role="status">
          {tr(
            "Ei vielä tuotuja kuitteja tai tilauksia, joista menot voisi laskea.",
            "No imported receipts or orders yet to count spending from.",
          )}
        </p>
      ) : (
        <>
          <svg
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label={tr(
              "Pylväskaavio viikoittaisista toteutuneista ostoista budjettiin verrattuna. Tarkat luvut ovat alla olevassa taulukossa.",
              "Bar chart of weekly actual purchases against the budget. Exact figures are in the table below.",
            )}
            className="spending-chart"
          >
            <defs>
              <pattern
                id="spending-partial"
                width="6"
                height="6"
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(45)"
              >
                <rect width="6" height="6" fill="var(--kk-surface)" />
                <rect width="3" height="6" fill="var(--kk-action)" />
              </pattern>
            </defs>
            {spending.weeks.map((w, i) => {
              const x = left + i * slot + slot * 0.15;
              const barWidth = slot * 0.7;
              const actualTop = y(w.actual);
              const estimateTop = y(w.actual + w.transferEstimate.amount);
              return (
                <g key={w.start}>
                  {w.transferEstimate.amount > 0 && (
                    <rect
                      x={x}
                      y={estimateTop}
                      width={barWidth}
                      height={actualTop - estimateTop}
                      fill="none"
                      stroke="var(--kk-muted)"
                      strokeDasharray="4 3"
                    />
                  )}
                  {w.actual > 0 && (
                    <rect
                      x={x}
                      y={actualTop}
                      width={barWidth}
                      height={8 + plot - actualTop}
                      fill={
                        w.coverage === "partial"
                          ? "url(#spending-partial)"
                          : "var(--kk-action)"
                      }
                      stroke="var(--kk-action)"
                    />
                  )}
                  {w.coverage === "partial" && w.actual === 0 && (
                    <text
                      x={x + barWidth / 2}
                      y={8 + plot - 4}
                      textAnchor="middle"
                      fontSize="12"
                      fill="var(--kk-warning)"
                    >
                      ?
                    </text>
                  )}
                  <text
                    x={x + barWidth / 2}
                    y={height - 10}
                    textAnchor="middle"
                    fontSize="11"
                    fill="var(--kk-muted)"
                  >
                    {day(w.start)}
                  </text>
                </g>
              );
            })}
            {budget > 0 && (
              <g>
                <line
                  x1={left}
                  x2={width - left}
                  y1={y(budget)}
                  y2={y(budget)}
                  stroke="var(--kk-warning)"
                  strokeWidth="2"
                  strokeDasharray="8 4"
                />
                <text
                  x={width - left}
                  y={y(budget) - 4}
                  textAnchor="end"
                  fontSize="12"
                  fill="var(--kk-warning)"
                >
                  {tr("Viikkobudjetti", "Weekly budget")} {money(budget)}
                </text>
              </g>
            )}
          </svg>
          <p className="muted">
            <span aria-hidden="true">▨</span>{" "}
            {tr(
              "Raidoitettu viikko: kaikkien ostosten summa ei ole tiedossa, joten summa on alaraja.",
              "Hatched week: not every purchase total is known, so the amount is a lower bound.",
            )}
          </p>
          <table className="spending-table">
            <caption className="sr-only">
              {tr("Viikoittaiset menot", "Weekly spending")}
            </caption>
            <thead>
              <tr>
                <th scope="col">{tr("Viikko alkaa", "Week of")}</th>
                <th scope="col">
                  {tr("Toteutuneet ostot", "Actual purchases")}
                </th>
                <th scope="col">{tr("Ostoksia", "Purchases")}</th>
                <th scope="col">{tr("Kattavuus", "Coverage")}</th>
                <th scope="col">
                  {tr("Ruoka / muut (kuitissa)", "Food / other (printed)")}
                </th>
                <th scope="col">
                  {tr("Arvio siirroista", "Estimate from transfers")}
                </th>
              </tr>
            </thead>
            <tbody>
              {spending.weeks.map((w) => (
                <tr key={w.start} data-coverage={w.coverage}>
                  <th scope="row">{day(w.start)}</th>
                  <td>
                    {w.purchases === 0
                      ? tr("ei ostoja", "none")
                      : `${money(w.actual)}${w.unknownTotals ? "+" : ""}`}
                    {budget > 0 && w.actual > budget
                      ? ` · ${tr("yli budjetin", "over budget")}`
                      : ""}
                  </td>
                  <td>{w.purchases}</td>
                  <td>
                    {w.coverage === "none"
                      ? "–"
                      : w.coverage === "complete"
                        ? tr("täysi", "complete")
                        : tr(
                            `${w.unknownTotals} summaa tuntematta`,
                            `${w.unknownTotals} totals unknown`,
                          )}
                    {w.conflicting
                      ? ` · ${w.conflicting} ${tr("ristiriitaista", "conflicting")}`
                      : ""}
                  </td>
                  <td>
                    {w.breakdown.withBreakdown
                      ? `${money(w.breakdown.food)} / ${money(w.breakdown.nonFood)}`
                      : tr("ei tiedossa", "unknown")}
                    {w.breakdown.withBreakdown && w.breakdown.withoutBreakdown
                      ? ` (${w.breakdown.withBreakdown}/${w.purchases})`
                      : ""}
                  </td>
                  <td>
                    {w.transferEstimate.transfers
                      ? `${tr("noin", "about")} ${money(w.transferEstimate.amount)}${w.transferEstimate.unknownItems ? "+" : ""}`
                      : "–"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {spending.undated.purchases > 0 && (
            <p className="muted">
              {tr(
                `Ilman päivämäärää: ${spending.undated.purchases} ostosta${
                  spending.undated.actual
                    ? `, yhteensä ${money(spending.undated.actual)}`
                    : ""
                }. Niitä ei sijoiteta viikkoihin.`,
                `Undated: ${spending.undated.purchases} purchases${
                  spending.undated.actual
                    ? `, ${money(spending.undated.actual)} in total`
                    : ""
                }. They are not placed in any week.`,
              )}
            </p>
          )}
        </>
      )}
    </section>
  );
}
