// submit-inquiry — decision 18's door. The second function in this project with
// no signed-in caller, and it is `approve-quote`'s twin in every structural
// respect.
//
// ---------------------------------------------------------------------------
// WHERE ITS AUTHORITY COMES FROM
// ---------------------------------------------------------------------------
// The SQL, and nothing else. The first thing it does is call `create_inquiry`
// (migration 057) THROUGH THE ANON KEY — the same gate a direct caller would
// hit — so this function can create nothing the page could not, and there is
// exactly one implementation of who may submit what. Only once that comes back
// `created` does it switch to `service_role`, and then only to do the one thing
// a customer's browser genuinely cannot: read the org's mail configuration and
// send the confirmation from specialorders@.
//
// That is the same bounded exception to design rule 1 `approve-quote` takes,
// and it is bounded the same way — every write below is scoped to an
// `order_id` that came back FROM the gate rather than from the request body. A
// caller cannot name an order.
//
// ---------------------------------------------------------------------------
// THE LEAD IS THE FACT; THE EMAIL IS BOOKKEEPING
// ---------------------------------------------------------------------------
// Once the RPC has returned `created`, the inquiry EXISTS and a supervisor will
// see it. So a failed send must never come back as an error: the customer would
// submit again, and the second submission is the one the throttle answers with
// "we already have that", which reads as the form being broken. Failures after
// the gate are collected as warnings on a 200 and named in the order's own log.
//
// ---------------------------------------------------------------------------
// WHY IT SENDS AT ALL
// ---------------------------------------------------------------------------
// Three reasons, and only the first is the obvious one. It reassures the person
// who just typed their wedding into a form. It proves the address they gave is
// real. And — decision 12 — ITS `Message-ID` BECOMES THE THREAD ROOT: the
// order stores it, so every quote, invoice and receipt the app later sends
// threads onto this message, and the customer's own replies land in the same
// conversation. That is what retires FileMaker's subject-pasting kludge, and it
// is why `newMessageId` exists rather than storing what `sendMail` returns
// (a provider id, which threads with nothing).

import { createClient } from "npm:@supabase/supabase-js@2";

import {
  newMessageId,
  resolveTransport,
  sendMail,
  TransportError,
  type ProviderConfig,
} from "../_shared/email.ts";

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

/** The PO sender's idiom: a template out of settings, a generic fallback in
 *  code, and `{placeholders}` filled from the order. */
function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? "");
}

