import type { SupabaseClient } from "@supabase/supabase-js";
import { confirmDialog, splitConfirmMessage } from "@/lib/confirm";

export type DeletablePo = { id: string; po_number: string; status: string };

/**
 * Confirm and delete purchase orders — ONE implementation behind every door:
 * the PO list's Delete and row menu, and PO detail's Delete Purchase Order…
 * (Mark, 2026-09-14). What gets remembered in one copy and forgotten in another
 * is the confirm (non-draft history, attributed bills) and the row-count check,
 * so neither lives anywhere else.
 *
 * Resolves `cancelled` when the confirm is declined, `deleted` on success, and
 * `error` with a sentence otherwise.
 */
export async function confirmAndDeletePurchaseOrders(
  supabase: SupabaseClient,
  selected: DeletablePo[]
): Promise<"cancelled" | "deleted" | { error: string }> {
  if (selected.length === 0) return "cancelled";
  const nonDraft = selected.filter((po) => po.status !== "draft");

  /**
   * WHICH BILLS POINT AT THESE ORDERS.
   *
   * Both links are `on delete set null` (025), so deleting an order does not
   * take its invoices with it — the money is still owed and the bill stays
   * payable, which is right. What goes is the ATTRIBUTION: those invoices
   * silently stop knowing what was ordered, and nothing said so (Mark asked
   * what happens, 2026-09-02).
   */
  let attributed: string[] = [];
  const { data: linked } = await supabase
    .from("vendor_bill_lines")
    .select("bill_id, vendor_bills ( invoice_number )")
    .in("purchase_order_id", selected.map((po) => po.id));
  if (linked && linked.length > 0) {
    attributed = [
      ...new Set(
        linked
          .map(
            (l) =>
              (l.vendor_bills as unknown as { invoice_number: string | null } | null)
                ?.invoice_number ?? "no number"
          )
          .filter(Boolean)
      ),
    ];
  }

  const message =
    (selected.length === 1
      ? `Delete purchase order ${selected[0].po_number} and its lines?`
      : `Delete ${selected.length} purchase orders and their lines?`) +
    (nonDraft.length > 0
      ? (selected.length === 1
          ? `\n\nWARNING: it is ${nonDraft[0].status}, not a draft.`
          : `\n\nWARNING: ${nonDraft.length} of them ${
              nonDraft.length === 1 ? "is" : "are"
            } not a draft (${[...new Set(nonDraft.map((po) => po.status))].join(", ")}).`) +
        " Deleting sent or received orders erases order history permanently."
      : "") +
    (attributed.length > 0
      ? `\n\n${attributed.length} invoice${attributed.length === 1 ? "" : "s"} ` +
        `(${attributed.slice(0, 4).join(", ")}${attributed.length > 4 ? ", …" : ""}) ` +
        `${attributed.length === 1 ? "is" : "are"} attributed to ` +
        `${selected.length === 1 ? "this order" : "these orders"}. ` +
        `The bill${attributed.length === 1 ? "" : "s"} stay${attributed.length === 1 ? "s" : ""} ` +
        `and remain${attributed.length === 1 ? "s" : ""} payable — but ` +
        `${attributed.length === 1 ? "it" : "they"} will no longer know what was ordered.`
      : "") +
    (nonDraft.length === 0 && attributed.length === 0 ? "\n\nThis cannot be undone." : "");
  if (
    !(await confirmDialog({
      ...splitConfirmMessage(message),
      confirmLabel: "Delete",
      tone: "danger",
    }))
  )
    return "cancelled";

  // `.select()` ON A DELETE. With no matching RLS policy Postgres removes ZERO
  // ROWS and PostgREST returns NO ERROR, so a bare delete reports a cheerful
  // success and the order is still there after the refresh — the
  // employee-delete lesson.
  const { data, error } = await supabase
    .from("purchase_orders")
    .delete()
    .in(
      "id",
      selected.map((po) => po.id)
    )
    .select("id");
  if (error) return { error: error.message };
  if ((data?.length ?? 0) < selected.length) {
    return {
      error: data?.length
        ? `Only ${data.length} of ${selected.length} were deleted — the rest are not yours to delete.`
        : "Nothing was deleted. Purchase orders are a purchaser's to remove.",
    };
  }
  return "deleted";
}
