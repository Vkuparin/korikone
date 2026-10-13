import { expect, type Page } from "@playwright/test";

/** Plain onions now resolve automatically without an extra approval action. */
export async function approveFixtureOnion(page: Page) {
  const row = page.locator(".grocery-row").filter({ hasText: /sipuli/i });
  await expect(row).not.toHaveClass(/unresolved/);
  await expect(
    row.getByRole("button", { name: "Kotimaista sipuli 500 g", exact: true }),
  ).toBeVisible();
}
