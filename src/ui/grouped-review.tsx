import React, { useEffect, useRef, useState } from "react";
import type { Snapshot } from "../application/service";
import type { Requirement } from "../domain/model";
import { RowDetails } from "./details";
import { preferenceCategoryLabel } from "./category-preferences";

type Call = (
  method: string,
  input?: unknown,
  options?: { preserveError?: boolean },
) => Promise<boolean>;
const rowKey = (requirement: Requirement) =>
  `${requirement.id}:${requirement.unit}`;

/** An optional view of the captured uncertain rows; it owns no list, quote or transfer. */
export function GroupedReview({
  snapshot,
  requirements,
  busy,
  money,
  call,
  close,
}: {
  snapshot: Snapshot;
  requirements: Requirement[];
  busy: boolean;
  money: (cents: number) => string;
  call: Call;
  close: () => void;
}) {
  const language = snapshot.state.language;
  const tr = (fi: string, en: string) => (language === "fi" ? fi : en);
  const heading = useRef<HTMLHeadingElement>(null);
  const rowHeadings = useRef(new Map<string, HTMLHeadingElement>());
  const [aside, setAside] = useState<string[]>([]);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const groups = new Map<string, Requirement[]>();
  for (const requirement of requirements) {
    const line = snapshot.basket.find(
      (candidate) => rowKey(candidate.requirement) === rowKey(requirement),
    );
    const category = line?.matching?.category;
    const name = category
      ? preferenceCategoryLabel(category, language)
      : tr("Muut pyynnöt", "Other requests");
    groups.set(name, [...(groups.get(name) ?? []), requirement]);
  }
  return (
    <section
      className="card grouped-review"
      aria-labelledby="grouped-review-heading"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !busy) {
          event.stopPropagation();
          close();
        }
      }}
    >
      <h2 ref={heading} tabIndex={-1} id="grouped-review-heading">
        {tr("Tarkista tuotevalinnat", "Review product choices")}
      </h2>
      <p>
        {tr(
          "Käytä kerran hyväksyy tuotteen nykyiseen listaan. Muista tyyppi kysyy erikseen tulevien listojen säännön. Voit jättää rivin ratkaisematta; siirto kysyy puuttuvista tuotteista myöhemmin.",
          "Use once approves a product for the current list. Remember type asks separately for a rule for future lists. You can leave a row unresolved; transfer will ask about missing products later.",
        )}
      </p>
      <button
        type="button"
        className="secondary"
        disabled={busy}
        onClick={close}
      >
        {tr("Sulje tarkistus", "Close review")}
      </button>
      {[...groups].map(([category, rows]) => (
        <section className="review-category" key={category}>
          <h3>{category}</h3>
          {rows.map((requirement) => {
            const key = rowKey(requirement);
            const line = snapshot.basket.find(
              (candidate) => rowKey(candidate.requirement) === key,
            );
            const left = aside.includes(key) && !line?.product;
            return (
              <section
                className="review-row"
                aria-label={`${tr("Tarkista", "Review")}: ${requirement.name}`}
                key={key}
              >
                <h4
                  tabIndex={-1}
                  ref={(element) => {
                    if (element) rowHeadings.current.set(key, element);
                    else rowHeadings.current.delete(key);
                  }}
                >
                  {requirement.name}
                </h4>
                {line?.product && (
                  <p role="status">
                    {tr(
                      "Tuote valittu nykyiseen listaan",
                      "Product chosen for the current list",
                    )}
                    : {line.product.name}
                  </p>
                )}
                {left ? (
                  <>
                    <p role="status">
                      {tr(
                        "Jätetty ratkaisematta. Rivi säilyy listassa.",
                        "Left unresolved. The row stays in the list.",
                      )}
                    </p>
                    <button
                      type="button"
                      className="text"
                      disabled={busy}
                      onClick={() =>
                        setAside(aside.filter((saved) => saved !== key))
                      }
                    >
                      {tr("Tarkista uudelleen", "Review again")}
                    </button>
                  </>
                ) : (
                  <>
                    {line ? (
                      <RowDetails
                        snapshot={snapshot}
                        line={line}
                        busy={busy}
                        money={money}
                        cheaper={null}
                        choose={(product) => {
                          void call("accept", {
                            ingredientId: requirement.id,
                            productId: product.id,
                          }).then((applied) => {
                            if (applied) rowHeadings.current.get(key)?.focus();
                          });
                        }}
                        remember={async (input) => {
                          const applied = await call(
                            "rememberCategoryPreference",
                            input,
                          );
                          if (!applied)
                            await call("load", undefined, {
                              preserveError: true,
                            });
                          return applied;
                        }}
                        confirmPack={(product, amount, unit) => {
                          void call("setPackSize", {
                            productId: product.id,
                            amount,
                            unit,
                          });
                        }}
                      />
                    ) : (
                      <p>
                        {tr(
                          "Tuotteita ei ole haettu tälle riville. Hae tuotteet ja hinnat listan yhteydessä.",
                          "Products have not been retrieved for this row. Get products and prices from the list.",
                        )}
                      </p>
                    )}
                    {!line?.product && (
                      <button
                        type="button"
                        className="secondary"
                        disabled={busy}
                        onClick={() => {
                          setAside([...aside, key]);
                          rowHeadings.current.get(key)?.focus();
                        }}
                      >
                        {tr("Jätä ratkaisematta", "Leave unresolved")}
                      </button>
                    )}
                  </>
                )}
              </section>
            );
          })}
        </section>
      ))}
    </section>
  );
}
