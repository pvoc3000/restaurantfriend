// approve-quote — decision 17's write leg. The one function in this project
// with no signed-in caller at all.
//
// ---------------------------------------------------------------------------
// WHERE ITS AUTHORITY COMES FROM
// ---------------------------------------------------------------------------
// The TOKEN, and nothing else. The first thing this does is call
// `approve_quote_by_token` (migration 052) THROUGH THE ANON KEY — so the gate
// is the same SQL the public page's own call goes through, in one place, and
// this function cannot approve anything the page could not. Only after that
// returns `approved` does it do anything else.
//
// It then switches to `service_role` for three things a customer's browser
// genuinely cannot do: write the signed PDF into a private bucket, record the
// attachment row, and read the org's mail configuration to send the two
// confirmations. That is a deliberate exception to design rule 1's "never
// bypass RLS", and it is bounded by construction — every write below is scoped
// to `order_id`, which came back FROM the token check rather than from the
// request body. A caller cannot name an order.
//
// ---------------------------------------------------------------------------
// THE APPROVAL IS THE FACT; EVERYTHING AFTER IT IS BOOKKEEPING
// ---------------------------------------------------------------------------
// Once the RPC has returned `approved`, the customer HAS approved — the row
// says so and the order is stamped. So a failed upload, a failed attachment row
// or a failed email must never turn that into an error on their phone: they
// would tap again, be told "already approved", and reasonably conclude the
// thing is broken. Failures after the gate are collected and returned as
// warnings, and the app-side log entry names them.

import { createClient } from "npm:@supabase/supabase-js@2";

