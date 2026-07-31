"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { RowMenu } from "@/components/ui/RowMenu";
import {
  Dialog,
  DIALOG_CANCEL_CLASS,
  DIALOG_COMMIT_CLASS,
  DIALOG_DANGER_CLASS,
} from "@/components/ui/Dialog";

/**
 * The columns a duplicate carries over. Explicit rather than "everything but
 * the keys", because two of the omissions are decisions:
 *
 * - `legacy_id` is the FileMaker row's identity. Two rows claiming the same one
 *   would quietly corrupt any future reconciliation against the export.
 * - `created_at` / `updated_at` belong to the new row, not the old one.
 *
 * `product_id` IS copied. The case this exists for is a pack-size variant of
 * something the vendor already sells, and starting from the neighbouring SKU is
 * closer to the answer than starting from blank.
 */
const COPIED_COLUMNS = [
  "org_id",
  "vendor_id",
  "inventory_item_id",
  "product_id",
  "brand",
  "description",
  "package_desc",
  "package_content",
  "pack_count",
  "pack_size",
  "pack_unit",
  "price",
  "url",
  "notes",
  "is_active",
] as const;

/** What a delete would take with it, counted before anything is offered. */
type Usage = {
  poLines: number;
  favorites: number;
  guideEntries: number;
  priceHistory: number;
  priceOverrides: number;
};

async function countUsage(
  supabase: ReturnType<typeof createClient>,
  vendorItemId: string
): Promise<Usage> {
  const count = async (table: string) => {
    const { count } = await supabase
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq("vendor_item_id", vendorItemId);
    return count ?? 0;
  };
  const [poLines, favorites, guideEntries, priceHistory, priceOverrides] =
    await Promise.all([
      count("purchase_order_items"),
      count("order_guide_plan_days"),
      count("order_guide_entries"),
      count("price_history"),
      count("vendor_item_location_prices"),
    ]);
  return { poLines, favorites, guideEntries, priceHistory, priceOverrides };
}

/**
 * A vendor item's own commands — duplicate it, or get rid of it.
 *
 * **Delete is usage-aware on purpose.** The foreign keys around `vendor_items`
 * are unusually destructive and none of it is visible from the row you're
 * looking at: `price_history`, `vendor_item_location_prices`,
 * `order_guide_entries` and — since migration 008 — `order_guide_plan_days` all
 * CASCADE, so deleting one vendor item silently takes its price audit trail,
 * its per-location overrides and **its favorites** with it. Purchase order
 * lines are the exception (`on delete set null`): the snapshot survives, so
 * history stays readable, but the line loses the anchor that "last ordered" and
 * price reconciliation need.
 *
 * So the dialog counts all five first and says what each one means, and for
 * anything ever ordered it makes **Deactivate** the default — the resolution the
 * open thread called for. Delete stays reachable; it just stops being the easy
 * thing to do by accident.
 */
