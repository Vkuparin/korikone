import type { Page } from "@playwright/test";

export async function settingsCategory(
  page: Page,
  value: string,
  label: string,
) {
  const settings = page.locator(".settings-page");
  const select = settings.locator(".settings-category select");
  if (await select.isVisible()) await select.selectOption(value);
  else
    await settings
      .getByRole("navigation")
      .getByRole("button", { name: label, exact: true })
      .click();
}
