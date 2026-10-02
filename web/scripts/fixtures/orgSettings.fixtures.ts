// The org settings screen's tab helpers — `lib/orgSettings`. The vendor and
// employee records' rules, pinned so the third copy cannot drift.

import { test, eq, ok } from "./harness";
import {
  SETTINGS_TABS,
  SETTINGS_TAB_LABEL,
  parseSettingsTab,
  settingsTabHref,
} from "../../src/lib/orgSettings";

test("an unrecognised settings tab shows General rather than an error", () => {
  eq(parseSettingsTab("messages"), "messages");
  eq(parseSettingsTab("accounting"), "accounting");
  eq(parseSettingsTab(undefined), "general", "no parameter");
  eq(parseSettingsTab("nonsense"), "general", "a stale bookmark");
  eq(parseSettingsTab(["accounting", "general"]), "accounting", "a repeated parameter takes the first");
});

test("the default tab writes no parameter, so /settings keeps one address", () => {
  eq(settingsTabHref("general"), "/settings");
  eq(settingsTabHref("messages"), "/settings?tab=messages");
  eq(settingsTabHref("accounting"), "/settings?tab=accounting");
  ok(SETTINGS_TABS.every((t) => SETTINGS_TAB_LABEL[t].length > 0), "every tab is labelled");
});

import { integrationsTabHref, parseIntegrationsTab } from "../../src/lib/orgSettings";

test("the Integrations tab's own tabs: QuickBooks by default, Square by parameter", () => {
  eq(parseIntegrationsTab(undefined), "quickbooks", "no parameter");
  eq(parseIntegrationsTab("square"), "square");
  eq(parseIntegrationsTab("bogus"), "quickbooks", "an unknown value falls back");
  eq(integrationsTabHref("quickbooks"), "/settings?tab=accounting", "the first writes no parameter");
  eq(integrationsTabHref("square"), "/settings?tab=accounting&integration=square");
});
