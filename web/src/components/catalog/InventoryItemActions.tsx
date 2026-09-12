"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { RowMenu } from "@/components/ui/RowMenu";
import type { ActionMenuItem } from "@/components/ui/ActionMenu";
import {
  Dialog,
  DIALOG_CANCEL_CLASS,
  DIALOG_COMMIT_CLASS,
  DIALOG_DANGER_CLASS,
} from "@/components/ui/Dialog";
import { duplicateTitle } from "@/lib/productionPlans";

/**
 * The columns a duplicate carries, table by table. Explicit rather than
 * "everything but the keys" — `legacy_id` is the FileMaker row's identity and
 * two rows claiming it would corrupt any reconciliation against the export,
 * and the timestamps belong to the new rows.
 */
const ITEM_COLUMNS = "org_id, name, category, base_unit, note, is_active";
const LOCATION_COLUMNS =
  "org_id, location_id, shop_section_id, default_par, par_by_weekday, par_fixed_by_weekday, order_days, note, is_active";
const VENDOR_ITEM_COLUMNS =
  "org_id, vendor_id, product_id, brand, description, package_desc, package_content, pack_count, pack_size, pack_unit, price, url, notes, is_active";

type Row = Record<string, unknown>;

/** What a delete would take with it, counted before anything is offered. */
type Usage = {
  vendorItems: number;
  locations: number;
  reminders: number;
  elements: number;
  requests: number;
};

async function countUsage(
  supabase: ReturnType<typeof createClient>,
  itemIds: string[]
): Promise<Usage> {
  const count = async (table: string) => {
    const { count } = await supabase
      .from(table)
      .select("*", { count: "exact", head: true })
      .in("inventory_item_id", itemIds);
    return count ?? 0;
  };
  const [vendorItems, locations, reminders, elements, requests] = await Promise.all([
    count("vendor_items"),
    count("inventory_item_locations"),
    count("purchase_reminders"),
    count("production_elements"),
    count("purchase_requests"),
  ]);
  return { vendorItems, locations, reminders, elements, requests };
}

/**
 * An inventory item's own commands — duplicate it whole, or get rid of it.
 *
 * **Duplicate copies EVERYTHING about the item** (Mark, 2026-09-04): the master
 * row, every per-location row (section, par, per-weekday pars, order days,
 * note), every vendor item pointing at it with its per-location price
 * overrides, and the weekday favorites — re-pointed at the COPIED vendor items,
 * so the copy is orderable on day one exactly as the original is. It arrives
 * named "… copy" and the screen lands on it, because renaming it is the next
 * thing you do.
 *
 * Written parent-first and client-side, the plan duplicate's shape. The vendor
 * items are inserted ONE AT A TIME rather than in a batch so old id → new id is
 * certain rather than inferred from return order; an item has a handful, so
 * this costs nothing worth saving.
 *
 * **Delete is usage-aware.** `inventory_item_locations` cascade (taking their
 * favorites and guide counts), `purchase_reminders` cascade, and `vendor_items`
 * go `on delete set null` — they survive, UNLINKED, which means off every
 * guide until somebody re-links them. Production elements and purchase
 * requests lose their link the same way. The dialog counts all of it, and
 * where the item is stocked anywhere it makes **Deactivate** the default.
 * Every write `.select()`s its own result: a delete refused by RLS removes zero
 * rows and returns NO error.
 */
export type ItemTarget = { id: string; name: string; isActive: boolean };

