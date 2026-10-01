"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_DANGER_CLASS } from "@/components/ui/Dialog";
import { TextInput } from "@/components/ui/TextInput";
import { SearchGlyph } from "@/components/ui/SearchGlyph";
import { inventorySearchWords } from "@/lib/catalog";

type ItemRow = {
  id: string;
  name: string;
  category: string | null;
  base_unit: string;
  is_active: boolean;
};

/**
 * Point a vendor item at an inventory item — the fix for "this is filed under
 * the wrong item", and for the rows that were never filed at all (72 rows the
 * migration left unlinked).
 *
 * TWO CALLERS, both on vendor item LISTS: the unlinked cell in
 * `VendorItemsTable` and the ⋯ menu's command in `VendorItemActions`. The two
 * RECORDS — the vendor item and the production element — use a `PickList` over
 * `lib/inventoryItemOptions` instead (Mark, 2026-10-01), which is why this no
 * longer takes a table, a seeded search or an inline layout: those were theirs.
 *
 * It writes ONE column and nothing else (Mark, 2026-07-23). Favorites are keyed
 * (item-location, weekday, vendor item), so any that referenced the old item
 * simply stop being reachable by the guide — quiet, not broken, and they light
 * up again if you point it back. Deleting them would make a one-click
 * correction irreversible, so don't add cleanup here.
 */
export function InventoryItemPicker({
  rowId,
  currentItemId,
  allowUnlink = false,
  trigger,
  currentItemName,
  defaultOpen = false,
  onClose,
}: {
  rowId: string;
  currentItemId: string | null;
  /**
   * Offer "Unlink" as well.
   *
   * On for the ⋯ menu, the one place a LINKED vendor item opens this.
   * Re-linking already fixes a mis-link; this is for the row that should carry
   * no link at all, and without it linking is a one-way door.
   */
  allowUnlink?: boolean;
  /**
   * What the button says — the cell's own text, so the value you were already
   * reading becomes the control that changes it. Omitted when a command opened
   * this, because the command IS the button.
   */
  trigger?: ReactNode;
  /**
   * What the row is linked to NOW, for the dialog to say out loud.
   *
   * `currentItemId` marks the result already chosen; this is the sentence at
   * the top, which matters most where the caller is a ⋯ menu and the cell that
   * carries the name is somewhere else on the row.
   */
  currentItemName?: string | null;
  /**
   * Open on mount — `ui/PickList`'s prop and its reason: a deliberate act
   * already summoned this, so making the person press a second control to see
   * the thing they just asked for is a tax. Only ever pass it to a picker some
   * command opened.
   */
  defaultOpen?: boolean;
  /**
   * Fires whenever the dialog closes — dismissed, unlinked, or linked.
   *
   * NOT `PickList`'s narrower contract, where `onClose` skips the pick path,
   * and deliberately so: a caller that mounts this on a menu command has to
   * unmount it again, and one that only heard about dismissals would be left
   * holding an open flag over a component rendering nothing, with its own
   * command then a no-op.
   */
  onClose?: () => void;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(defaultOpen);
  const [term, setTerm] = useState("");
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
      .from("vendor_items")
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
    setTerm("");
    close();
    router.refresh();
  }

  function close() {
    setOpen(false);
    onClose?.();
  }

  function toggle() {
    if (open) {
      close();
      return;
    }
    // Clear on OPEN, so an abandoned search does not come back next time.
    setTerm("");
    setOpen(true);
  }

  // The search and its results, filling the dialog.
  const search = (
    <span className="flex flex-col gap-1">
      <TextInput
        autoFocus
        value={term}
        onValueChange={setTerm}
        aria-label="Search inventory items by name"
        clearLabel="Clear the search"
        search
        fullWidth
        icon={<SearchGlyph />}
      />
      {canSearch && results.length === 0 && (
        <span className="text-xs text-subtle">No items match.</span>
      )}
      {!canSearch && (
        <span className="text-xs text-subtle">Type at least two letters.</span>
      )}
      {canSearch && results.length > 0 && (
        <ul className="max-h-[50vh] w-full overflow-auto border border-ink">
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
  );

  return (
    <>
      {/* The cell's own text IS the button — underlined at rest, because on an
          iPad there is no hover to reveal that something is pressable, and a
          value that looks like description is exactly how this control went
          missing for 71 rows. */}
      {/* No trigger at all when a command already opened this — a ⋯ menu item
          IS the button, and a second one would render into the row it came
          from. */}
      {trigger !== undefined && (
        <button
          type="button"
          onClick={toggle}
          disabled={busy}
          title={
            currentItemId
              ? "Point this at a different inventory item"
              : "Link this to an inventory item"
          }
          className="max-w-full truncate underline decoration-neutral-400 underline-offset-[3px] hover:decoration-current disabled:opacity-35"
        >
          {busy ? "saving…" : trigger}
        </button>
      )}
      {open && (
        <Dialog
          title={currentItemId ? "Change inventory item" : "Link inventory item"}
          onClose={close}
          busy={busy}
          width="max-w-lg"
          footer={
            <>
              <button
                type="button"
                onClick={close}
                disabled={busy}
                className={DIALOG_CANCEL_CLASS}
              >
                Cancel
              </button>
              {/* Unlink lives HERE rather than as a second menu command, and
                  that is the whole reason it is two taps: it takes the row off
                  the order guide, and the sentence saying so has to be on
                  screen beside the button that does it. Picking a different
                  item from the list is the ordinary fix; this is for the row
                  that should carry no link at all. */}
              {allowUnlink && currentItemId && (
                <button
                  type="button"
                  onClick={() => void write(null)}
                  disabled={busy}
                  className={DIALOG_DANGER_CLASS}
                >
                  {busy ? "Working…" : "Unlink"}
                </button>
              )}
            </>
          }
        >
          <div className="space-y-2">
            {currentItemName ? (
              <p className="text-sm text-muted">
                Linked to{" "}
                <span className="text-ink">{currentItemName}</span>. Search the
                catalog to point it somewhere else, or unlink it — an unlinked
                vendor item keeps its history and its price, and drops off the
                order guide until it is linked again.
              </p>
            ) : (
              <p className="text-sm text-muted">
                Search the catalog and link this vendor item to the inventory item
                it is bought as.
              </p>
            )}
            {error && <p className="text-sm text-accent">{error}</p>}
            {search}
          </div>
        </Dialog>
      )}
    </>
  );
}
