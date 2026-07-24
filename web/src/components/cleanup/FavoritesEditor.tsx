"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// ISO weekdays 1=Mon … 7=Sun (CLAUDE.md). All ordering is Monday today, so Mon
// leads; the rest stay available but unobtrusive.
const DAYS: { weekday: number; label: string }[] = [
  { weekday: 1, label: "M" },
  { weekday: 2, label: "T" },
  { weekday: 3, label: "W" },
  { weekday: 4, label: "T" },
  { weekday: 5, label: "F" },
  { weekday: 6, label: "S" },
  { weekday: 7, label: "S" },
];

type VendorItem = {
  id: string;
  description: string | null;
  brand: string | null;
  package_desc: string | null;
  vendors: { name: string } | null;
};

// key = `${weekday}|${vendorItemId}` → the plan row id (for delete)
type PlanMap = Map<string, string>;
const key = (weekday: number, viId: string) => `${weekday}|${viId}`;

type FetchResult = { error: string } | { vendorItems: VendorItem[]; plan: PlanMap };

/**
 * Multi-favorite plan-row editor (brief §A, schema 003): a weekday × vendor-item
 * checkbox grid. Each checked cell is an order_guide_plan_days row favoriting that
 * vendor item on that weekday for this item-location. An item can have several
 * favorites on the same day (multi-vendor sourcing or pack-size variants).
 *
 * A favorite is one of the should-order conditions, not membership (schema
 * 008): checking a day-cell no longer implicitly turns the item's order day on
 * — that's the item-location's own order_days array, edited in the row above.
 */
