import { useMemo, useRef, useState } from "react";
import type { Recipe } from "../domain/model";
import { count, unitLabel } from "./i18n";

const pageSize = 12;

export function RecipeLibrary({
  recipes,
  language,
  editing,
  onEdit,
  onList = new Set(),
  onAdd,
  busy = false,
}: {
  recipes: Recipe[];
  language: string;
  editing: boolean;
  onEdit: (recipe: Recipe) => void;
  /** Recipes already on this week's list (B7.5). */
  onList?: ReadonlySet<string>;
  /** Adds the recipe to this week's list at the household's portions. */
  onAdd?: (recipe: Recipe) => void;
  busy?: boolean;
}) {
  const fi = language === "fi";
  const tr = (a: string, b: string) => (fi ? a : b);
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(pageSize);
  const search = useRef<HTMLInputElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const term = query.trim().toLocaleLowerCase("fi");
  const matches = useMemo(
    () =>
      (term
        ? recipes.filter(
            (recipe) =>
              recipe.name.toLocaleLowerCase("fi").includes(term) ||
              recipe.ingredients.some((item) =>
                item.name.toLocaleLowerCase("fi").includes(term),
              ),
          )
        : recipes
      ).toReversed(),
    [recipes, term],
  );
  if (editing) return null;
  if (!recipes.length)
    return (
      <p>{tr("Ei vielä tallennettuja reseptejä.", "No saved recipes yet.")}</p>
    );
  function filter(value: string) {
    setQuery(value);
    setLimit(pageSize);
  }
  return (
    <>
      <div className="recipe-filter">
        <label>
          {tr("Etsi nimellä tai aineksella", "Search by recipe or ingredient")}
          <input
            type="search"
            ref={search}
            value={query}
            onChange={(event) => filter(event.target.value)}
          />
        </label>
        {query && (
          <button
            className="text"
            onClick={() => {
              filter("");
              search.current?.focus();
            }}
          >
            {tr("Tyhjennä haku", "Clear search")}
          </button>
        )}
      </div>
      <p className="recipe-count muted" role="status">
        {matches.length === 0
          ? tr("Haulla ei löytynyt reseptejä.", "No matching recipes.")
          : count(
              matches.length,
              fi,
              ["resepti", "reseptiä"],
              ["recipe", "recipes"],
            )}
      </p>
      <div className="grid recipe-grid" ref={grid}>
        {matches.slice(0, limit).map((recipe) => (
          <article className="card" key={recipe.id}>
            <h2 tabIndex={-1}>{recipe.name}</h2>
            <p className="muted">
              {count(
                recipe.servings,
                fi,
                ["annos", "annosta"],
                ["serving", "servings"],
              )}
              {onList.has(recipe.id) && (
                <>
                  {" · "}
                  <span className="recipe-on-list">
                    {tr("Listalla", "On the list")}
                  </span>
                </>
              )}
            </p>
            <ul>
              {recipe.ingredients.map((item, index) => (
                <li key={index}>
                  {item.name} · {item.amount} {unitLabel(item.unit, language)}
                </li>
              ))}
            </ul>
            {recipe.instructions.trim() && (
              <details className="recipe-instructions">
                <summary>{tr("Valmistusohje", "Instructions")}</summary>
                <p>{recipe.instructions}</p>
              </details>
            )}
            <div className="actions">
              {onAdd && (
                <button
                  type="button"
                  disabled={busy}
                  aria-label={`${tr("Lisää ostoslistalle", "Add to shopping list")}: ${recipe.name}`}
                  onClick={() => onAdd(recipe)}
                >
                  {tr("Lisää ostoslistalle", "Add to shopping list")}
                </button>
              )}
              <button className="secondary" onClick={() => onEdit(recipe)}>
                {tr("Muokkaa", "Edit")}
              </button>
            </div>
          </article>
        ))}
      </div>
      {matches.length > limit && (
        <button
          className="secondary recipe-more"
          onClick={() => {
            setLimit(limit + pageSize);
            requestAnimationFrame(() =>
              grid.current?.children[limit]?.querySelector("h2")?.focus(),
            );
          }}
        >
          {tr("Näytä lisää reseptejä", "Show more recipes")} (
          {Math.min(pageSize, matches.length - limit)})
        </button>
      )}
    </>
  );
}
