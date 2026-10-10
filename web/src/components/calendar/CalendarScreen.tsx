"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeading } from "@/components/ui/PageHeading";
import { TabPicker } from "@/components/ui/TabPicker";
import { PickSet } from "@/components/ui/PickSet";
import { ControlField } from "@/components/ui/ControlField";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import { addMonths, monthLabel, monthStart } from "@/lib/dateRange";
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
import { MonthView, LAYER_MARK } from "@/components/calendar/MonthView";
import { DayPanel } from "@/components/calendar/DayPanel";
import { EntryDialog, type EntryLocation } from "@/components/calendar/EntryDialog";
import { EntriesList } from "@/components/calendar/EntriesList";

export type CalendarView = "month" | "list";

/** Which dialog is open: a day's panel, an entry, or a new entry on a day. */
type Open =
  | { kind: "day"; date: string }
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
  today,
  entries,
  layerItems,
  layerFailures,
  layers,
  locations,
  shops,
  canWrite,
  canSetBlackouts,
}: {
  orgId: string;
  view: CalendarView;
  /** The first day of the month on screen. */
  month: string;
  today: string;
  /** Month view: the entries touching the grid. List view: every entry. */
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
}) {
  const router = useRouter();
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

  const range = useMemo(() => gridRange(month), [month]);
  const days = useMemo(() => {
    const all = [...entryItems(entries, range), ...layerItems];
    return itemsByDay(visibleItems(all, { hiddenLayers: hiddenSet, shops: shopFilter }));
  }, [entries, layerItems, range, hiddenSet, shopFilter]);

  const shopCodes = useMemo(() => new Map(locations.map((l) => [l.id, l.code])), [locations]);
  const entryById = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);

  function href(next: { month?: string; view?: CalendarView; shops?: string[] }): string {
    const params = new URLSearchParams();
    const v = next.view ?? view;
    if (v === "list") params.set("view", "list");
    else params.set("month", monthParam(next.month ?? month));
    const s = next.shops ?? shopFilter;
    if (s.length > 0) params.set("shops", s.join(","));
    return `/calendar?${params.toString()}`;
  }

  function goToMonth(next: string) {
    router.push(href({ month: next }));
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
        noun={view === "list" ? "entries" : `on screen · ${monthLabel(month)}`}
        action={
          canWrite ? (
            <button
              type="button"
              onClick={() => setOpen({ kind: "new", date: view === "month" && monthStart(today) === month ? today : null })}
              className={`${BUTTON_CLASS} ml-auto shrink-0`}
            >
              New entry
            </button>
          ) : null
        }
      />

      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <TabPicker<CalendarView>
          ariaLabel="View"
          value={view}
          options={[
            { key: "month", label: "Month", href: href({ view: "month" }) },
            { key: "list", label: "List", href: href({ view: "list" }) },
          ]}
          className="!flex-none"
        />
        {view === "month" && (
          <div className="flex items-center gap-2">
            <button type="button" aria-label="Previous month" onClick={() => goToMonth(addMonths(month, -1))} className={NAV}>
              ‹
            </button>
            <span className="w-44 text-center text-sm font-semibold">{monthLabel(month)}</span>
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
        {view === "month" && (
          <div className="ml-auto flex flex-wrap items-end gap-x-6 gap-y-3">
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
            {offered.length > 1 && (
              <ControlField label="Show">
                <PickSet
                  options={offered.map((l) => ({
                    value: l.key,
                    label: `${LAYER_MARK[l.key]} ${l.label}`.trim(),
                  }))}
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
                />
              </ControlField>
            )}
          </div>
        )}
      </div>

      {layerFailures.length > 0 && (
        <p className="text-sm text-accent">Could not load: {layerFailures.join("; ")}</p>
      )}

      {view === "month" ? (
        <MonthView
          month={month}
          today={today}
          days={days}
          onDay={(date) => setOpen({ kind: "day", date })}
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

      {open?.kind === "day" && (
        <DayPanel
          date={open.date}
          items={days.get(open.date) ?? []}
          shopCodes={shopCodes}
          canWrite={canWrite}
          onEntry={(id) => setOpen({ kind: "entry", id })}
          onNew={() => setOpen({ kind: "new", date: open.date })}
          onClose={() => setOpen(null)}
        />
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