export function VendorItemActions({
  vendorItemId,
  label,
  isActive,
  afterDelete = "refresh",
}: {
  vendorItemId: string;
  /** What to call this item in the dialog — the catalog name where there is one. */
  label: string;
  isActive: boolean;
  /**
   * Where to end up once the row is gone. A list refreshes in place; a detail
   * screen is now looking at nothing and has to navigate. An href rather than a
   * callback because half the callers are SERVER components, and a function
   * can't cross that boundary.
   */
  afterDelete?: "refresh" | { href: string };
}) {
  const router = useRouter();
  const supabase = createClient();
  const [confirming, setConfirming] = useState(false);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function duplicate() {
    setBusy("duplicate");
    setError(null);
    const { data, error: readError } = await supabase
      .from("vendor_items")
      .select(COPIED_COLUMNS.join(", "))
      .eq("id", vendorItemId)
      .maybeSingle();
    if (readError || !data) {
      setBusy(null);
      setError(readError?.message ?? "That vendor item is no longer there.");
      return;
    }
    // The copy is a new SKU, not a second favorite: plan rows and per-location
    // price overrides are deliberately NOT carried over. Where it should be
    // preferred, and what it costs at a particular shop, are answers about THIS
    // pack size and have to be given again.
    const { error: writeError } = await supabase.from("vendor_items").insert(data);
    setBusy(null);
    if (writeError) setError(writeError.message);
    else router.refresh();
  }

  async function openConfirm() {
    setConfirming(true);
    setUsage(null);
    setError(null);
    setUsage(await countUsage(supabase, vendorItemId));
  }

  async function deactivate() {
    setBusy("deactivate");
    setError(null);
    const { error } = await supabase
      .from("vendor_items")
      .update({ is_active: false })
      .eq("id", vendorItemId);
    setBusy(null);
    if (error) {
      setError(error.message);
      return;
    }
    setConfirming(false);
    router.refresh();
  }

  async function remove() {
    setBusy("delete");
    setError(null);
    const { error } = await supabase
      .from("vendor_items")
      .delete()
      .eq("id", vendorItemId);
    setBusy(null);
    if (error) {
      setError(error.message);
      return;
    }
    setConfirming(false);
    if (afterDelete === "refresh") router.refresh();
    else router.push(afterDelete.href);
  }

  const everOrdered = (usage?.poLines ?? 0) > 0;

  return (
    <>
      <RowMenu
        label={`Actions for ${label}`}
        items={[
          {
            label: busy === "duplicate" ? "Duplicating…" : "Duplicate",
            hint: "A new item, same vendor, no favorites",
            disabled: busy !== null,
            onSelect: () => void duplicate(),
          },
          {
            label: "Delete…",
            hint: "Shows what would go with it",
            danger: true,
            disabled: busy !== null,
            onSelect: () => void openConfirm(),
          },
        ]}
      />

      {/* The menu closes on select, so a duplicate failure has nowhere of its
          own to land — it goes beside the row. */}
      {error && !confirming && (
        <p className="mt-1 text-xs text-accent">{error}</p>
      )}

      {confirming && (
        <Dialog
          title="Delete vendor item"
          onClose={() => setConfirming(false)}
          busy={busy !== null}
          footer={
            <>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={busy !== null}
                className={DIALOG_CANCEL_CLASS}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void remove()}
                disabled={busy !== null || usage === null}
                className={DIALOG_DANGER_CLASS}
              >
                {busy === "delete" ? "Deleting…" : "Delete anyway"}
              </button>
              {isActive && (
                <button
                  type="button"
                  onClick={() => void deactivate()}
                  disabled={busy !== null}
                  className={DIALOG_COMMIT_CLASS}
                >
                  {busy === "deactivate" ? "Deactivating…" : "Deactivate instead"}
                </button>
              )}
            </>
          }
        >
          <p className="text-sm text-ink">{label}</p>

          {usage === null ? (
            <p className="mt-3 text-sm text-subtle">Checking what uses it…</p>
          ) : (
            <div className="mt-3 space-y-3 text-sm">
              {everOrdered ? (
                <p className="border border-ink bg-[var(--rf-yellow-200)] px-3 py-2 text-ink">
                  This item has been ordered {usage.poLines}{" "}
                  {usage.poLines === 1 ? "time" : "times"}. Deactivating takes it
                  off the guide and out of the pickers while leaving that history
                  whole — which is almost always what you want.
                </p>
              ) : (
                <p className="text-muted">
                  This item has never been on a purchase order.
                </p>
              )}

              <div>
                <p className="text-[12px] uppercase tracking-[0.12em] text-subtle">
                  Deleting would also remove
                </p>
                <ul className="mt-1 space-y-0.5">
                  <UsageLine n={usage.favorites} one="favorite day" many="favorite days" />
                  <UsageLine
                    n={usage.priceOverrides}
                    one="per-location price override"
                    many="per-location price overrides"
                  />
                  <UsageLine
                    n={usage.priceHistory}
                    one="price-history entry"
                    many="price-history entries"
                  />
                  <UsageLine
                    n={usage.guideEntries}
                    one="recorded guide count"
                    many="recorded guide counts"
                  />
                </ul>
                {usage.favorites +
                  usage.priceOverrides +
                  usage.priceHistory +
                  usage.guideEntries ===
                  0 && <p className="mt-1 text-muted">Nothing — it isn&rsquo;t used anywhere.</p>}
              </div>

              {everOrdered && (
                <p className="text-muted">
                  The {usage.poLines} order{" "}
                  {usage.poLines === 1 ? "line" : "lines"} would stay, keeping
                  what was ordered and what it cost, but would no longer
                  point at a catalog item — so &ldquo;last ordered&rdquo; and price
                  reconciliation lose it.
                </p>
              )}

              {error && <p className="text-accent">{error}</p>}
            </div>
          )}
        </Dialog>
      )}
    </>
  );
}

function UsageLine({ n, one, many }: { n: number; one: string; many: string }) {
  if (n === 0) return null;
  return (
    <li className="text-body">
      <span className="tabular-nums font-semibold">{n}</span> {n === 1 ? one : many}
    </li>
  );
}
