// square-pay — the pay link's write leg (migration 119). Like approve-quote,
// it has no signed-in caller at all.
//
// ---------------------------------------------------------------------------
// WHERE ITS AUTHORITY COMES FROM
// ---------------------------------------------------------------------------
// The TOKEN, through the ANON key — approve-quote's rule. `claim_pay_token` is
// the same SQL the page could call, so this function can charge nothing the
// link does not already entitle somebody to pay. Only after Square says the
// payment COMPLETED does it switch to service_role, and then only to call
// `record_pay_link_payment`, which is granted to nobody else.
//
// ---------------------------------------------------------------------------
// THE AMOUNT NEVER COMES FROM THE BROWSER
// ---------------------------------------------------------------------------
// The request carries a card NONCE (Square's single-use `source_id`), never a
// figure. The balance is read from the claim, after the claim is won, so two
// tabs cannot both charge it and a payment recorded by hand a minute ago is
// not charged again.
//
// ---------------------------------------------------------------------------
// ONCE SQUARE HAS THE MONEY, THE CUSTOMER IS TOLD SO
// ---------------------------------------------------------------------------
// approve-quote's second rule. A charge that succeeded is a fact on the
// customer's card; if recording it or emailing about it then fails, the page
// still says "paid", and the failure goes to the order's log where a
// supervisor will see it. Telling the customer "error" would invite a second
// payment. The unique index in 119 makes a later retry of the record safe.

import { createClient } from "npm:@supabase/supabase-js@2";

import { resolveTransport, sendMail, type ProviderConfig } from "../_shared/email.ts";

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

/** Pinned with sync-square-sales, so one Square account is read and written
 *  under one contract. */
const SQUARE_VERSION = "2026-07-15";

const SQUARE_BASE: Record<string, string> = {
  production: "https://connect.squareup.com",
  sandbox: "https://connect.squareupsandbox.com",
};

/** Dollars (as Postgres numeric → JSON) to integer cents, or null for anything
 *  that is not a whole number of cents. Mirrors `toCents` in web/src/lib/payLink. */
function toCents(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : (value as number);
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  const cents = Math.round(n * 100);
  if (Math.abs(n * 100 - cents) > 1e-6) return null;
  return cents;
}

/**
 * What a decline MEANS to the person holding the card. Square's codes are for
 * developers; "GENERIC_DECLINE" on a phone reads as our bug.
 */
