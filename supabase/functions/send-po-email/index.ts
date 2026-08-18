// send-po-email — the PO email leg (spec §2 step 4), in-app version.
//
// The web app renders the §4.9 PDF client-side and posts it here (base64,
// ~6KB) with the human-reviewed to/cc/subject/body from the compose card.
// This function authenticates the caller, re-checks their role, sends through
// the org's (or location's) CONFIGURED provider, and stamps the PO sent with
// an audit note.
//
// THE PROVIDER LAYER MOVED TO `_shared/email.ts` (2026-08-17), when special
// orders needed to send as a DIFFERENT MAILBOX and a second copy of the MIME
// builder would have been the `ui/Dialog` story in Deno. Nothing about this
// function's behaviour changed — the resolution order is still
// `locations.settings.email_provider` → `orgs.settings.email_provider` → the
// app's own default sender — but **`_shared` is compiled into each function at
// deploy time, so editing it means redeploying BOTH.**
//
// Design rule 1: the Supabase client here carries the CALLER's JWT, so every
// query and the final status update flow through RLS exactly as they would
// from the browser. The explicit role check just gives a readable error.

import { createClient } from "npm:@supabase/supabase-js@2";

import {
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

// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { po_id, to, cc, subject, body, pdf_base64, filename } =
      await req.json();

    if (!po_id || !to || !subject || !pdf_base64 || !filename) {
      return json(400, { error: "missing po_id, to, subject, pdf_base64 or filename" });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return json(401, { error: "not signed in" });

    const { data: po, error: poError } = await supabase
      .from("purchase_orders")
      .select("id, po_number, org_id, location_id")
      .eq("id", po_id)
      .maybeSingle();
    if (poError) return json(400, { error: poError.message });
    if (!po) return json(404, { error: "purchase order not found" });

    const { data: member } = await supabase
      .from("org_members")
      .select("role")
      .eq("user_id", user.id)
      .eq("org_id", po.org_id)
      .maybeSingle();
    if (!member || !["owner", "admin", "purchaser"].includes(member.role)) {
      return json(403, { error: "purchaser role required to send purchase orders" });
    }

    // Transport: location override → org config → the APP'S OWN sender. The
    // three tiers and their reasons live in `_shared/email.ts`; the only thing
    // this function decides is that a LOCATION may override, which is true of
    // a purchase order (a shop can have its own mailbox) and not of a special
    // order (a customer quote is the org's letter).
    const [{ data: org }, { data: location }] = await Promise.all([
      supabase
        .from("orgs")
        .select("name, settings")
        .eq("id", po.org_id)
        .maybeSingle(),
      supabase
        .from("locations")
        .select("settings")
        .eq("id", po.location_id)
        .maybeSingle(),
    ]);
    const orgSettings = (org?.settings ?? {}) as {
      email_provider?: ProviderConfig;
      po_email?: { cc?: string; reply_to?: string };
      billing?: { email?: string };
    };

    const transport = resolveTransport({
      explicit: (location?.settings as { email_provider?: ProviderConfig } | null)
        ?.email_provider,
      orgProvider: orgSettings.email_provider,
      orgName: org?.name ?? "Purchasing",
      // Replies must reach the ORG — the platform address is send-only.
      replyToFallbacks: [
        orgSettings.po_email?.reply_to,
        orgSettings.po_email?.cc,
        orgSettings.billing?.email,
      ],
    });

    const providerId = await sendMail(transport, {
      to,
      cc: cc || undefined,
      subject,
      text: body ?? "",
      attachment: { filename, base64: pdf_base64 },
    });

    // The email is out — a failed bookkeeping write must not report failure.
    // sent_notes is the audit trail FMP never had.
    const { error: updateError } = await supabase
      .from("purchase_orders")
      .update({
        status: "sent",
        sent_via: "email",
        sent_notes: `emailed to ${to}${cc ? ` (cc ${cc})` : ""} · ${providerId}`,
      })
      .eq("id", po_id);

    return json(200, {
      id: providerId,
      warning: updateError
        ? `sent, but the PO could not be marked: ${updateError.message}`
        : undefined,
    });
  } catch (e) {
    // A misconfiguration names itself with its own status — 400 for a bad
    // config, 500 for a missing secret — rather than every failure reading 500.
    if (e instanceof TransportError) return json(e.status, { error: e.message });
    return json(500, { error: e instanceof Error ? e.message : String(e) });
  }
});
