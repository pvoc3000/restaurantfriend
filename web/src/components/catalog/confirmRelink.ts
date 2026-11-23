import { createClient } from "@/lib/supabase/client";
import { confirmDialog } from "@/lib/confirm";
import type { PickOption } from "@/components/ui/PickList";

/**
 * RELINKING A VENDOR ITEM ASKS FIRST (Mark, 2026-11-23: "we should confirm
 * changes to a vendor item inventory item with a dialogue box before
 * committing. It's pretty important.").
 *
 * The Inventory item picklist writes on the pick, and its first row after
 * "Not linked" is a real item — Activated Charcoal. On 2026-11-09 Unified
 * Paper's Biodegradable Fork landed there by what looks like a stray pick, and
 * nothing said so: it just vanished from the fork. A relink is rare and moves a
 * lot — the vendor item's order and price history go with it, it leaves one
 * item's guide lines for another's — so one extra click is cheap.
 *
 * ONLY WHEN A LINK CHANGES OR IS REMOVED. Linking an unlinked vendor item (a
 * new one being set up, or one of the unlinked rows) commits on the pick:
 * there is nothing to lose and that is the common case.
 *
 * FAVORITES DO NOT FOLLOW. A favorite (`order_guide_plan_days`) is keyed by the
 * OLD item's item-location as well as the vendor item, and `v_order_guide`
 * joins on both — so after a relink it matches nothing and quietly stops
 * applying. The dialog counts them so that is said before, not discovered on
 * the next walk.
 *
 * Shared by the vendor item record and the vendor items table, which wear the
 * same picklist.
 */
export async function confirmRelink(
  vendorItem: { id: string; description: string | null },
  from: string | null,
  to: string | null,
  options: PickOption[]
): Promise<boolean> {
  if (from === null || from === to) return true;

  const name = (value: string | null) =>
    options.find((o) => o.value === value)?.label ?? "another item";
  const fromName = name(from);
  const what = vendorItem.description?.trim() || "This vendor item";

  const { count } = await createClient()
    .from("order_guide_plan_days")
    .select("id", { count: "exact", head: true })
    .eq("vendor_item_id", vendorItem.id);
  const favorites =
    count && count > 0
      ? `\n\nIts ${count} favorite ${count === 1 ? "day stays" : "days stay"} with ${fromName} and will stop applying.`
      : "";

  if (to === null) {
    return confirmDialog({
      title: `Unlink from ${fromName}?`,
      body:
        `${what} keeps its order and price history, and drops off the order guide until it is linked again.` +
        favorites,
      confirmLabel: "Unlink",
    });
  }

  const toName = name(to);
  return confirmDialog({
    title: `Move to ${toName}?`,
    body:
      `${what} is linked to ${fromName}. Its order and price history move with it, and it will be ordered under ${toName}.` +
      favorites,
    confirmLabel: "Move",
  });
}