function declineMessage(code: string | undefined, sourceType: string | undefined): string {
  switch (code) {
    case "INSUFFICIENT_FUNDS":
      return sourceType === "gift_card"
        ? "The gift card’s balance is less than the amount due — please use a card."
        : "The card was declined for insufficient funds.";
    case "CVV_FAILURE":
      return "The security code didn’t match. Please check it and try again.";
    case "ADDRESS_VERIFICATION_FAILURE":
      return "The ZIP code didn’t match the card. Please check it and try again.";
    case "INVALID_EXPIRATION":
    case "EXPIRATION_FAILURE":
      return "The expiry date didn’t match the card. Please check it and try again.";
    case "INVALID_CARD":
    case "INVALID_CARD_DATA":
    case "CARD_NOT_SUPPORTED":
      return "That card can’t be used here. Please try a different one.";
    default:
      return "The payment was declined. Please try a different card, or contact your bank.";
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { token, source_id, idempotency_key, verification_token, source_type } =
      await req.json();
    if (!token || !source_id || !idempotency_key) {
      return json(400, { error: "missing token, source_id or idempotency_key" });
    }

    /* ---- 0. CONFIGURATION ---------------------------------------------- */

    // Its own pair of secrets, not sync-square-sales's SQUARE_ACCESS_TOKEN:
    // the pay link is tested against Square's SANDBOX, and a sandbox token
    // there would silently break the nightly sales sync.
    const squareToken = Deno.env
      .get("SQUARE_PAY_ACCESS_TOKEN")
      // deno-lint-ignore no-control-regex
      ?.replace(/[\u0000-\u001F\u007F]/g, "")
      .trim()
      .replace(/^["']|["']$/g, "");
    const env = (Deno.env.get("SQUARE_PAY_ENV") ?? "production").trim();
    if (!squareToken || !SQUARE_BASE[env]) {
      return json(500, {
        error: "Online payment is not set up yet. Please reply to our email and we’ll help.",
        detail: "SQUARE_PAY_ACCESS_TOKEN / SQUARE_PAY_ENV — see docs/square-payments-setup.md",
      });
    }

    /* ---- 1. THE GATE --------------------------------------------------- */

    const anon = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!
    );

    const { data: claimData, error: claimError } = await anon.rpc("claim_pay_token", {
      p_token: token,
    });
    if (claimError) return json(400, { error: claimError.message });

    const claim = (claimData ?? {}) as {
      state: string;
      org_id?: string;
      order_id?: string;
      number?: string;
      balance?: number | string;
      location_id?: string;
    };

    // `unknown`, `superseded`, `cancelled`, `paid`, `busy` — the page words them.
    if (claim.state !== "claimed" || !claim.order_id || !claim.org_id) {
      return json(200, { state: claim.state });
    }

    const release = () => anon.rpc("release_pay_token", { p_token: token });

    const cents = toCents(claim.balance);
    if (!cents || cents <= 0 || !claim.location_id) {
      await release();
      return json(200, {
        state: "declined",
        message: "This invoice can’t be paid online right now. Please reply to our email.",
      });
    }

    /* ---- 2. THE CHARGE ------------------------------------------------- */

    const reference = `Order ${claim.number ?? ""}`.trim();
    const payload = {
      source_id,
      idempotency_key: String(idempotency_key).slice(0, 45),
      amount_money: { amount: cents, currency: "USD" },
      location_id: claim.location_id,
      autocomplete: true,
      reference_id: reference.slice(0, 40),
      note: `Invoice ${reference} — pay link`.slice(0, 500),
      ...(verification_token ? { verification_token } : {}),
    };

    // ONE retry, with the SAME idempotency key, and only for a failure to
    // reach Square at all. Square treats the repeat as the same payment, so a
    // request that landed but whose answer was lost cannot charge twice.
    let res: Response | null = null;
    for (let attempt = 0; attempt < 2 && !res; attempt++) {
      try {
        res = await fetch(`${SQUARE_BASE[env]}/v2/payments`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${squareToken}`,
            "Square-Version": SQUARE_VERSION,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });
      } catch {
        res = null;
      }
    }
    if (!res) {
      // NOT released: whether the charge landed is unknown, and letting a new
      // attempt start inside the two-minute claim is how a card is charged
      // twice. The claim expires by itself.
      return json(200, {
        state: "unconfirmed",
        message:
          "We couldn’t confirm the payment. Please check your card statement before trying again, or reply to our email.",
      });
    }

    const body = (await res.json().catch(() => ({}))) as {
      payment?: {
        id: string;
        status: string;
        receipt_url?: string;
        source_type?: string;
        card_details?: { card?: { card_brand?: string; last_4?: string } };
      };
      errors?: { code?: string; detail?: string; category?: string }[];
    };

    const payment = body.payment;
    if (!res.ok || !payment || payment.status !== "COMPLETED") {
      await release();
      const code = body.errors?.[0]?.code;
      console.error("square-pay: declined", res.status, JSON.stringify(body.errors ?? payment?.status));
      return json(200, { state: "declined", message: declineMessage(code, source_type) });
    }

    /* ---- 3. THE RECORD (service_role) ---------------------------------- */

    const card = payment.card_details?.card;
    const method =
      card?.last_4
        ? `${card.card_brand ? card.card_brand.replace(/_/g, " ").toLowerCase() : "card"} ending ${card.last_4}`
        : (payment.source_type ?? "").replace(/_/g, " ").toLowerCase() || "online";
    const amount = cents / 100;

    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!serviceKey) {
      console.error("square-pay: charged but no service key", payment.id);
      return json(200, { state: "paid", amount, receipt_url: payment.receipt_url });
    }
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

    const warnings: string[] = [];
    const { data: recorded, error: recordError } = await admin.rpc("record_pay_link_payment", {
      p_token: token,
      p_amount: amount,
      p_square_payment_id: payment.id,
      p_note: `Pay link · ${method}`,
    });
    if (recordError || !["recorded", "already_recorded"].includes((recorded as { state?: string })?.state ?? "")) {
      warnings.push(
        `Square payment ${payment.id} (${amount.toFixed(2)}) was NOT recorded: ${recordError?.message ?? JSON.stringify(recorded)} — record it by hand`
      );
    }

    /* ---- 4. THE CONFIRMATION ------------------------------------------- */

    const { data: order } = await admin
      .from("special_orders")
      .select("number, title, contact_email, inbound_message_id, customers(email)")
      .eq("id", claim.order_id)
      .maybeSingle();
    const { data: org } = await admin
      .from("orgs")
      .select("name, settings")
      .eq("id", claim.org_id)
      .maybeSingle();
    const orgSettings = (org?.settings ?? {}) as {
      email_provider?: ProviderConfig;
      special_orders?: { email_provider?: ProviderConfig; reply_to?: string };
      billing?: { email?: string };
    };

    const customerEmail =
      order?.contact_email ?? (order?.customers as { email?: string } | null)?.email ?? null;

    if (customerEmail) {
      try {
        const transport = resolveTransport({
          explicit: orgSettings.special_orders?.email_provider,
          orgProvider: orgSettings.email_provider,
          orgName: org?.name ?? "Orders",
          replyToFallbacks: [orgSettings.special_orders?.reply_to, orgSettings.billing?.email],
        });
        const raw = (order?.inbound_message_id ?? "").trim();
        const inReplyTo = raw ? (raw.startsWith("<") ? raw : `<${raw}>`) : undefined;
        const remaining = Number((recorded as { balance?: number | string } | null)?.balance ?? 0);

        await sendMail(transport, {
          to: customerEmail,
          subject: `Payment received — order #${order?.number ?? claim.number ?? ""}${order?.title ? ` — ${order.title}` : ""}`,
          text:
            `Thank you — we received your payment of $${amount.toFixed(2)} for order #${order?.number ?? claim.number ?? ""} (${method}).\n\n` +
            (remaining > 0 ? `Balance remaining: $${remaining.toFixed(2)}\n\n` : "") +
            (payment.receipt_url ? `Your receipt: ${payment.receipt_url}\n\n` : "") +
            `If anything needs changing, just reply to this message.\n`,
          inReplyTo,
          references: inReplyTo,
        });
      } catch (e) {
        warnings.push(`the payment confirmation email was not sent: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    if (warnings.length) {
      await admin.from("special_order_events").insert({
        org_id: claim.org_id,
        order_id: claim.order_id,
        message: `Paid online, but ${warnings.join("; ")}`,
        source: "app",
      });
    }

    return json(200, {
      state: "paid",
      amount,
      method,
      receipt_url: payment.receipt_url,
      warning: warnings.length ? warnings.join("; ") : undefined,
    });
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : String(e) });
  }
});
