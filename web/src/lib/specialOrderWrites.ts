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

import type { SpecialOrderKind } from "./specialOrders";

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
 * WHICH refusal applies, as a key rather than a sentence.
 *
 * Split out of `deleteRefusal` for the LIST's batch delete (2026-09-20), which
 * asks the same question of twenty rows at once and then groups them: "3 were
 * made by a standing order" is the sentence a selection wants, where
 * `deleteRefusal` writes the one a single order wants, naming its parent. Two
 * copies of the TEST is how a batch quietly starts deleting something the row
 * menu refuses, so there is one test and two vocabularies on top of it.
 *
 * It takes only the two fields it reads, so a caller holding a list row — which
 * has `standing_order_id` and `production_schedule_id` and no counts — can ask
 * without the four round trips `readDeleteContext` costs.
 */
export type DeleteBlock = "standing_day" | "scheduled" | null;

export function deleteBlock(ctx: {
  /** Truthy when this day was MADE by a standing order. */
  fromStanding: string | null;
  scheduled: boolean;
}): DeleteBlock {
  if (ctx.fromStanding) return "standing_day";
  if (ctx.scheduled) return "scheduled";
  return null;
}

/**
 * Why this order must NOT be deleted, or null.
 *
 * Both of these are refusals rather than confirms, and each for its own reason
 * — see the messages. Everything else about a delete is a question, which is
 * what `deleteConfirmMessage` is for.
 */
