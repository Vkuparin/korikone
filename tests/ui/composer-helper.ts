import type { Locator, Page } from "@playwright/test";

/** The shopping composer's label depends on its mode: create, edit the current list or new list. */
const composerLabel =
  /^(Mitä haluaisit valmistaa\?|What would you like to cook\?|Muokkaa nykyistä listaa|Edit current list|Uusi lista|New list)$/;

/** The one note/instruction textarea of the shopping workspace. */
export function composer(page: Page): Locator {
  return page.getByLabel(composerLabel);
}

/** The primary AI action in any composer mode. */
export const updateName =
  /^(Taio ostoslista|Taio muutokset|Create my shopping list|Update my shopping list)$/;

/**
 * Starts a new list through the one confirmation, so a test can plan from an empty workspace.
 * Without a list or text, or in the replacement-draft state, there is nothing to confirm.
 */
export async function startNewList(page: Page) {
  await composer(page).waitFor();
  const open = page.getByRole("button", { name: /^(Uusi lista|New list)$/ });
  if (!(await open.count())) return;
  await open.click();
  await page
    .getByRole("button", { name: /^(Aloita uusi lista|Start new list)$/ })
    .click();
  await page.getByRole("alertdialog").waitFor({ state: "detached" });
}
