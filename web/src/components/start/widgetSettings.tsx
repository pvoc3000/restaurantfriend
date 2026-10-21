"use client";

import { createContext, useContext } from "react";

import { DEFAULT_CALENDAR_DAYS, type CalendarDays, type Span } from "@/lib/startLayout";
import type { TileKey } from "@/lib/tablet/landing";

/**
 * A widget's own settings, handed DOWN by the grid to the body inside it. The
 * body is rendered on the server once per page load and the settings change in
 * the browser, so a body that must follow a setting without a round trip — the
 * Calendar's day count, the Actions widget's tiles — reads it here. Width does
 * not need this: CSS container queries already see the tile's real width.
 */
export type WidgetSettings = { span: Span; days: CalendarDays; actions: TileKey[] };

const WidgetSettingsContext = createContext<WidgetSettings>({ span: 1, days: DEFAULT_CALENDAR_DAYS, actions: [] });

export const WidgetSettingsProvider = WidgetSettingsContext.Provider;

export function useWidgetSettings(): WidgetSettings {
  return useContext(WidgetSettingsContext);
}