export function InventoryItemActions({
  items,
  existingNames,
  afterDelete = "refresh",
  scope = "row",
  children,
}: {
  /** One item from its row, or the whole ticked selection. */
  items: ItemTarget[];
  /** Every item name in the org, so a copy's name doesn't collide. */
  existingNames: string[];
  afterDelete?: "refresh" | { href: string };
  /** Wording only: a row's menu says "Duplicate", a selection's says
   *  "Duplicate Selected". */
  scope?: "row" | "selection";
  /**
   * HAND THE ROWS OUT instead of drawing a `RowMenu` — the list's one Actions
   * menu owns WHERE they sit while this keeps owning what they DO. Without it
   * the row menu is drawn as before.
   */
  children?: (rows: ActionMenuItem[]) => ReactNode;
}) {
  const ids = items.map((i) => i.id);
  const many = items.length !== 1;
  const subject = many ? `${items.length} inventory items` : items[0]?.name ?? "";
  const router = useRouter();
  const supabase = createClient();
  const [confirming, setConfirming] = useState(false);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * ONE AT A TIME, AND THE TAKEN NAMES GROW AS IT GOES — `duplicateTitle` reads
   * a list of names to avoid, so a batch that passed the same list every time
   * would make three items all called "… copy". Sequential rather than
   * parallel for the same reason: each copy has to see the one before it.
   *
   * IT LANDS ON THE COPY ONLY WHEN THERE IS ONE. Duplicating a single item is
   * "make me one to edit", and its record is where you go next; duplicating
   * nine is a bulk act with no single destination, so it refreshes the list and
   * says how many it made.
   *
   * A FAILURE PART WAY THROUGH KEEPS WHAT IT MADE and says so. Every copy is
   * its own tree of writes, so there is no transaction spanning them and
   * pretending otherwise would be worse than reporting the truth.
   */
  async function duplicate() {
    setBusy("duplicate");
    setError(null);
    const taken = [...existingNames];
    let made = 0;
    let lastId: string | null = null;
    try {
      for (const target of items) {
        const { id, name } = await duplicateItem(target.id, taken);
        taken.push(name);
        lastId = id;
        made += 1;
      }
      router.refresh();
      if (items.length === 1 && lastId) router.push(`/items/${lastId}`);
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      setError(
        made > 0 && items.length > 1
          ? `Copied ${made} of ${items.length}, then stopped: ${why}`
          : why
      );
      if (made > 0) router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function duplicateItem(
    itemId: string,
    takenNames: string[]
  ): Promise<{ id: string; name: string }> {
    // 1. The master row.
    const { data: item, error: itemErr } = await supabase
      .from("inventory_items")
      .select(ITEM_COLUMNS)
      .eq("id", itemId)
      .maybeSingle();
    if (itemErr || !item) throw new Error(itemErr?.message ?? "That item is no longer there.");
    const source = item as unknown as Row;
    const copyName = duplicateTitle(takenNames, String(source.name));
    const { data: created, error: createErr } = await supabase
      .from("inventory_items")
      .insert({ ...source, name: copyName })
      .select("id")
      .single();
    if (createErr || !created) throw new Error(createErr?.message ?? "The copy could not be created.");
    const newId = created.id as string;

    // 2. Every vendor item, one at a time, so the old → new map is certain.
    const { data: vendorItems, error: viErr } = await supabase
      .from("vendor_items")
      .select(`id, ${VENDOR_ITEM_COLUMNS}`)
      .eq("inventory_item_id", itemId);
    if (viErr) throw new Error(viErr.message);
    const vendorItemMap = new Map<string, string>();
    for (const vi of (vendorItems ?? []) as unknown as Row[]) {
      const { id: oldId, ...rest } = vi;
      const { data, error } = await supabase
        .from("vendor_items")
        .insert({ ...rest, inventory_item_id: newId })
        .select("id")
        .single();
      if (error || !data) throw new Error(error?.message ?? "A vendor item could not be copied.");
      vendorItemMap.set(oldId as string, data.id as string);
    }

    // Their per-location price overrides, keyed on the new vendor item.
    if (vendorItemMap.size > 0) {
      const { data: prices, error: pErr } = await supabase
        .from("vendor_item_location_prices")
        .select("vendor_item_id, location_id, org_id, price")
        .in("vendor_item_id", [...vendorItemMap.keys()]);
      if (pErr) throw new Error(pErr.message);
      if (prices && prices.length > 0) {
        const { error } = await supabase.from("vendor_item_location_prices").insert(
          prices.map((p) => ({ ...p, vendor_item_id: vendorItemMap.get(p.vendor_item_id)! }))
        );
        if (error) throw new Error(error.message);
      }
    }

    // 3. Every per-location row; the location is the natural key, so a batch
    //    insert can be matched back without trusting return order.
    const { data: ils, error: ilErr } = await supabase
      .from("inventory_item_locations")
      .select(`id, ${LOCATION_COLUMNS}`)
      .eq("inventory_item_id", itemId);
    if (ilErr) throw new Error(ilErr.message);
    const oldIls = (ils ?? []) as unknown as Row[];
    const ilMap = new Map<string, string>();
    if (oldIls.length > 0) {
      const { data: newIls, error } = await supabase
        .from("inventory_item_locations")
        .insert(
          oldIls.map((il) => {
            const { id: _oldId, ...rest } = il;
            void _oldId;
            return { ...rest, inventory_item_id: newId };
          })
        )
        .select("id, location_id");
      if (error || !newIls) throw new Error(error?.message ?? "The per-location rows could not be copied.");
      const byLocation = new Map(newIls.map((r) => [r.location_id as string, r.id as string]));
      for (const il of oldIls) {
        const mapped = byLocation.get(il.location_id as string);
        if (mapped) ilMap.set(il.id as string, mapped);
      }

      // 4. The favorites, re-pointed at both copies.
      const { data: favs, error: fErr } = await supabase
        .from("order_guide_plan_days")
        .select("org_id, item_location_id, weekday, vendor_item_id")
        .in("item_location_id", [...ilMap.keys()]);
      if (fErr) throw new Error(fErr.message);
      const copied = (favs ?? [])
        .filter((f) => ilMap.has(f.item_location_id) && vendorItemMap.has(f.vendor_item_id))
        .map((f) => ({
          org_id: f.org_id,
          weekday: f.weekday,
          item_location_id: ilMap.get(f.item_location_id)!,
          vendor_item_id: vendorItemMap.get(f.vendor_item_id)!,
        }));
      if (copied.length > 0) {
        const { error } = await supabase.from("order_guide_plan_days").insert(copied);
        if (error) throw new Error(error.message);
      }
    }

    return { id: newId, name: copyName };
  }

  async function openConfirm() {
    setConfirming(true);
    setUsage(null);
    setError(null);
    setUsage(await countUsage(supabase, ids));
  }

  async function deactivate() {
    setBusy("deactivate");
    setError(null);
    const { data, error } = await supabase
      .from("inventory_items")
      .update({ is_active: false })
      .in("id", ids)
      .select("id");
    setBusy(null);
    if (error || !data?.length) {
      setError(error?.message ?? "Nothing changed — you may not have permission.");
      return;
    }
    setConfirming(false);
    router.refresh();
  }

  async function remove() {
    setBusy("delete");
    setError(null);
    const { data, error } = await supabase
      .from("inventory_items")
      .delete()
      .in("id", ids)
      .select("id");
    setBusy(null);
    if (error || !data?.length) {
      setError(error?.message ?? "Nothing was deleted — you may not have permission.");
      return;
    }
    setConfirming(false);
    if (afterDelete === "refresh") router.refresh();
    else router.push(afterDelete.href);
  }

  const stocked = (usage?.locations ?? 0) > 0;
  const anyActive = items.some((i) => i.isActive);
  const suffix = scope === "selection" ? " Selected" : "";

  /**
   * The two commands, whichever door draws them. `hint` is the ROW MENU's —
   * `ActionMenuItem` deliberately has none ("MenuButton stays for a short flat
   * list with hints"), so the menu gets the same rows with the hints dropped
   * rather than a second declaration that could drift from this one.
   */
  const rows = [
    {
      label: busy === "duplicate" ? "Duplicating…" : `Duplicate${suffix}`,
      hint: "A copy with its locations, vendor items and favorites",
      disabled: busy !== null || items.length === 0,
      onSelect: () => void duplicate(),
    },
    {
      label: `Delete${suffix}…`,
      hint: "Shows what would go with it",
      danger: true,
      disabled: busy !== null || items.length === 0,
      onSelect: () => void openConfirm(),
    },
  ];

  return (
    <>
      {children ? (
        children(
          rows.map(
            ({ hint: _hint, ...row }): ActionMenuItem => {
              void _hint;
              return row;
            }
          )
        )
      ) : (
        <RowMenu label={`Actions for ${subject}`} items={rows} />
      )}

      {error && !confirming && <p className="mt-1 text-xs text-accent">{error}</p>}

      {confirming && (
        <Dialog
          title={many ? "Delete inventory items" : "Delete inventory item"}
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
              {anyActive && (
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
          {/* The ONE item by name; a batch by count, with the first few named
              so you can tell at a glance whether the selection is what you
              meant. */}
          <p className="text-sm text-ink">{subject}</p>
          {many && (
            <p className="mt-1 text-sm text-muted">
              {items.slice(0, 4).map((i) => i.name).join(", ")}
              {items.length > 4 ? `, and ${items.length - 4} more` : ""}
            </p>
          )}

          {usage === null ? (
            <p className="mt-3 text-sm text-subtle">Checking what uses it…</p>
          ) : (
            <div className="mt-3 space-y-3 text-sm">
              {stocked ? (
                <p className="border border-ink bg-[var(--rf-yellow-200)] px-3 py-2 text-ink">
                  {many ? "These items are" : "This item is"} stocked at{" "}
                  {usage.locations} {usage.locations === 1 ? "location" : "locations"}
                  . Deactivating takes {many ? "them" : "it"} off the guide
                  everywhere while leaving {many ? "their histories" : "its history"}{" "}
                  whole — which is almost always what you want.
                </p>
              ) : (
                <p className="text-muted">
                  {many ? "None of these items is" : "This item is not"} stocked anywhere.
                </p>
              )}

              <div>
                <p className="text-[12px] uppercase tracking-[0.12em] text-subtle">
                  Deleting would also remove
                </p>
                <ul className="mt-1 space-y-0.5">
                  <UsageLine
                    n={usage.locations}
                    one="per-location row, with its favorites and guide counts"
                    many="per-location rows, with their favorites and guide counts"
                  />
                  <UsageLine n={usage.reminders} one="reminder" many="reminders" />
                </ul>
                {usage.locations + usage.reminders === 0 && (
                  <p className="mt-1 text-muted">Nothing else.</p>
                )}
              </div>

              {usage.vendorItems + usage.elements + usage.requests > 0 && (
                <div>
                  <p className="text-[12px] uppercase tracking-[0.12em] text-subtle">
                    Left behind, unlinked
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    <UsageLine
                      n={usage.vendorItems}
                      one="vendor item — off every order guide until re-linked"
                      many="vendor items — off every order guide until re-linked"
                    />
                    <UsageLine
                      n={usage.elements}
                      one="production element, which loses its cost source"
                      many="production elements, which lose their cost source"
                    />
                    <UsageLine n={usage.requests} one="purchase request" many="purchase requests" />
                  </ul>
                </div>
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
