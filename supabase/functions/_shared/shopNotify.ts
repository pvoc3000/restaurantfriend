// SENDING A SHOP NOTICE — the one door for the three emails the shop gets when
// a customer acts on their own (a new inquiry, a quote approved, a payment
// taken online). The CONTENT is `shopNotices.ts` (pure, fixture-tested); this
// is the delivery: who it goes to, which mailbox it leaves from, and the line
// in the order's log saying so — or saying why not.
//
// WHO: `orgs.settings.special_orders.inquiry_notify` (137), one address or
// several, comma-separated; empty turns every shop notice off. The key kept its
// first name when the approval and paid-online notices joined it (2026-09-24);
// Settings labels it for all three.
//
// Never throws: a notice is bookkeeping, and the thing it reports (the lead,
// the approval, the payment) has already happened.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

import { resolveTransport, sendMail, type ProviderConfig } from "./email.ts";
import { buildPaymentNotice, type Notice } from "./shopNotices.ts";

/** A link into the app, or null when the `APP_URL` secret is not set — the
 *  notice then simply has no button. */
export function appLink(path: string): string | null {
  const base = (Deno.env.get("APP_URL") ?? "").trim().replace(/\/+$/, "");
  return base ? `${base}${path}` : null;
}

export async function sendShopNotice(
  admin: SupabaseClient,
  args: {
    orgId: string;
    notice: Notice;
    /** Each order the notice is about gets the log line. */
    orderIds: string[];
    /** "New-inquiry notice", "Quote-approved notice", "Paid-online notice". */
    what: string;
    replyTo?: string | null;
    attachment?: { filename: string; base64: string };
  }
): Promise<"sent" | "off" | "error"> {
  const log = async (message: string) => {
    if (args.orderIds.length === 0) return;
    await admin.from("special_order_events").insert(
      args.orderIds.map((order_id) => ({
        org_id: args.orgId,
        order_id,
        message,
        author: "Website",
        source: "app",
      }))
    );
  };
  try {
    const { data: org } = await admin.from("orgs").select("name, settings").eq("id", args.orgId).maybeSingle();
    const settings = (org?.settings ?? {}) as {
      email_provider?: ProviderConfig;
      special_orders?: { email_provider?: ProviderConfig; reply_to?: string; inquiry_notify?: string };
      billing?: { email?: string };
    };
    const to = (settings.special_orders?.inquiry_notify ?? "")
      .split(/[,;]/)
      .map((a) => a.trim())
      .filter(Boolean);
    if (to.length === 0) return "off";

    const transport = resolveTransport({
      explicit: settings.special_orders?.email_provider,
      orgProvider: settings.email_provider,
      orgName: org?.name ?? "Orders",
      replyToFallbacks: [settings.special_orders?.reply_to, settings.billing?.email],
    });
    await sendMail(transport, {
      // The first address as To and any others as Cc: Resend reads `to` as ONE
      // address, while `cc` is split on commas by both providers.
      to: to[0],
      cc: to.length > 1 ? to.slice(1).join(", ") : undefined,
      subject: args.notice.subject,
      text: args.notice.text,
      html: args.notice.html,
      replyTo: args.replyTo?.trim() || undefined,
      attachment: args.attachment,
    });
    await log(`${args.what} emailed to ${to.join(", ")}`);
    return "sent";
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    console.error(`shop notice (${args.what})`, why);
    await log(`${args.what} was not sent: ${why}`);
    return "error";
  }
}


/** "Traci Trombino", else the company, else null. */
function customerName(c: { first_name?: string | null; last_name?: string | null; company?: string | null } | null) {
  if (!c) return null;
  const person = [c.first_name, c.last_name].filter((v) => v && v.trim()).join(" ").trim();
  return person || (c.company ?? "").trim() || null;
}

/**
 * PAID ONLINE, ON A CUSTOMER INVOICE — the QuickBooks path (webhook and its
 * backup poll) and the Square pay link when it pays an invoice. Reads the
 * invoice after the payment was recorded, so the balance is what is left.
 * Call it ONLY when the recording step said "recorded" — that is what makes it
 * once per payment whichever path got there first.
 */
export async function notifyInvoicePaid(
  admin: SupabaseClient,
  args: { orgId: string; invoiceId: string; amount: number; method: string; processor: "Square" | "QuickBooks" }
): Promise<"sent" | "off" | "error"> {
  try {
    const { data: inv } = await admin
      .from("customer_invoices")
      .select("id, number, customers(first_name, last_name, company, email)")
      .eq("id", args.invoiceId)
      .maybeSingle();
    if (!inv) return "error";
    const { data: lines } = await admin
      .from("customer_invoice_lines")
      .select("amount, special_order_id, special_orders(number, title, event_date)")
      .eq("invoice_id", args.invoiceId)
      .order("sort");
    const { data: pays } = await admin
      .from("special_order_payments")
      .select("amount")
      .eq("customer_invoice_id", args.invoiceId);
    const rows = (lines ?? []) as unknown as {
      amount: number | string;
      special_order_id: string;
      special_orders: { number: string; title: string | null; event_date: string | null } | null;
    }[];
    const total = rows.reduce((a, l) => a + Number(l.amount), 0);
    const paid = (pays ?? []).reduce((a, p) => a + Number((p as { amount: number | string }).amount), 0);
    const customer = inv.customers as unknown as { first_name?: string; last_name?: string; company?: string; email?: string } | null;
    const notice = buildPaymentNotice(
      {
        kind: "invoice",
        number: String(inv.number),
        title: null,
        customer: customerName(customer),
        amount: args.amount,
        method: args.method,
        processor: args.processor,
        balance: Math.round((total - paid) * 100) / 100,
        event_date: null,
        orders: rows
          .filter((l) => l.special_orders)
          .map((l) => `#${l.special_orders!.number}${l.special_orders!.title ? ` — ${l.special_orders!.title}` : ""}`),
      },
      appLink(`/customer-invoices/${args.invoiceId}`)
    );
    return await sendShopNotice(admin, {
      orgId: args.orgId,
      notice,
      orderIds: [...new Set(rows.map((l) => l.special_order_id))],
      what: "Paid-online notice",
      replyTo: customer?.email ?? null,
    });
  } catch (e) {
    console.error("shop notice (paid invoice)", e instanceof Error ? e.message : String(e));
    return "error";
  }
}

/** The customer invoice a QuickBooks invoice id belongs to, via the company's
 *  realm — how the webhook and the poll name it. */
export async function qboInvoice(
  admin: SupabaseClient,
  realm: string,
  qboInvoiceId: string
): Promise<{ orgId: string; invoiceId: string } | null> {
  const { data: conn } = await admin
    .from("accounting_connections")
    .select("org_id")
    .eq("provider", "qbo")
    .eq("realm_id", realm)
    .maybeSingle();
  if (!conn) return null;
  const { data: inv } = await admin
    .from("customer_invoices")
    .select("id")
    .eq("org_id", conn.org_id)
    .eq("external_ref->qbo->>id", qboInvoiceId)
    .maybeSingle();
  return inv ? { orgId: conn.org_id as string, invoiceId: inv.id as string } : null;
}
