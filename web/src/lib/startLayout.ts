// THE DESK START PAGE'S LAYOUT — which widgets, in what order, how wide, and
// what tint (Mark, 2026-10-17: "choose which modules to display and where to
// display them … make the widget 1 column, 2 columns, or 3 columns wide").
//
// PER PERSON, in the database (`org_members.start_layout`, migration 207), so
// it follows you between machines. One built-in default and no per-role
// defaults (Mark's choice); a person who never edits their page has NULL stored
// and follows `DEFAULT_LAYOUT` as it changes.
//
// Pure — fixture-tested in `scripts/fixtures/startLayout.fixtures.ts`.
// Everything that reads the stored value goes through `readStartLayout`, which
// is tolerant on purpose: the column outlives the code that wrote it, so a
// widget renamed or retired next year must cost its tile, not the page.

import { moveInOrder, type DropTarget } from "./moveInOrder";

export const WIDGET_KINDS = [
  "reminders",
  "sales",
  "bills",
  "purchase_orders",
  "special_orders",
  "invoices",
  "shift_reports",
  "paperwork",
  "calendar",
  "today",
] as const;

export type WidgetKind = (typeof WIDGET_KINDS)[number];

export type Span = 1 | 2 | 3;

/** Days ahead the Calendar widget lists. */
export const CALENDAR_DAYS = [7, 14, 30] as const;
export type CalendarDays = (typeof CALENDAR_DAYS)[number];

export type PlacedWidget = {
  kind: WidgetKind;
  span: Span;
  tint: TintKey | null;
  /** Calendar only. Absent = `DEFAULT_CALENDAR_DAYS`. */
  days?: CalendarDays;
};

export type StartLayout = { version: 1; widgets: PlacedWidget[] };

export const DEFAULT_CALENDAR_DAYS: CalendarDays = 14;

/** A widget's name, the list it opens, and the width it is added at. */
export const WIDGET_META: Record<WidgetKind, { title: string; href: string; span: Span }> = {
  reminders: { title: "Reminders", href: "/order-guide", span: 3 },
  sales: { title: "Sales", href: "/sales", span: 3 },
  bills: { title: "Bills", href: "/bills", span: 1 },
  purchase_orders: { title: "Purchase orders", href: "/purchase-orders", span: 1 },
  special_orders: { title: "Special orders", href: "/special-orders", span: 1 },
  invoices: { title: "Invoices", href: "/customer-invoices", span: 1 },
  shift_reports: { title: "Shift reports", href: "/shift-reports", span: 1 },
  paperwork: { title: "Employee paperwork", href: "/employees", span: 1 },
  calendar: { title: "Calendar", href: "/calendar", span: 1 },
  today: { title: "Today", href: "/calendar?view=day", span: 2 },
};

/**
 * THE DEFAULT IS THE PAGE AS IT WAS before widgets (2026-09-17): the guide's
 * two bands, sales across the top, then the six cards. Today and Calendar are
 * NEW, so they start in the Add list rather than changing everybody's page the
 * day this ships.
 */
export const DEFAULT_LAYOUT: StartLayout = {
  version: 1,
  widgets: (
    ["reminders", "sales", "bills", "purchase_orders", "special_orders", "invoices", "shift_reports", "paperwork"] as const
  ).map((kind) => ({ kind, span: WIDGET_META[kind].span, tint: null })),
};

// ---------------------------------------------------------------------------
// Tints
// ---------------------------------------------------------------------------

/**
 * THE ONE SANCTIONED DECORATIVE COLOR IN THE APP. The design system's rule is
 * that color is a record's STATE, never decoration — which is why the heart
 * and the star are black and the sales chart has no hue. A widget's tint is a
 * label its owner chose, so it must never be mistaken for a state: these are
 * pale NEUTRALS and cool tints only. No green, red, yellow or orange — those
 * are the go / stop / mark / submitted fills — and nothing a count badge's
 * yellow would vanish against.
 *
 * A PALETTE, NOT A COLOR WELL, as `lib/calendarColors` argues: every class is
 * a whole literal so Tailwind ships it.
 */
export type TintKey = "grey" | "stone" | "slate" | "sky" | "lilac";

export const START_TINTS: readonly { key: TintKey; label: string; fill: string }[] = [
  { key: "grey", label: "Grey", fill: "bg-neutral-100" },
  { key: "stone", label: "Stone", fill: "bg-stone-200" },
  { key: "slate", label: "Slate", fill: "bg-slate-200" },
  { key: "sky", label: "Sky", fill: "bg-sky-100" },
  { key: "lilac", label: "Lilac", fill: "bg-violet-100" },
];

const TINT_FILL = new Map<string, string>(START_TINTS.map((t) => [t.key, t.fill]));

/** The background a widget wears: its tint, or white. */
export function tintFill(tint: TintKey | null): string {
  return (tint && TINT_FILL.get(tint)) || "bg-white";
}

// ---------------------------------------------------------------------------
// Reading what was stored
// ---------------------------------------------------------------------------

const KIND_SET = new Set<string>(WIDGET_KINDS);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * The stored layout, or the default. NULL (never edited) and anything that
 * isn't a version-1 object give the default; inside one, an unknown kind or a
 * second copy of a kind is dropped, a span is clamped to 1–3, an unknown tint
 * or day count is forgotten. An EMPTY widget list is kept — a person may
 * remove everything, and the page then says how to add one back.
 */
