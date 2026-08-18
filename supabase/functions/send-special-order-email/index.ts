// send-special-order-email — decision 12's leg: a quote, invoice, receipt or
// kitchen order goes out with its PDF attached, threaded onto the customer's
// own inquiry, and the record stamps itself.
//
// The web app renders the document client-side and posts it here (base64) with
// the human-reviewed to/cc/subject/body from the compose card. This function
// authenticates the caller, re-checks their role, sends through the resolved
// provider, and then does the FOUR bookkeeping writes that make the record
// true: the stage date, the log entry, the filed copy of what was sent, and —
// for a quote — binding decision 17's token to that exact document.
//
// THREE THINGS THIS FUNCTION GETS RIGHT THAT THE PO ONE DOES NOT HAVE TO:
//
// **It sends as specialorders@, not info@** (decision 12). The provider config
// is read from `orgs.settings.special_orders.email_provider` first, falling
// back to the org's own and then to the app's default sender. It needs its own
// Gmail OAuth — the info@ refresh token cannot send as a different account, and
// Gmail rewrites a From it is not authorized for rather than refusing it, which
// is the failure that looks like it worked.
//
// **It threads.** `In-Reply-To` and `References` carry the inbound
// `Message-ID`, which retires FileMaker's subject-pasting kludge. Null on
// anything that did not start as an inquiry, which is almost everything, so the
// headers must be absent rather than empty.
//
// **The email going out is the fact; every write after it is bookkeeping.** A
// failed stamp returns a WARNING with a 200, never an error — reporting failure
// after the customer already has the quote would have somebody send it twice.
//
// Design rule 1: the Supabase client carries the CALLER's JWT, so every query
// and every write flows through RLS exactly as it would from the browser. The
// explicit role check just gives a readable error instead of an empty result.

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

/** Which stage column each document stamps. Mirrors `DOCUMENT_STAGE` in
 *  `web/src/lib/specialOrderDocs.ts` — the Deno runtime cannot import from
 *  `web/`, which is the same both-sides declaration `extract-invoice`'s schema
 *  lives with. If one changes, change both. */
const STAGE_COLUMN: Record<string, string> = {
  quote: "quote_sent_at",
  invoice: "invoice_sent_at",
  receipt: "receipt_sent_at",
  order: "order_printed_at",
};

/** What a filed copy of the sent document is called. `order` files nothing —
 *  the kitchen sheet is internal and is reproduced from the record whenever
 *  anyone wants it, where a quote and an invoice are documents a customer
 *  HOLDS and the record should show exactly what they got. */
const FILED_KIND: Record<string, string | null> = {
  quote: "quote_document",
  invoice: "invoice_document",
  receipt: "invoice_document",
  order: null,
};

