"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { TextInput } from "@/components/ui/TextInput";
import { inventorySearchWords } from "@/lib/catalog";

type ItemRow = {
  id: string;
  name: string;
  category: string | null;
  base_unit: string;
  is_active: boolean;
};

/**
 * Point a row at an inventory item — the fix for "this is filed under the wrong
 * item", and for the rows that were never filed at all.
 *
 * TWO TABLES USE IT, and it takes the table rather than owning one:
 *
 *   `vendor_items`        — the original caller. 72 rows the migration left
 *                           unlinked, plus the ordinary mis-filing correction.
 *   `production_elements` — a PURCHASED element costs nothing until it resolves
 *                           to an inventory item, and until 2026-08-13 there was
 *                           no way to link one anywhere in the app. The element
 *                           record showed "Not linked — this element has no cost
 *                           until it is" and offered nothing to do about it,
 *                           which left 76 active elements permanently uncosted
 *                           and made the Uncosted tier a list of problems with
 *                           no fix (Mark: "this is something the user needs to
 *                           be able to do on our own").
 *
 * It writes ONE column and nothing else (Mark, 2026-07-23). On a vendor item,
 * favorites are keyed (item-location, weekday, vendor item), so any that
 * referenced the old item simply stop being reachable by the guide — quiet, not
 * broken, and they light up again if you point it back. Deleting them would
 * make a one-click correction irreversible, so don't add cleanup here.
 */
export function InventoryItemPicker({
  table,
  rowId,
  currentItemId,
  initialTerm,
  allowUnlink = false,
}: {
  /** The table holding the `inventory_item_id` column being written. */
  table: "vendor_items" | "production_elements";
  rowId: string;
  currentItemId: string | null;
  /**
   * What to put in the search box when it opens — the row's own name.
   *
   * With word-AND matching that is usually the answer already: 23 of the 76
   * unlinked elements differ from their inventory item only by word order. The
   * vendor item passes nothing, because its name is the VENDOR's wording for a
   * product and searching our catalog with it mostly returns noise.
   */
  initialTerm?: string;
  /**
   * Offer "Unlink" as well.
   *
   * On for elements, because "none of these" is a REAL answer there rather than
   * a mistake: of the 76 unlinked ones, a good few are cleaning duties and
   * FileMaker metadata rows ("Fryer - replace filter", "Total Base") that got
   * typed `purchased` at migration and should never resolve to an ingredient.
   * Re-linking already fixes a mis-link; this is for the rows that should carry
   * no link at all, and without it linking is a one-way door.
   */
  allowUnlink?: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState(initialTerm ?? "");
  const [results, setResults] = useState<ItemRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Server-side, and only once the term is worth running — 790 items is too
  // many to list.
  const canSearch = open && term.trim().length >= 2;
  useEffect(() => {
    if (!canSearch) return;
    let cancelled = false;

    const words = inventorySearchWords(term);
    if (!words.length) return;

    let q = supabase
      .from("inventory_items")
      .select("id, name, category, base_unit, is_active");
    for (const w of words) q = q.ilike("name", `%${w}%`);
    q.order("is_active", { ascending: false })
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

  /**
   * `.select("id")` AND A ROW COUNT, not a bare update.
   *
   * An update matching no RLS policy changes zero rows and PostgREST returns NO
   * error, so a bare `.update()` reports a cheerful success, `router.refresh()`
   * hands back the old value, and the link appears not to have taken. That is
   * the `order_guide_entries` lesson and it is live on both tables here:
   * `vendor_items` and `production_elements` are both purchaser+ to write, and
   * this control renders for anyone who can see the record.
   */
  async function write(inventoryItemId: string | null) {
    setBusy(true);
    setError(null);

    const { data, error } = await supabase
      .from(table)
      .update({ inventory_item_id: inventoryItemId })
      .eq("id", rowId)
      .select("id");

    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    if (!data?.length) {
      setError("Not allowed — you need purchaser access to change this.");
      return;
    }
    setOpen(false);
    setTerm(initialTerm ?? "");
    router.refresh();
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <span className="inline-flex items-center gap-2">
        <button
          type="button"
          onClick={() =>
            setOpen((v) => {
              // Re-seed on OPEN, so a search you cleared and abandoned does not
              // come back empty next time.
              if (!v) setTerm(initialTerm ?? "");
              return !v;
            })
          }
          disabled={busy}
          title={
            currentItemId
              ? "Point this at a different inventory item"
              : "Link this to an inventory item so it can be costed"
          }
          className="border border-ink px-1.5 py-0.5 text-xs text-ink transition-colors hover:bg-ink hover:text-white disabled:opacity-35"
        >
          {/* "Link…" when there is nothing to change — on an element the row
              beside this says "Not linked", and "Change" there names an act
              that has no object. */}
          {open ? "Cancel" : currentItemId ? "Change" : "Link…"}
        </button>
        {allowUnlink && currentItemId && !open ? (
          <button
            type="button"
            onClick={() => write(null)}
            disabled={busy}
            title="Leave this with no inventory item, so it is not costed"
            className="border border-ink px-1.5 py-0.5 text-xs text-ink transition-colors hover:bg-ink hover:text-white disabled:opacity-35"
          >
            Unlink
          </button>
        ) : null}
        {busy && <span className="text-xs text-subtle">saving…</span>}
      </span>

      {error && <span className="text-xs text-accent">{error}</span>}

      {open && (
        <span className="flex flex-col gap-1">
          <TextInput
            autoFocus
            value={term}
            onValueChange={setTerm}
            placeholder="Search inventory items by name…"
            clearLabel="Clear the search"
            className="w-80"
          />
          {canSearch && results.length === 0 && (
            <span className="text-xs text-subtle">No items match.</span>
          )}
          {canSearch && results.length > 0 && (
            <ul className="max-h-64 w-80 overflow-auto border border-ink">
              {results.map((it) => {
                const isCurrent = it.id === currentItemId;
                return (
                  <li
                    key={it.id}
                    className="flex items-center gap-2 border-b border-hairline px-2 py-1 text-sm last:border-b-0"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{it.name}</span>
                      <span className="block text-xs text-subtle">
                        {it.category ?? "no category"} · {it.base_unit}
                        {!it.is_active && (
                          <span className="ml-1 border border-neutral-300 bg-neutral-100 px-1 text-muted">
                            inactive
                          </span>
                        )}
                      </span>
                    </span>
                    <button
                      type="button"
                      disabled={busy || isCurrent}
                      onClick={() => write(it.id)}
                      className="shrink-0 border border-ink px-2 py-0.5 text-xs transition-colors hover:bg-ink hover:text-white disabled:opacity-35"
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
