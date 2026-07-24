"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type ItemRow = {
  id: string;
  name: string;
  category: string | null;
  base_unit: string;
  is_active: boolean;
};

/**
 * Re-point a vendor item at a different inventory item — the fix for "this
 * product is filed under the wrong item", including the 72 rows the migration
 * left unlinked entirely.
 *
 * This writes ONE column and nothing else (Mark, 2026-07-23). Favorites are
 * keyed (item-location, weekday, vendor item), so any that referenced the old
 * item simply stop being reachable by the guide — quiet, not broken, and they
 * light up again if you point the vendor item back. Deleting them would make a
 * one-click correction irreversible, so don't add cleanup here.
 */
export function InventoryItemPicker({
  vendorItemId,
  currentItemId,
}: {
  vendorItemId: string;
  currentItemId: string | null;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<ItemRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Server-side ilike, and only once the term is worth running — 790 items is
  // too many to list.
  const canSearch = open && term.trim().length >= 2;
  useEffect(() => {
    if (!canSearch) return;
    let cancelled = false;
    const t = term.trim();
    supabase
      .from("inventory_items")
      .select("id, name, category, base_unit, is_active")
      .ilike("name", `%${t}%`)
      .order("is_active", { ascending: false })
      .order("name")
      .limit(25)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) setError(error.message);
        else setResults((data ?? []) as ItemRow[]);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, canSearch, term]);

  async function link(target: ItemRow) {
    setBusy(true);
    setError(null);

    const { error } = await supabase
      .from("vendor_items")
      .update({ inventory_item_id: target.id })
      .eq("id", vendorItemId);

    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setOpen(false);
    setTerm("");
    router.refresh();
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <span className="inline-flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          disabled={busy}
          title="Link this vendor item to a different inventory item"
          className="rounded border border-neutral-300 px-1.5 py-0.5 text-xs text-neutral-600 hover:bg-neutral-100 disabled:opacity-40"
        >
          {open ? "Cancel" : "Change"}
        </button>
        {busy && <span className="text-xs text-neutral-500">saving…</span>}
      </span>

      {error && <span className="text-xs text-red-700">{error}</span>}

      {open && (
        <span className="flex flex-col gap-1">
          <input
            autoFocus
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search inventory items by name…"
            className="w-80 rounded border border-neutral-300 px-2 py-1 text-sm"
          />
          {canSearch && results.length === 0 && (
            <span className="text-xs text-neutral-500">No items match.</span>
          )}
          {canSearch && results.length > 0 && (
            <ul className="max-h-64 w-80 overflow-auto rounded border border-neutral-200">
              {results.map((it) => {
                const isCurrent = it.id === currentItemId;
                return (
                  <li
                    key={it.id}
                    className="flex items-center gap-2 border-b border-neutral-100 px-2 py-1 text-sm last:border-b-0"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{it.name}</span>
                      <span className="block text-xs text-neutral-500">
                        {it.category ?? "no category"} · {it.base_unit}
                        {!it.is_active && (
                          <span className="ml-1 rounded bg-neutral-200 px-1 text-neutral-600">
                            inactive
                          </span>
                        )}
                      </span>
                    </span>
                    <button
                      type="button"
                      disabled={busy || isCurrent}
                      onClick={() => link(it)}
                      className="shrink-0 rounded border border-neutral-300 px-2 py-0.5 text-xs hover:bg-neutral-100 disabled:opacity-40"
                    >
                      {isCurrent ? "current" : "Link"}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </span>
      )}
    </span>
  );
}
