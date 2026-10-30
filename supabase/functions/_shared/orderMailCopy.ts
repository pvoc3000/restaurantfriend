/**
 * AN EMAIL THE APP JUST SENT, INTO ITS ORDER'S HISTORY AT ONCE (Mark,
 * 2026-10-29: the approval confirmation "did not appear in the email thread.
 * I know it will if I tap 'check for email' but seems like I shouldn't have
 * to").
 *
 * Every email to a customer about an order — a document, an invoice, the
 * approval confirmation, the inquiry confirmation, "Payment received", a reply
 * from the Email tab — calls this straight after it goes, beside
 * `orderThread`'s `record`. It reads the message back from the sending
 * mailbox (the copy is what Gmail actually holds, attachments and all), writes
 * it to `special_order_messages` and settles what it answers, exactly as the
 * five-minute check (`order-mail`) would have a few minutes later.
 *
 * The service-role client is made HERE, because `special_order_messages` has
 * no write policy: the check and this are its only writers, and several
 * callers hold only the signed-in user's client. Scoped by `org_id`
 * explicitly, since it bypasses RLS.
 *
 * NEVER THROWS, and returns a problem worth a warning or null. The email has
 * gone either way, and the next check copies anything this missed. A mailbox
 * that is not Gmail is not readable, so there is nothing to copy.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

import { gmailAccessToken, type ResolvedTransport } from "./email.ts";
import { readMessage, rowFor, type GmailMessage } from "./orderMail.ts";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

async function gmail<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${GMAIL}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = (data as { error?: { message?: string } })?.error?.message ?? res.statusText;
    throw new Error(`Gmail refused ${path.split("?")[0]}: ${message}`);
  }
  return data as T;
}

export async function copySentToOrder(args: {
  transport: ResolvedTransport;
  orgId: string;
  orderId: string;
  /** `Sent.ref` — "gmail <id>" from a Gmail send. */
  ref: string;
}): Promise<string | null> {
  if (args.transport.cfg.kind !== "gmail" || !args.ref.startsWith("gmail ")) return null;
  try {
    const token = await gmailAccessToken(args.transport.creds as Record<string, string>);
    const profile = await gmail<{ emailAddress?: string }>(token, "/profile");
    const mailbox = (profile.emailAddress ?? "").toLowerCase();
    if (!mailbox) return "the email is not on the order's Email tab until the next check: Gmail did not say which mailbox this is";
    const gmailId = args.ref.replace(/^gmail\s+/, "");
    const message = await gmail<GmailMessage>(token, `/messages/${encodeURIComponent(gmailId)}?format=full`);
    const read = readMessage(message, mailbox);
    if (!read.ok) return null;

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false },
    });
    const { error } = await admin
      .from("special_order_messages")
      .upsert(rowFor(args.orgId, args.orderId, message, read.message, "sent"), {
        onConflict: "org_id,gmail_message_id",
        ignoreDuplicates: true,
      });
    if (error) return `the email was not copied to the order: ${error.message}`;
    const { error: settleError } = await admin.rpc("settle_special_order_messages", { p_orders: [args.orderId] });
    if (settleError) return `the order still shows as waiting: ${settleError.message}`;
    return null;
  } catch (e) {
    return `the email is not on the order's Email tab until the next check: ${e instanceof Error ? e.message : String(e)}`;
  }
}
