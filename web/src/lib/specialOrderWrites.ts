/**
 * DUPLICATING AND DELETING A SPECIAL ORDER — one implementation, two doors.
 *
 * The record's command row had both to itself until 2026-09-08, when the list
 * grew a `⋯` (Mark: "add a 'more options' button column … with 'duplicate' and
 * 'delete' options to start"). The PO list's own rule applies and is why this
 * module exists rather than a second copy in the menu: `renderPoPdf` and
 * `deleteOrders` are one implementation behind both doors "which matters most
 * for the confirm", and the confirm is exactly what would have drifted here —
 * a delete on this table has THREE refusals and a message that has to count
 * what goes.
 *
 * Client-safe (the `createSpecialOrder` idiom): every read and write goes
 * through the CALLER's supabase client, so RLS applies exactly as it would from
 * any screen, and a purchaser gets the same answer here as anywhere else.
 *
 * The two pure functions are the point of the split — `deleteRefusal` and
 * `deleteConfirmMessage` are what the two doors must agree about, and they are
 * fixture-tested where a component is not.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Everything the guards and the confirm need, in one read.
 *
 * Gathered by `readDeleteContext` rather than passed in from the caller, and
 * that is deliberate: the list's row carries none of it (no line count, no
 * schedule link, no `standing_order_id`), and a version of this that took what
 * the caller happened to hold would have one door checking three things and the
 * other checking one — which is the state this module was written to end.
 */
export type DeleteContext = {
  id: string;
  number: string;
  kind: string;
  /** True once a production schedule exists for this order. */
  scheduled: boolean;
  /** The standing order that MADE this day, if it was made rather than typed. */
  fromStanding: string | null;
  /** For a standing order: how many days it has already made. */
  madeCount: number;
  lineCount: number;
  paymentCount: number;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Why this order must NOT be deleted, or null.
 *
 * Both of these are refusals rather than confirms, and each for its own reason
 * — see the messages. Everything else about a delete is a question, which is
 * what `deleteConfirmMessage` is for.
 */
export function deleteRefusal(ctx: DeleteContext): string | null {
  /**
   * THE ONE THAT STOPS THE APP UNDOING ITSELF. 051's
   * `special_orders_standing_day` is unique on `(standing_order_id,
   * event_date)` and a CANCELLED day still occupies its slot — that is what
   * makes cancelling Thanksgiving stick. Delete the row and the slot is free,
   * so 099's next top-up (the next time anybody opens this list) makes the day
   * again and the donuts get made.
   *
   * Not a confirm you can click through, unlike everything else here: what goes
   * wrong happens minutes later on somebody else's screen, so the reader cannot
   * know something the app does not.
   */
  if (ctx.fromStanding) {
    return (
      `This day was made from standing order ${ctx.fromStanding}, so deleting it would only ` +
      `make it again the next time anybody opens the list. Cancel it instead — that is what ` +
      `keeps it from being made.`
    );
  }

  /**
   * `production_schedules.source_ref` deliberately carries no FK (040: the
   * table did not exist yet), so deleting the order would leave a live schedule
   * pointing at a uuid that is gone — a kitchen document with a dead backlink
   * and nothing to explain it. Unscheduling first is one click.
   */
  if (ctx.scheduled) {
    return (
      "This order's production is scheduled. Unschedule it first — deleting now would leave " +
      "the kitchen holding a schedule with nothing behind it."
    );
  }

  return null;
}

/**
 * The confirm's words — `splitConfirmMessage`'s two-paragraph shape.
 *
 * IT NAMES THE ORDER whichever door asked, which is the PO list's rule: from a
 * row menu "1 order" is a worse answer to "which one?" than the number on the
 * row you just pressed, and from the record it costs nothing to repeat what the
 * heading says.
 */
export function deleteConfirmMessage(ctx: DeleteContext): string {
  const damage = [
    ctx.lineCount ? plural(ctx.lineCount, "line") : null,
    ctx.paymentCount ? plural(ctx.paymentCount, "payment") : null,
  ].filter(Boolean);
  const removes = damage.length
    ? `This also removes ${damage.join(" and ")}, and everything in its history. `
    : "";

  if (ctx.kind === "standing_order") {
    /**
     * A STANDING ORDER IS NOT A DAY, so the advice is different and the
     * arithmetic is worth stating. 051 makes `standing_order_id` `on delete set
     * null` precisely so the days already made — invoiced, delivered, eaten —
     * survive their parent; what stops is the MAKING, silently, which is the
     * thing somebody deleting this would not have meant.
     */
    const made = ctx.madeCount
      ? `The ${plural(ctx.madeCount, "order")} it has already made ${
          ctx.madeCount === 1 ? "is" : "are"
        } NOT deleted — they stay as ordinary orders. `
      : "";
    return (
      `Delete standing order ${ctx.number}?\n\n${removes}${made}` +
      `To stop it making more without losing the record, PAUSE it instead.`
    );
  }

  const noun = ctx.kind === "template" ? "template" : "order";
  return (
    `Delete ${noun} ${ctx.number}?\n\n${removes}Deleting is for a typo. ` +
    `An order that is not happening should be CANCELLED, which keeps the record.`
  );
}

export async function readDeleteContext(
  supabase: SupabaseClient,
  id: string
): Promise<DeleteContext | { error: string }> {
  const { data: row, error } = await supabase
    .from("special_orders")
    .select("id, number, kind, production_schedule_id, standing_order_id")
    .eq("id", id)
    .maybeSingle();
  if (error) return { error: error.message };
  if (!row) return { error: "That order does not exist, or is not yours to see." };

  const standingId = (row.standing_order_id as string | null) ?? null;

  // `head: true` throughout — these are counts for a sentence, and pulling the
  // rows to length them would fetch a wholesale order's whole line list to say
  // "2 lines".
  const [{ count: lineCount }, { count: paymentCount }, { count: madeCount }, { data: parent }] =
    await Promise.all([
      supabase.from("special_order_items").select("id", { count: "exact", head: true }).eq("order_id", id),
      supabase.from("special_order_payments").select("id", { count: "exact", head: true }).eq("order_id", id),
      row.kind === "standing_order"
        ? supabase
            .from("special_orders")
            .select("id", { count: "exact", head: true })
            .eq("standing_order_id", id)
        : { count: 0 },
      standingId
        ? supabase.from("special_orders").select("number").eq("id", standingId).maybeSingle()
        : { data: null },
    ]);

  return {
    id: row.id as string,
    number: row.number as string,
    kind: (row.kind as string) ?? "order",
    scheduled: (row.production_schedule_id as string | null) !== null,
    // The NUMBER, not the id — the refusal names it, and a row that has lost
    // its parent (051's `set null`, after somebody deleted the standing order)
    // is an ordinary order again and must not be refused.
    fromStanding: ((parent as { number?: string } | null)?.number as string | undefined) ?? null,
    madeCount: madeCount ?? 0,
    lineCount: lineCount ?? 0,
    paymentCount: paymentCount ?? 0,
  };
}

/**
 * `.select()`s its own result: with no matching policy Postgres removes zero
 * rows and PostgREST returns NO error, so a bare delete reports a cheerful
 * success — and on the record it also NAVIGATES, which reads as the order
 * having gone.
 */
export async function deleteSpecialOrder(
  supabase: SupabaseClient,
  id: string
): Promise<{ deleted: number } | { error: string }> {
  const { data, error } = await supabase
    .from("special_orders")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) return { error: error.message };
  if (!data?.length) {
    return { error: "Nothing was deleted — the database refused it and said nothing." };
  }
  return { deleted: data.length };
}

