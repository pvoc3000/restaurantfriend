// send-po-email — the PO email leg (spec §2 step 4), in-app version.
//
// The web app renders the §4.9 PDF client-side and posts it here (base64,
// ~6KB) with the human-reviewed to/cc/subject/body from the compose card.
// This function authenticates the caller, re-checks their role, sends via
// Resend, and stamps the PO sent with an audit note.
//
// Secrets/config it needs:
//   RESEND_API_KEY               — Supabase dashboard → Edge Functions → Secrets
//   orgs.settings.po_email.from  — the From header, e.g.
//                                  "Donut Friend Purchasing <orders@donutfriend.com>"
//                                  (domain must be verified in Resend)
//   orgs.settings.po_email.reply_to — optional Reply-To
//
// Design rule 1: the Supabase client here carries the CALLER's JWT, so every
// query and the final status update flow through RLS exactly as they would
// from the browser. The explicit role check just gives a readable error.

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
      .select("id, po_number, org_id")
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

    const { data: org } = await supabase
      .from("orgs")
      .select("settings")
      .eq("id", po.org_id)
      .maybeSingle();
    const poEmail = (org?.settings as {
      po_email?: { from?: string; reply_to?: string };
    } | null)?.po_email;

    if (!poEmail?.from) {
      return json(400, {
        error:
          "orgs.settings.po_email.from is not set — add the From address " +
          '(e.g. "Donut Friend Purchasing <orders@donutfriend.com>") in the SQL editor',
      });
    }

    const key = Deno.env.get("RESEND_API_KEY");
    if (!key) {
      return json(500, {
        error: "RESEND_API_KEY secret is not set (Edge Functions → Secrets)",
      });
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: poEmail.from,
        to: [to],
        cc: cc ? [cc] : undefined,
        reply_to: poEmail.reply_to ?? undefined,
        subject,
        text: body ?? "",
        attachments: [{ filename, content: pdf_base64 }],
      }),
    });
    const result = await res.json();
    if (!res.ok) {
      return json(502, {
        error: `Resend refused the send: ${result?.message ?? res.statusText}`,
      });
    }

    // The email is out — a failed bookkeeping write must not report failure.
    // sent_notes is the audit trail FMP never had.
    const { error: updateError } = await supabase
      .from("purchase_orders")
      .update({
        status: "sent",
        sent_via: "email",
        sent_notes: `emailed to ${to}${cc ? ` (cc ${cc})` : ""} · resend ${result.id}`,
      })
      .eq("id", po_id);

    return json(200, {
      id: result.id,
      warning: updateError
        ? `sent, but the PO could not be marked: ${updateError.message}`
        : undefined,
    });
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : String(e) });
  }
});
