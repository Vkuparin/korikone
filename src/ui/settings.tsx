import React, { useEffect, useRef, useState } from "react";
import { Choice } from "./choice";
import {
  settingsSections,
  type SettingsProps,
  type SettingsSectionProps,
  type SettingsSection,
} from "./settings-contract";
import type { Key } from "./i18n";

export const sectionLabels: Record<SettingsSection, Key> = {
  general: "settingsGeneral",
  household: "settingsHousehold",
  stores: "settingsStores",
  ai: "settingsAI",
  data: "settingsData",
  advanced: "settingsAdvanced",
  about: "settingsAbout",
};

export function Settings({
  visible,
  activeSection,
  onSectionChange,
  sections,
  t,
}: SettingsProps) {
  const [visited, setVisited] = useState<SettingsSection[]>([]);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!visible) return;
    setVisited((current) =>
      current.includes(activeSection) ? current : [...current, activeSection],
    );
    const heading = root.current?.querySelector<HTMLElement>(
      `#settings-section-${activeSection}`,
    );
    heading?.focus({ preventScroll: true });
    if (
      heading &&
      (heading.getBoundingClientRect().top < 0 ||
        heading.getBoundingClientRect().bottom > innerHeight)
    )
      heading.scrollIntoView({ block: "nearest" });
  }, [visible, activeSection]);
  return (
    <div ref={root} hidden={!visible} className="settings-page">
      <h1>{t("settings")}</h1>
      <div className="settings-layout">
        <nav className="settings-navigation" aria-label={t("settingsCategory")}>
          {settingsSections.map((section) => (
            <button
              key={section}
              aria-current={activeSection === section ? "page" : undefined}
              onClick={() => onSectionChange(section)}
            >
              {t(sectionLabels[section])}
            </button>
          ))}
        </nav>
        <label className="settings-category">
          {t("settingsCategory")}
          <select
            value={activeSection}
            onChange={(e) => onSectionChange(e.target.value as SettingsSection)}
          >
            {settingsSections.map((section) => (
              <option key={section} value={section}>
                {t(sectionLabels[section])}
              </option>
            ))}
          </select>
        </label>
        <div className="settings-content">
          {settingsSections
            .filter(
              (section) =>
                visited.includes(section) ||
                (visible && section === activeSection),
            )
            .map((section) => (
              <section
                key={section}
                hidden={!visible || section !== activeSection}
                aria-labelledby={`settings-section-${section}`}
              >
                <h2 id={`settings-section-${section}`} tabIndex={-1}>
                  {t(sectionLabels[section])}
                </h2>
                {sections[section]}
              </section>
            ))}
        </div>
      </div>
    </div>
  );
}

/** Adopt restored committed values only where the user has not edited the old baseline. */
export function useSettingsDraft<T extends Record<string, string>>(
  committed: T,
) {
  const [draft, setDraft] = useState(committed);
  const baseline = useRef(committed);
  const key = JSON.stringify(committed);
  useEffect(() => {
    const previous = baseline.current;
    setDraft(
      (current) =>
        Object.fromEntries(
          Object.entries(committed).map(([name, value]) => [
            name,
            current[name] === previous[name] ? value : current[name],
          ]),
        ) as T,
    );
    baseline.current = committed;
  }, [key]);
  return [draft, setDraft] as const;
}

export function GeneralSettings({
  snapshot,
  t,
  changeLanguage,
  call,
}: SettingsSectionProps) {
  return (
    <div className="card form">
      <label>
        {t("appearance")}
        <select
          aria-label={t("appearance")}
          value={snapshot.state.appearance}
          onChange={(e) => void call("setAppearance", e.target.value)}
        >
          <option value="system">{t("appearanceSystem")}</option>
          <option value="light">{t("appearanceLight")}</option>
          <option value="dark">{t("appearanceDark")}</option>
        </select>
      </label>
      {snapshot.state.appearance === "system" && (
        <p role="status" data-testid="system-appearance" className="muted">
          {t("appearanceSystemCurrent")}:{" "}
          {t(
            document.documentElement.dataset.theme === "dark"
              ? "appearanceDark"
              : "appearanceLight",
          )}
        </p>
      )}
      <label>
        {t("language")}
        <Choice
          label={t("language")}
          value={snapshot.state.language}
          options={[
            { value: "fi", label: "Suomi" },
            { value: "en", label: "English" },
          ]}
          onChange={(value) => changeLanguage(value as "fi" | "en")}
        />
      </label>
    </div>
  );
}

export function HouseholdSettings({
  snapshot,
  busy,
  save,
  t,
  editStaples,
}: SettingsSectionProps) {
  const state = snapshot.state;
  const [draft, setDraft] = useSettingsDraft({
    servings: String(state.household.servings),
    budget: String(state.household.budget / 100),
    exclusions: state.household.exclusions,
  });
  const unapplied =
    Number(draft.servings) !== state.household.servings ||
    Math.round(Number(draft.budget.replace(",", ".")) * 100) !==
      state.household.budget ||
    draft.exclusions !== state.household.exclusions;
  return (
    <>
      <form
        className="card form"
        onSubmit={(e) => {
          e.preventDefault();
          void save({
            ...state,
            household: {
              servings: Number(draft.servings),
              budget: Math.round(Number(draft.budget.replace(",", ".")) * 100),
              exclusions: draft.exclusions,
            },
          });
        }}
      >
        <label>
          {t("servings")}
          <input
            name="servings"
            type="number"
            min="1"
            max="100"
            required
            value={draft.servings}
            onChange={(e) => setDraft({ ...draft, servings: e.target.value })}
          />
        </label>
        <label>
          {t("budget")}
          <input
            name="budget"
            inputMode="decimal"
            required
            value={draft.budget}
            onChange={(e) => setDraft({ ...draft, budget: e.target.value })}
          />
        </label>
        <label>
          {t("exclusions")}
          <textarea
            name="exclusions"
            value={draft.exclusions}
            onChange={(e) => setDraft({ ...draft, exclusions: e.target.value })}
          />
        </label>
        <p className="muted">{t("exclusionsHelp")}</p>
        {unapplied && (
          <p role="status" className="muted">
            {t("householdUnapplied")}
          </p>
        )}
        <button disabled={busy}>{t("save")}</button>
      </form>
      <section className="card">
        <h3>{t("staples")}</h3>
        <p className="muted">{t("staplesHelp")}</p>
        <button className="secondary" onClick={editStaples}>
          {t("editStaples")}
        </button>
      </section>
    </>
  );
}

export function AboutSettings({
  snapshot,
  appVersion,
  busy,
  call,
  t,
}: SettingsSectionProps) {
  const fi = snapshot.state.language === "fi";
  return (
    <section
      className="card"
      aria-label={fi ? "Tietoja Korikoneesta" : "About Korikone"}
    >
      <p>
        {fi ? "Versio" : "Version"}:{" "}
        <span data-testid="app-version">
          {appVersion || (fi ? "Ei saatavilla" : "Unavailable")}
        </span>
      </p>
      <div className="actions">
        <button
          className="secondary"
          disabled={busy}
          onClick={() => void call("openNotices")}
        >
          {t("openNotices")}
        </button>
        {snapshot.update && !snapshot.developmentMode && (
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void call("openRelease")}
          >
            {t("openRelease")}
          </button>
        )}
      </div>
    </section>
  );
}
