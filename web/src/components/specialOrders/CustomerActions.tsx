"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { confirmDialog, splitConfirmMessage } from "@/lib/confirm";
import { BUTTON_CLASS, DANGER_BUTTON_CLASS } from "@/components/ui/buttons";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { CustomerStatement } from "./CustomerStatement";
import { createSpecialOrder } from "@/lib/createSpecialOrder";

/**
 * What you can do to a customer.
 *
 * NEW ORDER FROM HERE is the one people reach for: the phone rings, it is
 * somebody we know, and typing their name into a fresh order is exactly the
 * transcription this record exists to avoid.
 *
 * DELETING KEEPS THEIR ORDERS. `special_orders.customer_id` is `on delete set
 * null`, deliberately: a customer removed must not take twelve years of orders
 * with them, and 73 real orders already name nobody, which the app renders as
 * an em dash. The confirm says so, because "delete" that silently keeps the
 * children is worth stating.
 */
export function CustomerActions({
  id,
  orgId,
  name,
  email,
  orderCount,
  today,
  defaultLocationId,
  canWrite,
}: {
  id: string;
  orgId: string;
  name: string;
  /** Named in the statement dialog, so whoever renders one knows where it is
   *  meant to go without leaving the record to find out. */
  email: string | null;
  orderCount: number;
  /** Today in the ORG's timezone — what "last week" is measured from on the
   *  statement, and a new order's `date_initiated`. */
  today: string;
  /** The shop you are standing in — a new order's pickup shop, and therefore
   *  its tax rate. */
  defaultLocationId: string | null;
  canWrite: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!canWrite) return null;

  function newOrder() {
    setError(null);
    start(async () => {
      // The SAME creator the list's New special order uses, which is how this
      // door gets the pickup shop and the tax snapshot it was missing. The
      // pickup default is the shop you are standing in.
      const result = await createSpecialOrder(supabase, {
        orgId,
        kind: "order",
        title: `New order for ${name}`,
        customerId: id,
        locationId: defaultLocationId,
        // Their name, phone and email become the order's day-of contact —
        // `createSpecialOrder` reads the row, so this door and the list's
        // dialog seed it identically.
        today,
      });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      router.refresh();
      router.push(`/special-orders/${result.id}`);
    });
  }

  async function remove() {
    if (
      !(await confirmDialog({
        ...splitConfirmMessage(
          `Delete ${name}?\n\n${
            orderCount
              ? `Their ${orderCount} order${orderCount === 1 ? "" : "s"} stay — each one simply stops naming a customer, which is how 73 migrated orders already read. `
              : ""
          }This is for a duplicate or a typo.`
        ),
        confirmLabel: "Delete",
        tone: "danger",
      }))
    ) {
      return;
    }
    setError(null);
    start(async () => {
      // `.select()` its own result: with no matching policy Postgres removes
      // zero rows and returns NO error, and a cheerful success that also
      // navigates reads as the customer having been deleted.
      const { data, error: e } = await supabase
        .from("customers")
        .delete()
        .eq("id", id)
        .select("id");
      if (e) {
        setError(e.message);
        return;
      }
      if (!data?.length) {
        setError("Nothing was deleted — the database refused it and said nothing.");
        return;
      }
      router.refresh();
      router.push("/customers");
    });
  }

  return (
    <section className="space-y-3">
      <SectionHeading>Commands</SectionHeading>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={BUTTON_CLASS} onClick={newOrder} disabled={pending}>
          New order for them
        </button>
        {/* Decision 21. It sits with the other commands rather than beside the
            order table it summarises, because it produces a DOCUMENT — the same
            class of act as New order, not a view of the list. */}
        <CustomerStatement
          customerId={id}
          customerEmail={email}
          today={today}
          canWrite={canWrite}
        />
        <button type="button" className={DANGER_BUTTON_CLASS} onClick={remove} disabled={pending}>
          Delete
        </button>
      </div>
      {error ? <p className="text-[13px] text-accent">{error}</p> : null}
    </section>
  );
}
