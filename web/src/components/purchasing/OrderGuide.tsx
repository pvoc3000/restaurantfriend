"use client";

import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { money } from "@/lib/purchaseOrders";
import {
  groupGuide,
  vendorTotals,
  GROUPING_LABEL,
  WEEKDAY_LABELS,
  type EntryState,
  type GuideEntry,
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
  availableDays,
  guideDate,
  locationId,
  locationCode,
  orgId,
}: {
  rows: GuideRow[];
  entries: GuideEntry[];
  weekday: number;
  availableDays: number[];
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
  const [onlyTouched, setOnlyTouched] = useState(false);
  const [term, setTerm] = useState("");
  // Grouping is client-side only — the rows are already loaded, so switching
  // between the walk, an A–Z list and a per-vendor view costs nothing.
  const [grouping, setGrouping] = useState<GuideGrouping>("section");

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
      if (onlyTouched) {
        const entry = entries.get(row.vendor_item_id);
        if (!entry || (entry.qty_to_order === null && entry.on_hand === null)) return false;
      }
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
  }, [rows, entries, term, onlyTouched]);

  const sections = useMemo(
    () => groupGuide(visibleRows, grouping),
    [visibleRows, grouping]
  );
  const totals = useMemo(() => vendorTotals(rows, entries), [rows, entries]);
  const grandTotal = totals.reduce((sum, t) => (t.short ? sum : sum + t.subtotal), 0);
  const shortTotal = totals.reduce((sum, t) => (t.short ? sum + t.subtotal : sum), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-xl font-semibold">Order guide</h1>
        <span className="text-sm text-neutral-500">
          {locationCode} · {WEEKDAY_LABELS[weekday - 1]} plan · walked {guideDate}
        </span>
        {availableDays.length > 1 && (
          <span className="flex items-center gap-1 text-sm">
            {availableDays.map((d) => (
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
        )}
        <button
          onClick={() => router.refresh()}
          className="ml-auto text-sm text-neutral-500 hover:underline"
        >
          Refresh
        </button>
      </div>

      {/* Vendor totals bar — the guide's central instrument (§4.2). Sticky so
          it stays visible while you walk. */}
      <div className="sticky top-0 z-20 space-y-2 border-b border-neutral-200 bg-white/95 py-2 backdrop-blur">
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
        <label className="flex items-center gap-1.5 text-neutral-700">
          <input
            type="checkbox"
            checked={onlyTouched}
            onChange={(e) => setOnlyTouched(e.target.checked)}
          />
          Only lines I&apos;ve touched
        </label>
        <span className="flex items-center gap-1">
          <span className="text-xs uppercase tracking-wide text-neutral-400">
            Group by
          </span>
          {(["section", "item", "vendor"] as GuideGrouping[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setGrouping(mode)}
              className={`rounded px-2 py-1 ${
                grouping === mode
                  ? "bg-neutral-900 text-white"
                  : "text-neutral-600 hover:bg-neutral-100"
              }`}
            >
              {GROUPING_LABEL[mode]}
            </button>
          ))}
        </span>

        <span className="text-neutral-500">
          {visibleRows.length} of {rows.length} lines
        </span>
      </div>

      {sections.length === 0 ? (
        <p className="text-sm text-neutral-600">
          No plan lines for this day. Favorites on the item detail screen decide
          what appears here.
        </p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-neutral-300 text-left text-neutral-600">
              <th className="px-2 py-1 font-medium">Item / vendor item</th>
              <th className="w-20 px-2 py-1 text-right font-medium">On hand</th>
              <th className="w-16 px-2 py-1 text-right font-medium">Sugg.</th>
              <th className="w-20 px-2 py-1 text-right font-medium">Order</th>
              <th className="w-24 px-2 py-1 text-right font-medium">Line</th>
            </tr>
          </thead>
          <tbody>
            {sections.map((section) => (
              <Fragment key={section.key}>
                {section.showHeader && (
                  <tr className="border-b border-neutral-300 bg-neutral-100">
                    <td
                      colSpan={5}
                      className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-neutral-700"
                    >
                      {section.label}
                      <span className="ml-2 font-normal normal-case tracking-normal text-neutral-500">
                        {section.items.length}
                      </span>
                    </td>
                  </tr>
                )}

                {section.items.map((item) => (
                  <Fragment key={item.inventory_item_id}>
                    <tr className="border-b border-neutral-100 bg-neutral-50">
                      <td colSpan={5} className="px-2 py-1">
                        <Link
                          href={`/items/${item.inventory_item_id}`}
                          className="font-medium text-blue-700 hover:underline"
                        >
                          {item.item_name}
                        </Link>
                        <span className="ml-2 text-xs text-neutral-500">
                          par {item.par_qty ?? "—"} {item.base_unit}
                        </span>
                      </td>
                    </tr>

                    {item.lines.map((row) => (
                      <GuideLine
                        key={row.vendor_item_id}
                        row={row}
                        entry={entries.get(row.vendor_item_id)}
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
      )}
    </div>
  );
}