const DEFAULT_SUBJECT = "We got your special order inquiry — #{number}";
const DEFAULT_BODY = [
  "Hi {name},",
  "",
  "Thanks for getting in touch — we have your inquiry and a real person is",
  "reading it. We'll come back to you with a quote.",
  "",
  "Your reference is #{number}. Just reply to this message if you want to add",
  "anything or change a detail.",
  "",
  "— {org}",
  "",
].join("\n");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json();
    const {
      org_id,
      name,
      email,
      phone,
      occasion,
      fulfillment,
      address,
      location_id,
      event_date,
      event_time,
      interest,
      description,
      allergies,
      honeypot,
    } = body ?? {};

    if (!org_id || !name) return json(400, { error: "missing org_id or name" });

    /* ---- 1. THE GATE ---------------------------------------------------- */

    const anon = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!
    );

    // The honeypot travels in the meta rather than being decided here, so the
    // gate holds the whole rule and a direct caller cannot skip it.
    const meta = {
      ip: req.headers.get("x-forwarded-for") ?? null,
      user_agent: req.headers.get("user-agent") ?? null,
      at: new Date().toISOString(),
      honeypot: typeof honeypot === "string" ? honeypot : null,
    };

    const { data: result, error: rpcError } = await anon.rpc("create_inquiry", {
      p_org_id: org_id,
      p_name: name,
      p_email: email ?? null,
      p_phone: phone ?? null,
      p_occasion: occasion ?? null,
      p_fulfillment: fulfillment ?? "pickup",
      p_address: address ?? null,
      p_location_id: location_id ?? null,
      p_event_date: event_date ?? null,
      p_event_time: event_time ?? null,
      p_interest: interest ?? null,
      p_description: description ?? null,
      p_allergies: allergies ?? null,
      p_meta: meta,
    });
    if (rpcError) return json(400, { error: rpcError.message });

    const state = (result ?? {}) as {
      ok?: boolean;
      state: string;
      order_id?: string;
      org_id?: string;
      number?: string;
      contact_name?: string;
      contact_email?: string;
    };

    // Every other state — a refusal, a throttled duplicate, a swallowed
    // honeypot — is handed straight back for the page to word. `received` in
    // particular must look exactly like a success to the caller, which is the
    // whole reason the gate returns it rather than an error.
    if (state.state !== "created" || !state.order_id || !state.org_id) {
      return json(200, state);
    }

    /* ---- 2. THE CONFIRMATION, AND THE THREAD ROOT ----------------------- */

    if (!state.contact_email) {
      // A phone-only inquiry is a real submission and there is nobody to write
      // to. Not a failure, and not worth a warning in the log either.
      return json(200, state);
    }

    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!serviceKey) {
      return json(200, {
        ...state,
        warning: "received, but no confirmation was sent (no service key)",
      });
    }
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

    const warnings: string[] = [];

    const { data: org } = await admin
      .from("orgs")
      .select("name, settings")
      .eq("id", state.org_id)
      .maybeSingle();

    const orgSettings = (org?.settings ?? {}) as {
      email_provider?: ProviderConfig;
      special_orders?: {
        email_provider?: ProviderConfig;
        reply_to?: string;
        inquiry_cc?: string;
        inquiry_email?: { subject?: string; body?: string };
      };
      billing?: { email?: string };
    };

    try {
      // Decision 12: the MODULE's mailbox first, and no location tier — an
      // inquiry belongs to the org, and the customer has not chosen a shop in
      // any sense that decides who writes to them.
      const transport = resolveTransport({
        explicit: orgSettings.special_orders?.email_provider,
        orgProvider: orgSettings.email_provider,
        orgName: org?.name ?? "Orders",
        replyToFallbacks: [orgSettings.special_orders?.reply_to, orgSettings.billing?.email],
      });

      const values = {
        number: state.number ?? "",
        name: state.contact_name ?? "there",
        org: org?.name ?? "",
      };
      const subject = fill(
        orgSettings.special_orders?.inquiry_email?.subject ?? DEFAULT_SUBJECT,
        values
      );

      // Generated BEFORE the send and stored AFTER it, and it is the same
      // string both times — which is the entire point. Reading a Message-ID
      // back off a provider is either impossible or a second API call, and
      // getting it wrong fails silently forever.
      const messageId = newMessageId(transport.cfg.from);

      await sendMail(transport, {
        to: state.contact_email,
        cc: orgSettings.special_orders?.inquiry_cc || undefined,
        subject,
        text: fill(
          orgSettings.special_orders?.inquiry_email?.body ?? DEFAULT_BODY,
          values
        ),
        messageId,
      });

      const { error: stampError } = await admin
        .from("special_orders")
        .update({ inbound_message_id: messageId, inbound_subject: subject })
        .eq("id", state.order_id)
        .select("id");
      if (stampError) {
        // The customer has the message; we have lost the ability to thread onto
        // it. Worth saying out loud, because the symptom later is silent.
        warnings.push(`the reply thread was not recorded: ${stampError.message}`);
      }

      await admin.from("special_order_events").insert({
        org_id: state.org_id,
        order_id: state.order_id,
        message: `Confirmation emailed to ${state.contact_email}`,
        author: "Website",
        source: "app",
      });
    } catch (e) {
      warnings.push(
        `the confirmation email was not sent: ${e instanceof Error ? e.message : String(e)}`
      );
    }

    if (warnings.length) {
      await admin.from("special_order_events").insert({
        org_id: state.org_id,
        order_id: state.order_id,
        message: `Inquiry recorded, but ${warnings.join("; ")}`,
        author: "Website",
        source: "app",
      });
    }

    return json(200, { ...state, warning: warnings.length ? warnings.join("; ") : undefined });
  } catch (e) {
    if (e instanceof TransportError) return json(e.status, { error: e.message });
    return json(500, { error: e instanceof Error ? e.message : String(e) });
  }
});
