"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { TextInput } from "@/components/ui/TextInput";
import { SMALL_BUTTON_CLASS } from "@/components/ui/buttons";
import { SearchGlyph } from "@/components/ui/SearchGlyph";
import { inventorySearchWords } from "@/lib/catalog";

type ItemRow = {
  id: string;
  name: string;
  category: string | null;
  base_unit: string;
  is_active: boolean;
};

export type ChosenItem = {
  id: string;
  name: string;
  /**
   * OPTIONAL, and it is what a caller creating a vendor item needs: pars,
   * on-hand counts and `package_content` are all in this unit (design rule 5),
   * so a pack of "50 lbs" can only become a content once you know what the ITEM
   * is counted in.
   *
   * Optional because two callers construct a `ChosenItem` from a row they
   * already hold rather than from this search, and neither of them has the unit
   * or needs it. Every choice made THROUGH this component carries it.
   */
  base_unit?: string;
};

/**
 * FIND AN INVENTORY ITEM AND HAND IT BACK. IT WRITES NOTHING.
 *
 * The records and the vendor items table link an item with a `PickList` that
 * writes on the pick (`lib/inventoryItemOptions`), and that cannot be used
 * where there is no row to update yet — a create dialog that had already
 * written something by the time you pressed Cancel is a dialog that lies about
 * what Cancel means. That is `CustomerPicker`'s rule (a new customer is held as
 * a DRAFT and written in the same act as the order), and a purchase request is
 * the second place it comes up.
 *
 * The search is server-side (word-AND `ilike`, active first, capped at 25),
 * and lives here rather than in `lib/catalog`: that module is PURE and is
 * compiled into the Node fixture run, so importing the browser client into it
 * would drag `@supabase/ssr` along behind. `inventorySearchWords` — the half
 * that IS pure — lives there.
 *
 * ONE FIELD, TWO STATES (Mark, 2026-10-06: "choosing an item in it leaves the
 * field blank"). It used to keep the search box on screen after a choice, now
 * empty, with the choice in a second box above it — so the field you had just
 * filled in read as not filled in. A chosen item now TAKES THE SEARCH BOX'S
 * PLACE, and Change brings the search back.
 *
 * Every button here calls `preventDefault` on its click, and that is not
 * decoration: two callers wrap this in a `<label>`, and a label forwards a
 * click inside it to its FIRST labelable descendant. After a choice that
 * descendant is the Change button, so on an engine that forwards from a button
 * the same click that chose the item also cleared it. A cancelled click is not
 * forwarded.
 */
export function InventoryItemChooser({
  value,
  onPick,
  autoFocus = false,
  onNotListed,
}: {
  /** What is currently chosen, or null. The caller owns it. */
  value: ChosenItem | null;
  /** Null when the choice is cleared. */
  onPick: (item: ChosenItem | null) => void;
  autoFocus?: boolean;
  /**
   * Offers "Not in the list" under the search, handing back what was typed so
   * the caller can start its own free-text field from it. Omit it where an
   * item is the only possible answer.
   */
  onNotListed?: (term: string) => void;
}) {
  const supabase = createClient();
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<ItemRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Change puts you straight back in the search box, whatever the caller's
  // `autoFocus` said about the first time the dialog opened.
  const [changing, setChanging] = useState(false);

  // Server-side, and only once the term is worth running — 790 items is too
  // many to list.
  const canSearch = term.trim().length >= 2;
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
        else {
          setError(null);
          setResults((data ?? []) as ItemRow[]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, canSearch, term]);

  function choose(item: ItemRow) {
    onPick({ id: item.id, name: item.name, base_unit: item.base_unit });
    setTerm("");
    setResults([]);
  }

  if (value) {
    return (
      <div className="flex min-h-9 items-center gap-2 border border-ink bg-white px-3 py-1 text-sm">
        <span className="min-w-0 flex-1 truncate">{value.name}</span>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            setChanging(true);
            onPick(null);
          }}
          className={`shrink-0 ${SMALL_BUTTON_CLASS}`}
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <TextInput
        autoFocus={autoFocus || changing}
        value={term}
        onValueChange={setTerm}
        clearLabel="Clear the search"
        search
        // Fills the dialog's track; `search` alone caps a box at 18rem.
        fullWidth
        aria-label="Search inventory items"
        icon={<SearchGlyph />}
      />

      {error && <span className="text-xs text-accent">{error}</span>}

      {canSearch && !error && results.length === 0 && (
        <span className="text-xs text-subtle">No items match.</span>
      )}

      {canSearch && results.length > 0 && (
        <ul className="max-h-64 overflow-auto border border-ink">
          {results.map((it) => {
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
                  onClick={(e) => {
                    e.preventDefault();
                    choose(it);
                  }}
                  className="shrink-0 border border-ink px-2 py-0.5 text-xs transition-colors hover:bg-ink hover:text-white"
                >
                  Choose
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {onNotListed && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            onNotListed(term.trim());
          }}
          className={`self-start ${SMALL_BUTTON_CLASS}`}
        >
          Not in the list
        </button>
      )}
    </div>
  );
}
