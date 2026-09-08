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
import { duplicateTitle } from "@/lib/productionPlans";

/**
 * The columns a duplicate carries, table by table. Explicit rather than
 * "everything but the keys" — `legacy_id` is the FileMaker row's identity and
 * both child tables are `unique (org_id, legacy_id)`, so copying it would fail
 * the insert; `source`/`source_payload` describe where a row CAME FROM, and a
 * copy made in the app came from the app.
 *
 * WRITTEN AGAINST THE LIVE TABLE, not against 037: `base_element_id` was in the
 * first draft of this list and **migration 049 dropped it** ("an item is a list
 * of components, and none of them is special"), so the first real duplicate
 * failed with `column production_items.base_element_id does not exist`. Probe
 * the columns; don't read the migration that created them.
 *
 * `show_on_inquiry_form` is deliberately NOT copied. It is opt-in and it is
 * PUBLIC — 4a's inquiry form reads it — so carrying it over would put a
 * half-finished row named "… copy" in front of customers the moment the copy
 * exists. `is_active` IS copied, which is safe for the mirror-image reason: an
 * item is made because it is on a tray, and a copy is on none.
 */
const ITEM_COLUMNS =
  "org_id, name, item_type, subtype, finish, size, price_class, price_tier, tally_box_size, tray_capacity, is_active, notes";
const COMPONENT_COLUMNS = "org_id, element_id, qty, unit, sort, note";
const LOCATION_COLUMNS =
  "org_id, location_id, par_by_weekday, price_override, is_active, notes";

type Row = Record<string, unknown>;

/** What stands in a delete's way, and what would go with it. */
type Usage = {
  /** RESTRICT — Postgres refuses the delete while either of these exists. */
  planSlots: number;
  scheduleLines: number;
  /** CASCADE. */
  components: number;
  locations: number;
  overrides: number;
  /** SET NULL — the row survives, unlinked. */
  orderLines: number;
  tags: number;
};

async function countUsage(
  supabase: ReturnType<typeof createClient>,
  itemId: string
): Promise<Usage> {
  const count = async (table: string, column = "item_id") => {
    const { count } = await supabase
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq(column, itemId);
    return count ?? 0;
  };
  const [planSlots, scheduleLines, components, locations, overrides, orderLines, tags] =
    await Promise.all([
      count("production_plan_tray_items"),
      count("production_schedule_items"),
      count("production_item_elements"),
      count("production_item_locations"),
      count("production_par_overrides"),
      count("special_order_items", "production_item_id"),
      count("display_tags", "production_item_id"),
    ]);
  return { planSlots, scheduleLines, components, locations, overrides, orderLines, tags };
}

/**
 * A production item's own commands — duplicate it whole, or get rid of it.
 * `InventoryItemActions`' shape, which is the template the app's other two
 * row-level Duplicate/Delete menus already follow.
 *
 * **DUPLICATE COPIES WHAT THE ITEM IS, NOT WHERE IT HAS BEEN.** The master row,
 * its components (the BOM the cost is derived from) and its per-shop rows
 * (default pars and price overrides) — everything the record screen shows. It
 * deliberately copies NO plan slot, schedule line or par override: those are
 * facts about days and menus somebody wrote, and a copy landing on a plan would
 * quietly double a shop's production, which is the same reasoning that makes a
 * duplicated PLAN arrive inactive.
 *
 * The copy is `is_active` exactly as the original is, and that is safe here in
 * a way it is not for a plan: an item is made because it is on a tray, and this
 * one is on none.
 *
 * Written parent-first and client-side, and 038 dropped `unique (org_id, name)`
 * — "Angry Samoa" is four different donuts — so "… copy" is for the READER
 * picking it out of a list rather than for the database.
 *
 * **DELETE CAN BE REFUSED BY THE DATABASE, WHICH IS THE ONE PLACE THIS DIFFERS
 * FROM THE INVENTORY ITEM'S MENU.** `production_plan_tray_items` (039) and
 * `production_schedule_items` (040) are `on delete restrict`, so an item on a
 * plan or on any schedule ever generated CANNOT be deleted — Postgres raises,
 * whatever the confirm says. So the count is taken first and the button is
 * disabled with the reason on screen: a control that can only fail is worse
 * than a sentence (`NewLocation`'s rule), and this is not the
 * `closeReadiness` case of naming something and letting you through, because
 * there is no through.
 *
 * Everything else is stated the way that menu states it: components, per-shop
 * rows and par overrides CASCADE, while special-order lines and display tags
 * go `set null` and survive unlinked. Every write `.select()`s its own result —
 * a delete refused by RLS removes zero rows and returns NO error.
 */
