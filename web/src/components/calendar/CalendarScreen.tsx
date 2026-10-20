"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeading } from "@/components/ui/PageHeading";
import { Radio } from "@/components/ui/Radio";
import { PickSet } from "@/components/ui/PickSet";
import { ControlField } from "@/components/ui/ControlField";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import { addMonths, monthEnd, monthLabel, monthStart } from "@/lib/dateRange";
import { daysAfter, daysBefore } from "@/lib/today";
import {
  CALENDAR_LAYERS,
  OPT_IN_LAYERS,
  WORKING_SHOP,
  entryItems,
  gridRange,
  itemsByDay,
  monthParam,
  resolveShops,
  shopsParam,
  visibleItems,
  type CalendarItem,
  type CalendarLayer,
} from "@/lib/calendar";
import type { CalendarEntry } from "@/lib/blackoutDates";
import { useStoredSet } from "@/lib/storedSet";
import { MonthView } from "@/components/calendar/MonthView";
import { MonthJump } from "@/components/calendar/MonthJump";
import { CalendarEventIcon, ExtrasMenu } from "@/components/catalog/ExtrasMenu";
import { ColorSwatches } from "@/components/calendar/ColorSwatches";
import { Dialog, DIALOG_CANCEL_CLASS } from "@/components/ui/Dialog";
import { createClient } from "@/lib/supabase/client";
import {
  BLACKOUT_CHIP,
  colorChip,
  layerColor,
  withLayerColor,
  type CalendarColor,
  type LayerColors,
} from "@/lib/calendarColors";
import { DayView } from "@/components/calendar/DayView";
import { DayJump } from "@/components/calendar/DayJump";
import { EntryDialog, type EntryLocation } from "@/components/calendar/EntryDialog";
import { ListView } from "@/components/calendar/ListView";

export type CalendarView = "month" | "day" | "list";

/** What the key calls a layer. Blackouts have their own, fixed, chip beside
 *  the entries', so that one is "Notes and events" here. */
function keyLabel(layer: { key: CalendarLayer; label: string }): string {
  return layer.key === "entries" ? "Notes and events" : layer.label;
}

/** Which dialog is open: an entry, or a new entry on a day. */
type Open =
  | { kind: "entry"; id: string }
  | { kind: "new"; date: string | null };

const NAV =
  "mac-control flex h-9 w-9 items-center justify-center border border-ink bg-white text-lg leading-none hover:bg-neutral-100 any-pointer-coarse:h-11 any-pointer-coarse:w-11";

/**
 * `/calendar` — the month, what is on it, and the entries typed here.
 *
 * The MONTH is in the URL and is the server's business: changing it is a
 * navigation, because every layer is fetched for the 42 days on screen (the
 * LIST view is the same month, its own days only, as one band per day). The
 * SHOP filter is in the URL too and is applied here, over what was fetched.
 * WHICH LAYERS SHOW is a display preference and lives in localStorage
 * (`docs/conventions.md`, "View state in the URL, display preferences in
 * localStorage").
 */
