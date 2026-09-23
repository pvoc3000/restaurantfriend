// square-refund — give back a pay-link payment, from the order's Payments
// section (Mark, 2026-09-22: "is refunding it from within restaurant friend a
// possibility?" … "build it — manager and up, leave status alone").
//
// ---------------------------------------------------------------------------
// WHO MAY, AND WHAT
// ---------------------------------------------------------------------------
// A SIGNED-IN caller, owner or admin ("Manager") — `canRefundPayments` in
// lib/roles, the same set as member management. The payment row is read
// through the CALLER's client, so RLS decides whether they can see it at all,
// and only a row that `square-pay` wrote can be refunded: `payment_type =
// 'Square Online'` with the Square payment id in `external_ref`. The ~1,200
// hand-typed 'Square Invoice' rows carry no id and are refunded in Square.
//
// ---------------------------------------------------------------------------
// SQUARE SAYS HOW MUCH IS LEFT TO REFUND, NOT US
// ---------------------------------------------------------------------------
// The payment is read back from Square first, and its `refunded_money` is the
// authority — a refund made in Square's own dashboard counts, which a sum over
// our rows would miss. Asking for more than is left is refused with the figure.
//
// ---------------------------------------------------------------------------
// THE RECORD IS A NEGATIVE PAYMENT, AND THE ORDER IS LEFT ALONE
// ---------------------------------------------------------------------------
// Written through the caller's client (RLS: supervisor+, so a manager passes)
// as `payment_type = 'Square Refund'`, a negative amount and the Square REFUND
// id, so the balance and the history follow on their own (054's trigger logs
// it). Status, to-do and dates are NOT touched: why the money went back decides
// whether the order is cancelled or re-invoiced, and that is a person's call.
//
// A card refund is accepted at once and settles over days (PENDING →
// COMPLETED); it is recorded when Square accepts it. A later failure would
// need the webhook that arrives with ACH.

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

/** Pinned with square-pay and sync-square-sales. */
const SQUARE_VERSION = "2026-07-15";

const SQUARE_BASE: Record<string, string> = {
  production: "https://connect.squareup.com",
  sandbox: "https://connect.squareupsandbox.com",
};

