"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { money } from "@/lib/purchaseOrders";
import { withFrom } from "@/lib/breadcrumbs";
import { useScrollMemoryKey } from "@/lib/scrollMemory";
import { TextInput } from "@/components/ui/TextInput";
import { TabPicker } from "@/components/ui/TabPicker";
import { DateField } from "@/components/ui/DateField";
import {
  applyExpansions,
  daySourceIndex,
  expansionKey,
  groupGuide,
  lastPurchaseLabel,
  matchesGuideFilter,
  vendorTotals,
  serializeGuideView,
  GROUPING_LABEL,
  GUIDE_FILTERS,
  GUIDE_FILTER_LABEL,
  GUIDE_GROUPINGS,
  GUIDE_VIEW_COOKIE,
  WEEKDAY_LABELS,
  guideHref,
  type EntryState,
  type GuideEntry,
  type GuideFilter,
  type GuideGrouping,
  type GuideRow,
  type LastPurchase,
} from "@/lib/orderGuide";
import type { Reminder } from "@/lib/reminders";
import { GuideLine } from "./GuideLine";
import { GeneratePos } from "./GeneratePos";
import { Reminders } from "./Reminders";
import { GuideRequests, type GuideRequest } from "./GuideRequests";
import { ActionBar, ActionBarButton } from "@/components/ui/ActionBar";
import { BackToTop } from "@/components/ui/BackToTop";
import { usePublishedHeight } from "@/lib/tableHead";
import { confirmDialog, splitConfirmMessage } from "@/lib/confirm";

/**
 * TRIAL, 2026-08-10 (Mark): the item header's par is hidden — "distracting…
 * a little irrelevant" now that every line states its own par in its own
 * packages under its own order box. It was the same number said twice, once in
 * base units at 15px in red across the whole walk and once per line where you
 * actually decide, and only the second reading is in the unit you order in.
 *
 * Flip to true to bring it back; nothing else moved. `itemPar` still reaches
 * GuideLine, which is what the per-line "par 3 CS" and count mode's suggestion
 * divide — this hides a restatement, it does not remove a number the guide
 * computes from.
 *
 * The NO PAR marker is deliberately still shown. It isn't the thing that was
 * distracting (faint grey, not red) and it's the only place on the walk that
 * flags a missing par at item level — with this off, the header goes quiet
 * except where there's a gap, which is the exception worth marking.
 */