import { resolveTransport, sendMail, TransportError, type ProviderConfig } from "../_shared/email.ts";

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
    const { token, name, pdf_base64 } = await req.json();
    if (!token || !name) return json(400, { error: "missing token or name" });

    /* ---- 1. THE GATE ---------------------------------------------------- */

    const anon = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!
    );

    // The clickwrap's own record, which is why a clickwrap ever collects them.
    // The forwarded-for header is what a proxy leaves; `req.headers` is all
    // this runtime has.
    const meta = {
      ip: req.headers.get("x-forwarded-for") ?? null,
      user_agent: req.headers.get("user-agent") ?? null,
      at: new Date().toISOString(),
    };

    const { data: result, error: rpcError } = await anon.rpc("approve_quote_by_token", {
      p_token: token,
      p_name: name,
      p_meta: meta,
    });
    if (rpcError) return json(400, { error: rpcError.message });

    const state = (result ?? {}) as {
      state: string;
      order_id?: string;
      org_id?: string;
      approved_at?: string;
      approved_name?: string;
    };

    // Anything but a fresh approval is handed straight back for the page to
    // word — `unknown`, `superseded`, `already_approved`, `name_required` are
    // four different sentences and this function has no business picking one.
    if (state.state !== "approved" || !state.order_id || !state.org_id) {
      return json(200, state);
    }

    /* ---- 2. THE ARTIFACT AND THE CONFIRMATIONS -------------------------- */

    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!serviceKey) {
      // The approval stands. Say so, and say what did not happen.
      return json(200, {
        ...state,
        warning: "approved, but the signed copy could not be filed (no service key)",
      });
    }
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

    const warnings: string[] = [];

    let filed = false;
    if (pdf_base64) {
      // 018's key shape — `{org}/{order}/…` — so migration 051's storage
      // policies would authorise it for a signed-in supervisor too, and the
      // object sits exactly where the same order's other paperwork does.
      const path = `${state.org_id}/${state.order_id}/${crypto.randomUUID()}.pdf`;
      const bytes = Uint8Array.from(atob(pdf_base64), (c) => c.charCodeAt(0));
      const { error: uploadError } = await admin.storage
        .from("special-order-attachments")
        .upload(path, bytes, { contentType: "application/pdf" });
      if (uploadError) {
        warnings.push(`the signed copy was not filed: ${uploadError.message}`);
      } else {
        const { error: rowError } = await admin.from("special_order_attachments").insert({
          org_id: state.org_id,
          order_id: state.order_id,
          kind: "signed_quote",
          storage_path: path,
          file_name: `Signed quote ${state.approved_at?.slice(0, 10) ?? ""}.pdf`,
          content_type: "application/pdf",
          byte_size: bytes.byteLength,
        });
        if (rowError) {
          // Storage first, row second — a failed row means taking the object
          // back out rather than leaving a file nothing points at.
          await admin.storage.from("special-order-attachments").remove([path]);
          warnings.push(`the signed copy was not recorded: ${rowError.message}`);
        } else {
          filed = true;
        }
      }
    } else {
      warnings.push("no signed copy was produced by the browser");
    }

    // Both confirmations go out through the same provider layer the quote did,
    // so they come from the same mailbox and land in the same thread.
    const { data: order } = await admin
      .from("special_orders")
      .select("number, title, contact_email, contact_name, inbound_message_id, customers(email)")
      .eq("id", state.order_id)
      .maybeSingle();
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
        approval_cc?: string;
      };
      billing?: { email?: string };
    };

    try {
      const transport = resolveTransport({
        explicit: orgSettings.special_orders?.email_provider,
        orgProvider: orgSettings.email_provider,
        orgName: org?.name ?? "Orders",
        replyToFallbacks: [orgSettings.special_orders?.reply_to, orgSettings.billing?.email],
      });

      const rawMessageId = (order?.inbound_message_id ?? "").trim();
      const inReplyTo = rawMessageId
        ? rawMessageId.startsWith("<")
          ? rawMessageId
          : `<${rawMessageId}>`
        : undefined;

      const customerEmail =
        order?.contact_email ??
        (order?.customers as { email?: string } | null)?.email ??
        null;

      // ONE MESSAGE, not two sends: the customer's confirmation with the shop
      // on Cc. That is what makes it land in the same conversation for both of
      // them, and it means a customer replying "actually, can we make it 11am"
      // reaches somebody rather than an unmonitored no-reply.
      const internal =
        orgSettings.special_orders?.approval_cc ??
        orgSettings.special_orders?.reply_to ??
        orgSettings.billing?.email ??
        null;

      if (customerEmail || internal) {
        await sendMail(transport, {
          to: customerEmail ?? internal!,
          cc: customerEmail && internal ? internal : undefined,
          subject: `Quote #${order?.number ?? ""} approved${order?.title ? ` — ${order.title}` : ""}`,
          text:
            `Thank you — we have your approval for quote #${order?.number ?? ""}.\n\n` +
            `Approved by: ${state.approved_name}\n` +
            `When: ${state.approved_at}\n\n` +
            `Your invoice will follow by email. If anything needs changing, just reply to this message.\n`,
          // The signed copy rides along where there IS one; with none the
          // message is an ordinary text email rather than one carrying a
          // placeholder file nobody can explain.
          attachment:
            pdf_base64 && filed
              ? { filename: `Signed quote ${order?.number ?? ""}.pdf`, base64: pdf_base64 }
              : undefined,
          inReplyTo,
          references: inReplyTo,
        });
      }
    } catch (e) {
      warnings.push(
        `the confirmation email was not sent: ${e instanceof Error ? e.message : String(e)}`
      );
    }

    if (warnings.length) {
      // The log is where a supervisor finds out something went wrong, since the
      // customer is deliberately not told about bookkeeping.
      await admin.from("special_order_events").insert({
        org_id: state.org_id,
        order_id: state.order_id,
        message: `Approval recorded, but ${warnings.join("; ")}`,
        source: "app",
      });
    }

    return json(200, { ...state, warning: warnings.length ? warnings.join("; ") : undefined });
  } catch (e) {
    if (e instanceof TransportError) return json(e.status, { error: e.message });
    return json(500, { error: e instanceof Error ? e.message : String(e) });
  }
});
