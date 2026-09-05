/**
 * The org settings screen's sections (Mark, 2026-09-05: "break it up into
 * different tabs, with the tabpick being vertical like we do on other pages").
 * `ui/SectionNav`'s pattern, the employee record's: the tab in the URL, the
 * default writing no parameter so the screen keeps one canonical address, and
 * anything unrecognised falling back to the first tab rather than an error.
 */
export type SettingsTab = "general" | "messages" | "accounting";

export const SETTINGS_TABS: SettingsTab[] = ["general", "messages", "accounting"];

export const SETTINGS_TAB_LABEL: Record<SettingsTab, string> = {
  general: "General",
  messages: "Messages",
  accounting: "Accounting",
};

export function parseSettingsTab(raw: string | string[] | undefined): SettingsTab {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (SETTINGS_TABS as string[]).includes(value ?? "") ? (value as SettingsTab) : "general";
}

export function settingsTabHref(tab: SettingsTab): string {
  return tab === "general" ? "/settings" : `/settings?tab=${tab}`;
}
