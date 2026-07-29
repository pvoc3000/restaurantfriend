"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { money } from "@/lib/purchaseOrders";
import { packageDivisor, parPackageLabel } from "@/lib/catalog";
import { withFrom } from "@/lib/breadcrumbs";
import {
  applyExpansions,
  daySourceIndex,
  expansionKey,
  groupGuide,
  matchesGuideFilter,
  vendorTotals,
  serializeGuideView,
  GROUPING_LABEL,
  GUIDE_FILTERS,
  GUIDE_FILTER_LABEL,
  GUIDE_GROUPINGS,
  GUIDE_VIEW_COOKIE,
  WEEKDAY_LABELS,
  type EntryState,
  type GuideEntry,
  type GuideFilter,
  type GuideGrouping,
  type GuideRow,
} from "@/lib/orderGuide";
import { GuideLine } from "./GuideLine";
import { GeneratePos } from "./GeneratePos";
import { ActionBar, ActionBarButton } from "@/components/ui/ActionBar";

/**
 * The order guide (spec §4.6): the shop in walk order, item headers with par,
 * plan lines nested beneath, and the vendor totals bar tracking each vendor
 * against its minimum as you go.
 *
 * There is no clear/update ceremony — this renders from `v_order_guide` on
 * every load (design rule 4). Entries are written per line as you walk, so a
 * closed laptop loses nothing.
 */