const ROLES = ["owner", "admin", "purchaser", "supervisor"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const {
      order_id,
      kind,
      to,
      cc,
      subject,
      body,
      pdf_base64,
      filename,
      /** The token minted when the compose card opened, so the link in the body
       *  is real and editable. Binding it to the document is this function's
       *  job — see below. */
      quote_token,
    } = await req.json();

    if (!order_id || !kind || !to || !subject || !pdf_base64 || !filename) {
      return json(400, {
        error: "missing order_id, kind, to, subject, pdf_base64 or filename",
      });
    }
    if (!(kind in STAGE_COLUMN)) {
      return json(400, {
        error: `unknown document kind "${kind}" — expected one of: ${Object.keys(
          STAGE_COLUMN
        ).join(", ")}`,
      });
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

    const { data: order, error: orderError } = await supabase
      .from("special_orders")
      .select("id, org_id, number, inbound_message_id, inbound_subject")
      .eq("id", order_id)
      .maybeSingle();
    if (orderError) return json(400, { error: orderError.message });
    if (!order) return json(404, { error: "special order not found" });

    const { data: member } = await supabase
      .from("org_members")
      .select("role, display_name")
      .eq("user_id", user.id)
      .eq("org_id", order.org_id)
      .maybeSingle();
    if (!member || !ROLES.includes(member.role)) {
      return json(403, {
        error: "supervisor role required to send special order documents",
      });
    }

    const { data: org } = await supabase
      .from("orgs")
      .select("name, settings")
      .eq("id", order.org_id)
      .maybeSingle();
    const orgSettings = (org?.settings ?? {}) as {
      email_provider?: ProviderConfig;
      special_orders?: { email_provider?: ProviderConfig; reply_to?: string };
      billing?: { email?: string };
    };

    // Decision 12: the MODULE's mailbox first. No location tier — a customer
    // quote is the org's letter, and which shop they collect from does not
    // change who wrote to them.
    const transport = resolveTransport({
      explicit: orgSettings.special_orders?.email_provider,
      orgProvider: orgSettings.email_provider,
      orgName: org?.name ?? "Orders",
      replyToFallbacks: [orgSettings.special_orders?.reply_to, orgSettings.billing?.email],
    });

    // Angle-bracketed on the wire; a stored value may or may not be, and
    // sending `<<id>>` threads with nothing.
    const rawMessageId = (order.inbound_message_id ?? "").trim();
    const inReplyTo = rawMessageId
      ? rawMessageId.startsWith("<")
        ? rawMessageId
        : `<${rawMessageId}>`
      : undefined;

    const providerId = await sendMail(transport, {
      to,
      cc: cc || undefined,
      subject,
      text: body ?? "",
      attachment: { filename, base64: pdf_base64 },
      inReplyTo,
      references: inReplyTo,
    });

    /* ---- from here down, nothing may turn a sent email into a failure ---- */

    const warnings: string[] = [];
    const today = new Date().toISOString().slice(0, 10);

    const { error: stampError } = await supabase
      .from("special_orders")
      .update({ [STAGE_COLUMN[kind]]: today })
      .eq("id", order_id);
    if (stampError) warnings.push(`the ${kind} date was not stamped: ${stampError.message}`);

    const { error: logError } = await supabase.from("special_order_events").insert({
      org_id: order.org_id,
      order_id,
      message: `${kind[0].toUpperCase()}${kind.slice(1)} emailed to ${to}${
        cc ? ` (cc ${cc})` : ""
      } · ${providerId}`,
      author: member.display_name ?? user.email ?? null,
      author_id: user.id,
      source: "app",
    });
    if (logError) warnings.push(`the log entry was not written: ${logError.message}`);

    // FILE WHAT WAS SENT. The object key is 018's shape — `{org}/{order}/…` —
    // so migration 051's storage policies authorise it on the first segment
    // with no join, and the upload flows through the CALLER's JWT like
    // everything else here.
    const filedKind = FILED_KIND[kind];
    let documentPath: string | null = null;
    if (filedKind) {
      documentPath = `${order.org_id}/${order_id}/${crypto.randomUUID()}.pdf`;
      const bytes = Uint8Array.from(atob(pdf_base64), (c) => c.charCodeAt(0));
      const { error: uploadError } = await supabase.storage
        .from("special-order-attachments")
        .upload(documentPath, bytes, { contentType: "application/pdf" });
      if (uploadError) {
        warnings.push(`the sent document was not filed: ${uploadError.message}`);
        documentPath = null;
      } else {
        const { error: rowError } = await supabase
          .from("special_order_attachments")
          .insert({
            org_id: order.org_id,
            order_id,
            kind: filedKind,
            storage_path: documentPath,
            file_name: filename,
            content_type: "application/pdf",
            byte_size: bytes.byteLength,
            uploaded_by: user.id,
          });
        if (rowError) {
          // Storage first, row second — and a failed row means taking the
          // object back out, or the bucket accumulates files nothing points at.
          await supabase.storage.from("special-order-attachments").remove([documentPath]);
          warnings.push(`the sent document was not recorded: ${rowError.message}`);
          documentPath = null;
        }
      }
    }

    // DECISION 17: THE TOKEN BINDS TO THE DOCUMENT THAT WENT OUT, not to the
    // order — money is derived live, so the order can change afterwards and
    // approving must sign what the customer actually read. Every EARLIER token
    // for this order is superseded in the same breath: a revised quote makes
    // the old link say so rather than showing a stale price.
    if (kind === "quote" && quote_token) {
      const { error: supersedeError } = await supabase
        .from("special_order_quote_tokens")
        .update({ superseded_at: new Date().toISOString() })
        .eq("order_id", order_id)
        .neq("token", quote_token)
        .is("approved_at", null)
        .is("superseded_at", null);
      if (supersedeError) {
        warnings.push(`earlier quote links were not retired: ${supersedeError.message}`);
      }
      if (documentPath) {
        const { error: bindError } = await supabase
          .from("special_order_quote_tokens")
          .update({ document_path: documentPath })
          .eq("token", quote_token)
          .eq("order_id", order_id);
        if (bindError) {
          warnings.push(`the approval link was not bound to the quote: ${bindError.message}`);
        }
      } else {
        warnings.push(
          "the approval link has no document behind it, so it will tell the customer the quote is not ready"
        );
      }
    }

    return json(200, {
      id: providerId,
      warning: warnings.length ? `sent, but ${warnings.join("; ")}` : undefined,
    });
  } catch (e) {
    if (e instanceof TransportError) return json(e.status, { error: e.message });
    return json(500, { error: e instanceof Error ? e.message : String(e) });
  }
});