export function ProductionItemActions({
  itemId,
  name,
  isActive,
  existingNames,
  afterDelete = "refresh",
}: {
  itemId: string;
  name: string;
  isActive: boolean;
  /** Every item name in the org, so the copy's name doesn't collide. */
  existingNames: string[];
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
    try {
      const newId = await duplicateItem();
      router.refresh();
      router.push(`/production-items/${newId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function duplicateItem(): Promise<string> {
    // 1. The master row.
    const { data: item, error: itemErr } = await supabase
      .from("production_items")
      .select(ITEM_COLUMNS)
      .eq("id", itemId)
      .maybeSingle();
    if (itemErr || !item) throw new Error(itemErr?.message ?? "That item is no longer there.");
    const source = item as unknown as Row;
    const { data: created, error: createErr } = await supabase
      .from("production_items")
      .insert({ ...source, name: duplicateTitle(existingNames, String(source.name)) })
      .select("id")
      .single();
    if (createErr || !created)
      throw new Error(createErr?.message ?? "The copy could not be created.");
    const newId = created.id as string;

    // 2. The BOM. `unique (item_id, element_id)` holds on the copy for free,
    //    because the source obeys it.
    const { data: components, error: cErr } = await supabase
      .from("production_item_elements")
      .select(COMPONENT_COLUMNS)
      .eq("item_id", itemId);
    if (cErr) throw new Error(cErr.message);
    if (components && components.length > 0) {
      const { error } = await supabase
        .from("production_item_elements")
        .insert((components as unknown as Row[]).map((c) => ({ ...c, item_id: newId })));
      if (error) throw new Error(error.message);
    }

    // 3. The per-shop rows: default pars and price overrides.
    const { data: locations, error: lErr } = await supabase
      .from("production_item_locations")
      .select(LOCATION_COLUMNS)
      .eq("item_id", itemId);
    if (lErr) throw new Error(lErr.message);
    if (locations && locations.length > 0) {
      const { error } = await supabase
        .from("production_item_locations")
        .insert((locations as unknown as Row[]).map((l) => ({ ...l, item_id: newId })));
      if (error) throw new Error(error.message);
    }

    return newId;
  }

  async function openConfirm() {
    setConfirming(true);
    setUsage(null);
    setError(null);
    setUsage(await countUsage(supabase, itemId));
  }

  async function deactivate() {
    setBusy("deactivate");
    setError(null);
    const { data, error } = await supabase
      .from("production_items")
      .update({ is_active: false })
      .eq("id", itemId)
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
      .from("production_items")
      .delete()
      .eq("id", itemId)
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

  const held = usage === null ? 0 : usage.planSlots + usage.scheduleLines;

  return (
    <>
      <RowMenu
        label={`Actions for ${name}`}
        items={[
          {
            label: busy === "duplicate" ? "Duplicating…" : "Duplicate",
            hint: "A copy with its components and per-shop pars",
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

      {error && !confirming && <p className="mt-1 text-xs text-accent">{error}</p>}

      {confirming && (
        <Dialog
          title="Delete production item"
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
                disabled={busy !== null || usage === null || held > 0}
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
          <p className="text-sm text-ink">{name}</p>

          {usage === null ? (
            <p className="mt-3 text-sm text-subtle">Checking what uses it…</p>
          ) : (
            <div className="mt-3 space-y-3 text-sm">
              {held > 0 ? (
                <p className="border border-ink bg-[var(--rf-yellow-200)] px-3 py-2 text-ink">
                  This item cannot be deleted: it is on{" "}
                  {usage.planSlots > 0 ? (
                    <>
                      <span className="tabular-nums font-semibold">{usage.planSlots}</span>{" "}
                      {usage.planSlots === 1 ? "plan slot" : "plan slots"}
                    </>
                  ) : null}
                  {usage.planSlots > 0 && usage.scheduleLines > 0 ? " and " : null}
                  {usage.scheduleLines > 0 ? (
                    <>
                      <span className="tabular-nums font-semibold">{usage.scheduleLines}</span>{" "}
                      {usage.scheduleLines === 1 ? "schedule line" : "schedule lines"}
                    </>
                  ) : null}
                  . Deactivating takes it off the menu while leaving what has
                  already been made whole — which is almost always what you want.
                </p>
              ) : (
                <p className="text-muted">
                  This item is on no plan and on no schedule, so it can go.
                </p>
              )}

              <div>
                <p className="text-[12px] uppercase tracking-[0.12em] text-subtle">
                  Deleting would also remove
                </p>
                <ul className="mt-1 space-y-0.5">
                  <UsageLine n={usage.components} one="component" many="components" />
                  <UsageLine
                    n={usage.locations}
                    one="per-shop row, with its default pars and price"
                    many="per-shop rows, with their default pars and prices"
                  />
                  <UsageLine n={usage.overrides} one="par override" many="par overrides" />
                </ul>
                {usage.components + usage.locations + usage.overrides === 0 && (
                  <p className="mt-1 text-muted">Nothing else.</p>
                )}
              </div>

              {usage.orderLines + usage.tags > 0 && (
                <div>
                  <p className="text-[12px] uppercase tracking-[0.12em] text-subtle">
                    Left behind, unlinked
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    <UsageLine
                      n={usage.orderLines}
                      one="special-order line — it keeps its own wording and can no longer be scheduled"
                      many="special-order lines — they keep their own wording and can no longer be scheduled"
                    />
                    <UsageLine
                      n={usage.tags}
                      one="display tag, which loses the price it prints"
                      many="display tags, which lose the price they print"
                    />
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
