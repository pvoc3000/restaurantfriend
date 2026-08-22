"use client";

import { useEffect, useState } from "react";
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

export type ChosenItem = { id: string; name: string };

/**
 * FIND AN INVENTORY ITEM AND HAND IT BACK. IT WRITES NOTHING.
 *
 * `InventoryItemPicker` is the same search wired to an UPDATE, and it cannot be
 * used where there is no row to update yet — a create dialog that had already
 * written something by the time you pressed Cancel is a dialog that lies about
 * what Cancel means. That is `CustomerPicker`'s rule (a new customer is held as
 * a DRAFT and written in the same act as the order), and a purchase request is
 * the second place it comes up.
 *
 * So the two are deliberately separate rather than one component with a mode:
 * every line of the writing one is about the write — the row count that catches
 * a silently-refused update, the `router.refresh()`, the unlink door — and none
 * of it means anything here. What they share is the QUERY, and that shape
 * (word-AND `ilike`, active first, capped at 25) is small enough that the honest
 * place for it is each component rather than `lib/catalog`: that module is PURE
 * and is compiled into the Node fixture run, so importing the browser client
 * into it would drag `@supabase/ssr` along behind. `inventorySearchWords` — the
 * half that IS pure — already lives there and is shared.
 */
export function InventoryItemChooser({
  value,
  onPick,
  autoFocus = false,
  placeholder = "Search inventory items by name…",
}: {
  /** What is currently chosen, or null. The caller owns it. */
  value: ChosenItem | null;
  /** Null when the choice is cleared. */
  onPick: (item: ChosenItem | null) => void;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const supabase = createClient();
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<ItemRow[]>([]);
  const [error, setError] = useState<string | null>(null);

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
    onPick({ id: item.id, name: item.name });
    setTerm("");
    setResults([]);
  }

  return (
    <div className="flex flex-col gap-2">
      {value ? (
        <div className="flex items-center gap-2 border border-ink px-2 py-1 text-sm">
          <span className="min-w-0 flex-1 truncate">{value.name}</span>
          <button
            type="button"
            onClick={() => onPick(null)}
            className="shrink-0 border border-ink px-2 py-0.5 text-xs transition-colors hover:bg-ink hover:text-white"
          >
            Clear
          </button>
        </div>
      ) : null}

      <TextInput
        autoFocus={autoFocus}
        value={term}
        onValueChange={setTerm}
        placeholder={placeholder}
        clearLabel="Clear the search"
        className="w-full"
        aria-label="Search inventory items"
      />

      {error && <span className="text-xs text-accent">{error}</span>}

      {canSearch && !error && results.length === 0 && (
        <span className="text-xs text-subtle">No items match.</span>
      )}

      {canSearch && results.length > 0 && (
        <ul className="max-h-64 overflow-auto border border-ink">
          {results.map((it) => {
            const isCurrent = it.id === value?.id;
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
                  disabled={isCurrent}
                  onClick={() => choose(it)}
                  className="shrink-0 border border-ink px-2 py-0.5 text-xs transition-colors hover:bg-ink hover:text-white disabled:opacity-35"
                >
                  {isCurrent ? "chosen" : "Choose"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
