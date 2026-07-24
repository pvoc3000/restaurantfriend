"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { money } from "@/lib/purchaseOrders";
import { withFrom } from "@/lib/breadcrumbs";
import {
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

  const sections = useMemo(
    () => groupGuide(visibleRows, grouping),
    [visibleRows, grouping]
  );
  const totals = useMemo(() => vendorTotals(rows, entries), [rows, entries]);
  const grandTotal = totals.reduce((sum, t) => (t.short ? sum : sum + t.subtotal), 0);
  const shortTotal = totals.reduce((sum, t) => (t.short ? sum + t.subtotal : sum), 0);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-xl font-semibold">Order guide</h1>
        <span className="text-sm text-neutral-500">
          {locationCode} · {ignoreDays ? "all days" : WEEKDAY_LABELS[weekday - 1]} ·
          walked {guideDate}
        </span>
        {/* All seven days, always. The guide exists every day — picking one
            scopes the list to what's orderable then, and a day with nothing
            scheduled simply renders empty rather than disappearing. */}
        <span className="flex items-center gap-1 text-sm">
          {[1, 2, 3, 4, 5, 6, 7].map((d) => (
            <Link
              key={d}
              href={`/order-guide?day=${d}`}
              className={`rounded px-2 py-1 ${
                d === weekday
                  ? "bg-neutral-900 text-white"
                  : "text-neutral-600 hover:bg-neutral-100"
              }`}
            >
              {WEEKDAY_LABELS[d - 1]}
            </Link>
          ))}
        </span>
        <button
          onClick={() => router.refresh()}
          className="ml-auto text-sm text-neutral-500 hover:underline"
        >
          Refresh
        </button>
      </div>

      {/* Vendor totals bar — the guide's central instrument (§4.2). */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {totals.length === 0 ? (
            <span className="text-sm text-neutral-500">
              Nothing ordered yet — quantities you enter total up here by vendor.
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
                className={`rounded-full border px-3 py-1 text-sm ${
                  t.short
                    ? "border-red-300 bg-red-50 text-red-800"
                    : "border-green-300 bg-green-50 text-green-900"
                }`}
              >
                {t.vendor_name}{" "}
                <span className="tabular-nums">
                  {money(t.subtotal)}
                  {t.minimum !== null ? ` / ${money(t.minimum)}` : ""}
                </span>
              </span>
            ))
          )}

          <span className="ml-auto text-sm">
            <span className="text-neutral-500">Will order </span>
            <span className="font-medium tabular-nums">{money(grandTotal)}</span>
            {shortTotal > 0 && (
              <span className="ml-2 text-red-700" title="Vendors under their minimum">
                +{money(shortTotal)} blocked
              </span>
            )}
          </span>
        </div>
        {error && <p className="text-sm text-red-700">{error}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Jump to item, vendor or section…"
          className="w-72 rounded border border-neutral-300 px-2 py-1"
        />
        {/* Segmented control: these four are one choice, so they read as one
            object rather than four loose buttons. */}
        <span className="inline-flex items-stretch overflow-hidden rounded-md border border-neutral-300">
          {GUIDE_FILTERS.map((f, i) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2.5 py-1 font-medium ${
                i > 0 ? "border-l border-neutral-300" : ""
              } ${
                filter === f
                  ? "bg-neutral-900 text-white"
                  : "bg-white text-neutral-600 hover:bg-neutral-100"
              }`}
            >
              {GUIDE_FILTER_LABEL[f]}
              <span className="ml-1.5 font-normal text-neutral-400">
                {filterCounts[f]}
              </span>
            </button>
          ))}
        </span>

        {/* The escape hatch from the day gates (FMP's "ignore order day"):
            every orderable line, whenever you'd normally buy it. A switch, not
            a button — it's a mode you leave on, not an action you fire. Amber
            rather than the ActiveToggle green, which is already spoken for by
            the order boxes. */}
        <button
          type="button"
          role="switch"
          aria-checked={ignoreDays}
          onClick={() => setIgnoreDays((v) => !v)}
          title="Show every orderable line, regardless of vendor or item ordering days"
          className="inline-flex items-center gap-2 text-neutral-600 hover:text-neutral-900"
        >
          <span
            aria-hidden
            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
              ignoreDays ? "bg-amber-600" : "bg-neutral-300"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                ignoreDays ? "translate-x-4" : "translate-x-0.5"
              }`}
            />
          </span>
          Ignore ordering days
        </button>

        <span className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-neutral-400">
            Group by
          </span>
          <span className="inline-flex items-stretch overflow-hidden rounded-md border border-neutral-300">
            {GUIDE_GROUPINGS.map((mode, i) => (
              <button
                key={mode}
                onClick={() => setGrouping(mode)}
                className={`px-2 py-1 ${i > 0 ? "border-l border-neutral-300" : ""} ${
                  grouping === mode
                    ? "bg-neutral-900 text-white"
                    : "bg-white text-neutral-600 hover:bg-neutral-100"
                }`}
              >
                {GROUPING_LABEL[mode]}
              </button>
            ))}
          </span>
        </span>

        <span className="text-neutral-500">
          {visibleRows.length} of {rows.length} lines
        </span>
      </div>

      {sections.length === 0 ? (
        <p className="pt-4 text-sm text-neutral-600">
          {filter === "favorites" || filter === "skipped"
            ? "No favorites for this day — nothing here has it in the vendor, item, and favorite order days. Switch to All to see everything orderable this day."
            : ignoreDays
              ? "No lines match. Every orderable line is listed — check the search box."
              : "No lines for this day — no vendor takes orders and no item is scheduled. Turn on “Ignore ordering days” to see everything orderable."}
        </p>
      ) : (
        // The lines scroll in their own pane, so the controls above stay put
        // without the page itself sticking anything. Sized to the rest of the
        // viewport, with a floor for short windows.
        <div className="max-h-[calc(100vh-15rem)] min-h-64 overflow-auto rounded border border-neutral-300">
        <table className="w-full border-collapse text-sm">
          <thead>
            {/* Sticky to the PANE, not the page — and on the cells, since
                Safari won't make a <thead>/<tr> a sticky container. */}
            <tr className="text-left text-xs uppercase tracking-wide text-neutral-600">
              {[
                ["Vendor", ""],
                ["Description", ""],
                ["Pack", ""],
                ["Price", "text-right"],
                ["On hand", "w-20 text-right"],
                ["Sugg", "w-12 text-right"],
                ["Order", "w-56 text-right"],
                ["Line", "w-24 text-right"],
              ].map(([label, extra]) => (
                <th
                  key={label}
                  className={`sticky top-0 z-20 bg-white px-2 py-1 font-semibold shadow-[inset_0_-2px_0_#171717] ${extra}`}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sections.map((section) => (
              <Fragment key={section.key}>
                {section.showHeader && (
                  <tr className="bg-neutral-900">
                    <td
                      colSpan={8}
                      className="px-3 py-2 text-center text-base font-bold uppercase tracking-wide text-white"
                    >
                      {section.label}
                      <span className="ml-3 text-sm font-normal text-neutral-400">
                        {section.items.length}
                      </span>
                    </td>
                  </tr>
                )}

                {section.items.map((item) => (
                  <Fragment key={item.inventory_item_id}>
                    <tr className="border-t-2 border-neutral-300">
                      <td colSpan={6} className="px-2 pb-0.5 pt-3">
                        <Link
                          href={withFrom(`/items/${item.inventory_item_id}`, here)}
                          className="text-base font-bold uppercase tracking-tight text-neutral-900 underline decoration-neutral-400 underline-offset-4 hover:decoration-neutral-900"
                        >
                          {item.item_name}
                        </Link>
                      </td>
                      {/* Par sits directly above the order boxes, as in FMP —
                          it's the number you're ordering up TO. */}
                      <td className="px-2 pb-0.5 pt-3 text-right">
                        {item.par_qty === null ? (
                          // A missing par is a gap to fix, not an alarm — the
                          // red is reserved for the number you order up to.
                          <span className="text-xs uppercase tracking-wide text-neutral-400">
                            no par
                          </span>
                        ) : (
                          <span className="whitespace-nowrap text-sm font-bold uppercase tracking-wide text-red-700">
                            par {Number(item.par_qty)} {item.base_unit}
                          </span>
                        )}
                      </td>
                      <td />
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
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}
