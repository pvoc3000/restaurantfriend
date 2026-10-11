"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeading } from "@/components/ui/PageHeading";
import { Radio } from "@/components/ui/Radio";
import { PickSet } from "@/components/ui/PickSet";
import { ControlField } from "@/components/ui/ControlField";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import { addMonths, monthLabel, monthStart } from "@/lib/dateRange";
import { daysAfter, daysBefore } from "@/lib/today";
import {
  CALENDAR_LAYERS,
  OPT_IN_LAYERS,
  entryItems,
  gridRange,
  itemsByDay,
  monthParam,
  visibleItems,
  type CalendarItem,
  type CalendarLayer,
} from "@/lib/calendar";
import type { CalendarEntry } from "@/lib/blackoutDates";
import { useStoredSet } from "@/lib/storedSet";
import { MonthView } from "@/components/calendar/MonthView";
import { MonthJump } from "@/components/calendar/MonthJump";
import { ColumnsIcon } from "@/components/catalog/ColumnsMenu";
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
import { EntriesList } from "@/components/calendar/EntriesList";

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
 * navigation, because every layer is fetched for the 42 days on screen. The
 * SHOP filter is in the URL too and is applied here, over what was fetched.
 * WHICH LAYERS SHOW is a display preference and lives in localStorage
 * (`docs/conventions.md`, "View state in the URL, display preferences in
 * localStorage").
 */
export function CalendarScreen({
  orgId,
  view,
  month,
  date,
  today,
  entries,
  layerItems,
  layerFailures,
  layers,
  locations,
  shops,
  canWrite,
  canSetBlackouts,
  layerColors,
  orgSettings,
}: {
  orgId: string;
  view: CalendarView;
  /** The first day of the month on screen. */
  month: string;
  /** The day the DAY view shows. Today when another view is on. */
  date: string;
  today: string;
  /** Month and day view: the entries touching what is on screen. List view:
   *  every entry. */
  entries: CalendarEntry[];
  /** Every other layer's items for the grid, already built on the server. */
  layerItems: CalendarItem[];
  /** A layer that could not be loaded, named — the rest still draw. */
  layerFailures: string[];
  /** The layers this person may see — the menu offers these and no others. */
  layers: CalendarLayer[];
  locations: EntryLocation[];
  /** The shop filter from `?shops=`. Empty means every shop. */
  shops: string[];
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
          setColourError(error?.message ?? "The colour was not saved — the database refused it.");
          return;
        }
        router.refresh();
      });
  }

  const [open, setOpen] = useState<Open | null>(null);
  const [shopFilter, setShopFilter] = useState<string[]>(shops);
  // Stored as the layers that are HIDDEN, so a layer added later shows by
  // default for everybody who has already chosen.
  const [hidden, setHidden] = useStoredSet("rf.calendar.hiddenLayers");
  // The OPT-IN layers (`OPT_IN_LAYERS`) are the other way round: hidden until
  // somebody turns one on, so what is stored is the ones that were.
  const [optedIn, setOptedIn] = useStoredSet("rf.calendar.shownLayers");

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
  // `PickSet` reads an empty value as ALL, which is exactly "nothing hidden".
  const shownLayers = hiddenSet.size === 0 ? [] : offered.filter((l) => !hiddenSet.has(l.key)).map((l) => l.key);

  const range = useMemo(
    () => (view === "day" ? { from: date, to: date } : gridRange(month)),
    [view, date, month],
  );
  const days = useMemo(() => {
    const all = [...entryItems(entries, range), ...layerItems];
    return itemsByDay(visibleItems(all, { hiddenLayers: hiddenSet, shops: shopFilter }));
  }, [entries, layerItems, range, hiddenSet, shopFilter]);

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
    if (v === "list") params.set("view", "list");
    else if (v === "day") {
      params.set("view", "day");
      params.set("date", next.date ?? date);
    } else params.set("month", monthParam(next.month ?? month));
    const s = next.shops ?? shopFilter;
    if (s.length > 0) params.set("shops", s.join(","));
    return `/calendar?${params.toString()}`;
  }

  function goToMonth(next: string) {
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
    } else if (next === "month") {
      router.push(href({ view: "month", month: view === "day" ? monthStart(date) : month }));
    } else {
      router.push(href({ view: "list" }));
    }
  }

  function changeShops(next: string[]) {
    setShopFilter(next);
    // A filter over what is already loaded: the URL follows without a fetch.
    window.history.replaceState(null, "", href({ shops: next }));
  }

  const count = view === "list" ? entries.length : [...days.values()].reduce((n, d) => n + d.length, 0);
  const openEntry = open?.kind === "entry" ? entryById.get(open.id) ?? null : null;

  return (
    <div className="space-y-5">
      <PageHeading
        title="Calendar"
        total={count}
        noun={
          view === "list"
            ? "entries"
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
                      : view === "month" && monthStart(today) === month
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

      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        {view === "month" && (
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
              onClick={() => goToMonth(monthStart(today))}
              disabled={monthStart(today) === month}
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
            and the layers' eye alone at the far right, where a table's columns
            eye sits. */}
        {view !== "list" && (
          <ControlField label="Shops">
            <PickSet
              options={locations.map((l) => ({ value: l.id, label: l.code, hint: l.name }))}
              value={shopFilter}
              onChange={changeShops}
              allLabel="All shops"
              label="Which shops to show"
              noun="shops"
            />
          </ControlField>
        )}
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
        {view !== "list" && offered.length > 1 && (
          <PickSet
            // THE EYE — `ColumnsMenu`'s, for the same verb: which of these to
            // show. The key of chips under this row is what says the answer,
            // so the trigger does not have to.
            icon={<ColumnsIcon />}
            options={offered.map((l) => ({ value: l.key, label: l.label }))}
            value={shownLayers}
            onChange={(next) => {
              // An empty set from `PickSet` means ALL, opt-in layers too.
              const shown = next.length === 0 ? offered.map((l) => l.key) : next;
              setHidden(
                offered
                  .filter((l) => !OPT_IN_LAYERS.includes(l.key) && !shown.includes(l.key))
                  .map((l) => l.key),
              );
              setOptedIn(OPT_IN_LAYERS.filter((l) => shown.includes(l)));
            }}
            allLabel="Everything"
            label="What the calendar shows"
            noun="layers"
            align="right"
            className="ml-auto"
          />
        )}
      </div>

      {layerFailures.length > 0 && (
        <p className="text-sm text-accent">Could not load: {layerFailures.join("; ")}</p>
      )}

      {/* THE KEY to the colours: one chip per layer that is showing, in the
          menu's order, so the calendar never has to be decoded from memory. */}
      {view !== "list" && (
        <ul aria-label="Colours" className="flex flex-wrap gap-x-2 gap-y-1 text-[11px] font-medium">
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
                    aria-label={`Change the colour of ${keyLabel(l)}`}
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
        <EntriesList
          entries={entries}
          today={today}
          locations={locations}
          canWrite={canWrite}
          canSetBlackouts={canSetBlackouts}
          onOpen={(id) => setOpen({ kind: "entry", id })}
        />
      )}

      {colourError && <p className="text-sm text-accent">{colourError}</p>}
      {recolouring && (
        <Dialog
          title={`Colour for ${keyLabel(CALENDAR_LAYERS.find((l) => l.key === recolouring)!)}`}
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
              ariaLabel="Colour"
              name="layer-colour"
            />
            <p className="text-sm text-muted">Everyone in the organisation sees this colour.</p>
          </div>
        </Dialog>
      )}

      {open?.kind === "new" && (
        <EntryDialog
          orgId={orgId}
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