export function OrderGuide({
  rows,
  entries: initialEntries,
  weekday,
  initialFilter,
  initialGrouping,
  initialIgnoreDays,
  guideDate,
  locationId,
  locationCode,
  orgId,
  canGeneratePos,
}: {
  rows: GuideRow[];
  entries: GuideEntry[];
  weekday: number;
  initialFilter: GuideFilter;
  initialGrouping: GuideGrouping;
  initialIgnoreDays: boolean;
  guideDate: string;
  locationId: string;
  locationCode: string;
  orgId: string;
  /** Purchaser+ only — staff walk the guide but can't create POs (RLS). */
  canGeneratePos: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();

  // Entries are held locally and written through: a walk is hundreds of small
  // edits and a server round-trip per keystroke would make it unusable.
  const [entries, setEntries] = useState<Map<string, EntryState>>(
    () =>
      new Map(
        initialEntries.map((e) => [
          e.vendor_item_id,
          { on_hand: e.on_hand, qty_to_order: e.qty_to_order },
        ])
      )
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Seeded from the session cookie by the server, so you come back to the view
  // you left rather than to the defaults. Favorites is the working mode when
  // there's nothing remembered: the day's preferred sources, everything else
  // present but quiet.
  const [filter, setFilter] = useState<GuideFilter>(initialFilter);
  // Lifts the vendor/item ordering-day gates off the list, for looking
  // something up regardless of when you'd order it. The walked day still
  // decides which day's pars and favorites the rows carry.
  const [ignoreDays, setIgnoreDays] = useState(initialIgnoreDays);
  // The search box is deliberately NOT remembered — coming back to a list
  // silently narrowed by a term you've forgotten typing is its own trap.
  const [term, setTerm] = useState("");
  // Grouping is client-side only — the rows are already loaded, so switching
  // between the walk, an A–Z list and a per-vendor view costs nothing.
  const [grouping, setGrouping] = useState<GuideGrouping>(initialGrouping);

  /**
   * Which item blocks are open on their other sources for the day. Held here
   * and nowhere else: expansion does not stick (Mark, 2026-07-26) — not across
   * a filter change, a regrouping, or a reload. It's a glance, not a setting,
   * and a guide that came back with a scatter of items pre-opened would be
   * lying about where you'd got to. Keys are (group, item) — see expansionKey.
   */
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  function toggleExpanded(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  /**
   * The triangle discloses the day's OTHER sources for one item, so it belongs
   * only on the one list that is narrower than that — Favorites, the working
   * mode (Mark, 2026-07-26). Everywhere else it would either mean nothing or
   * mean something different:
   * - All — already shows every day-relevant source; there is nothing behind it.
   * - Skipped — a burn-down of what you haven't looked at. Expanding it mixes
   *   in lines you've already priced, which isn't what that list is for.
   * - Will order — you're reviewing decisions, not shopping for alternatives.
   * - Ignore ordering days — the expansion is DEFINED by the day gates and the
   *   switch lifts them, so day-filtering one item inside a day-blind list
   *   would be incoherent; the switch is already this feature's global form.
   *
   * When it's off, the header shows NO triangle at all — not the greyed one.
   * The grey means "this item has no other source today", which is a claim
   * only Favorites is in a position to make.
   */
  const canExpand = !ignoreDays && filter === "favorites";

  /** Changing what the list shows drops the expansions with it. */
  function changeFilter(next: GuideFilter) {
    setFilter(next);
    setExpanded(new Set());
  }

  function changeGrouping(next: GuideGrouping) {
    setGrouping(next);
    setExpanded(new Set());
  }

  function toggleIgnoreDays() {
    setIgnoreDays((v) => !v);
    setExpanded(new Set());
  }

  // Remember the view for the rest of the browser session. A session cookie
  // (no max-age) is what "until you log out" means here, and signOut clears it.
  useEffect(() => {
    document.cookie = `${GUIDE_VIEW_COOKIE}=${serializeGuideView({
      weekday,
      filter,
      grouping,
      ignoreDays,
    })}; path=/; SameSite=Lax`;
  }, [weekday, filter, grouping, ignoreDays]);

  async function commit(row: GuideRow, patch: Partial<EntryState>) {
    const current = entries.get(row.vendor_item_id) ?? { on_hand: null, qty_to_order: null };
    const next: EntryState = { ...current, ...patch };

    setEntries((prev) => new Map(prev).set(row.vendor_item_id, next));
    setSaving(true);
    setError(null);

    const { error } = await supabase.from("order_guide_entries").upsert(
      {
        org_id: orgId,
        location_id: locationId,
        guide_date: guideDate,
        vendor_item_id: row.vendor_item_id,
        on_hand: next.on_hand,
        qty_to_order: next.qty_to_order,
      },
      { onConflict: "location_id,guide_date,vendor_item_id" }
    );

    setSaving(false);
    if (error) {
      // Put the old value back rather than leaving a number on screen that
      // isn't in the database.
      setEntries((prev) => new Map(prev).set(row.vendor_item_id, current));
      setError(error.message);
    }
  }

  const visibleRows = useMemo(() => {
    const words = term.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return rows.filter((row) => {
      if (
        !matchesGuideFilter(row, entries.get(row.vendor_item_id), filter, weekday, ignoreDays)
      )
        return false;
      if (words.length === 0) return true;
      const haystack = [
        row.item_name,
        row.vendor_name,
        row.brand,
        row.vendor_item_description,
        row.shop_section,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return words.every((w) => haystack.includes(w));
    });
  }, [rows, entries, term, filter, weekday, ignoreDays]);

  // Counts on the buttons ignore the search box: they describe the day's work,
  // not whatever you happen to have typed.
  const filterCounts = useMemo(() => {
    const counts: Record<GuideFilter, number> = {
      all: 0,
      favorites: 0,
      skipped: 0,
      will_order: 0,
    };
    for (const row of rows) {
      const entry = entries.get(row.vendor_item_id);
      for (const f of GUIDE_FILTERS) {
        if (matchesGuideFilter(row, entry, f, weekday, ignoreDays)) counts[f] += 1;
      }
    }
    return counts;
  }, [rows, entries, weekday, ignoreDays]);

  // Leaving the guide for an item must lead back to the guide — and to the day
  // you were walking, not whichever day defaults today.
  const here = { href: `/order-guide?day=${weekday}`, label: "Order Guide" };

  // Every day-relevant line keyed by item, so an item header can ask "is there
  // anything behind my triangle" without rescanning the whole day.
  const sourceIndex = useMemo(() => daySourceIndex(rows, weekday), [rows, weekday]);

  const sections = useMemo(() => {
    const grouped = groupGuide(visibleRows, grouping);
    return canExpand
      ? applyExpansions(grouped, sourceIndex, expanded, grouping)
      : grouped;
  }, [visibleRows, grouping, canExpand, sourceIndex, expanded]);
  const totals = useMemo(() => vendorTotals(rows, entries), [rows, entries]);
  const grandTotal = totals.reduce((sum, t) => (t.short ? sum : sum + t.subtotal), 0);
  const shortTotal = totals.reduce((sum, t) => (t.short ? sum + t.subtotal : sum), 0);

  /**
   * ZERO SECTION (from the FMP original): mark the section's still-untouched
   * SHOULD-ORDER lines explicitly zero, so "not ordering" is a decision on
   * record rather than a gap (Mark, 2026-07-25). Lines that weren't today's
   * work stay untouched, and entered quantities are never overwritten —
   * zeroing is for what you walked past, not what you chose.
   */
  const [zeroing, setZeroing] = useState<string | null>(null);
  async function zeroSection(sectionKey: string, lines: GuideRow[]) {
    const untouched = lines.filter(
      (row) =>
        row.should_order &&
        (entries.get(row.vendor_item_id)?.qty_to_order ?? null) === null
    );
    if (untouched.length === 0) return;

    setZeroing(sectionKey);
    setError(null);
    const { error } = await supabase.from("order_guide_entries").upsert(
      untouched.map((row) => ({
        org_id: orgId,
        location_id: locationId,
        guide_date: guideDate,
        vendor_item_id: row.vendor_item_id,
        on_hand: entries.get(row.vendor_item_id)?.on_hand ?? null,
        qty_to_order: 0,
      })),
      { onConflict: "location_id,guide_date,vendor_item_id" }
    );
    setZeroing(null);
    if (error) {
      setError(error.message);
      return;
    }
    setEntries((prev) => {
      const next = new Map(prev);
      for (const row of untouched) {
        const current = next.get(row.vendor_item_id);
        next.set(row.vendor_item_id, {
          on_hand: current?.on_hand ?? null,
          qty_to_order: 0,
        });
      }
      return next;
    });
  }

  /**
   * CLEAR THE WHOLE DAY — reset every line of this location's guide for this
   * date back to untouched: quantities entered, quantities explicitly zeroed,
   * and on-hand counts alike (Mark, 2026-07-26 — a full reset of the walk, not
   * just the order column).
   *
   * An UPDATE to nulls rather than a DELETE, because `order_guide_entries` has
   * select/insert/update policies and no DELETE policy (migration 001) — a
   * delete from the app would match zero rows and report success. Nulling is
   * equivalent anyway: every reader treats a (null, null) row exactly as it
   * treats an absent one.
   *
   * Scoped by location + date, not by the loaded rows, so it also clears
   * entries against vendor items that have since stopped being orderable and
   * so aren't on screen to be seen. Any member may do it — that's what the
   * update policy allows, and whoever can walk the guide can restart it.
   */
  const [clearing, setClearing] = useState(false);

  const dayTally = useMemo(() => {
    let entered = 0;
    let zeroed = 0;
    let counted = 0;
    for (const entry of entries.values()) {
      const qty = entry.qty_to_order;
      if (qty !== null && Number(qty) > 0) entered += 1;
      else if (qty !== null) zeroed += 1;
      if (entry.on_hand !== null) counted += 1;
    }
    return { entered, zeroed, counted, total: entered + zeroed + counted };
  }, [entries]);

  async function clearGuide() {
    const parts = [
      dayTally.entered > 0
        ? `${dayTally.entered} order quantit${dayTally.entered === 1 ? "y" : "ies"}` +
          ` worth ${money(grandTotal + shortTotal)}`
        : null,
      dayTally.zeroed > 0 ? `${dayTally.zeroed} zeroed line${dayTally.zeroed === 1 ? "" : "s"}` : null,
      dayTally.counted > 0
        ? `${dayTally.counted} on-hand count${dayTally.counted === 1 ? "" : "s"}`
        : null,
    ].filter(Boolean);

    if (
      !window.confirm(
        `Clear the whole guide for ${guideDate} at ${locationCode}?\n\n` +
          `This resets every line to untouched, discarding ${parts.join(", ")}.` +
          `\n\nPurchase orders already generated are not affected. This cannot be undone.`
      )
    )
      return;

    setClearing(true);
    setError(null);
    const { error } = await supabase
      .from("order_guide_entries")
      .update({ on_hand: null, qty_to_order: null })
      .eq("location_id", locationId)
      .eq("guide_date", guideDate);
    setClearing(false);

    if (error) {
      setError(error.message);
      return;
    }
    setEntries(new Map());
  }

  return (
    <div className="space-y-4 pb-28">
      {/* Title block: the screen's name in display caps, the context line in
          small caps beneath it. */}
      <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
        <div>
          <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
            Order Guide
          </h1>
          <p className="mt-1 text-[12px] uppercase tracking-[0.12em] text-subtle">
            {locationCode} · {ignoreDays ? "all days" : WEEKDAY_LABELS[weekday - 1]} ·
            walked {guideDate} · {visibleRows.length} of {rows.length} lines
          </p>
        </div>
        {/* All seven days, always, as one segmented control. The guide exists
            every day — picking one scopes the list to what's orderable then,
            and a day with nothing scheduled simply renders empty rather than
            disappearing. */}
        <span className="inline-flex h-9 items-stretch border border-ink">
          {[1, 2, 3, 4, 5, 6, 7].map((d) => (
            <Link
              key={d}
              href={`/order-guide?day=${d}`}
              className={`inline-flex items-center px-3 text-[12px] font-semibold uppercase tracking-[0.06em] no-underline ${
                d > 1 ? "border-l border-ink" : ""
              } ${
                d === weekday
                  ? "bg-ink text-white"
                  : "bg-white text-ink hover:bg-neutral-100"
              }`}
            >
              {WEEKDAY_LABELS[d - 1]}
            </Link>
          ))}
        </span>
        <button
          onClick={() => router.refresh()}
          className="ml-auto text-[12px] uppercase tracking-[0.12em] text-subtle underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900"
        >
          Refresh
        </button>
      </div>

      {/* Vendor totals bar — the guide's central instrument (§4.2): square
          boxes on a ruled bar, so it reads as an instrument panel rather than
          a row of tags. */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-4 border-y border-ink py-4">
          {totals.length === 0 ? (
            <span className="text-[12px] uppercase tracking-[0.12em] text-subtle">
              Nothing ordered yet — quantities you enter total up here by vendor
            </span>
          ) : (
            totals.map((t) => (
              <span
                key={t.vendor_id}
                title={
                  t.short
                    ? `Under the ${money(t.minimum)} minimum — this vendor generates no PO`
                    : undefined
                }
                className={`inline-flex items-baseline gap-3 border border-ink px-4 py-2 ${
                  t.short ? "bg-[var(--rf-red-200)]" : "bg-[var(--rf-green-200)]"
                }`}
              >
                <span className="text-[12px] font-semibold uppercase tracking-[0.06em]">
                  {t.vendor_name}
                </span>
                <span className="text-[13px] tabular-nums">
                  {money(t.subtotal)}
                  {t.minimum !== null ? ` / ${money(t.minimum)}` : ""}
                </span>
              </span>
            ))
          )}

          <span className="ml-auto inline-flex items-baseline gap-3">
            <span className="text-[12px] uppercase tracking-[0.12em] text-subtle">
              Will order
            </span>
            <span className="text-[22px] font-bold tabular-nums tracking-[-0.01em]">
              {money(grandTotal)}
            </span>
            {shortTotal > 0 && (
              <span
                className="text-[12px] uppercase tracking-[0.12em] text-accent"
                title="Vendors under their minimum"
              >
                +{money(shortTotal)} blocked
              </span>
            )}
          </span>
        </div>
        {error && <p className="text-sm text-accent">{error}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-4 text-sm">
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Jump to item, vendor or section…"
          className="h-9 w-72 border border-ink px-3 outline-none focus:border-2"
        />
        {/* Segmented control: these four are one choice, so they read as one
            object rather than four loose buttons. */}
        <span className="inline-flex h-9 items-stretch border border-ink">
          {GUIDE_FILTERS.map((f, i) => (
            <button
              key={f}
              onClick={() => changeFilter(f)}
              className={`inline-flex items-center gap-2 px-4 text-[12px] font-semibold uppercase tracking-[0.06em] transition-colors ${
                i > 0 ? "border-l border-ink" : ""
              } ${
                filter === f
                  ? "bg-ink text-white"
                  : "bg-white text-ink hover:bg-neutral-100"
              }`}
            >
              {GUIDE_FILTER_LABEL[f]}
              <span className="font-normal tabular-nums opacity-55">
                {filterCounts[f]}
              </span>
            </button>
          ))}
        </span>

        {/* The escape hatch from the day gates (FMP's "ignore order day"):
            every orderable line, whenever you'd normally buy it. A switch, not
            a button — it's a mode you leave on, not an action you fire. It
            lives with the filters it changes, and matches the app's other
            switches: black/white, off = the exact inverse of on (Mark,
            2026-07-25). */}
        <button
          type="button"
          role="switch"
          aria-checked={ignoreDays}
          onClick={toggleIgnoreDays}
          title="Show every orderable line, regardless of vendor or item ordering days"
          className="inline-flex items-center gap-3 text-[12px] font-semibold uppercase tracking-[0.06em] text-body hover:text-ink"
        >
          <span
            aria-hidden
            className={`relative inline-flex h-[26px] w-[46px] shrink-0 items-center rounded-full border-[1.5px] border-ink transition-colors ${
              ignoreDays ? "bg-ink" : "bg-white"
            }`}
          >
            <span
              className={`inline-block h-[18px] w-[18px] transform rounded-full transition-transform ${
                ignoreDays
                  ? "translate-x-[22px] bg-white"
                  : "translate-x-[2px] bg-ink"
              }`}
            />
          </span>
          Ignore ordering days
        </button>

        <span className="flex items-center gap-3">
          <span className="text-xs uppercase tracking-[0.12em] text-subtle">
            Group by
          </span>
          <span className="inline-flex h-9 items-stretch border border-ink">
            {GUIDE_GROUPINGS.map((mode, i) => (
              <button
                key={mode}
                onClick={() => changeGrouping(mode)}
                className={`inline-flex items-center px-3 text-[12px] font-semibold uppercase tracking-[0.06em] transition-colors ${
                  i > 0 ? "border-l border-ink" : ""
                } ${
                  grouping === mode
                    ? "bg-ink text-white"
                    : "bg-white text-ink hover:bg-neutral-100"
                }`}
              >
                {GROUPING_LABEL[mode]}
              </button>
            ))}
          </span>
        </span>
      </div>

      {sections.length === 0 ? (
        <p className="pt-4 text-sm text-muted">
          {filter === "favorites" || filter === "skipped"
            ? "No favorites for this day — nothing here has it in the vendor, item, and favorite order days. Switch to All to see everything orderable this day."
            : ignoreDays
              ? "No lines match. Every orderable line is listed — check the search box."
              : "No lines for this day — no vendor takes orders and no item is scheduled. Turn on “Ignore ordering days” to see everything orderable."}
        </p>
      ) : (
        // The lines scroll in their own pane, so the controls above stay put
        // without the page itself sticking anything. Sized to the rest of the
        // viewport (minus the action bar), with a floor for short windows. No
        // outer box — the sticky head's 2px rule is the structure.
        //
        // The masthead's share is subtracted as a live variable rather than
        // baked into the constant (globals.css, HeaderShell): collapsing the
        // menu hands those ~56px straight to the list, which is the whole point
        // of collapsing it.
        <div className="max-h-[calc(100vh-var(--rf-header-h)-15.5rem)] min-h-64 overflow-auto">
        <table className="w-full border-collapse text-[15px]">
          <thead>
            {/* Sticky to the PANE, not the page — and on the cells, since
                Safari won't make a <thead>/<tr> a sticky container. */}
            <tr className="text-left text-[12px] uppercase tracking-[0.12em] text-subtle">
              {[
                ["Vendor", ""],
                ["Description", ""],
                ["Pack", ""],
                ["Price", "text-right"],
                ["On hand", "w-24 text-right"],
                ["Sugg", "w-14 text-right"],
                ["Line", "w-28 text-right"],
                // LAST column on purpose (Mark, 2026-07-27): the stepper is
                // what a thumb reaches for all the way down the walk, so it
                // sits against the right edge and the line total — read, never
                // touched — moves inboard of it.
                ["Order", "w-64 pr-0 text-right"],
              ].map(([label, extra]) => (
                <th
                  key={label}
                  className={`sticky top-0 z-20 bg-white px-4 py-3 font-normal shadow-[inset_0_-2px_0_var(--rf-neutral-900)] ${extra}`}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sections.map((section, sectionIndex) => (
              <Fragment key={section.key}>
                {section.showHeader && (
                  <>
                    {/* A new section gets 64px of nothing above its band. */}
                    {sectionIndex > 0 && (
                      <tr aria-hidden>
                        <td colSpan={8} className="h-16" />
                      </tr>
                    )}
                    <tr className="bg-ink">
                      <td colSpan={8} className="px-8 py-0">
                        <div className="flex min-h-20 items-center gap-6">
                          <span className="text-[36px] font-bold uppercase leading-none tracking-[-0.02em] text-white">
                            {section.label}
                          </span>
                          <span className="text-[12px] uppercase tracking-[0.12em] text-white/55">
                            {section.items.length}{" "}
                            {section.items.length === 1 ? "item" : "items"}
                          </span>
                          {/* The section's own command lives in its band, as
                              the original had it: an explicit zero for every
                              line you walked past. Entered quantities are
                              never touched. */}
                          <button
                            type="button"
                            disabled={zeroing !== null}
                            onClick={() => {
                              const lines = section.items.flatMap((i) => i.lines);
                              void zeroSection(section.key, lines);
                            }}
                            className="ml-auto h-9 border border-white/40 px-4 text-[12px] font-semibold uppercase tracking-[0.06em] text-white transition-colors hover:bg-white hover:text-ink disabled:opacity-35"
                          >
                            {zeroing === section.key ? "Zeroing…" : "Zero section"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  </>
                )}

                {section.items.map((item) => {
                  const itemKey = expansionKey(section.key, item.inventory_item_id);
                  const isOpen = expanded.has(itemKey);
                  // The header states the par as a fact about the shelf, in base
                  // units — that's the one reading no vendor can contradict. But
                  // 576 oz is not a number anyone acts on, so it also carries the
                  // FAVORITE's package translation: the source you'd normally
                  // take, named in the tooltip because a second source with a
                  // different pack size will show a different figure on its own
                  // line, and both are right.
                  const parSource =
                    item.lines.find((l) => l.is_favorite) ?? item.lines[0];
                  const headerPar = parPackageLabel(
                    item.par_qty,
                    parSource ? packageDivisor(parSource, item.base_unit) : null,
                    parSource?.package_desc
                  );
                  return (
                  <Fragment key={item.inventory_item_id}>
                    {/* Item header: bold caps over a 2px black rule, par in
                        red on the right — directly above the order boxes,
                        because it's the number you order up TO. */}
                    <tr>
                      <td colSpan={8} className="px-0 pb-0 pt-12">
                        <div className="flex items-end gap-4 border-b-2 border-ink px-4 pb-2">
                          <span className="flex items-center gap-3">
                            <Link
                              href={withFrom(`/items/${item.inventory_item_id}`, here)}
                              className="text-[22px] font-bold uppercase leading-tight tracking-[0.06em] text-ink no-underline hover:underline"
                            >
                              {item.item_name}
                            </Link>
                            {/* The day's other sources for THIS item, without
                                leaving Favorites (see applyExpansions). It
                                trails the name rather than leading it (Mark,
                                2026-07-26) — the name is what you're scanning
                                for down the walk, so nothing should sit to the
                                left of it. A bare triangle at the scale of that
                                name rather than DataTable's small bordered box:
                                this header is a 22px title read standing up and
                                the control has to be hittable at arm's length.
                                Absent entirely outside Favorites — see
                                canExpand. */}
                            {canExpand &&
                              (item.expandable ? (
                                <button
                                  type="button"
                                  onClick={() => toggleExpanded(itemKey)}
                                  aria-expanded={isOpen}
                                  aria-label={
                                    isOpen
                                      ? `Hide other sources for ${item.item_name}`
                                      : `Show other sources for ${item.item_name}`
                                  }
                                  title={
                                    isOpen
                                      ? "Show only today's favorites"
                                      : "Show every source orderable today"
                                  }
                                  className="flex h-7 w-7 shrink-0 items-center justify-center text-[20px] leading-none text-ink transition-colors hover:text-muted"
                                >
                                  {isOpen ? "▼" : "▶"}
                                </button>
                              ) : (
                                // Greyed and inert rather than absent (Mark,
                                // 2026-07-26): every item on the working list
                                // says something about its other sources, and
                                // silence would be ambiguous between "none" and
                                // "not checked".
                                <span
                                  aria-hidden
                                  title="No other sources orderable today"
                                  className="flex h-7 w-7 shrink-0 items-center justify-center text-[20px] leading-none text-faint"
                                >
                                  ▶
                                </span>
                              ))}
                          </span>
                          <span className="ml-auto">
                            {item.par_qty === null ? (
                              // A missing par is a gap to fix, not an alarm —
                              // red is reserved for the number you order up to.
                              <span className="text-xs uppercase tracking-[0.12em] text-faint">
                                no par
                              </span>
                            ) : (
                              <span className="whitespace-nowrap text-[15px] font-bold uppercase tracking-[0.06em] text-accent">
                                par {Number(item.par_qty)} {item.base_unit}
                                {headerPar && (
                                  <span
                                    title={`${Number(item.par_qty)} ${item.base_unit} is ${headerPar} at ${parSource.vendor_name}`}
                                  >
                                    {" · "}
                                    {headerPar}
                                  </span>
                                )}
                              </span>
                            )}
                          </span>
                        </div>
                      </td>
                    </tr>

                    {item.lines.map((row) => (
                      <GuideLine
                        key={row.vendor_item_id}
                        row={row}
                        entry={entries.get(row.vendor_item_id)}
                        weekday={weekday}
                        ignoreDays={ignoreDays}
                        itemPar={item.par_qty}
                        baseUnit={item.base_unit}
                        saving={saving}
                        onCommit={(patch) => commit(row, patch)}
                      />
                    ))}
                  </Fragment>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
        </div>
      )}

      {/* The screen's decision, pinned to the bottom the way the original's
          command bar was. */}
      <ActionBar
        note={`${locationCode} · ${
          ignoreDays ? "all days" : WEEKDAY_LABELS[weekday - 1]
        } · ${visibleRows.length} of ${rows.length} lines`}
      >
        {/* Start the day over. Left of Generate POs — the escape hatch comes
            before the destination. Both cells are plain black: Mark preferred
            the black cell to the white fill (2026-07-26), so this bar has no
            primary. The bar's own black is emphasis enough; a white cell inside
            it read as a different kind of object. */}
        <ActionBarButton
          onClick={() => void clearGuide()}
          disabled={clearing || dayTally.total === 0}
          title={
            dayTally.total === 0
              ? "Nothing entered yet — there's nothing to clear"
              : "Reset every line of this day's guide to untouched"
          }
        >
          {clearing ? "Clearing…" : "Clear guide…"}
        </ActionBarButton>

        {/* The walk's end point (spec §2 step 3): who gets a PO. */}
        {canGeneratePos && (
          <GeneratePos
            totals={totals}
            locationId={locationId}
            guideDate={guideDate}
            weekday={weekday}
            trigger={(open) => (
              <ActionBarButton
                onClick={open}
                disabled={totals.length === 0}
                title={
                  totals.length === 0
                    ? "Enter order quantities first — there's nothing to generate"
                    : undefined
                }
              >
                Generate POs…
              </ActionBarButton>
            )}
          />
        )}
      </ActionBar>
    </div>
  );
}