export function CalendarScreen({
  orgId,
  userId,
  view,
  month,
  date,
  today,
  entries,
  layerItems,
  layerFailures,
  calendars,
  layers,
  locations,
  shops,
  workingLocation,
  canWrite,
  canSetBlackouts,
  layerColors,
  orgSettings,
}: {
  orgId: string;
  userId: string;
  view: CalendarView;
  /** The first day of the month on screen. */
  month: string;
  /** The day the DAY view shows. Today when another view is on. */
  date: string;
  today: string;
  /** The entries touching what is on screen. */
  entries: CalendarEntry[];
  /** Every other layer's items for the grid, already built on the server. */
  layerItems: CalendarItem[];
  /** A layer that could not be loaded, named — the rest still draw. */
  layerFailures: string[];
  /** The subscribed calendars, by name, so the eye can hide them one by one. */
  calendars: { id: string; name: string }[];
  /** The layers this person may see — the menu offers these and no others. */
  layers: CalendarLayer[];
  locations: EntryLocation[];
  /** The Shops picker's value, from `?shops=` (`parseShopsParam`): shop ids,
   *  and `WORKING_SHOP` for "whichever shop I am working at". Empty is all. */
  shops: string[];
  /** The shop being worked at, which `WORKING_SHOP` resolves to. */
  workingLocation: { id: string; code: string } | null;
  canWrite: boolean;
  canSetBlackouts: boolean;
  /** The organisation's colour per layer, from `orgs.settings`. */
  layerColors: LayerColors;
  /**
   * The whole of `orgs.settings`, for a manager, so a layer's colour can be
   * written back into it; NULL for everyone else, which is also what makes the
   * key's chips plain labels instead of buttons. 001's `org_update` policy is
   * owner/admin and would refuse the write regardless.
   */
  orgSettings: Record<string, unknown> | null;
}) {
  const router = useRouter();
  // Shown the moment it is picked; the server's copy arrives with the refresh.
  const [colors, setColors] = useState<LayerColors>(layerColors);
  const [recolouring, setRecolouring] = useState<CalendarLayer | null>(null);
  const [colourError, setColourError] = useState<string | null>(null);

  function setLayerColour(layer: CalendarLayer, color: CalendarColor) {
    if (!orgSettings) return;
    const before = colors;
    setColourError(null);
    setColors({ ...colors, [layer]: color });
    // The whole document, with this one key changed — how every other org
    // setting is written (`InlineValue`'s `jsonColumn`). Built from what the
    // screen has already saved, so two changes in a row both land.
    const base = Object.entries({ ...before, [layer]: color }).reduce(
      (doc, [l, c]) => withLayerColor(doc, l as CalendarLayer, c as CalendarColor),
      orgSettings,
    );
    void createClient()
      .from("orgs")
      .update({ settings: base })
      .eq("id", orgId)
      .select("id")
      .then(({ data, error }) => {
        if (error || !data?.length) {
          setColors(before);
          setColourError(error?.message ?? "The color was not saved — the database refused it.");
          return;
        }
        router.refresh();
      });
  }

  // THE FILTER ROW STICKS under the masthead (Mark, 2026-10-11), and publishes
  // its measured height so the list can scroll a day's band to just below it —
  // measured, because the row wraps to two lines on a narrow window.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const controlsRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const controls = controlsRef.current;
    const root = rootRef.current;
    if (!controls || !root) return;
    const publish = () =>
      root.style.setProperty("--rf-calendar-controls-h", `${controls.offsetHeight}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(controls);
    return () => observer.disconnect();
  }, []);

  /** List view's Today: scroll to today's band (`ListView` marks it). */
  function scrollToToday() {
    document
      .querySelector("[data-calendar-landing]")
      ?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  const [open, setOpen] = useState<Open | null>(null);
  const [shopFilter, setShopFilter] = useState<string[]>(shops);
  // Stored as the layers that are HIDDEN, so a layer added later shows by
  // default for everybody who has already chosen.
  const [hidden, setHidden] = useStoredSet("rf.calendar.hiddenLayers");
  // The OPT-IN layers (`OPT_IN_LAYERS`) are the other way round: hidden until
  // somebody turns one on, so what is stored is the ones that were.
  const [optedIn, setOptedIn] = useStoredSet("rf.calendar.shownLayers");
  // Subscribed calendars hidden ONE BY ONE, by id (Mark, 2026-10-10).
  const [hiddenFeeds, setHiddenFeeds] = useStoredSet("rf.calendar.hiddenFeeds");

  const offered = useMemo(
    () => CALENDAR_LAYERS.filter((l) => layers.includes(l.key)),
    [layers],
  );
  const hiddenSet = useMemo(() => {
    const set = new Set(hidden.filter((k) => layers.includes(k as CalendarLayer)) as CalendarLayer[]);
    for (const layer of OPT_IN_LAYERS) {
      if (layers.includes(layer) && !optedIn.includes(layer)) set.add(layer);
    }
    return set;
  }, [hidden, optedIn, layers]);

  const range = useMemo(
    () =>
      view === "day"
        ? { from: date, to: date }
        : view === "list"
          ? { from: month, to: monthEnd(month) }
          : gridRange(month),
    [view, date, month],
  );
  const days = useMemo(() => {
    const all = [...entryItems(entries, range, locations), ...layerItems];
    return itemsByDay(
      visibleItems(all, {
        hiddenLayers: hiddenSet,
        shops: resolveShops(shopFilter, workingLocation?.id ?? null),
        hiddenSources: hiddenFeeds,
      }),
    );
  }, [entries, layerItems, range, locations, hiddenSet, shopFilter, workingLocation, hiddenFeeds]);

  // THE LIST: the month's own days that have something on them, in order. The
  // menu plan is left out — it is on every day, so it would put a line under
  // each one and say nothing.
  const listDays = useMemo(
    () =>
      view !== "list"
        ? []
        : [...days.entries()]
            .map(([day, items]) => ({ date: day, items: items.filter((i) => i.layer !== "menu_plan") }))
            .filter((d) => d.date >= range.from && d.date <= range.to && d.items.length > 0)
            .sort((a, b) => a.date.localeCompare(b.date)),
    [view, days, range],
  );

  const shopCodes = useMemo(() => new Map(locations.map((l) => [l.id, l.code])), [locations]);
  const entryById = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);

  function href(next: {
    month?: string;
    date?: string;
    view?: CalendarView;
    shops?: string[];
  }): string {
    const params = new URLSearchParams();
    const v = next.view ?? view;
    if (v === "list") {
      params.set("view", "list");
      params.set("month", monthParam(next.month ?? month));
    } else if (v === "day") {
      params.set("view", "day");
      params.set("date", next.date ?? date);
    } else params.set("month", monthParam(next.month ?? month));
    const s = shopsParam(next.shops ?? shopFilter);
    if (s !== null) params.set("shops", s);
    return `/calendar?${params.toString()}`;
  }

  function goToMonth(next: string) {
    // Month and List both walk by month, and keep the view they are in.
    router.push(href({ month: next }));
  }

  function goToDay(next: string) {
    router.push(href({ view: "day", date: next }));
  }

  /** The radios. Day opens on today when today is in the month on screen, and
   *  on that month's first day otherwise; Month opens on the day's month. */
  function changeView(next: CalendarView) {
    if (next === "day") {
      goToDay(view === "day" ? date : monthStart(today) === month ? today : month);
    } else {
      router.push(href({ view: next, month: view === "day" ? monthStart(date) : month }));
    }
  }

  function changeShops(next: string[]) {
    setShopFilter(next);
    // A filter over what is already loaded: the URL follows without a fetch.
    window.history.replaceState(null, "", href({ shops: next }));
  }

  const count =
    view === "list"
      ? listDays.reduce((n, d) => n + d.items.length, 0)
      : [...days.values()].reduce((n, d) => n + d.length, 0);
  const openEntry = open?.kind === "entry" ? entryById.get(open.id) ?? null : null;

  return (
    <div ref={rootRef} className="space-y-5">
      <PageHeading
        title="Calendar"
        total={count}
        noun={
          view === "list"
            ? `in ${monthLabel(month)}`
            : view === "day"
              ? "on this day"
              : `on screen · ${monthLabel(month)}`
        }
        action={
          canWrite ? (
            <button
              type="button"
              onClick={() =>
                setOpen({
                  kind: "new",
                  date:
                    view === "day"
                      ? date
                      : monthStart(today) === month
                        ? today
                        : null,
                })
              }
              className={`${BUTTON_CLASS} ml-auto shrink-0`}
            >
              New entry
            </button>
          ) : null
        }
      />

      {/* PINNED: the filter row and the colour key under it (Mark, 2026-10-11). */}
      <div ref={controlsRef} className="sticky top-[var(--rf-header-h)] z-30 space-y-3 bg-white py-3">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          {view !== "day" && (
            <div className="flex items-center gap-2">
              <button type="button" aria-label="Previous month" onClick={() => goToMonth(addMonths(month, -1))} className={NAV}>
                ‹
              </button>
              <MonthJump month={month} today={today} onPick={goToMonth} />
              <button type="button" aria-label="Next month" onClick={() => goToMonth(addMonths(month, 1))} className={NAV}>
                ›
              </button>
              <button
                type="button"
                // In the list, in this month, Today is a scroll to today's band;
                // anywhere else it is the way back to this month.
                onClick={() =>
                  view === "list" && monthStart(today) === month
                    ? scrollToToday()
                    : goToMonth(monthStart(today))
                }
                disabled={view === "month" && monthStart(today) === month}
                className={BUTTON_CLASS}
              >
                Today
              </button>
            </div>
          )}
          {view === "day" && (
            <div className="flex items-center gap-2">
              <button type="button" aria-label="Previous day" onClick={() => goToDay(daysBefore(date, 1))} className={NAV}>
                ‹
              </button>
              <DayJump date={date} today={today} onPick={goToDay} />
              <button type="button" aria-label="Next day" onClick={() => goToDay(daysAfter(date, 1))} className={NAV}>
                ›
              </button>
              <button type="button" onClick={() => goToDay(today)} disabled={date === today} className={BUTTON_CLASS}>
                Today
              </button>
            </div>
          )}
          {/* LEFT TO RIGHT (Mark, 2026-10-10): the date and Today, then Shops,
              then View — the row's `gap-x-6` is the air between Today and Shops —
              and the layers' button alone at the far right, where a table's
              columns button sits. */}
          <ControlField label="Shops">
            <PickSet
              // "Working location" FIRST (Mark, 2026-10-10): the calendar
              // follows the shop you are standing in. The default is All
              // shops (Mark, 2026-10-11).
              options={[
                ...(workingLocation
                  ? [
                      {
                        value: WORKING_SHOP,
                        label: "Working location",
                        hint: workingLocation.code,
                        summary: `Working location (${workingLocation.code})`,
                      },
                    ]
                  : []),
                ...locations.map((l) => ({ value: l.id, label: l.code, hint: l.name })),
              ]}
              value={shopFilter}
              onChange={changeShops}
              allLabel="All shops"
              label="Which shops to show"
              noun="shops"
            />
          </ControlField>
          <ControlField label="View">
            <Radio<CalendarView>
              ariaLabel="View"
              value={view}
              onChange={changeView}
              options={[
                { value: "month", label: "Month" },
                { value: "day", label: "Day" },
                { value: "list", label: "List" },
              ]}
              // A button tall, so the radios sit on the pickers' baseline.
              className="h-9"
            />
          </ControlField>
          {offered.length > 1 && (
            // THE ORDERS LIST'S CALENDAR GLYPH (Mark, 2026-10-13; an eye before
            // that) — which of these to show. `catalog/ExtrasMenu`, the menu the orders list's
            // calendar button uses, so a layer and the calendars nested under
            // "Subscribed calendars" read the same on both screens. The key of
            // chips under this row is what says the answer.
            <div className="ml-auto">
              <ExtrasMenu
                extras={{
                  label: "What the calendar shows",
                  icon: <CalendarEventIcon />,
                  items: offered.flatMap((l) => {
                    const on = !hiddenSet.has(l.key);
                    const layer = {
                      key: l.key,
                      label: l.label,
                      on,
                      // An OPT-IN layer is stored as shown; the rest as hidden.
                      onToggle: (next: boolean) =>
                        OPT_IN_LAYERS.includes(l.key)
                          ? setOptedIn(next ? [...optedIn, l.key] : optedIn.filter((k) => k !== l.key))
                          : setHidden(next ? hidden.filter((k) => k !== l.key) : [...hidden, l.key]),
                    };
                    // Each subscribed calendar, nested — with two or more. With
                    // the layer off they are shown unticked and fixed: it is the
                    // layer that is hiding them.
                    if (l.key !== "feeds" || calendars.length < 2) return [layer];
                    return [
                      layer,
                      ...calendars.map((c) => ({
                        key: `feed:${c.id}`,
                        label: c.name,
                        nested: true,
                        disabled: !on,
                        on: on && !hiddenFeeds.includes(c.id),
                        onToggle: (next: boolean) =>
                          setHiddenFeeds(
                            next ? hiddenFeeds.filter((id) => id !== c.id) : [...hiddenFeeds, c.id],
                          ),
                      })),
                    ];
                  }),
                }}
              />
            </div>
          )}
        </div>

        {/* THE KEY to the colours: one chip per layer that is showing, in the
            menu's order, so the calendar never has to be decoded from memory. */}
        <ul aria-label="Colors" className="flex flex-wrap gap-x-2 gap-y-1 text-[11px] font-medium">
          {!hiddenSet.has("entries") && (
            <li className={`rounded-[4px] px-1.5 leading-[18px] ${BLACKOUT_CHIP}`}>Blackouts</li>
          )}
          {offered
            .filter((l) => !hiddenSet.has(l.key))
            .map((l) => (
              <li key={l.key}>
                {/* A manager presses a chip to change that layer's colour, for
                    everybody. For anyone else it is a label. */}
                {orgSettings ? (
                  <button
                    type="button"
                    onClick={() => setRecolouring(l.key)}
                    aria-label={`Change the color of ${keyLabel(l)}`}
                    className={`rounded-[4px] px-1.5 leading-[18px] hover:brightness-95 ${colorChip(layerColor(l.key, colors))}`}
                  >
                    {keyLabel(l)}
                  </button>
                ) : (
                  <span className={`block rounded-[4px] px-1.5 leading-[18px] ${colorChip(layerColor(l.key, colors))}`}>
                    {keyLabel(l)}
                  </span>
                )}
              </li>
            ))}
        </ul>
      </div>

      {layerFailures.length > 0 && (
        <p className="text-sm text-accent">Could not load: {layerFailures.join("; ")}</p>
      )}

      {view === "month" ? (
        <MonthView
          month={month}
          today={today}
          days={days}
          colors={colors}
          // A day opens in DAY view (Mark, 2026-10-10), which replaced the
          // pop-up panel: the same list, with room.
          onDay={goToDay}
          onEntry={(id) => setOpen({ kind: "entry", id })}
        />
      ) : view === "day" ? (
        <DayView
          items={days.get(date) ?? []}
          shopCodes={shopCodes}
          colors={colors}
          onEntry={(id) => setOpen({ kind: "entry", id })}
        />
      ) : (
        <ListView
          days={listDays}
          today={today}
          shopCodes={shopCodes}
          colors={colors}
          onDay={goToDay}
          onEntry={(id) => setOpen({ kind: "entry", id })}
        />
      )}

      {colourError && <p className="text-sm text-accent">{colourError}</p>}
      {recolouring && (
        <Dialog
          title={`Color for ${keyLabel(CALENDAR_LAYERS.find((l) => l.key === recolouring)!)}`}
          onClose={() => setRecolouring(null)}
          width="max-w-lg"
          footer={
            <button type="button" onClick={() => setRecolouring(null)} className={DIALOG_CANCEL_CLASS}>
              Done
            </button>
          }
        >
          <div className="space-y-4">
            <ColorSwatches
              value={layerColor(recolouring, colors)}
              onChange={(next) => next && setLayerColour(recolouring, next)}
              ariaLabel="Color"
              name="layer-colour"
            />
            <p className="text-sm text-muted">Everyone in the organization sees this color.</p>
          </div>
        </Dialog>
      )}

      {open?.kind === "new" && (
        <EntryDialog
          orgId={orgId}
          userId={userId}
          locations={locations}
          initialDate={open.date}
          canWrite={canWrite}
          canSetBlackouts={canSetBlackouts}
          onClose={() => setOpen(null)}
        />
      )}
      {openEntry && (
        <EntryDialog
          key={openEntry.id}
          orgId={orgId}
          userId={userId}
          locations={locations}
          entry={openEntry}
          canWrite={canWrite}
          canSetBlackouts={canSetBlackouts}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}
