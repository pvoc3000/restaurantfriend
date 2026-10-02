/**
 * ONE CONVERSATION PER SPECIAL ORDER (migration 167, Mark, 2026-10-02).
 *
 * Every customer email about an order answers the order's thread root —
 * `In-Reply-To` and `References`, which is what clients actually thread on —
 * and goes under its fixed subject, because Gmail also splits on a changed
 * subject. An order with no root yet gets one: the email being sent carries a
 * Message-ID generated here, and `record` stores it ONCE THE MAIL HAS GONE, so
 * a failed send never leaves a root that no message carries.
 *
 * Generated rather than read back, for `submit-inquiry`'s reason: a provider
 * id is not the Message-ID header, and storing one threads with nothing,
 * silently and forever (see `MailMessage.messageId`).
 *
 * Only for mail TO THE CUSTOMER. The kitchen sheet and the carrier emails are
 * other conversations with other people and never call this.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { newMessageId } from "./email.ts";
import { threadSubject } from "./threadSubject.ts";

export type OrderThread = {
  /** The fixed subject, or the one this first email will fix. */
  subject: string;
  headers: { messageId?: string; inReplyTo?: string; references?: string };
  /** After a SUCCESSFUL send: fix the root and the subject on an order that
   *  had none. Returns a problem worth a warning, or null. Never throws. */
  record: (sentSubject: string) => Promise<string | null>;
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
    .select("thread_message_id, thread_subject, number, title")
    .eq("id", orderId)
    .maybeSingle();
  if (error || !order) return null;

  const root = String(order.thread_message_id ?? "").trim();
  const fixedSubject = String(order.thread_subject ?? "").trim();
  const subject =
    fixedSubject ||
    threadSubject(naming.template, { org: naming.org, number: order.number, title: order.title });

  if (root) {
    const id = bracketed(root);
    return {
      subject,
      headers: { inReplyTo: id, references: id },
      record: async (sent) => {
        if (fixedSubject) return null;
        const { error: e } = await client
          .from("special_orders")
          .update({ thread_subject: sent.trim() || subject })
          .eq("id", orderId)
          .is("thread_subject", null);
        return e ? `the conversation subject was not recorded: ${e.message}` : null;
      },
    };
  }

  const messageId = newMessageId(from);
  return {
    subject,
    headers: { messageId },
    record: async (sent) => {
      // `is null`, so a send that started the thread a moment earlier keeps
      // it; this message is then simply its own.
      const { error: e } = await client
        .from("special_orders")
        .update({ thread_message_id: messageId, thread_subject: fixedSubject || sent.trim() || subject })
        .eq("id", orderId)
        .is("thread_message_id", null);
      return e ? `the conversation was not recorded, so later emails will not thread: ${e.message}` : null;
    },
  };
}
