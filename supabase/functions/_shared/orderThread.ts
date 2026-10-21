/**
 * ONE CONVERSATION PER SPECIAL ORDER (migration 167, Mark, 2026-10-02; made to
 * actually work by 210, 2026-10-21).
 *
 * Every email about an order — the customer's AND the shop's own notices —
 * answers the order's thread root with `In-Reply-To` and `References`, which
 * is what mail clients thread on, and goes under its fixed subject, because
 * Gmail also splits on a changed subject. In the sending mailbox it also names
 * the order's Gmail conversation (`threadId`), without which every API send
 * from specialorders@ started a conversation of its own however good its
 * headers were.
 *
 * The root is the Message-ID the first email ACTUALLY carried, read back
 * after the send (`Sent.messageId`). 167 generated one, sent it and stored it
 * — and Gmail replaces a supplied Message-ID with its own, so for three weeks
 * every order's root was an id no message anywhere carries, and nothing
 * threaded. `record` stores the root, the conversation and the subject ONCE
 * THE MAIL HAS GONE, each only where the order has none, so a failed send
 * never leaves a root that no message carries.
 *
 * A message going to the shop (a notice) may start the thread when nobody has
 * written to the customer — a phone-only inquiry. The kitchen sheet and the
 * carrier emails are other conversations with other people and never call this.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { newMessageId, type Sent } from "./email.ts";
import { threadSubject } from "./threadSubject.ts";

export type OrderThread = {
  /** The fixed subject, or the one this first email will fix. */
  subject: string;
  /** Spread into the `Mail`: the reply headers, a generated Message-ID when
   *  there is no root yet (which Resend keeps and Gmail replaces), and the
   *  sending mailbox's conversation when there is one. */
  headers: { messageId?: string; inReplyTo?: string; references?: string; threadId?: string };
  /** After a SUCCESSFUL send: fix the root, the conversation and the subject
   *  wherever the order has none. Returns a problem worth a warning, or null.
   *  Never throws. */
  record: (sent: Sent, sentSubject: string) => Promise<string | null>;
};

/** Angle-bracketed on the wire; a stored value may or may not be, and
 *  `<<id>>` threads with nothing. */
export function bracketed(id: string): string {
  const t = id.trim();
  return t.startsWith("<") ? t : `<${t}>`;
}

/**
 * The order's thread, or null when the order cannot be read — the mail then
 * goes out unthreaded rather than not at all.
 *
 * `client` is whichever client the sender already holds: the CALLER's for a
 * send from the app (a supervisor+ can update the order), the service role's
 * for the public pages.
 */
export async function orderThread(
  client: SupabaseClient,
  orderId: string,
  from: string | null | undefined,
  naming: { org: string | null | undefined; template: string | null | undefined }
): Promise<OrderThread | null> {
  const { data: order, error } = await client
    .from("special_orders")
    .select("thread_message_id, thread_conversation_id, thread_subject, number, title")
    .eq("id", orderId)
    .maybeSingle();
  if (error || !order) return null;

  const root = String(order.thread_message_id ?? "").trim();
  const conversation = String(order.thread_conversation_id ?? "").trim();
  const fixedSubject = String(order.thread_subject ?? "").trim();
  const subject =
    fixedSubject ||
    threadSubject(naming.template, { org: naming.org, number: order.number, title: order.title });

  const headers: OrderThread["headers"] = root
    ? { inReplyTo: bracketed(root), references: bracketed(root) }
    : { messageId: newMessageId(from) };
  if (conversation) headers.threadId = conversation;

  return {
    subject,
    headers,
    record: async (sent, sentSubject) => {
      // One guarded write per column, each `is null`: a send that started the
      // thread a moment earlier keeps it, and this message is simply in it.
      const problems: string[] = [];
      const fill = async (column: string, value: string | null) => {
        if (!value) return;
        const { error: e } = await client
          .from("special_orders")
          .update({ [column]: value })
          .eq("id", orderId)
          .is(column, null);
        if (e) problems.push(e.message);
      };
      if (!fixedSubject) await fill("thread_subject", sentSubject.trim() || subject);
      if (!root) await fill("thread_message_id", sent.messageId);
      if (!conversation) await fill("thread_conversation_id", sent.threadId);

      if (problems.length) {
        return `the conversation was not recorded, so later emails may not thread: ${problems.join("; ")}`;
      }
      if (!root && !sent.messageId) {
        return `this email could not start the conversation: ${sent.note ?? "its Message-ID is unknown"}`;
      }
      return null;
    },
  };
}
