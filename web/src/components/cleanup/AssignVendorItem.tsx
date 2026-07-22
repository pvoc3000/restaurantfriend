"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type VendorItemRow = {
  id: string;
  description: string | null;
  brand: string | null;
  package_desc: string | null;
  package_content: number | null;
  price: number | null;
  is_active: boolean;
  inventory_item_id: string | null;
  vendors: { name: string; is_active: boolean } | null;
};

// vendors!inner + the .eq("vendors.is_active", true) filter on each query keeps
// items from DEACTIVATED vendors out of the choice lists (an individually
// inactive vendor item under an active vendor can still appear, badged).
const SELECT =
  "id, description, brand, package_desc, package_content, price, is_active, inventory_item_id, vendors!inner ( name, is_active )";

function money(v: number | null) {
  return v === null || v === undefined
    ? "—"
    : `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
}

/**
 * Fixes "no default vendor item" / "default inactive" (brief P2 #1): pick one of
 * the item's own vendor items, or search all vendor items and link one to this
 * item. Also offers deactivating the item here or everywhere (many broken rows
 * are dead items).
 */
export function AssignVendorItem({
  itemLocationId,
  inventoryItemId,
  currentDefaultId,
  onChanged,
}: {
  itemLocationId: string;
  inventoryItemId: string;
  currentDefaultId: string | null;
  onChanged: () => void;
}) {
  const supabase = createClient();
  const [own, setOwn] = useState<VendorItemRow[] | null>(null);
  const [searchAll, setSearchAll] = useState(false);
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<VendorItemRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The item's own vendor items — the common case.
  useEffect(() => {
    let cancelled = false;
    supabase
      .from("vendor_items")
      .select(SELECT)
      .eq("inventory_item_id", inventoryItemId)
      .eq("vendors.is_active", true)
      .order("is_active", { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) setError(error.message);
        else setOwn((data ?? []) as unknown as VendorItemRow[]);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, inventoryItemId]);

  // Broadened search across all vendor items. Results are only rendered when
  // the term is long enough (see below), so no synchronous clear is needed.
  const canSearch = searchAll && term.trim().length >= 2;
  useEffect(() => {
    if (!canSearch) return;
    let cancelled = false;
    const t = term.trim();
    supabase
      .from("vendor_items")
      .select(SELECT)
      .eq("vendors.is_active", true)
      .or(`description.ilike.%${t}%,brand.ilike.%${t}%,product_id.ilike.%${t}%`)
      .limit(25)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) setError(error.message);
        else setResults((data ?? []) as unknown as VendorItemRow[]);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, canSearch, term]);

  async function assign(vi: VendorItemRow) {
    setBusy(true);
    setError(null);
    // If this vendor item isn't linked to this inventory item yet (it came from
    // the broad search), link it first — otherwise the guide view can't resolve
    // alternates for the item.
    if (vi.inventory_item_id !== inventoryItemId) {
      const { error: linkErr } = await supabase
        .from("vendor_items")
        .update({ inventory_item_id: inventoryItemId })
        .eq("id", vi.id);
      if (linkErr) {
        setError(linkErr.message);
        setBusy(false);
        return;
      }
    }
    const { error } = await supabase
      .from("item_locations")
      .update({ default_vendor_item_id: vi.id })
      .eq("id", itemLocationId);
    setBusy(false);
    if (error) setError(error.message);
    else onChanged();
  }

  async function deactivate(scope: "here" | "everywhere") {
    setBusy(true);
    setError(null);
    const { error } =
      scope === "here"
        ? await supabase
            .from("item_locations")
            .update({ is_active: false })
            .eq("id", itemLocationId)
        : await supabase
            .from("inventory_items")
            .update({ is_active: false })
            .eq("id", inventoryItemId);
    setBusy(false);
    if (error) setError(error.message);
    else onChanged();
  }

  function row(vi: VendorItemRow) {
    const isCurrent = vi.id === currentDefaultId;
    return (
      <li
        key={vi.id}
        className="flex items-center gap-2 border-b border-neutral-100 py-1.5 text-sm"
      >
        <div className="min-w-0 flex-1">
          <div className="truncate">
            <span className="font-medium">{vi.vendors?.name ?? "—"}</span>{" "}
            <span className="text-neutral-600">
              {vi.brand ? `${vi.brand} · ` : ""}
              {vi.description ?? "—"}
            </span>
          </div>
          <div className="text-xs text-neutral-500">
            {vi.package_desc ?? "?"} · {money(vi.price)}
            {vi.package_content !== null ? ` · ${vi.package_content}/pkg` : ""}
            {!vi.is_active && (
              <span className="ml-1 rounded bg-neutral-200 px-1 text-neutral-600">
                inactive
              </span>
            )}
            {vi.vendors && !vi.vendors.is_active && (
              <span className="ml-1 rounded bg-neutral-200 px-1 text-neutral-600">
                vendor inactive
              </span>
            )}
          </div>
        </div>
        <button
          disabled={busy || isCurrent}
          onClick={() => assign(vi)}
          className="shrink-0 rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 disabled:opacity-40"
        >
          {isCurrent ? "current" : "Set default"}
        </button>
      </li>
    );
  }

  return (
    <div className="space-y-2">
      {error && <p className="text-sm text-red-700">{error}</p>}

      {own === null ? (
        <p className="text-sm text-neutral-500">Loading vendor items…</p>
      ) : own.length === 0 ? (
        <p className="text-sm text-neutral-600">
          This item has no vendor items of its own — search all below.
        </p>
      ) : (
        <ul>{own.map(row)}</ul>
      )}

      <label className="flex items-center gap-2 text-sm text-neutral-700">
        <input
          type="checkbox"
          checked={searchAll}
          onChange={(e) => setSearchAll(e.target.checked)}
        />
        Search all vendor items and link one to this item
      </label>

      {searchAll && (
        <div className="space-y-1">
          <input
            autoFocus
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search description / brand / product ID…"
            className="w-full rounded border border-neutral-300 px-2 py-1 text-sm"
          />
          {canSearch && results.length > 0 && <ul>{results.map(row)}</ul>}
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        <button
          disabled={busy}
          onClick={() => deactivate("here")}
          className="rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-100 disabled:opacity-40"
        >
          Deactivate item here
        </button>
        <button
          disabled={busy}
          onClick={() => deactivate("everywhere")}
          className="rounded border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-40"
        >
          Deactivate item everywhere
        </button>
      </div>
    </div>
  );
}
