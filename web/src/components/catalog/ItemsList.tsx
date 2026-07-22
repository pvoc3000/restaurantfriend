"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { STALE_ORDER, STALE_LABEL, type StaleBucket } from "@/lib/lastOrdered";
import { money, qty, vendorItemLabel } from "@/lib/catalog";
import type { ItemRow } from "@/app/(app)/items/page";

type ActiveTab = "active" | "inactive" | "all";
type StaleTab = StaleBucket | "any";

const ACTIVE_TABS: { key: ActiveTab; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "inactive", label: "Inactive" },
  { key: "all", label: "All" },
];

/**
 * The general catalog list (brief §D) — search / category / active /
 * last-ordered, with multi-select deactivate. Unlike /cleanup this shows the
 * whole catalog, healthy rows included; it's the way in to item detail.
 */
export function ItemsList({
  items,
  categories,
  activeLocationCode,
}: {
  items: ItemRow[];
  categories: string[];
  activeLocationCode: string | null;
}) {
  const router = useRouter();
  const supabase = createClient();

  const [term, setTerm] = useState("");
  const [category, setCategory] = useState<string>("");
  const [activeTab, setActiveTab] = useState<ActiveTab>("active");
  const [staleTab, setStaleTab] = useState<StaleTab>("any");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visible = useMemo(() => {
    const t = term.trim().toLowerCase();
    return items.filter((i) => {
      if (activeTab === "active" && !i.is_active) return false;
      if (activeTab === "inactive" && i.is_active) return false;
      if (category && i.category !== category) return false;
      if (staleTab !== "any" && i.stale !== staleTab) return false;
      if (!t) return true;
      const vi = i.inventory_item_locations[0]?.vendor_items ?? null;
      return (
        i.name.toLowerCase().includes(t) ||
        (i.category ?? "").toLowerCase().includes(t) ||
        (vi?.vendors?.name ?? "").toLowerCase().includes(t) ||
        (vi !== null && vendorItemLabel(vi).toLowerCase().includes(t))
      );
    });
  }, [items, term, category, activeTab, staleTab]);

  const staleCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const i of items) c[i.stale] = (c[i.stale] ?? 0) + 1;
    return c;
  }, [items]);

  const visibleIds = visible.map((i) => i.id);
  const allVisibleChecked =
    visibleIds.length > 0 && visibleIds.every((id) => checked.has(id));

  function toggleAllVisible() {
    setChecked((prev) => {
      const next = new Set(prev);
      if (allVisibleChecked) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  }

  function toggleOne(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // "Here" deactivates the item-location rows at the current location; the
  // catalog master stays active elsewhere. "Everywhere" deactivates the item
  // itself — same two scopes the cleanup drawer offers, one item at a time.
  async function deactivate(scope: "here" | "everywhere") {
    const rows = items.filter((i) => checked.has(i.id));
    if (rows.length === 0) return;
    setBusy(true);
    setError(null);

    if (scope === "here") {
      const ilIds = rows
        .map((r) => r.inventory_item_locations[0]?.id)
        .filter((id): id is string => !!id);
      if (ilIds.length === 0) {
        setError("None of the selected items are stocked at this location.");
        setBusy(false);
        return;
      }
      const { error } = await supabase
        .from("inventory_item_locations")
        .update({ is_active: false })
        .in("id", ilIds);
      if (error) {
        setError(error.message);
        setBusy(false);
        return;
      }
    } else {
      const { error } = await supabase
        .from("inventory_items")
        .update({ is_active: false })
        .in(
          "id",
          rows.map((r) => r.id)
        );
      if (error) {
        setError(error.message);
        setBusy(false);
        return;
      }
    }

    setChecked(new Set());
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-xl font-semibold">Items</h1>
        <span className="text-sm text-neutral-500">
          {visible.length} of {items.length}
          {activeLocationCode ? ` · ${activeLocationCode}` : ""}
        </span>
      </div>

      {/* Search + category */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search name, category, vendor…"
          className="w-72 rounded border border-neutral-300 px-2 py-1 text-sm"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded border border-neutral-300 bg-white px-2 py-1 text-sm"
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-1 text-sm">
          {ACTIVE_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`rounded px-2 py-1 ${
                activeTab === t.key
                  ? "bg-neutral-900 text-white"
                  : "text-neutral-600 hover:bg-neutral-100"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Last-ordered filter — same buckets as the cleanup queue */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-neutral-400">
          Last ordered
        </span>
        {(["any", ...STALE_ORDER] as StaleTab[]).map((t) => {
          const count = t === "any" ? items.length : staleCounts[t] ?? 0;
          const label = t === "any" ? "Any age" : STALE_LABEL[t];
          const on = staleTab === t;
          return (
            <button
              key={t}
              onClick={() => setStaleTab(t)}
              className={`rounded-full border px-3 py-1 text-sm ${
                on
                  ? "border-amber-700 bg-amber-700 text-white"
                  : "border-neutral-300 text-neutral-700 hover:bg-neutral-100"
              }`}
            >
              {label}
              <span className={`ml-1.5 ${on ? "text-amber-200" : "text-neutral-400"}`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {checked.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm">
          <span>{checked.size} selected</span>
          <button
            disabled={busy}
            onClick={() => deactivate("here")}
            className="rounded border border-neutral-300 bg-white px-3 py-1 hover:bg-neutral-100 disabled:opacity-50"
          >
            Deactivate here{activeLocationCode ? ` (${activeLocationCode})` : ""}
          </button>
          <button
            disabled={busy}
            onClick={() => deactivate("everywhere")}
            className="rounded bg-red-700 px-3 py-1 text-white hover:bg-red-800 disabled:opacity-50"
          >
            Deactivate everywhere
          </button>
          <button
            onClick={() => setChecked(new Set())}
            className="text-neutral-600 hover:underline"
          >
            Clear
          </button>
          {error && <span className="text-red-700">{error}</span>}
        </div>
      )}

      {visible.length === 0 ? (
        <p className="text-sm text-neutral-600">No items match these filters.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-neutral-300 text-left text-neutral-600">
                <th className="w-8 px-2 py-1">
                  <input
                    type="checkbox"
                    checked={allVisibleChecked}
                    onChange={toggleAllVisible}
                    aria-label="select all"
                  />
                </th>
                <th className="px-2 py-1 font-medium">Item</th>
                <th className="px-2 py-1 font-medium">Category</th>
                <th className="px-2 py-1 font-medium">Section</th>
                <th className="px-2 py-1 font-medium text-right">Par</th>
                <th className="px-2 py-1 font-medium">Unit</th>
                <th className="px-2 py-1 font-medium">Default vendor item</th>
                <th className="px-2 py-1 font-medium text-right">Price</th>
                <th className="px-2 py-1 font-medium">Last ordered</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => {
                const il = item.inventory_item_locations[0] ?? null;
                const vi = il?.vendor_items ?? null;
                return (
                  <tr
                    key={item.id}
                    className={`border-b border-neutral-100 hover:bg-neutral-50 ${
                      item.is_active ? "" : "text-neutral-400"
                    }`}
                  >
                    <td className="px-2 py-1">
                      <input
                        type="checkbox"
                        checked={checked.has(item.id)}
                        onChange={() => toggleOne(item.id)}
                        aria-label={`select ${item.name}`}
                      />
                    </td>
                    <td className="px-2 py-1">
                      <Link
                        href={`/items/${item.id}`}
                        className="text-blue-700 hover:underline"
                      >
                        {item.name}
                      </Link>
                      {!item.is_active && (
                        <span className="ml-1.5 rounded bg-neutral-200 px-1 text-xs text-neutral-600">
                          inactive
                        </span>
                      )}
                      {!il && (
                        <span className="ml-1.5 rounded bg-amber-100 px-1 text-xs text-amber-800">
                          not stocked here
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1 text-neutral-600">
                      {item.category ?? "—"}
                    </td>
                    <td className="px-2 py-1 text-neutral-600">
                      {il?.shop_sections?.display_name ?? "—"}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums text-neutral-600">
                      {qty(il?.default_par)}
                    </td>
                    <td className="px-2 py-1 text-neutral-600">{item.base_unit}</td>
                    <td className="px-2 py-1 text-neutral-600">
                      {vi ? (
                        <>
                          <span className="font-medium text-neutral-700">
                            {vi.vendors?.name ?? "—"}
                          </span>{" "}
                          {vendorItemLabel(vi)}
                          {vi.package_desc ? (
                            <span className="text-neutral-500"> · {vi.package_desc}</span>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-neutral-400">none</span>
                      )}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums text-neutral-600">
                      {money(vi?.price)}
                    </td>
                    <td className="px-2 py-1 tabular-nums">
                      {item.last_order_date ? (
                        <span className="text-neutral-600">{item.last_order_date}</span>
                      ) : (
                        <span className="text-amber-700">never</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