const SHOW_ITEM_PAR: boolean = false;

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
  lastPurchases,
  lastPurchaseError,
  entries: initialEntries,
  reminders,
  weekday,
  initialFilter,
  initialGrouping,
  initialIgnoreDays,
  initialTerm,
  guideDate,
  today,
  locationId,
  locationCode,
  orgId,
  canGeneratePos,
  requests,
  userId,
}: {
  rows: GuideRow[];
  /** Migration 048 — the most recent non-void purchase per item-location. */
  lastPurchases: LastPurchase[];
  /** Set only while 048 is unapplied; see the note where it's rendered. */
  lastPurchaseError: string | null;
  entries: GuideEntry[];
  /** Due at this location and not yet dismissed (spec §2 step 1). */
  reminders: Reminder[];
  weekday: number;
  initialFilter: GuideFilter;
  initialGrouping: GuideGrouping;
  initialIgnoreDays: boolean;
  /** The remembered search term — see GuideView.term. */
  initialTerm: string;
  guideDate: string;
  /** Today in the ORG's zone. `guideDate` is usually this and need not be. */
  today: string;
  locationId: string;
  locationCode: string;
  orgId: string;
  /** Purchaser+ only — staff walk the guide but can't create POs (RLS). */
  canGeneratePos: boolean;
  /** Open purchase requests at this location, for the header's right column. */
  requests: GuideRequest[];
  /** Who is walking — the request menu needs it to know its own author. */
  userId: string;
}) {
  const router = useRouter();
  const supabase = createClient();

  // The sticky controls band publishes its own height, so the column labels
  // know where to stop. See the band itself, further down.
  const controlsRef = useRef<HTMLDivElement>(null);
  /** The item a jump could not reach, so its request row can say why. */
  const [jumpMiss, setJumpMiss] = useState<string | null>(null);
  usePublishedHeight(controlsRef, "--rf-guide-controls-h");

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
  // Remembered with the rest of the view since 2026-08-03 (Mark). Seeded from
  // the server like the others, so the first paint is already narrowed rather
  // than showing the whole walk and then snapping — see GuideView.term for why
  // this stopped being a trap.
  const [term, setTerm] = useState(initialTerm);
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
      filter,
      grouping,
      ignoreDays,
      term,
    })}; path=/; SameSite=Lax`;
  }, [weekday, filter, grouping, ignoreDays, term]);

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
  // The trail back from an item returns to the DAY you left, which is now one
  // parameter rather than two.
  const here = { href: guideHref(guideDate, today), label: "Order Guide" };

  /**
   * Last purchase keyed by item-location, so an item header is a map lookup
   * rather than a scan of ~450 rows per header.
   */
  const lastByItemLocation = useMemo(() => {
    const map = new Map<string, LastPurchase>();
    for (const p of lastPurchases) map.set(p.item_location_id, p);
    return map;
  }, [lastPurchases]);

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
  /**
   * Everything pinned above the list, measured rather than assumed — the
   * masthead wraps at iPad widths and the controls band wraps at 1440, so any
   * constant is wrong at some width. The controls band joined this stack on
   * 2026-08-03; miss it out and every jump lands its row underneath the search
   * box.
   */
  function chromeOffset() {
    const header = document.querySelector("header");
    const controls = document.querySelector("[data-guide-controls]");
    const labels = document.querySelector("thead th");
    return (
      (header?.getBoundingClientRect().height ?? 0) +
      (controls?.getBoundingClientRect().height ?? 0) +
      (labels?.getBoundingClientRect().height ?? 0)
    );
  }

  function scrollToNext(selector: string) {
    const offset = chromeOffset();

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

  /**
   * TAKE ME TO THAT ITEM IN THE WALK (Mark, 2026-08-22 — "go to the inventory
   * item on the order guide").
   *
   * The requests band names an item; this is how you get to the row that lets
   * you order it. Not a link to `/items/[id]` — the list screen offers that,
   * and it is the right destination there, but from the guide the useful place
   * is fifteen feet down this page rather than a different screen.
   *
   * Three outcomes, in the order they are tried:
   *
   *   1. The row is on screen — scroll to it, under the chrome.
   *   2. It is somewhere in today's guide but this VIEW is hiding it, which the
   *      filter and the search box are the two ways of doing. Both are widened
   *      and the scroll is deferred to the render that follows. The change is
   *      deliberately visible — the tab moves to All and the search box empties
   *      — because a jump that silently rearranged the screen would be worse
   *      than one that explained nothing.
   *   3. It is not on today's guide at all, which is decided SYNCHRONOUSLY off
   *      `rows` (every orderable line for this weekday) rather than by looking
   *      for a row that was never going to appear. Saying so beats widening
   *      two controls to no effect.
   */
  const pendingJump = useRef<string | null>(null);

  function scrollToItem(itemId: string): boolean {
    const row = document.querySelector<HTMLElement>(
      `tr[data-guide-item="${itemId}"]`
    );
    if (!row) return false;
    const maxScroll = Math.max(
      0,
      document.documentElement.scrollHeight - window.innerHeight
    );
    window.scrollTo({
      top: Math.min(
        maxScroll,
        Math.max(0, window.scrollY + row.getBoundingClientRect().top - chromeOffset())
      ),
      behavior: "auto",
    });
    return true;
  }

  function jumpToItem(itemId: string) {
    setJumpMiss(null);
    if (scrollToItem(itemId)) return;

    // Not rendered. Is it even here today?
    if (!rows.some((r) => r.inventory_item_id === itemId)) {
      setJumpMiss(itemId);
      return;
    }

    // It is — so something in the view is hiding it. Widen both, and scroll on
    // the other side of the render. A ref rather than state, so this never
    // becomes a set-state-in-effect.
    pendingJump.current = itemId;
    if (term) setTerm("");
    changeFilter("all");
  }

  useEffect(() => {
    const itemId = pendingJump.current;
    if (!itemId) return;
    pendingJump.current = null;
    // One more miss here is possible in principle — an item orderable today
    // that even the All tier will not show — and it reports rather than
    // scrolling nowhere.
    if (!scrollToItem(itemId)) setJumpMiss(itemId);
    // Runs after the widened view has rendered; the deps are what widened.
  }, [filter, term]); // eslint-disable-line react-hooks/exhaustive-deps

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
      !(await confirmDialog({ ...splitConfirmMessage(`Clear the whole guide for ${guideDate} at ${locationCode}?\n\n` +
          `This resets every line to untouched, discarding ${parts.join(", ")}.` +
          `\n\nPurchase orders already generated are not affected. This cannot be undone.`), confirmLabel: "Clear guide", tone: "danger" }))
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
    <div className="space-y-4 pb-22">
      {/* THE HEADER'S TWO COLUMNS (Mark, 2026-08-22): what's due on the left,
          what the shop has asked for on the right. Both are alerts rather than
          view controls, which is why they sit above the shelf and not in it.

          `items-start`, so the taller column does not stretch the shorter one
          into a box of white space — these are two lists that happen to be
          side by side, not two halves of one card.

          The two `showEmpty` flags are what keep it a GRID: with anything in
          either column, both render and the empty one says so, rather than
          leaving a hole where a column should be. With both empty neither
          renders at all — the guide's first row should be the guide — and
          Reminders falls back to its own quiet "Add reminder" line. */}
      <div className="grid gap-4 md:grid-cols-2 md:items-start">
        <Reminders
          reminders={reminders}
          guideDate={guideDate}
          locationId={locationId}
          orgId={orgId}
          // Both dismissing and writing are UPDATEs/INSERTs on
          // purchase_reminders, which 001's generic policy makes purchaser+ —
          // the same gate that decides whether POs can be generated.
          canWrite={canGeneratePos}
          showEmpty={requests.length > 0}
        />
        <GuideRequests
          requests={requests}
          userId={userId}
          // 001's `preq_resolve` is the same role array as `canWriteCatalog`,
          // which is what `canGeneratePos` already carries.
          canResolve={canGeneratePos}
          showEmpty={reminders.length > 0}
          onJumpToItem={jumpToItem}
          jumpMiss={jumpMiss}
        />
      </div>

      {/* The shelf — everything above the list: the title, the day picker,
          the vendor totals and the filters. It used to hide with the
          masthead's collapse toggle, on the argument that these are all
          things you set BEFORE you start walking; that toggle is gone
          (Mark, 2026-08-02) and so is the hiding. */}
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

          {/* THE DAY — the screen's ONE piece of day state, and it sits in the
              identity block after the title because that is what it is: which
              walk you are looking at, not a filter over one (Mark, 2026-08-25).
              Heading scale for the same reason.

              The WEEKDAY is shown beside the date because it is the value doing
              the work — order days, favorites and par are all scoped by it, and
              "08/24/2026" says nothing about which day that is. It takes the
              mark FILL when the day on screen is not today, so "these
              quantities are being filed against Monday" is a colour rather than
              a sentence. */}
          <span className="flex items-center gap-2 text-[20px]">
            <span
              className={`px-1.5 font-semibold uppercase tracking-[0.06em] ${
                guideDate === today ? "text-subtle" : "bg-mark-fill text-ink"
              }`}
            >
              {WEEKDAY_LABELS[weekday - 1]}
            </span>
            <DateField
              variant="title"
              ariaLabel="The day this guide is showing"
              value={guideDate}
              onChange={(next) => router.push(guideHref(next ?? today, today))}
            />
            {guideDate !== today && (
              <Link
                href={guideHref(today, today)}
                className="text-[12px] uppercase tracking-[0.12em] text-ink underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900"
              >
                Today
              </Link>
            )}
          </span>

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

        {/* The guide is the screen the shop is walked on, so a view it can't
            read must not take it down — every row, quantity and total above
            still renders and only the last-purchase line is missing. But it
            isn't swallowed either: an absent line and "never ordered here" look
            identical, so without this the headers would quietly assert
            something false about every item. One muted sentence, gone the
            moment 048 lands. */}
        {lastPurchaseError && (
          <p className="text-[12px] text-subtle">
            Last-ordered is unavailable — {lastPurchaseError}
          </p>
        )}

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

      {/* THE CONTROLS STAY ON SCREEN FOR THE WHOLE WALK (Mark, 2026-08-03:
          "I would like to still have access to the search and filters when
          scrolling down the order guide"). Everything else in the shelf — the
          title, the day picker, the totals bar — is something you set before
          you take a step, so it scrolls away; these three you reach for
          mid-walk, and the guide is 66,000px long.

          It publishes its measured height (see usePublishedHeight) and the
          column labels below offset against the SUM, so the two bands stack
          instead of overlapping. Measured, not a constant: this row wraps to a
          second line the moment "Group by" can't share it, which at 1440 it
          already can't.

          z-30 puts it over the labels (20) and under the masthead (50). The
          ActionBar and BackToTop share 30 and never meet it — they live at the
          bottom of the viewport. */}
      <div
        ref={controlsRef}
        data-guide-controls=""
        className="sticky top-[var(--rf-header-h)] z-30 bg-white py-3"
      >
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <TextInput
          value={term}
          onValueChange={setTerm}
          placeholder="Jump to item, vendor or section…"
          clearLabel="Clear the search"
          className="w-72"
        />
        {/* Segmented control: these four are one choice, so they read as
            one object rather than four loose buttons. */}
        <TabPicker
          ariaLabel="Guide filter"
          value={filter}
          onChange={changeFilter}
          options={GUIDE_FILTERS.map((f) => ({
            key: f,
            label: GUIDE_FILTER_LABEL[f],
            count: filterCounts[f],
          }))}
        />

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
          <TabPicker
            ariaLabel="Group by"
            value={grouping}
            onChange={changeGrouping}
            options={GUIDE_GROUPINGS.map((mode) => ({
              key: mode,
              label: GROUPING_LABEL[mode],
            }))}
          />
        </span>
      </div>
      </div>

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
                // CELL PADDING TAKES A SECOND STEP AT 880 — px-4 → px-2 → px-1
                // — and it buys the guide a real margin on a small iPad (Mark,
                // 2026-08-10: the 10th-gen "seems to zoom in when changing
                // orientation", while the 12.9" Pro was fine).
                //
                // A table cannot render below its min-content, and the six
                // columns left at this width bottomed out at 795px against the
                // 788px a 820pt portrait iPad has to give. So the guide was
                // ~7px wider than the screen at every rotation — enough for
                // iOS Safari to rescale the page to fit, which is what reads as
                // "it zoomed in". The 12.9" hands it 992px and never came near
                // the floor, which is exactly why one iPad showed it and the
                // other didn't.
                //
                // The padding is the honest lever, because the alternative is
                // dropping another column and the ones left all earn their
                // place (see the notes above — Sugg is what count mode is FOR).
                // 4px a side over six columns takes the floor 795 → 751, so the
                // walk now clears a portrait 10th-gen by ~37px with its full
                // 16px page gutter intact, rather than by 5px with the table
                // overrunning the gutter. Safari sets type slightly wider than
                // Chromium, and that margin is what absorbs it.
                <th
                  key={label}
                  className={`sticky top-[calc(var(--rf-header-h)_+_var(--rf-guide-controls-h))] z-20 bg-white px-4 py-3 font-normal shadow-[inset_0_-2px_0_var(--rf-neutral-900)] max-[1180px]:px-2 max-[880px]:px-1 ${extra}`}
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
                        {/* w-0 min-w-full: SIZE ME FROM THE TABLE, never the
                            table from me. See the item header below for the
                            whole argument — a banner row spans every column, so
                            whatever it can't wrap is added to the table's
                            minimum and pushes the guide off the side of an
                            iPad. A section name is one long word away from
                            doing exactly what the last-purchase line did. */}
                        <div className="flex min-h-20 w-0 min-w-full items-center gap-6">
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
                    {/* Item header: bold caps over a 2px black rule. The par
                        used to sit in red on the right, directly above the
                        order boxes, because it's the number you order up TO;
                        it's off behind SHOW_ITEM_PAR while Mark lives without
                        it, leaving only the NO PAR marker for items missing
                        one. What's on the right now is the last purchase. */}
                    {/* `data-guide-item` is what the requests band aims at
                        when you tap an item on a request — see jumpToItem. */}
                    <tr data-guide-item={item.inventory_item_id}>
                      <td colSpan={7} className="px-0 pb-0 pt-12">
                        {/* items-BASELINE, not items-end (Mark, 2026-08-10: the last-purchase
                            text "appears 1 or 2 px lower than the inventory item").
                            It was 2.5px, measured. Bottom-aligning a 12px line
                            against a 22px one lines up their line BOXES, and a
                            line box is font metrics plus half-leading, so the
                            two baselines land apart — which is what the eye
                            reads. Sharing a baseline is the only alignment that
                            makes two different sizes look set on one line. */}
                        {/* w-0 min-w-full, and it is load-bearing on an iPad
                            (Mark, 2026-08-10: content wider than the screen on
                            two of them, and only on this screen).

                            `truncate` is `white-space: nowrap`, and a nowrap
                            element's MIN-CONTENT is its whole string. `min-w-0`
                            doesn't reduce that — it only licenses flex
                            shrinking against a DEFINITE width, and this cell
                            has none: it spans all seven columns of an
                            auto-layout table, so the table's width is being
                            derived FROM this content. The truncation therefore
                            never got a chance to happen; the table just grew.
                            Measured at 820px: the columns' own minimum is
                            795px, and the item headers were forcing 1210 —
                            "STICKER, SAFETY SEAL · last 2026-08-10 · Amazon ·
                            Food Grade Tamper Evident Safety Seal Stickers"
                            being set as one unbreakable line. Every one of the
                            eight widest rows was an item header, which is what
                            named the culprit: the last-purchase subtitle,
                            added the same day.

                            width:0 makes the intrinsic contribution zero (a
                            percentage min-width is ignored while the browser
                            is measuring), then min-width:100% fills the cell
                            once the columns are settled. So the row still
                            spans the table and its 2px rule still runs the
                            full width — the ONLY thing that changes is that it
                            stops voting on how wide the table is, and `truncate`
                            starts doing its job. 1210 → 799 in a 788px box.

                            Anything added to this row from now on inherits
                            that: it can be as long as it likes, and it will be
                            clipped rather than pushing the walk sideways. */}
                        {/* items-END, not baseline (Mark, 2026-08-31). Baseline is right while
                            every child is one line, and wrong the moment the
                            last-purchase label is a paragraph: a flex item's
                            baseline is its FIRST line, so the label pinned its
                            top to the title and hung the rest below — which is
                            what "bottom aligned" was asked for instead. On the
                            bottom edge the block grows UPWARD and its last line
                            stays beside the name. `align-self: last baseline`
                            would express this exactly and is not safe at the
                            Safari 16.4 floor. */}
                        <div className="flex w-0 min-w-full items-end gap-4 border-b-2 border-ink px-4 pb-2 max-[1180px]:px-2 max-[880px]:px-1">
                          {/* items-BASELINE here too, with the triangle opted OUT via self-center.
                            A flex container's baseline comes from its first
                            item that PARTICIPATES in baseline alignment, and
                            the triangle is first in the DOM — so while it
                            participated, the group handed the row the button's
                            baseline instead of the name's and the label landed
                            0.75px high. self-center takes the button out of
                            that chain, which is the point of it: a baseline is
                            for text, and a 28px control has no business
                            claiming one. */}
                          {/* PULLED 6px LEFT (Mark, 2026-08-10), and it is an
                              optical correction rather than a layout change.
                              The ▶ is centred inside a 28px hit box, so while
                              the box lines up with the heart below it — both at
                              64px — the INK starts at 70.21, measured. Six
                              pixels right of every other left edge on the
                              screen, which is what Mark saw and sized by eye.

                              A negative margin on this group rather than
                              padding on the row: the row carries the 2px rule
                              under the item name, and that must keep spanning
                              the table. Flex lays out in order, so the
                              last-purchase label following the name comes along
                              for free — "the whole inventory item line" — while
                              the ml-auto par marker stays pinned right. */}
                          <span className="-ml-1.5 flex min-w-0 max-w-[75%] shrink-0 items-baseline gap-3">
                            {/* The day's other sources for THIS item, without
                                leaving Favorites (see applyExpansions).

                                IT LEADS THE NAME (Mark, 2026-08-10), reversing
                                his own 2026-07-26 call that nothing should sit
                                to the left of the thing you scan for. What
                                changed is that the triangle is now a column in
                                its own right: every header has one, live or
                                greyed, so trailing the name put it at a ragged
                                left edge that moved with the length of every
                                item name. Leading, the triangles line up and
                                the names still start on one margin.

                                A bare triangle at the scale of that name rather
                                than DataTable's small bordered box: this header
                                is a 22px title read standing up and the control
                                has to be hittable at arm's length. Absent
                                entirely outside Favorites — see canExpand. */}
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
                                  className="flex h-7 w-7 shrink-0 self-center items-center justify-center text-[20px] leading-none text-ink transition-colors hover:text-muted"
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
                                  className="flex h-7 w-7 shrink-0 self-center items-center justify-center text-[20px] leading-none text-faint"
                                >
                                  ▶
                                </span>
                              ))}
                            <Link
                              href={withFrom(`/items/${item.inventory_item_id}`, here)}
                              className="truncate text-[22px] font-bold uppercase leading-tight tracking-[0.06em] text-ink no-underline hover:underline"
                            >
                              {item.item_name}
                            </Link>
                          </span>
                          {/* WHAT THIS ITEM WAS LAST BOUGHT, AND AS WHAT
                              (Mark, 2026-08-10). It follows the name directly
                              and stays left (Mark, same day) — it first sat at
                              the far right, in the slot hiding the par freed
                              up, where it was a line of text with the width of
                              the screen between it and the thing it describes.
                              Beside the name it reads as a subtitle of that
                              name, which is what it is.

                              Quiet, and it never competes: it is context, not
                              the decision. A shrink of 3 so it gives way three
                              times faster than the item name — a vendor
                              description is arbitrary text.

                              THE NAME TAKES WHAT IT NEEDS AND THIS TAKES THE
                              REST (Mark, 2026-08-31, in two passes). First: the
                              label "takes up too much space and causes the
                              inventory item to get truncated… especially on
                              tablets" — measured at 820, the portrait iPad this
                              is walked on, it was taking ~420px of a 768px row
                              and the item NAME, the thing you scan for down the
                              walk, read "COCOA POWDER, DUT…". As one `truncate`
                              line its width was set by the longest VENDOR
                              DESCRIPTION in the catalog, which is arbitrary text
                              nobody chose, and it won.

                              Then: "make the inventory item as wide as it needs
                              to be, whatever that is, and use the remaining
                              space on that line". So the name group is
                              `shrink-0` at its natural width and this is
                              `flex-1` — the leftover, whatever that is. A 12rem
                              cap stood here in between and is gone; it was only
                              ever a way of bounding the label without knowing
                              what the name wanted.

                              Measured over all 261 headers AS RENDERED: the
                              widest name group is 430px ("Flour, Mix, Raised,
                              Non-Vegan" plus the triangle), which is 57% of the
                              row at 768 — the portrait iPad, and the narrowest
                              width this is really used at. `max-w-[75%]` is
                              therefore a safety valve rather than a working
                              limit: it cannot bite until about a 550px window,
                              and it is what stops a pathologically long name
                              pushing the label to nothing and the par off the
                              screen. The link keeps `truncate` as the failure
                              when it does, which is the old behaviour and a
                              graceful one.

                              Measure this as RENDERED, never with a probe span
                              carrying only `font`: the title is
                              `tracking-[0.06em]` and the `font` shorthand does
                              not include letter-spacing, so a probe reports
                              309px for a name that really occupies 390 — which
                              is how the cap first got set to 60% with a
                              three-point margin.

                              `line-clamp-3` rather than a fourth line, because
                              past three the block is taller than the 22px title
                              it hangs off and starts to read as the row's
                              content rather than its footnote. With the row's
                              full leftover most labels now fit on ONE.

                              Bottom alignment is the ROW's (`items-end`, see
                              there) rather than a `self-end` here, because the
                              par marker needs it too — its own bottom is what
                              the title is level with. */}
                          <span className="line-clamp-3 min-w-0 flex-1 text-[11px] leading-[1.25] tracking-[0.02em] text-muted">
                            {/* Suppressed entirely when the view is unreadable,
                                because `lastPurchaseLabel` renders a missing
                                row as "never ordered here" — true when the view
                                answered and said nothing, a lie when it never
                                answered at all. The note under the title
                                carries the reason instead. */}
                            {!lastPurchaseError &&
                              lastPurchaseLabel(
                                lastByItemLocation.get(item.lines[0].item_location_id),
                                item.item_name,
                                item.base_unit
                              )}
                          </span>
                          <span className="ml-auto shrink-0">
                            {item.par_qty === null ? (
                              // A missing par is a gap to fix, not an alarm —
                              // red is reserved for the number you order up to.
                              <span className="text-xs uppercase tracking-[0.12em] text-faint">
                                no par
                              </span>
                            ) : SHOW_ITEM_PAR ? (
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
                            ) : null}
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
                        backHref={here}
                        ignoreDays={ignoreDays}
                        itemPar={item.par_qty}
                        baseUnit={item.base_unit}
                        // Compared against the LINE's own vendor item, not the
                        // item's — an item with four sources gets at most one
                        // star, on the one it was actually bought from.
                        wasLastPurchased={
                          !lastPurchaseError &&
                          lastByItemLocation.get(row.item_location_id)
                            ?.vendor_item_id === row.vendor_item_id
                        }
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
