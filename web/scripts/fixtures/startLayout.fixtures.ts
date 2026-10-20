// The desk start page's widget layout (migration 207, `lib/startLayout`).

import { eq, no, ok, test } from "./harness";
import {
  addableKinds,
  DEFAULT_LAYOUT,
  readStartLayout,
  sameKinds,
  tileDropTarget,
  tintFill,
  visibleWidgets,
  withMove,
  withSpan,
  withStep,
  withWidget,
  withoutWidget,
  WIDGET_KINDS,
  type StartLayout,
  type WidgetAccess,
} from "../../src/lib/startLayout";

const kinds = (l: StartLayout) => l.widgets.map((w) => w.kind);
const all: WidgetAccess = Object.fromEntries(WIDGET_KINDS.map((k) => [k, true])) as WidgetAccess;

// --- readStartLayout ---------------------------------------------------------

test("startLayout: null, garbage and the wrong version all give the default", () => {
  for (const raw of [null, undefined, 3, "x", [], {}, { version: 2, widgets: [] }, { version: 1, widgets: "no" }]) {
    eq(readStartLayout(raw), DEFAULT_LAYOUT, JSON.stringify(raw));
  }
});

test("startLayout: the default is the pre-widget page, with Today and Calendar left to add", () => {
  eq(kinds(DEFAULT_LAYOUT), [
    "reminders", "sales", "bills", "purchase_orders", "special_orders", "invoices", "shift_reports", "paperwork",
  ]);
  eq(DEFAULT_LAYOUT.widgets.map((w) => w.span), [3, 3, 1, 1, 1, 1, 1, 1]);
  eq(addableKinds(DEFAULT_LAYOUT, all), ["calendar", "today"]);
});

test("startLayout: unknown kinds and second copies are dropped, order kept", () => {
  const l = readStartLayout({
    version: 1,
    widgets: [{ kind: "bills", span: 1 }, { kind: "weather", span: 2 }, { kind: "sales", span: 3 }, { kind: "bills", span: 3 }, "x"],
  });
  eq(kinds(l), ["bills", "sales"]);
  eq(l.widgets[0].span, 1, "the FIRST bills wins");
});

test("startLayout: spans clamp to 1–3; a missing span takes the widget's own", () => {
  const l = readStartLayout({
    version: 1,
    widgets: [{ kind: "bills", span: 9 }, { kind: "sales", span: 0 }, { kind: "today", span: 2.4 }, { kind: "reminders" }],
  });
  eq(l.widgets.map((w) => w.span), [3, 1, 2, 3]);
});

test("startLayout: an unknown tint or day count is forgotten; days only on Calendar", () => {
  const l = readStartLayout({
    version: 1,
    widgets: [
      { kind: "bills", span: 1, tint: "red" },
      { kind: "sales", span: 3, tint: "sky", days: 7 },
      { kind: "calendar", span: 1, days: 30 },
      { kind: "today", span: 1 },
    ],
  });
  eq(l.widgets[0].tint, null, "red is a state colour, not a tint");
  eq(l.widgets[1].tint, "sky");
  no("days" in l.widgets[1], "days on Sales");
  eq(l.widgets[2].days, 30);
  eq(readStartLayout({ version: 1, widgets: [{ kind: "calendar", span: 1, days: 9 }] }).widgets[0].days, undefined);
});

test("startLayout: an empty list is kept, not replaced by the default", () => {
  eq(kinds(readStartLayout({ version: 1, widgets: [] })), []);
});

test("startLayout: tintFill is the tint's class, or white", () => {
  eq(tintFill(null), "bg-white");
  eq(tintFill("lilac"), "bg-violet-100");
});

// --- who sees what -----------------------------------------------------------

test("startLayout: a widget the role can't open is hidden but stays in the layout", () => {
  const may = { ...all, paperwork: false, bills: false };
  eq(kinds({ version: 1, widgets: visibleWidgets(DEFAULT_LAYOUT, may) }), [
    "reminders", "sales", "purchase_orders", "special_orders", "invoices", "shift_reports",
  ]);
  ok(kinds(DEFAULT_LAYOUT).includes("paperwork"), "still stored");
  eq(addableKinds(withoutWidget(DEFAULT_LAYOUT, "paperwork"), may), ["calendar", "today"], "nor offered to add");
});

test("startLayout: sameKinds ignores order, width and tint", () => {
  const moved = withSpan(withMove(DEFAULT_LAYOUT, "sales", { before: "reminders" }), "bills", 3);
  ok(sameKinds(DEFAULT_LAYOUT, moved));
  no(sameKinds(DEFAULT_LAYOUT, withWidget(DEFAULT_LAYOUT, "today")));
  no(sameKinds(DEFAULT_LAYOUT, withoutWidget(DEFAULT_LAYOUT, "bills")));
});

// --- edits -------------------------------------------------------------------

test("startLayout: add goes to the end at the widget's own width, once", () => {
  const l = withWidget(DEFAULT_LAYOUT, "today");
  eq(kinds(l).at(-1), "today");
  eq(l.widgets.at(-1)!.span, 2);
  eq(withWidget(l, "today"), l, "already placed");
});

test("startLayout: a move carries the widget's width and tint with it", () => {
  const l = withMove({ version: 1, widgets: [
    { kind: "bills", span: 2, tint: "sky" },
    { kind: "sales", span: 3, tint: null },
  ] }, "bills", { after: "sales" });
  eq(l.widgets, [{ kind: "sales", span: 3, tint: null }, { kind: "bills", span: 2, tint: "sky" }]);
});

test("startLayout: Move earlier/later steps over hidden widgets, and is a no-op at the ends", () => {
  const l: StartLayout = { version: 1, widgets: (["bills", "paperwork", "sales"] as const).map((kind) => ({ kind, span: 1, tint: null })) };
  const visible = ["bills", "sales"] as const;
  eq(kinds(withStep(l, "sales", -1, visible)), ["sales", "bills", "paperwork"], "one press moves past what you can see");
  eq(withStep(l, "bills", -1, visible), l);
  eq(withStep(l, "sales", 1, visible), l);
});

// --- tileDropTarget ----------------------------------------------------------

// Two rows: bills | sales (top), today spanning (bottom).
const rects = [
  { kind: "bills" as const, left: 0, top: 0, right: 100, bottom: 100 },
  { kind: "sales" as const, left: 120, top: 0, right: 220, bottom: 100 },
  { kind: "today" as const, left: 0, top: 120, right: 220, bottom: 220 },
];

test("tileDropTarget: the left half drops before, the right half after", () => {
  eq(tileDropTarget(rects, 130, 50, "today"), { before: "sales" });
  eq(tileDropTarget(rects, 210, 50, "today"), { after: "sales" });
  eq(tileDropTarget(rects, 20, 200, "bills"), { before: "today" });
});

test("tileDropTarget: in a gap it takes the nearest tile; over itself it is null", () => {
  eq(tileDropTarget(rects, 110, 50, "today"), { after: "bills" }, "the gutter between bills and sales, nearer bills");
  eq(tileDropTarget(rects, 40, 110, "sales"), { before: "bills" }, "the gutter between rows, equidistant — first measured wins");
  eq(tileDropTarget(rects, 50, 50, "bills"), null);
  eq(tileDropTarget([], 50, 50, "bills"), null);
});
