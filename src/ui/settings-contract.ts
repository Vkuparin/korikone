import type { ReactNode } from "react";
import type { Snapshot } from "../application/service";
import type { AppState } from "../domain/model";
import type { Key } from "./i18n";

export const settingsSections = [
  "general",
  "household",
  "stores",
  "ai",
  "data",
  "advanced",
  "about",
] as const;
export type SettingsSection = (typeof settingsSections)[number];

/** Parent ownership keeps a direct entry/return from recurring items in its section. */
export type SettingsProps = {
  visible: boolean;
  activeSection: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  sections: Record<SettingsSection, ReactNode>;
  t: (key: Key) => string;
};

/** Reuse App's real save/call wrappers, including translated error and busy handling. */
export type SettingsSectionProps = {
  snapshot: Snapshot;
  busy: boolean;
  call: (method: string, input?: unknown) => Promise<boolean>;
  save: (state: AppState) => Promise<boolean>;
  t: (key: Key) => string;
  changeLanguage: (language: "fi" | "en") => Promise<void>;
  editStaples: () => void;
  appVersion: string;
  aiRequestLimit: boolean;
  developmentLocked: boolean;
};
