import type { Locator, Page } from "@playwright/test";

/** The shopping composer's label depends on its mode: create, edit the current list or new list. */
const composerLabel =
  /^(Mitä haluaisit valmistaa\?|What would you like to cook\?|Muokkaa nykyistä listaa|Edit current list|Uusi lista|New list)$/;

/** The one note/instruction textarea of the shopping workspace. */
export function composer(page: Page): Locator {
  return page.getByLabel(composerLabel);
}

/** The explicit Update button in any composer mode. */
export const updateName =
  /^(Päivitä lista|Update list|Luo uusi lista|Create new list)$/;

/**
 * Opens the replacement draft when a list exists, so a test can plan over a saved list through
 * the New list path. Without a list, or already in the draft, it does nothing.
 */
export async function startNewList(page: Page) {
  await composer(page).waitFor();
  const open = page.getByRole("button", { name: /^(Uusi lista|New list)$/ });
  if (await open.count()) await open.click();
}