/**
 * Decision 13's one mechanism: a template, a standing order and an ordinary
 * order are all duplicated by this, and the copy is always a real ORDER
 * starting as a LEAD.
 *
 * It arrives with no dates and no payments — a duplicate of a paid order that
 * claimed to be paid would be a fiction, and the stage dates belong to the
 * event that happened.
 */
export async function duplicateSpecialOrder(
  supabase: SupabaseClient,
  id: string,
  number: string
): Promise<{ id: string } | { error: string }> {
  const { data: source, error: readError } = await supabase
    .from("special_orders")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (readError || !source) return { error: readError?.message ?? "Could not read this order." };

  const { data: nextNumber, error: numberError } = await supabase.rpc("next_special_order_number", {
    p_org_id: source.org_id,
  });
  if (numberError || !nextNumber) {
    return { error: numberError?.message ?? "Could not allocate an order number." };
  }

  const copy = { ...(source as Record<string, unknown>) };
  // Identity and history do not travel.
  for (const key of [
    "id", "number", "legacy_id", "legacy_seq", "created_at", "updated_at",
    "created_by", "updated_by", "date_initiated", "quote_sent_at",
    "quote_returned_at", "invoice_sent_at", "invoice_paid_at",
    "receipt_sent_at", "delivery_scheduled_at", "order_printed_at",
    "order_scheduled_at", "production_schedule_id", "standing_order_id",
    "inbound_subject", "inbound_message_id", "flag_reason",
    "source_payload", "external_ref",
  ]) {
    delete copy[key];
  }
  copy.number = nextNumber;
  copy.kind = "order";
  copy.status = "lead";
  copy.standing_days = null;
  copy.starts_on = null;
  copy.ends_on = null;
  copy.paused = false;
  copy.source = "app";
  copy.todo = "Respond to Email/Call";

  const { data: created, error: insertError } = await supabase
    .from("special_orders")
    .insert(copy)
    .select("id")
    .single();
  if (insertError || !created) {
    return { error: insertError?.message ?? "The copy could not be created." };
  }

  // The lines travel; the payments emphatically do not.
  const { data: lines } = await supabase.from("special_order_items").select("*").eq("order_id", id);
  if (lines?.length) {
    const copies = lines.map((l) => {
      const line = { ...(l as Record<string, unknown>) };
      for (const key of ["id", "created_at", "updated_at", "legacy_key"]) delete line[key];
      line.order_id = created.id;
      return line;
    });
    const { error: lineError } = await supabase.from("special_order_items").insert(copies);
    if (lineError) {
      return { error: `The order was copied but its lines were not: ${lineError.message}` };
    }
  }

  // 054's trigger says "Order started as a lead"; where it CAME FROM is a fact
  // with no watched column behind it, so it is written by hand.
  await supabase.from("special_order_events").insert({
    org_id: source.org_id,
    order_id: created.id,
    message: `Duplicated from order ${number}`,
    source: "app",
  });

  return { id: created.id as string };
}
