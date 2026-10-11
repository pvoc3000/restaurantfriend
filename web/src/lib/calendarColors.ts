// THE CALENDAR'S COLOURS — a fixed palette, and which one a chip wears.
//
// Mark, 2026-10-10: "choose the colors of events ourselves, or override the
// default colors, or both". Both, from ONE palette:
//
//   1. an entry's own colour, or a subscribed calendar's own (migration 188);
//   2. the organisation's colour for the layer (`orgs.settings.calendar.colors`);
//   3. the layer's default, below.
//
// A PALETTE, NOT A COLOUR WELL. Each swatch is a fill and a type colour chosen
// together — a pale fill under dark type of the same hue — so every chip is
// legible whatever anybody picks, and two layers cannot be set to shades nobody
// can tell apart. It is also the only way Tailwind can ship the classes: it
// emits what it can see WRITTEN OUT, so every class below is a whole literal.
//
// ORGANISATION-WIDE, on purpose: "the orange ones are unpaid" only works across
// a counter if everybody's orange is the same.

import type { CalendarItem, CalendarLayer } from "./calendar";

export type CalendarColor =
  | "yellow"
  | "orange"
  | "red"
  | "pink"
  | "purple"
  | "indigo"
  | "sky"
  | "teal"
  | "green"
  | "lime"
  | "brown"
  | "slate";

export const CALENDAR_PALETTE: readonly {
  key: CalendarColor;
  label: string;
  /** The chip: fill and type together. */
  chip: string;
  /** A solid dot of the hue, for the picker. */
  swatch: string;
}[] = [
  { key: "yellow", label: "Yellow", chip: "bg-yellow-200 text-yellow-950", swatch: "bg-yellow-400" },
  { key: "orange", label: "Orange", chip: "bg-orange-100 text-orange-900", swatch: "bg-orange-400" },
  { key: "red", label: "Red", chip: "bg-red-100 text-red-900", swatch: "bg-red-400" },
  { key: "pink", label: "Pink", chip: "bg-pink-100 text-pink-900", swatch: "bg-pink-400" },
  { key: "purple", label: "Purple", chip: "bg-purple-100 text-purple-900", swatch: "bg-purple-400" },
  { key: "indigo", label: "Indigo", chip: "bg-indigo-100 text-indigo-900", swatch: "bg-indigo-400" },
  { key: "sky", label: "Sky blue", chip: "bg-sky-100 text-sky-900", swatch: "bg-sky-400" },
  { key: "teal", label: "Teal", chip: "bg-teal-100 text-teal-900", swatch: "bg-teal-400" },
  { key: "green", label: "Green", chip: "bg-green-100 text-green-900", swatch: "bg-green-500" },
  { key: "lime", label: "Lime", chip: "bg-lime-200 text-lime-950", swatch: "bg-lime-400" },
  { key: "brown", label: "Brown", chip: "bg-amber-200 text-amber-950", swatch: "bg-amber-700" },
  { key: "slate", label: "Grey", chip: "bg-slate-200 text-slate-800", swatch: "bg-slate-400" },
];

const BY_KEY = new Map(CALENDAR_PALETTE.map((c) => [c.key as string, c]));

/** A blackout: the one chip that is solid, and the one nobody can recolour. */
export const BLACKOUT_CHIP = "bg-neutral-800 text-white";

/** What each layer wears until the organisation says otherwise. */
export const DEFAULT_LAYER_COLOR: Record<CalendarLayer, CalendarColor> = {
  menu_plan: "teal",
  entries: "yellow",
  orders_paid: "green",
  orders_unpaid: "orange",
  standing_orders: "brown",
  deliveries: "sky",
  tasks: "purple",
  pay_periods: "slate",
  hr: "pink",
  hr_events: "red",
  feeds: "indigo",
};

/** layer → colour, as the organisation set it. Partial: unset layers default. */
export type LayerColors = Partial<Record<CalendarLayer, CalendarColor>>;

/** Is this a colour the palette has? Anything else is treated as not set. */
export function isCalendarColor(value: unknown): value is CalendarColor {
  return typeof value === "string" && BY_KEY.has(value);
}

/**
 * Read `orgs.settings.calendar.colors` defensively: a layer this build does
 * not know, or a colour the palette has dropped, is ignored rather than
 * trusted — settings are jsonb and outlive the code that wrote them.
 */
export function readLayerColors(settings: unknown): LayerColors {
  const raw = (settings as { calendar?: { colors?: unknown } } | null)?.calendar?.colors;
  if (!raw || typeof raw !== "object") return {};
  const out: LayerColors = {};
  for (const [layer, color] of Object.entries(raw as Record<string, unknown>)) {
    if (layer in DEFAULT_LAYER_COLOR && isCalendarColor(color)) {
      out[layer as CalendarLayer] = color;
    }
  }
  return out;
}

/**
 * `orgs.settings` with one layer's colour set — or, given the layer's default,
 * UNSET, so the stored map holds only real decisions and a later change to a
 * default reaches everybody who never chose.
 */
export function withLayerColor(
  settings: Record<string, unknown>,
  layer: CalendarLayer,
  color: CalendarColor,
): Record<string, unknown> {
  const calendar = { ...((settings.calendar as Record<string, unknown> | undefined) ?? {}) };
  const colors: Record<string, unknown> = { ...readLayerColors(settings) };
  if (color === DEFAULT_LAYER_COLOR[layer]) delete colors[layer];
  else colors[layer] = color;
  return { ...settings, calendar: { ...calendar, colors } };
}

/** The colour a layer wears: the organisation's, or the default. */
export function layerColor(layer: CalendarLayer, colors: LayerColors): CalendarColor {
  return colors[layer] ?? DEFAULT_LAYER_COLOR[layer];
}

/** A palette key's chip classes. An unknown key draws as grey, never as nothing. */
export function colorChip(color: CalendarColor | string): string {
  return (BY_KEY.get(color) ?? BY_KEY.get("slate")!).chip;
}

/**
 * The chip an item wears.
 *
 * A blackout is always dark. Otherwise the item's OWN colour wins (an entry's,
 * a subscribed calendar's), then the organisation's for its layer, then the
 * layer's default.
 */
export function chipClass(
  item: Pick<CalendarItem, "layer" | "blackout" | "color">,
  colors: LayerColors,
): string {
  if (item.blackout) return BLACKOUT_CHIP;
  return colorChip(isCalendarColor(item.color) ? item.color : layerColor(item.layer, colors));
}