export function readStartLayout(raw: unknown): StartLayout {
  if (!isRecord(raw) || raw.version !== 1 || !Array.isArray(raw.widgets)) return DEFAULT_LAYOUT;
  const seen = new Set<string>();
  const widgets: PlacedWidget[] = [];
  for (const w of raw.widgets) {
    if (!isRecord(w) || typeof w.kind !== "string" || !KIND_SET.has(w.kind) || seen.has(w.kind)) continue;
    seen.add(w.kind);
    const kind = w.kind as WidgetKind;
    const span = typeof w.span === "number" && Number.isFinite(w.span) ? clampSpan(w.span) : WIDGET_META[kind].span;
    const tint = typeof w.tint === "string" && TINT_FILL.has(w.tint) ? (w.tint as TintKey) : null;
    const placed: PlacedWidget = { kind, span, tint };
    if (kind === "calendar" && (CALENDAR_DAYS as readonly unknown[]).includes(w.days)) {
      placed.days = w.days as CalendarDays;
    }
    widgets.push(placed);
  }
  return { version: 1, widgets };
}

function clampSpan(n: number): Span {
  return Math.min(3, Math.max(1, Math.round(n))) as Span;
}

// ---------------------------------------------------------------------------
// Who sees what
// ---------------------------------------------------------------------------

/** Which widgets this person's role may open — the page's `may` gate. */
export type WidgetAccess = Record<WidgetKind, boolean>;

/**
 * The widgets to draw: the layout's, in order, less any the role may not open.
 * HIDDEN, NOT DELETED — the stored layout keeps them, so a role that comes back
 * brings its widgets back where they were.
 */
export function visibleWidgets(layout: StartLayout, may: WidgetAccess): PlacedWidget[] {
  return layout.widgets.filter((w) => may[w.kind]);
}

/** What the Add menu offers: widgets the role may open that aren't placed. */
export function addableKinds(layout: StartLayout, may: WidgetAccess): WidgetKind[] {
  const placed = new Set(layout.widgets.map((w) => w.kind));
  return WIDGET_KINDS.filter((k) => may[k] && !placed.has(k));
}

// ---------------------------------------------------------------------------
// Edits — each returns a new layout and leaves the input alone
// ---------------------------------------------------------------------------

function mapWidget(layout: StartLayout, kind: WidgetKind, f: (w: PlacedWidget) => PlacedWidget): StartLayout {
  return { version: 1, widgets: layout.widgets.map((w) => (w.kind === kind ? f(w) : w)) };
}

export function withSpan(layout: StartLayout, kind: WidgetKind, span: Span): StartLayout {
  return mapWidget(layout, kind, (w) => ({ ...w, span }));
}

export function withTint(layout: StartLayout, kind: WidgetKind, tint: TintKey | null): StartLayout {
  return mapWidget(layout, kind, (w) => ({ ...w, tint }));
}

export function withDays(layout: StartLayout, kind: WidgetKind, days: CalendarDays): StartLayout {
  return mapWidget(layout, kind, (w) => ({ ...w, days }));
}

export function withoutWidget(layout: StartLayout, kind: WidgetKind): StartLayout {
  return { version: 1, widgets: layout.widgets.filter((w) => w.kind !== kind) };
}

/** Add at the END, at the widget's own width. Already placed is a no-op. */
export function withWidget(layout: StartLayout, kind: WidgetKind): StartLayout {
  if (layout.widgets.some((w) => w.kind === kind)) return layout;
  return { version: 1, widgets: [...layout.widgets, { kind, span: WIDGET_META[kind].span, tint: null }] };
}

/** A drag's drop, through the app's one reorder splice. */
export function withMove(layout: StartLayout, kind: WidgetKind, target: DropTarget): StartLayout {
  const byKind = new Map(layout.widgets.map((w) => [w.kind as string, w]));
  const order = moveInOrder(
    layout.widgets.map((w) => w.kind),
    kind,
    target,
  );
  return { version: 1, widgets: order.map((k) => byKind.get(k)!) };
}

/**
 * Move earlier / Move later — the keyboard's way to do what a drag does. Steps
 * over widgets the person can't see (`visible`), so one press always moves the
 * tile on screen; at either end it is a no-op.
 */
export function withStep(
  layout: StartLayout,
  kind: WidgetKind,
  step: -1 | 1,
  visible: readonly WidgetKind[],
): StartLayout {
  const at = visible.indexOf(kind);
  const neighbour = visible[at + step];
  if (at === -1 || neighbour === undefined) return layout;
  return withMove(layout, kind, step === -1 ? { before: neighbour } : { after: neighbour });
}

// ---------------------------------------------------------------------------
// Where a drag lands
// ---------------------------------------------------------------------------

export type TileRect = { kind: WidgetKind; left: number; top: number; right: number; bottom: number };

/**
 * The drop target for a pointer at (x, y) over the grid's tiles, measured once
 * at pointer-down. The tile under the pointer — or, in a gap between tiles, the
 * nearest one — and which half of it: the left half drops BEFORE it, the right
 * half AFTER. Reading order is left to right, then down, so "after the last
 * tile in a row" and "before the first in the next" are the same place.
 *
 * Null over the dragged tile itself, or when nothing is measured: a drop there
 * changes nothing.
 */
export function tileDropTarget(rects: readonly TileRect[], x: number, y: number, dragKind: WidgetKind): DropTarget | null {
  let best: TileRect | null = null;
  let bestDistance = Infinity;
  for (const r of rects) {
    const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
    const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
    const d = dx * dx + dy * dy;
    if (d < bestDistance) {
      best = r;
      bestDistance = d;
    }
  }
  if (!best || best.kind === dragKind) return null;
  return x < (best.left + best.right) / 2 ? { before: best.kind } : { after: best.kind };
}
