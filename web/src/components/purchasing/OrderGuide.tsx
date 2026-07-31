"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { money } from "@/lib/purchaseOrders";
import { withFrom } from "@/lib/breadcrumbs";
import { useChromeCollapsed } from "@/lib/chromeStore";
import { useScrollMemoryKey } from "@/lib/scrollMemory";
import { TextInput } from "@/components/ui/TextInput";
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
import type { Reminder } from "@/lib/reminders";
import { GuideLine } from "./GuideLine";
import { GeneratePos } from "./GeneratePos";
import { Reminders } from "./Reminders";
import { ActionBar, ActionBarButton } from "@/components/ui/ActionBar";
import { BackToTop } from "@/components/ui/BackToTop";

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
  reminders,
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
  /** Due at this location and not yet dismissed (spec §2 step 1). */
  reminders: Reminder[];
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

  // The masthead's ▲ hides this screen's shelf too — title, day picker, vendor
  // totals and filters — leaving the strip, the column labels and the list
  // (Mark, 2026-07-29). Same flag, so it's one button and one memory, not two.
  const chromeCollapsed = useChromeCollapsed();

  // Every screen is scroll-restored by the shell (components/ScrollMemory), but
  // the guide is the one screen its default key can't describe, so it names its
  // own. Two reasons, both fatal to a URL-derived key:
  // - WEEKDAY. `guideDate` is today — the day you're walking, which the picker
  //   does NOT change — so location + path would restore Monday's position into
  //   Thursday's much shorter list.
  // - The same list arrives at two URLs. The nav link is a bare `/order-guide`
  //   (the day comes from the view cookie) while the trail back from an item is
  //   `/order-guide?day=4`, so a key carrying the query would lose the position
  //   on exactly the round trip this exists for.
  // The remembered filter and grouping ride in that same cookie, so the list
  // you come back to is the list the position was measured against.
  useScrollMemoryKey(`guide:${locationId}:${guideDate}:${weekday}`);

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
  /**
   * WALK THE LIST from the ActionBar: jump to the next line still waiting for a
   * decision, or to the next section band (Mark, 2026-07-29). On a long guide
   * these replace hunting with the scrollbar — the guide is ~190 lines on a
   * Saturday at DF01 and the thing you want is always "the next one".
   *
   * Positions come from the DOM rather than from `sections`, because what the
   * jump needs is where a row physically IS, and only the browser knows that
   * once the item headers, section bands and expansions have laid out. The
   * offset is MEASURED off the masthead and the sticky column labels for the
   * same reason the labels themselves use a live variable: the masthead is 64px
   * open, 32 collapsed, and taller again when it wraps.
   */
  function scrollToNext(selector: string) {
    const header = document.querySelector("header");
    const labels = document.querySelector("thead th");
    const offset =
      (header?.getBoundingClientRect().height ?? 0) +
      (labels?.getBoundingClientRect().height ?? 0);

    const targets = Array.from(document.querySelectorAll<HTMLElement>(selector));
    if (targets.length === 0) return;

    // Compare in SCROLL space, not viewport space, and clamp to the page's real
    // limit first. Asking "is this row below the chrome?" breaks on the last few
    // rows: the page runs out of room to lift them that high, so they sit below
    // the chrome no matter what and the jump picks the same one forever. Measured
    // 2026-07-29 — the final untouched row parked 516px down and presses 6, 7
    // and 8 all landed on the same pixel. Asking "would this row move me?"
    // instead is the same question everywhere on the page.
    const maxScroll = Math.max(
      0,
      document.documentElement.scrollHeight - window.innerHeight
    );
    const scrollFor = (el: HTMLElement) =>
      Math.min(
        maxScroll,
        Math.max(0, window.scrollY + el.getBoundingClientRect().top - offset)
      );

    // Nothing further down means you're at the end, so wrap: on a burn-down the
    // answer to "no more after here" is the first one still outstanding.
    const next = targets.find((el) => scrollFor(el) > window.scrollY + 2) ?? targets[0];

    // INSTANT, not smooth. Two reasons, one measured and one from the design
    // system. Measured: `behavior: "smooth"` silently does nothing in at least
    // one Chromium build — scrollTo and scrollIntoView both no-op while "auto"
    // works — and a walk button that appears dead is the worst outcome here.
    // And the system's rule is near-zero motion; you pressed "next", so the
    // jump is the answer, not an animation of the answer. It also means
    // press-press-press keeps up with you instead of queueing 300ms each.
    window.scrollTo({ top: scrollFor(next), behavior: "auto" });
  }

  // What the two jumps have to aim at, so each button can say when there's
  // nowhere to go. Counted off the same data the list renders from.
  const untouchedCount = visibleRows.filter(
    (row) => (entries.get(row.vendor_item_id)?.qty_to_order ?? null) === null
  ).length;
  const sectionCount = sections.filter((section) => section.showHeader).length;

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
    // The two FIXED children — the command bar and the back-to-top disc — sit
    // OUTSIDE the spacing container, and that placement is load-bearing.
    // Tailwind's space-y-4 compiles to `margin-block-end` on every child except
    // the LAST one, and for a fixed box with bottom:0 it's the MARGIN edge that
    // lands on the viewport bottom. So while the bar was the last child it was
    // fine, and the moment the disc rendered after it the bar picked up 16px of
    // bottom margin and lifted 16px off the floor — footer jumping, a strip of
    // content scrolling through the gap underneath, and the bar's top rising
    // into the disc (Mark, 2026-07-29). Vertical rhythm means nothing to a fixed
    // element; keeping them out of the container is the fix, not zeroing the
    // margin, because the next fixed child would hit it all over again.
    //
    // -mt-8 collapsed, cancelling the page gutter's 32px top padding exactly
    // (layout.tsx, py-8). With the shelf gone that padding is the last thing
    // left between the strip and the column labels, and against a 32px strip a
    // 32px band of nothing reads as shelf that failed to hide. The labels' own
    // py-3 is the breathing room they need. Only this screen does it: every
    // other page keeps its title and filters when the chrome collapses, so
    // their top padding isn't leftover.
    //
    // pb-22 clears the fixed ActionBar: 52px of bar plus 36px so the last row
    // can scroll out from under it. Paired with the bar's own height — see
    // components/ui/ActionBar.
    <>
    <div className={`space-y-4 pb-22 ${chromeCollapsed ? "-mt-8" : ""}`}>
      {/* ABOVE the shelf, and outside it: a due reminder is an alert, not a view
          control, so it must survive the collapse that hides everything else up
          here. Walking with the chrome collapsed is the normal way to walk —
          that's what the collapse is for — and a reminder you only see when
          you're not working is no reminder at all. */}
      <Reminders
        reminders={reminders}
        guideDate={guideDate}
        locationId={locationId}
        orgId={orgId}
        // Both dismissing and writing are UPDATEs/INSERTs on purchase_reminders,
        // which 001's generic policy makes purchaser+ — the same gate that
        // decides whether POs can be generated.
        canWrite={canGeneratePos}
      />

      {/* The shelf — everything above the list. It goes with the menu when the
          chrome collapses: on a walk you're reading rows, and the title, the
          day picker, the totals and the filters are all things you set BEFORE
          you start (Mark, 2026-07-29). The strip keeps which location and which
          page you're on, and brings the rest back in a tap. */}
      {!chromeCollapsed && (
        <>
          {/* Title block. The context line that used to sit under the title is
              gone (Mark, 2026-07-29) — the location is in the masthead and the
              day is the lit chip in the picker, so all it added was the walked
              date. What's left of it is the count, moved up BESIDE the title
              where it reads as a subtitle, with the day picker taking the line
              underneath. */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
              <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
                Order Guide
              </h1>
              <p className="text-[12px] uppercase tracking-[0.12em] text-subtle">
                {visibleRows.length} of {rows.length} items
              </p>
              <button
                onClick={() => router.refresh()}
                className="ml-auto text-[12px] uppercase tracking-[0.12em] text-subtle underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900"
              >
                Refresh
              </button>
            </div>

            {/* All seven days, always, as one segmented control, directly under
                the title. The guide exists every day — picking one scopes the
                list to what's orderable then, and a day with nothing scheduled
                simply renders empty rather than disappearing.
                flex + w-fit, not inline-flex: an inline-level box in a block
                parent sits in a line box and collects its descender space, which
                is 4px of nothing under the control (the same trap that put Sign
                out off its baseline). */}
            <div className="flex h-9 w-fit items-stretch border border-ink">
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
            </div>
          </div>

          {/* Vendor totals bar — the guide's central instrument (§4.2): square
              boxes on a ruled bar, so it reads as an instrument panel rather
              than a row of tags. */}
          <div className="flex flex-wrap items-center gap-4 border-y border-ink py-4">
            {totals.length === 0 ? (
              <span className="text-[12px] uppercase tracking-[0.12em] text-subtle">
                Nothing ordered yet — quantities you enter total up here by
                vendor
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
                    t.short
                      ? "bg-[var(--rf-red-200)]"
                      : "bg-[var(--rf-green-200)]"
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

          <div className="flex flex-wrap items-center gap-4 text-sm">
            <TextInput
              value={term}
              onValueChange={setTerm}
              placeholder="Jump to item, vendor or section…"
              clearLabel="Clear the search"
              className="h-9 w-72"
            />
            {/* Segmented control: these four are one choice, so they read as
                one object rather than four loose buttons. */}
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
                every orderable line, whenever you'd normally buy it. A switch,
                not a button — it's a mode you leave on, not an action you fire.
                It lives with the filters it changes, and matches the app's
                other switches: black/white, off = the exact inverse of on
                (Mark, 2026-07-25). */}
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

            {/* Pushed to the right edge (Mark, 2026-07-29). Everything left of
                it narrows the list — search, the four tiers, the day gates —
                and this one only rearranges what survived, so it reads better
                as its own thing at the far end than as a fourth filter. ml-auto
                eats the slack in the row; if the row wraps at a narrow width
                this lands on its own line, still right-aligned. */}
            <span className="ml-auto flex items-center gap-3">
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
        </>
      )}

      {/* Deliberately OUTSIDE the shelf: a failed write is the one thing up
          here that isn't a control, and it has to reach you whether or not the
          chrome is collapsed. */}
      {error && <p className="text-sm text-accent">{error}</p>}

      {sections.length === 0 ? (
        <p className="pt-4 text-sm text-muted">
          {filter === "favorites" || filter === "skipped"
            ? "No favorites for this day — nothing here has it in the vendor, item, and favorite order days. Switch to All to see everything orderable this day."
            : ignoreDays
              ? "No lines match. Every orderable line is listed — check the search box."
              : "No lines for this day — no vendor takes orders and no item is scheduled. Turn on “Ignore ordering days” to see everything orderable."}
        </p>
      ) : (
        // The list is in the PAGE's flow — no pane, no second scrollbar (Mark,
        // 2026-07-29). It used to scroll in its own height-capped box, which
        // meant a wheel moved the shelf or the lines depending on where the
        // pointer happened to be, and the cap was a hand-tuned guess at the
        // shelf's height that left a band of dead space above the ActionBar
        // whenever the guess was wrong. One scroller can't disagree with
        // itself. No outer box — the sticky head's 2px rule is the structure.
        <table className="w-full border-collapse text-[15px]">
          <thead>
            {/* Sticky to the VIEWPORT now that nothing else scrolls, parked
                directly under the masthead — so the labels follow the chrome
                when it collapses (88px → 32px) instead of needing a constant.
                On the cells, since Safari won't make a <thead>/<tr> a sticky
                container. */}
            <tr className="text-left text-[12px] uppercase tracking-[0.12em] text-subtle">
              {[
                ["Vendor", ""],
                // Description CARRIES the pack, stacked beneath it (Mark,
                // 2026-07-29) — the same shape as this row's first cell, where
                // brand and delivery day sit under the vendor name. Two
                // columns' worth of information in one column's width, and
                // labelled for the line that leads it, as Vendor is.
                ["Description", ""],
                ["Price", "text-right"],
                ["On hand", "w-24 text-right"],
                ["Sugg", "w-14 text-right"],
                // The ONE column that gives way, and only below 880px (Mark,
                // 2026-07-29). Two measured facts set that number: the row's
                // seven columns bottom out at 815px of content (Vendor 146,
                // Description 112, Price 76, On hand 98, Sugg 56, Line 105,
                // Order 222), and dropping Line alone takes that to 710 — which
                // is what makes a 768px portrait window fit. Description is the
                // column that absorbs the squeeze on the way down; it is the
                // one that can wrap. Line is the right sacrifice because it's
                // pure arithmetic you can redo in your head, and the totals bar
                // already sums it per vendor. Sugg stays at every width — it's
                // what count mode is FOR, and it earns its 56px on a walk.
                ["Line", "w-28 text-right max-[880px]:hidden"],
                // LAST column on purpose (Mark, 2026-07-27): the stepper is
                // what a thumb reaches for all the way down the walk, so it
                // sits against the right edge and the line total — read, never
                // touched — moves inboard of it.
                //
                // w-64 is a comfort width, not a requirement — the stepper's
                // own floor is 222px. Below 1180 it's dropped so the slack goes
                // to Description instead of padding a column that doesn't need
                // it: measured at 768, that's Description 112 → 131 and 23px
                // off the tallest row. Description is the one column here that
                // can use width, so it should get it.
                ["Order", "w-64 pr-0 text-right max-[1180px]:w-auto"],
              ].map(([label, extra]) => (
                <th
                  key={label}
                  className={`sticky top-[var(--rf-header-h)] z-20 bg-white px-4 py-3 font-normal shadow-[inset_0_-2px_0_var(--rf-neutral-900)] max-[1180px]:px-2 ${extra}`}
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
                        <td colSpan={7} className="h-16" />
                      </tr>
                    )}
                    <tr className="bg-ink" data-guide-section="">
                      {/* colSpan stays 8 even where two columns are hidden
                          below 1180px — the browser clamps a colSpan to the
                          real column count, so the band still spans the row. */}
                      <td colSpan={7} className="px-4 py-0 xl:px-8">
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
                  return (
                  <Fragment key={item.inventory_item_id}>
                    {/* Item header: bold caps over a 2px black rule, par in
                        red on the right — directly above the order boxes,
                        because it's the number you order up TO. */}
                    <tr>
                      <td colSpan={7} className="px-0 pb-0 pt-12">
                        <div className="flex items-end gap-4 border-b-2 border-ink px-4 pb-2 max-[1180px]:px-2">
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
                              // The ITEM's par, in base units, and nothing else
                              // (Mark, 2026-07-29). It used to append the
                              // favorite's package translation, but an item can
                              // have several favorites, so that silently picked
                              // the first and showed one source's reading as if
                              // it were the item's. Each line states its own
                              // package par under its own order box, which is
                              // where a per-source number belongs.
                              <span className="whitespace-nowrap text-[15px] font-bold uppercase tracking-[0.06em] text-accent">
                                par {Number(item.par_qty)} {item.base_unit}
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
      )}
      </div>

      {/* The screen's decision, pinned to the bottom the way the original's
          command bar was. */}
      <ActionBar
        trailing={
          <>
            {/* Movement only — neither of these touches anything, which is why
                they sit at the far edge from the two that do (Mark,
                2026-07-29). Going BACK to the top isn't here: it's the floating
                disc (components/ui/BackToTop), where the convention puts it. */}
            <ActionBarButton
              onClick={() => scrollToNext("tr[data-untouched]")}
              disabled={untouchedCount === 0}
              title={
                untouchedCount === 0
                  ? "Every line in this view has an order quantity or an explicit zero"
                  : `Scroll to the next line with an empty order box — ${untouchedCount} left`
              }
            >
              Next favorite
            </ActionBarButton>

            <ActionBarButton
              onClick={() => scrollToNext("tr[data-guide-section]")}
              disabled={sectionCount === 0}
              title={
                sectionCount === 0
                  ? "Nothing to jump to in this view"
                  : `Scroll to the next ${
                      grouping === "vendor" ? "vendor" : "shop section"
                    } — ${sectionCount} in this view`
              }
            >
              Next section
            </ActionBarButton>
          </>
        }
      >
        {/* Start the day over. Left of Generate POs — the escape hatch comes
            before the destination. Every cell is plain black: Mark preferred
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

      {/* Floating, not a bar cell: scrolling back to the top is a scrolling
          affordance, so it lives over the list rather than among the commands. */}
      <BackToTop />
    </>
  );
}
