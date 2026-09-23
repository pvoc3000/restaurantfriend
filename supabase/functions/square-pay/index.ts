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
import { buildSquareOrder, type PayBreakdown } from "../_shared/squareOrder.ts";

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
 * THE "PAYMENT RECEIVED" MESSAGE'S DEFAULT — a MIRROR of `DEFAULT_TEMPLATES.
 * payment` in web/src/lib/specialOrderDocs.ts, which is what Settings →
 * Messages shows. Deno cannot import from `web/` (submit-inquiry keeps its
 * inquiry default the same way), so the two are kept in step by hand; this one
 * is the copy that is actually SENT when the org has not written its own.
 */
const PAYMENT_TEMPLATE = {
  subject: "Payment received — order #{number}{title_suffix}",
  body:
    "Hi {first_name},\n\n" +
    "Thank you — we received your payment of {amount} for order #{number} ({method}).\n" +
    "{balance_line}" +
    "{receipt_line}" +
    "\nIf anything needs changing, just reply to this message.\n",
};

/** `fillTemplate`'s rule: an unknown `{token}` is left as typed, so a typo is
 *  visible in the message rather than swallowed. */
function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, key) => (key in values ? values[key] : m));
}

function firstNameOf(name: string | null | undefined): string {
  return (name ?? "").trim().split(/\s+/)[0] ?? "";
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
      title?: string | null;
      breakdown?: PayBreakdown | null;
      variation_id?: string | null;
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

    /* ---- 2. THE ORDER --------------------------------------------------- */

    // What the money WAS, in Square's own terms — Special Orders goods, sales
    // tax, delivery. See `_shared/squareOrder.ts` (migration 123).
    const reference = `Order ${claim.number ?? ""}`.trim();
    const label = `Order #${claim.number ?? ""}${claim.title ? ` — ${claim.title}` : ""}`.slice(0, 500);
    const plan = buildSquareOrder({
      balanceCents: cents,
      breakdown: claim.breakdown ?? null,
      label,
      variationId: claim.variation_id ?? null,
      locationId: claim.location_id,
      referenceId: reference.slice(0, 40),
    });

    const squareHeaders = {
      Authorization: `Bearer ${squareToken}`,
      "Square-Version": SQUARE_VERSION,
      "Content-Type": "application/json",
    };

    let orderId: string | null = null;
    try {
      const orderRes = await fetch(`${SQUARE_BASE[env]}/v2/orders`, {
        method: "POST",
        headers: squareHeaders,
        // Derived from the payment's key, so a retried press re-finds the same
        // order rather than leaving a second open one behind.
        body: JSON.stringify({
          idempotency_key: `${String(idempotency_key).slice(0, 45)}-order`,
          order: plan.order,
        }),
      });
      const orderBody = (await orderRes.json().catch(() => ({}))) as {
        order?: { id: string; total_money?: { amount: number } };
        errors?: unknown;
      };
      // THE ORDER MUST COME TO THE INVOICE, TO THE CENT. `squareOrder` predicts
      // Square's tax; this is Square saying what it actually computed. If they
      // disagree, nothing is charged — a customer paying a different figure
      // from the one on their invoice is worse than paying later.
      if (!orderRes.ok || !orderBody.order) {
        console.error("square-pay: order refused", orderRes.status, JSON.stringify(orderBody.errors));
      } else if (orderBody.order.total_money?.amount !== cents) {
        console.error(
          "square-pay: order total mismatch",
          orderBody.order.total_money?.amount,
          "expected",
          cents,
          JSON.stringify(plan)
        );
      } else {
        orderId = orderBody.order.id;
      }
    } catch (e) {
      console.error("square-pay: order failed", e);
    }
    if (!orderId) {
      await release();
      return json(200, {
        state: "declined",
        message: "This invoice can’t be paid online right now. Please reply to our email and we’ll help.",
      });
    }

    /* ---- 3. THE CHARGE ------------------------------------------------- */

    const payload = {
      source_id,
      idempotency_key: String(idempotency_key).slice(0, 45),
      amount_money: { amount: cents, currency: "USD" },
      location_id: claim.location_id,
      order_id: orderId,
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
          headers: squareHeaders,
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

    /* ---- 4. THE RECORD (service_role) ---------------------------------- */

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

    /* ---- 5. THE CONFIRMATION ------------------------------------------- */

    // The "Payment received" message on Settings → Messages, filled here on
    // the server. See `PAYMENT_TEMPLATE` for why this has its own copy.
    const { data: order } = await admin
      .from("special_orders")
      .select(
        "number, title, contact_name, contact_email, inbound_message_id, taken_by, taken_by_employee_id, customers(first_name, last_name, company, email)"
      )
      .eq("id", claim.order_id)
      .maybeSingle();
    const { data: org } = await admin
      .from("orgs")
      .select("name, settings")
      .eq("id", claim.org_id)
      .maybeSingle();
    const orgSettings = (org?.settings ?? {}) as {
      email_provider?: ProviderConfig;
      special_orders?: {
        email_provider?: ProviderConfig;
        reply_to?: string;
        email_cc?: string;
        email?: { payment?: { subject?: string; body?: string } };
      };
      billing?: { email?: string };
    };

    const customer = (order?.customers ?? null) as {
      first_name?: string | null;
      last_name?: string | null;
      company?: string | null;
      email?: string | null;
    } | null;

    // `documentRecipient` / `documentCc` in lib/specialOrderDocs: the CUSTOMER
    // first (Mark, 2026-09-21), the standing Cc, and the day-of contact when
    // they are a different address.
    const to = (customer?.email ?? order?.contact_email ?? "").trim();
    const ccList = (orgSettings.special_orders?.email_cc ?? "")
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean);
    const contactEmail = (order?.contact_email ?? "").trim();
    if (
      contactEmail &&
      ![to, ...ccList].map((a) => a.toLowerCase()).includes(contactEmail.toLowerCase())
    ) {
      ccList.push(contactEmail);
    }

    if (to) {
      try {
        // WHO IS HANDLING IT, the same way the documents sign off: the linked
        // employee's name where there is one, FileMaker's text where not.
        let taker: string | null = order?.taken_by ?? null;
        // `special_order_takers` (053) checks the CALLER's membership, which
        // service_role does not have, so the one row is read directly and
        // named the way that function names it: nickname first, else first.
        if (order?.taken_by_employee_id) {
          const { data: emp } = await admin
            .from("employees")
            .select("nickname, first_name, last_name")
            .eq("id", order.taken_by_employee_id)
            .maybeSingle();
          const first = (emp?.nickname ?? "").trim() || (emp?.first_name ?? "").trim();
          if (first) taker = first;
        }

        const person = [customer?.first_name, customer?.last_name].filter(Boolean).join(" ").trim();
        const fullName = person || (customer?.company ?? "").trim() || (order?.contact_name ?? "").trim();
        const remaining = Number((recorded as { balance?: number | string } | null)?.balance ?? 0);
        const money = (v: number) => `$${v.toFixed(2)}`;
        const number = order?.number ?? claim.number ?? "";

        const values: Record<string, string> = {
          number,
          title: order?.title ?? "",
          title_suffix: order?.title ? ` — ${order.title}` : "",
          first_name: firstNameOf(fullName) || "there",
          full_name: fullName,
          employee_name: firstNameOf(taker),
          amount: money(amount),
          method,
          balance: money(Math.max(remaining, 0)),
          balance_line: remaining > 0.005 ? `Balance remaining: ${money(remaining)}\n` : "",
          receipt_line: payment.receipt_url ? `\nYour receipt: ${payment.receipt_url}\n` : "",
          org: org?.name ?? "",
        };

        const configured = orgSettings.special_orders?.email?.payment ?? {};
        const orDefault = (v: string | undefined, fallback: string) =>
          typeof v === "string" && v.trim() !== "" ? v : fallback;

        const transport = resolveTransport({
          explicit: orgSettings.special_orders?.email_provider,
          orgProvider: orgSettings.email_provider,
          orgName: org?.name ?? "Orders",
          replyToFallbacks: [orgSettings.special_orders?.reply_to, orgSettings.billing?.email],
        });
        const raw = (order?.inbound_message_id ?? "").trim();
        const inReplyTo = raw ? (raw.startsWith("<") ? raw : `<${raw}>`) : undefined;

        await sendMail(transport, {
          to,
          cc: ccList.length ? ccList.join(", ") : undefined,
          subject: fill(orDefault(configured.subject, PAYMENT_TEMPLATE.subject), values),
          text: fill(orDefault(configured.body, PAYMENT_TEMPLATE.body), values),
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