export function FavoritesEditor({
  itemLocationId,
  inventoryItemId,
  orgId,
  onChanged,
}: {
  itemLocationId: string;
  inventoryItemId: string;
  orgId: string;
  onChanged: () => void;
}) {
  const supabase = createClient();
  const [vendorItems, setVendorItems] = useState<VendorItem[] | null>(null);
  const [plan, setPlan] = useState<PlanMap>(new Map());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pure fetch (no setState) so it's safe to call from the effect and reuse
  // from handlers after a write.
  const fetchState = useCallback(async (): Promise<FetchResult> => {
    const [{ data: vis, error: viErr }, { data: rows, error: rowErr }] =
      await Promise.all([
        supabase
          .from("vendor_items")
          // vendors!inner + the filter hides items from deactivated vendors.
          .select("id, description, brand, package_desc, vendors!inner ( name, is_active )")
          .eq("inventory_item_id", inventoryItemId)
          .eq("is_active", true)
          .eq("vendors.is_active", true)
          .order("id"),
        supabase
          .from("order_guide_plan_days")
          .select("id, weekday, vendor_item_id")
          .eq("item_location_id", itemLocationId),
      ]);
    if (viErr || rowErr) return { error: (viErr ?? rowErr)!.message };
    const m: PlanMap = new Map();
    for (const r of rows ?? []) {
      // vendor_item_id is NOT NULL since 008 — every plan row is a cell.
      m.set(key(r.weekday, r.vendor_item_id), r.id);
    }
    return { vendorItems: (vis ?? []) as unknown as VendorItem[], plan: m };
  }, [supabase, inventoryItemId, itemLocationId]);

  const apply = useCallback(
    (res: Awaited<ReturnType<typeof fetchState>>) => {
      if ("error" in res) setError(res.error);
      else {
        setVendorItems(res.vendorItems);
        setPlan(res.plan);
      }
    },
    []
  );

  const load = useCallback(async () => apply(await fetchState()), [apply, fetchState]);

  useEffect(() => {
    let cancelled = false;
    fetchState().then((res) => {
      if (!cancelled) apply(res);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchState, apply]);

  async function toggle(weekday: number, viId: string, on: boolean) {
    setBusy(true);
    setError(null);
    const k = key(weekday, viId);
    if (on) {
      const { error } = await supabase.from("order_guide_plan_days").insert({
        org_id: orgId,
        item_location_id: itemLocationId,
        weekday,
        vendor_item_id: viId,
      });
      if (error) setError(error.message);
    } else {
      const id = plan.get(k);
      if (id) {
        const { error } = await supabase
          .from("order_guide_plan_days")
          .delete()
          .eq("id", id);
        if (error) setError(error.message);
      }
    }
    await load();
    setBusy(false);
    onChanged();
  }

  async function toggleAllDays(viId: string, on: boolean) {
    setBusy(true);
    setError(null);
    if (on) {
      const missing = DAYS.filter((d) => !plan.has(key(d.weekday, viId)));
      if (missing.length > 0) {
        const { error } = await supabase.from("order_guide_plan_days").insert(
          missing.map((d) => ({
            org_id: orgId,
            item_location_id: itemLocationId,
            weekday: d.weekday,
            vendor_item_id: viId,
          }))
        );
        if (error) setError(error.message);
      }
    } else {
      const ids = DAYS.map((d) => plan.get(key(d.weekday, viId))).filter(
        Boolean
      ) as string[];
      if (ids.length > 0) {
        const { error } = await supabase
          .from("order_guide_plan_days")
          .delete()
          .in("id", ids);
        if (error) setError(error.message);
      }
    }
    await load();
    setBusy(false);
    onChanged();
  }

  if (vendorItems === null)
    return <p className="text-sm text-neutral-500">Loading favorites…</p>;

  if (vendorItems.length === 0)
    return (
      <p className="text-sm text-neutral-600">
        No active vendor items to favorite yet — assign one above first.
      </p>
    );

  return (
    <div className="space-y-2 text-sm">
      {error && <p className="text-red-700">{error}</p>}

      <div className="overflow-x-auto">
        <table className="border-collapse">
          <thead>
            <tr className="text-neutral-500">
              <th className="px-1 py-1 text-left font-medium">Vendor item</th>
              {DAYS.map((d, i) => (
                <th key={i} className="w-7 px-1 py-1 text-center font-medium">
                  {d.label}
                </th>
              ))}
              <th className="px-1 py-1 text-center font-medium">all</th>
            </tr>
          </thead>
          <tbody>
            {vendorItems.map((vi) => {
              const allOn = DAYS.every((d) => plan.has(key(d.weekday, vi.id)));
              return (
                <tr key={vi.id} className="border-t border-neutral-100">
                  <td className="max-w-[11rem] px-1 py-1">
                    <div className="truncate">
                      <span className="font-medium">{vi.vendors?.name ?? "—"}</span>{" "}
                      <span className="text-neutral-500">
                        {vi.package_desc ?? ""}
                      </span>
                    </div>
                    <div className="truncate text-xs text-neutral-500">
                      {vi.brand ? `${vi.brand} · ` : ""}
                      {vi.description ?? ""}
                    </div>
                  </td>
                  {DAYS.map((d, i) => {
                    const on = plan.has(key(d.weekday, vi.id));
                    return (
                      <td key={i} className="px-1 py-1 text-center">
                        <input
                          type="checkbox"
                          checked={on}
                          disabled={busy}
                          onChange={(e) => toggle(d.weekday, vi.id, e.target.checked)}
                          aria-label={`${vi.vendors?.name ?? "vendor"} day ${d.weekday}`}
                        />
                      </td>
                    );
                  })}
                  <td className="px-1 py-1 text-center">
                    <input
                      type="checkbox"
                      checked={allOn}
                      disabled={busy}
                      onChange={(e) => toggleAllDays(vi.id, e.target.checked)}
                      aria-label="all days"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-neutral-500">
        Several favorites on one day = pick the source at order time (multi-vendor
        or pack sizes). If the variants are <em>distinct needs</em> each deserving
        its own par/on-hand (e.g. San Pellegrino flavors), split them into
        separate items instead.
      </p>
    </div>
  );
}
