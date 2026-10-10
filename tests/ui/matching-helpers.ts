import { expect, type Page } from "@playwright/test";

/** The observed generic onion label does not establish yellow onion. Approve it explicitly. */
export async function approveFixtureOnion(page: Page) {
  const row = page.locator(".grocery-row").filter({ hasText: /sipuli/i });
  await expect(row).toHaveClass(/unresolved/);
  await row.getByRole("button", { name: "Sipuli", exact: true }).click();
  await row
    .getByRole("button", {
      name: "Valitse tuote: Kotimaista sipuli 500 g",
      exact: true,
    })
    .click();
  await expect(row).not.toHaveClass(/unresolved/);
  await row
    .getByRole("button", { name: "Kotimaista sipuli 500 g", exact: true })
    .click();
}