const MANAGERS = ["owner", "admin"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { payment_id, amount, reason, idempotency_key } = await req.json();
    if (!payment_id || !idempotency_key) {
      return json(400, { error: "missing payment_id or idempotency_key" });
    }
    const cents = Math.round(Number(amount) * 100);
    if (!Number.isFinite(cents) || cents <= 0) {
      return json(400, { error: "The refund amount must be more than zero." });
    }

    /* ---- the caller ---------------------------------------------------- */

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return json(401, { error: "not signed in" });

    const { data: row, error: rowError } = await supabase
      .from("special_order_payments")
      .select("id, org_id, order_id, customer_invoice_id, amount, payment_type, note, external_ref")
      .eq("id", payment_id)
      .maybeSingle();
    if (rowError) return json(400, { error: rowError.message });
    if (!row) return json(404, { error: "payment not found" });

    const { data: member } = await supabase
      .from("org_members")
      .select("role")
      .eq("user_id", user.id)
      .eq("org_id", row.org_id)
      .maybeSingle();
    if (!member || !MANAGERS.includes(member.role)) {
      return json(403, { error: "Only a manager or the owner can refund a payment." });
    }

    if (row.payment_type !== "Square Online" || !row.external_ref || Number(row.amount) <= 0) {
      return json(400, {
        error:
          "Only a payment taken through the pay link can be refunded from here. Refund this one in the Square dashboard.",
      });
    }

    /* ---- Square -------------------------------------------------------- */

    const squareToken = Deno.env
      .get("SQUARE_PAY_ACCESS_TOKEN")
      // deno-lint-ignore no-control-regex
      ?.replace(/[\u0000-\u001F\u007F]/g, "")
      .trim()
      .replace(/^["']|["']$/g, "");
    const env = (Deno.env.get("SQUARE_PAY_ENV") ?? "production").trim();
    if (!squareToken || !SQUARE_BASE[env]) {
      return json(500, { error: "SQUARE_PAY_ACCESS_TOKEN / SQUARE_PAY_ENV are not set." });
    }
    const headers = {
      Authorization: `Bearer ${squareToken}`,
      "Square-Version": SQUARE_VERSION,
      "Content-Type": "application/json",
    };

    const payRes = await fetch(
      `${SQUARE_BASE[env]}/v2/payments/${encodeURIComponent(row.external_ref)}`,
      { headers }
    );
    const payBody = (await payRes.json().catch(() => ({}))) as {
      payment?: {
        status: string;
        amount_money?: { amount: number };
        refunded_money?: { amount: number };
      };
      errors?: { detail?: string }[];
    };
    if (!payRes.ok || !payBody.payment) {
      return json(400, {
        error: `Square could not find this payment (${payBody.errors?.[0]?.detail ?? payRes.status}). A payment taken in sandbox cannot be refunded in production, or the other way round.`,
      });
    }
    let left =
      (payBody.payment.amount_money?.amount ?? 0) - (payBody.payment.refunded_money?.amount ?? 0);

    // 124: ONE Square payment for a customer invoice is split across its
    // orders, one row each, so Square's own "left to refund" is the whole
    // invoice's. A refund from this row may take only this ORDER's share, less
    // what has already been refunded against the order on this invoice.
    if (row.customer_invoice_id) {
      const { data: refunds } = await supabase
        .from("special_order_payments")
        .select("amount")
        .eq("order_id", row.order_id)
        .eq("customer_invoice_id", row.customer_invoice_id)
        .eq("payment_type", "Square Refund");
      const refunded = (refunds ?? []).reduce((a, r) => a - Math.round(Number(r.amount) * 100), 0);
      left = Math.min(left, Math.round(Number(row.amount) * 100) - refunded);
    }
    if (cents > left) {
      return json(400, {
        error:
          left <= 0
            ? "This payment has already been refunded in full."
            : `Only $${(left / 100).toFixed(2)} of this payment is left to refund.`,
      });
    }

    const refundRes = await fetch(`${SQUARE_BASE[env]}/v2/refunds`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        idempotency_key: String(idempotency_key).slice(0, 45),
        payment_id: row.external_ref,
        amount_money: { amount: cents, currency: "USD" },
        reason: (reason ? String(reason) : "Refund").slice(0, 192),
      }),
    });
    const refundBody = (await refundRes.json().catch(() => ({}))) as {
      refund?: { id: string; status: string };
      errors?: { code?: string; detail?: string }[];
    };
    const refund = refundBody.refund;
    if (!refundRes.ok || !refund || ["REJECTED", "FAILED"].includes(refund.status)) {
      return json(400, {
        error: `Square refused the refund: ${refundBody.errors?.[0]?.detail ?? refund?.status ?? refundRes.status}`,
      });
    }

    /* ---- the record ---------------------------------------------------- */

    const { data: org } = await supabase
      .from("orgs")
      .select("settings")
      .eq("id", row.org_id)
      .maybeSingle();
    const tz =
      ((org?.settings ?? {}) as { timezone?: string }).timezone ?? "America/Los_Angeles";
    // en-CA formats as YYYY-MM-DD, which is the column's own shape.
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());

    const method = (row.note ?? "").replace(/^Pay link · /, "");
    const note = [`Refund${method ? ` to ${method}` : ""}`, reason ? String(reason).trim() : ""]
      .filter(Boolean)
      .join(" · ");

    // DESIGN RULE 1: org_id explicitly.
    const { data: inserted, error: insertError } = await supabase
      .from("special_order_payments")
      .insert({
        org_id: row.org_id,
        order_id: row.order_id,
        customer_invoice_id: row.customer_invoice_id ?? null,
        paid_on: today,
        amount: -cents / 100,
        payment_type: "Square Refund",
        note,
        external_ref: refund.id,
      })
      .select("id");

    if (insertError || !inserted?.length) {
      // The money has gone back; the record did not land. Say so on the order
      // where a person will see it, and to the person who pressed the button.
      const warning = `refunded $${(cents / 100).toFixed(2)} in Square (refund ${refund.id}) but it was NOT recorded here — record −$${(cents / 100).toFixed(2)} as 'Square Refund' by hand${insertError ? `: ${insertError.message}` : ""}`;
      await supabase.from("special_order_events").insert({
        org_id: row.org_id,
        order_id: row.order_id,
        message: `Refund ${warning}`,
        source: "app",
      });
      return json(200, { refund_id: refund.id, status: refund.status, warning });
    }

    return json(200, { refund_id: refund.id, status: refund.status, amount: cents / 100 });
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : String(e) });
  }
});
