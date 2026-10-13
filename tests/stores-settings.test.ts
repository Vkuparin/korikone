import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { Service } from "../src/application/service";
import { en, fi, type Key } from "../src/ui/i18n";
import { AdvancedSettings, StoresSettings } from "../src/ui/settings-sections";
import type { SettingsSectionProps } from "../src/ui/settings-contract";
import { memoryStorage } from "./helpers/purchase-fixtures";

async function render(
  language: "fi" | "en",
  development: boolean,
  storeOpen = false,
) {
  const service = new Service(memoryStorage().storage);
  await service.init();
  await service.setLanguage(language);
  service.developmentMode = development;
  const dictionary = language === "fi" ? fi : en;
  const props: SettingsSectionProps = {
    snapshot: service.snapshot() as unknown as SettingsSectionProps["snapshot"],
    busy: false,
    call: async () => true,
    save: async () => true,
    t: (key: Key) => dictionary[key],
    changeLanguage: async () => {},
    storeOpen,
    returnToStore: () => {},
    editStaples: () => {},
    appVersion: "0.0.0",
    aiRequestLimit: false,
    developmentLocked: false,
  };
  return {
    stores: renderToStaticMarkup(createElement(StoresSettings, props)),
    advanced: renderToStaticMarkup(createElement(AdvancedSettings, props)),
  };
}

test.each([
  ["fi", "Kauppayhteys", "Kauppaketjut", "Hintaperuste", "Palaa kauppaan"],
  ["en", "Store connection", "Store chains", "Price basis", "Return to store"],
] as const)(
  "the Stores section shows each chain once with the price option and keeps the demo switches in development mode only (%s)",
  async (language, connection, chains, basis, back) => {
    const normal = await render(language, false, true);
    // One chain card per chain, with its own actions; no duplicate connection headings.
    expect(normal.stores.match(/data-chain-cue/g)).toHaveLength(2);
    expect(normal.stores).not.toContain(`<h3>${connection}</h3>`);
    expect(normal.stores).not.toContain(`<h3>${chains}</h3>`);
    expect(normal.stores).toContain(`aria-label="${chains}"`);
    expect(normal.stores).toContain(back);
    expect(normal.stores).toContain(basis);
    // Demo provider and fulfilment switches are absent outside development mode.
    expect(normal.stores).not.toContain("demo-k");
    expect(normal.stores).not.toContain("demo-s");
    expect(normal.advanced).not.toContain("demo-k");
    expect(normal.advanced).not.toContain("demo-s");

    const development = await render(language, true);
    expect(development.stores).not.toContain("demo-k");
    expect(development.advanced).toContain('value="demo-k"');
    expect(development.advanced).toContain('value="demo-s"');
    expect(development.advanced).toContain('value="pickup"');
    expect(development.advanced).toContain('value="delivery"');
  },
);