export function deleteRefusal(ctx: DeleteContext): string | null {
  const block = deleteBlock(ctx);
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
  if (block === "standing_day") {
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
  if (block === "scheduled") {
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
      supabase.from("order_payments").select("id", { count: "exact", head: true }).eq("order_id", id),
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
 * CANCEL, shared by the record's Actions menu and the list's row menu (Mark,
 * 2026-09-28) so the two say the same thing. Only an ORDER cancels: a lead, a
 * quote, a template or a standing order has no production to call off.
 *
 * CANCELLING CALLS OFF THE ORDER'S INVOICING (Mark, 2026-09-28: "build all
 * three"). An invoice owns a COPY of its orders' lines (141), so changing the
 * order's status changes no invoice:
 *
 * - a DRAFT can still change, so the order comes off it;
 * - a SENT invoice (or one holding money) is frozen and still asks the
 *   customer for this order's money. Nothing here can edit it — it changes by
 *   Revise…, or goes by Void… — so the confirm names it and says so.
 */
export type CancelContext = {
  scheduled: boolean;
  /** The live (not void) invoices carrying this order, as the paper names them. */
  invoices: { id: string; label: string; sent: boolean }[];
};

/** "INV-10004", "INV-10004 and INV-10005", "A, B and C". */
function andList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export function cancelConfirmMessage(number: string, ctx: CancelContext): string {
  const paragraphs = [
    `Cancel order ${number}?`,
    "It stays on the list, greyed and struck through, and drops out of every working view. Cancelling is reversible — set the status back on the order's Info tab.",
  ];
  const drafts = ctx.invoices.filter((i) => !i.sent).map((i) => i.label);
  const sent = ctx.invoices.filter((i) => i.sent).map((i) => i.label);
  if (drafts.length) {
    paragraphs.push(`It comes off draft invoice${drafts.length === 1 ? "" : "s"} ${andList(drafts)}.`);
  }
  if (sent.length) {
    paragraphs.push(
      `${andList(sent)} ${sent.length === 1 ? "has" : "have"} gone out and still ask${
        sent.length === 1 ? "s" : ""
      } the customer for this order's money. Cancelling does not change a sent invoice: Revise… it and take this order off the revision, or Void… it.`
    );
  }
  if (ctx.scheduled) {
    paragraphs.push(
      "The kitchen still has this order: cancelling does NOT unschedule it, so unschedule it as well or those donuts get made."
    );
  }
  return paragraphs.join("\n\n");
}

/**
 * What the confirm needs, read at the moment of the click — neither the list's
 * row nor the record carries the invoices. `prefix` is the org's invoice
 * prefix ("INV-"), so the confirm names each invoice as its paper does.
 */
export async function readCancelContext(
  supabase: SupabaseClient,
  id: string,
  prefix: string
): Promise<CancelContext | { error: string }> {
  const [{ data: order, error: orderError }, { data: lines, error: lineError }] = await Promise.all([
    supabase.from("special_orders").select("production_schedule_id").eq("id", id).maybeSingle(),
    supabase.from("customer_invoice_lines").select("invoice_id").eq("special_order_id", id),
  ]);
  if (orderError) return { error: orderError.message };
  if (lineError) return { error: lineError.message };
  const ids = [...new Set((lines ?? []).map((l) => l.invoice_id as string))];
  let invoices: CancelContext["invoices"] = [];
  if (ids.length) {
    // `posted` is 144's "on the account" — sent, paid or holding money, and
    // not void — which for a live invoice is 141's "frozen".
    const { data, error } = await supabase
      .from("customer_invoice_totals")
      .select("id, number, revision, voided_at, posted")
      .in("id", ids)
      .is("voided_at", null)
      .order("number")
      .order("revision");
    if (error) return { error: error.message };
    invoices = (data ?? []).map((r) => ({
      id: r.id as string,
      label: `${prefix}${r.number}${(r.revision as number) > 1 ? `-${r.revision}` : ""}`,
      sent: Boolean(r.posted),
    }));
  }
  return { scheduled: Boolean(order?.production_schedule_id), invoices };
}

/**
 * Cancels, then takes the order off its drafts. The status write is the act;
 * a draft that refuses (somebody sent it a moment ago) does not undo it — it
 * comes back in `notes`, the things the person must be told afterwards.
 */
export async function cancelSpecialOrder(
  supabase: SupabaseClient,
  id: string,
  ctx: CancelContext
): Promise<{ notes: string[] } | { error: string }> {
  // `.select()` its own result: a refused update changes nothing and says so.
  const { data, error } = await supabase
    .from("special_orders")
    .update({ status: "cancelled" })
    .eq("id", id)
    .select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "The change wasn't saved — the database refused it silently." };

  const notes: string[] = [];
  for (const inv of ctx.invoices.filter((i) => !i.sent)) {
    const { error: e } = await supabase.rpc("remove_order_from_customer_invoice", {
      p_invoice: inv.id,
      p_order: id,
    });
    if (e) notes.push(`It is still on ${inv.label}: ${e.message}.`);
  }
  return { notes };
}

/**
 * Decision 13's one mechanism, and since 114 it is ONE CALL: a template, a
 * standing order and an ordinary order are all copied by
 * `copy_special_order`, and the copy's KIND is the caller's — which is what
 * turns "duplicate" into "convert into".
 *
 * ---------------------------------------------------------------------------
 * IT IS A WRAPPER, AND THAT IS THE POINT
 * ---------------------------------------------------------------------------
 * Everything this used to do in the browser — strip identity and the stage
 * dates, decide the status and to-do from the kind, drop the event date for a
 * shape, copy the lines, write where it came from — is in the function, because
 * only the database can do it in ONE TRANSACTION. That is not tidiness: the
 * app's three calls looked to Postgres like three unrelated inserts, so a
 * trigger logged "Added 12 × Glazed" for every line the copy made and a
 * converted template arrived carrying a re-enactment of the order's history.
 * `copy_special_order` raises a transaction-local flag that
 * `log_special_order_event` reads, and writes a single line naming the source.
 *
 * THE CLIENT-SIDE COPY THAT STOOD HERE IS GONE (2026-09-21, once 114 and 115
 * were applied and a real conversion was read back: template 10061, one log
 * entry). It was a fallback for the window before the migration landed, and it
 * had already earned its keep in the wrong direction — it caught 113's failure
 * and quietly did the copy the old way, reporting success, which is how a
 * broken migration looked like a working feature for a day.
 *
 * CONVERTING COPIES; THE ORIGINAL IS NOT TOUCHED. A finished order is HISTORY —
 * invoiced, made and eaten — and turning that row into a shape would delete the
 * record of a thing that happened.
 */
export async function duplicateSpecialOrder(
  supabase: SupabaseClient,
  orgId: string,
  id: string,
  /** What the COPY is. Defaults to an order, which is what Duplicate means. */
  kind: SpecialOrderKind = "order"
): Promise<{ id: string } | { error: string }> {
  const { data, error } = await supabase.rpc("copy_special_order", {
    p_org_id: orgId,
    p_order_id: id,
    p_kind: kind,
  });
  if (error) return { error: error.message };
  // The function returns the new uuid. Anything else means it ran and told us
  // nothing, which is not a copy anybody should be sent to look at.
  if (typeof data !== "string") {
    return { error: "The copy was not created, and the database said nothing." };
  }
  return { id: data };
}
