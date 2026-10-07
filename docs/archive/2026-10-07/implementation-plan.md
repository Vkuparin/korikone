# Korikone implementation plan

This plan builds the system described in [design.md](design.md). Each phase ends with something usable, so the project can stop after any of them and still be worth having.

Stack: Python 3.12+, `uv` for the environment, Typer for the CLI, Pydantic for models, PyYAML, the standard-library `sqlite3`, Playwright for the browser, `pytest` and `ruff`.

## Overview

| Phase | Result | Touches the store? |
|---|---|---|
| 0. Decide and spike | Store chosen, adapter approach known | Read-only, by hand |
| 1. Household data | Recipes, staples and known products on file | Order history import |
| 2. Planner | Menu message becomes a shopping list | No |
| 3. Matcher | Shopping list becomes a priced basket | Read-only search |
| 4. Cart fill and review | Basket lands in the cart, verified, with a diff | Cart changes |
| 5. Weekly use | Agent skill, real runs, fixes | Yes |
| 6. Offers | Menu suggestions from current offers | Read-only |

Phases 2 and 3 already save time on their own: after phase 2 you have a merged shopping list, and after phase 3 you have a priced one.

## Phase 0: Decide and spike

1. Price a typical week by hand at S-kaupat and K-Ruoka, including delivery or pickup fees. Pick one.
2. Create a dedicated browser profile and log in to the chosen store.
3. Spike with Playwright against that profile, in a throwaway script:
   - search for a product and read name, price, unit price and pack size
   - read the cart
   - add one item and remove it again
   - find where past orders are listed
4. Note whether the site's own JSON responses are usable or whether the visible page has to be read.
5. Answer the open questions in the design document and update it.

**Done when** the store is chosen and each `Store` method has a known way to be implemented, or the cart part is known to be infeasible. If it is infeasible, phases 1 to 3 still go ahead and phase 4 becomes "print the list in aisle order".

## Phase 1: Project skeleton and household data

1. `git init`, `pyproject.toml`, `ruff` and `pytest` configured, `.gitignore` covering `data/`, `runs/` and the browser profile.
2. `models.py`: week, recipe, list item, product, cart, order.
3. `db.py`: create tables on first run.
4. `store/base.py` with the interface and `store/fake.py` with an in-memory store.
5. Real adapter: `order_history()` only. `korikone history import` fills `orders`, `order_lines` and `products`.
6. A one-off helper that drafts `staples.yaml` and `ingredients.yaml` from the history: items bought in most orders become staples with a cadence, and repeatedly bought products become accepted products.
7. Edit those drafts by hand. Write `recipes.yaml` for the 15 to 20 most common dishes; the agent can draft these from dish names for you to correct.
8. Commit `data.example/` with a few fake entries.

**Done when** the three YAML files exist for the real household and load without validation errors.

## Phase 2: Planner

1. Load and validate the week file, recipes and staples.
2. Expand meals to ingredients, merge duplicates, add due staples and extras, remove skips.
3. `korikone plan <week>` writes `list.json` and prints a readable summary.
4. Unknown recipe names are an error that lists the unknown names, so the agent knows what to ask.
5. Unit tests: merging, staple cadence at the boundaries, skips, extras, the over-10-units guard.

**Done when** a real week's menu gives a list you would have written yourself.

## Phase 3: Matcher

1. Real adapter: `search()` and `get_product()`. Each lookup is written to `price_log`.
2. Matching per item by policy: `cheapest` among accepted products, `pinned`, or `ask`.
3. Pack arithmetic: number of packs to cover the needed amount, respecting `max_pack`.
4. Items without an accepted product return the top candidates by unit price.
5. `korikone pin` to accept a candidate.
6. `korikone match <week>` writes `basket.json` with an estimated total and the list of unresolved items.
7. Unit tests against the fake store: policy selection, pack rounding, unavailable product fallback, unresolved items.
8. Save two or three real pages or responses as fixtures and test the adapter's parsing against them.

**Done when** a real week produces a basket where at least nine items in ten are resolved without the agent choosing anything.

## Phase 4: Cart fill and review

1. Real adapter: `get_cart()`, `add()`, `set_quantity()`, `remove()`. Block checkout URLs in the browser context.
2. `korikone fill <week>`: stop if the cart is not empty, add each line with human-speed pacing, save the page to `runs/<week>/debug/` on any failure.
3. `--dry-run` runs the same code against the fake store.
4. `korikone review <week>`: read the cart, compare with `basket.json`, compare with the previous order, write `review.md`:
   - mismatches between cart and plan, first
   - total against budget
   - added, removed and changed lines compared with last week
   - open questions (unavailable pinned products, unresolved items)
5. Unit tests for the comparison logic with hand-built carts.
6. First real fill, watched in a visible browser window.

**Done when** a real basket is in the cart, the review reports no mismatches, and you have checked the cart by eye once to confirm the review is telling the truth.

## Phase 5: Weekly use

1. Write the agent skill in `skill/`: the order of commands, when to ask you, what to show at the end, and the rule that it never opens checkout.
2. Run it for real for three or four weeks. Keep a short `docs/notes.md` of what went wrong.
3. Fix what the notes show. Likely candidates: recipe quantities, staple cadences, products that should be pinned, weight-priced produce, multi-buy offers.
4. After you check out, mark the run as ordered so the next week's diff and staple cadences use it.

**Done when** a weekly run takes one message and one cart review, and you have stopped double-checking every line.

## Phase 6: Offers

1. `korikone offers`: current offers on accepted products, from `price_log` and a search per ingredient group.
2. Agent skill addition: before you write the menu, suggest dishes from the recipe file whose main ingredients are on offer, and dishes that share perishable ingredients.
3. Report savings only against a stated baseline: this week's price for a product against its own median in `price_log`.

**Done when** the suggestions have changed your menu at least once.

## Later, if wanted

- MCP wrapper around the CLI for agents that prefer tools to shell commands.
- Hermes or a local model as the agent, with a chat channel for the weekly message.
- A second store adapter for price comparison.
- Substitution preferences written into the store's own per-product settings.

## Working agreements

- One phase per branch or a run of small commits on `main`; no pull request process.
- `ruff check`, `ruff format` and `pytest` pass before a commit.
- Tests never touch the real store. Anything that does is run by hand.
- The fake store is kept in step with the interface so dry runs stay trustworthy.
- If a store-facing task takes more than two evenings of fighting the site, stop and fall back to the simpler path noted in phase 0.
