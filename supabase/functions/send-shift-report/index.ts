// send-shift-report — the closing routine's last step.
//
// The supervisor walks the report, presses Send, and two emails go out: one to
// MANAGEMENT with the staff ratings, one to SUPERVISORS without them. That
// split is the whole reason this function exists rather than a single send.
//
// ---------------------------------------------------------------------------
// THE BODIES ARE COMPOSED IN THE BROWSER AND POSTED HERE
//
// `send-po-email`'s shape, and for a stronger reason than convenience. The one
// rule this feature must never break is that the supervisor version carries no
// employee name, position, score or rating note — and `web/src/lib/shiftReports`
// enforces it STRUCTURALLY, by defining `managementBody` as `supervisorBody`
// plus a ratings section, so a leak needs somebody to move that section rather
// than merely to forget. It is fixture-pinned against the produced string.
//
// Deno cannot import from `web/`, so composing here would mean a SECOND
// implementation of that rule, in a file with no fixtures, drifting from the
// first. Sending what the client composed keeps one implementation.
//
// The obvious objection — a caller could post whatever it liked — does not
// bite: the caller is an authenticated supervisor sending THEIR OWN report,
// who can already read those ratings and could paste them anywhere. What this
// function still owns, and does not take from the request, is WHO RECEIVES
// WHICH VERSION.
//
// ---------------------------------------------------------------------------
// SENT AND EMAILED ARE TWO FACTS
//
// `submit_shift_report` has already run and already flipped the report to
// `sent` before this is called. So a failure here is recoverable rather than
// catastrophic: the report reads "sent, not emailed", the list offers a
// Resend, and nothing has to be undone. That is why the two are separate
// columns and separate acts.
//
// `_shared/email.ts` is compiled in AT DEPLOY TIME. This function is the first
// caller of its `html` field.

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

/** Who gets which version. Not taken from the request — see the header. */
const MANAGEMENT_ROLES = ["owner", "admin"];
const SUPERVISOR_ROLES = ["purchaser", "supervisor"];

/** A plain-text fallback part, so a client that will not render HTML still
 *  gets something readable rather than an empty body. */
function toText(html: string): string {
  return html
    .replace(/<\/(h2|h3|p|tr|li)>/g, "\n")
    .replace(/<\/t[dh]>/g, "\t")
    .replace(/<br\s*\/?>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const {
      report_id,
      subject,
      supervisor_html,
      management_html,
      net_sales_cents,
      tips_cents,
      sales_provisional,
    } = await req.json();

    if (!report_id || !subject || !supervisor_html || !management_html) {
      return json(400, {
        error: "missing report_id, subject, supervisor_html or management_html",
      });
    }

    // The CALLER's JWT: every read below flows through RLS exactly as it would
    // from the browser, and the stamp at the end goes through a definer that
    // re-checks the role itself.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );

    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return json(401, { error: "not signed in" });

    const { data: report } = await supabase
      .from("shift_reports")
      .select("id, org_id, location_id, report_date, shift, status")
      .eq("id", report_id)
      .maybeSingle();

    if (!report) return json(404, { error: "no such shift report" });

    const { data: member } = await supabase
      .from("org_members")
      .select("role")
      .eq("org_id", report.org_id)
      .eq("user_id", auth.user.id)
      .maybeSingle();

    if (!member || !["owner", "admin", "purchaser", "supervisor"].includes(member.role)) {
      return json(403, { error: "your account cannot send a shift report" });
    }

    // ---- recipients -------------------------------------------------------
    // `org_members` carries no email address — it is on `auth.users`, which no
    // ordinary client may read. So this escalates to service_role AFTER the
    // gate above, which is `submit-inquiry`'s shape: the caller's own
    // permissions decide whether anything happens, and the elevated client is
    // used only for the one thing RLS cannot express.
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: members } = await admin
      .from("org_members")
      .select("user_id, role")
      .eq("org_id", report.org_id);

    const wanted = (members ?? []).filter((m) =>
      [...MANAGEMENT_ROLES, ...SUPERVISOR_ROLES].includes(m.role)
    );

    const emailById = new Map<string, string>();
    // Paged, because `listUsers` defaults to 50 and an org that outgrows one
    // page would silently stop emailing whoever sorted last.
    for (let page = 1; page <= 20; page += 1) {
      const { data: users } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      const batch = users?.users ?? [];
      for (const u of batch) if (u.email) emailById.set(u.id, u.email);
      if (batch.length < 200) break;
    }

    const managementTo = wanted
      .filter((m) => MANAGEMENT_ROLES.includes(m.role))
      .map((m) => emailById.get(m.user_id))
      .filter((e): e is string => Boolean(e));

    const supervisorTo = wanted
      .filter((m) => SUPERVISOR_ROLES.includes(m.role))
      .map((m) => emailById.get(m.user_id))
      .filter((e): e is string => Boolean(e));

    if (managementTo.length === 0 && supervisorTo.length === 0) {
      return json(400, { error: "nobody in this org has an address to send to" });
    }

    // ---- transport --------------------------------------------------------
    const { data: org } = await supabase
      .from("orgs")
      .select("name, settings")
      .eq("id", report.org_id)
      .maybeSingle();

    const settings = (org?.settings ?? {}) as Record<string, unknown>;
    const shiftSettings = (settings.shift_report ?? {}) as Record<string, unknown>;
    const billing = (settings.billing ?? {}) as Record<string, unknown>;

    const transport = resolveTransport({
      explicit: shiftSettings.email_provider as ProviderConfig | undefined,
      orgProvider: settings.email_provider as ProviderConfig | undefined,
      orgName: org?.name ?? undefined,
      replyToFallbacks: [
        shiftSettings.reply_to as string | undefined,
        billing.email as string | undefined,
      ],
    });

    // ---- send -------------------------------------------------------------
    // Each version is ONE message with everybody on it, deliberately: this is
    // a team briefing, and a reply should reach the team.
    const warnings: string[] = [];
    const ids: string[] = [];

    for (const [to, html, label] of [
      [managementTo.join(", "), management_html, "management"],
      [supervisorTo.join(", "), supervisor_html, "supervisors"],
    ] as const) {
      if (to === "") continue;
      try {
        const id = await sendMail(transport, {
          to,
          subject,
          text: toText(html),
          html,
        });
        ids.push(`${label}: ${id}`);
      } catch (e) {
        // One version failing must not stop the other — a manager still being
        // told is better than nobody being told.
        warnings.push(`${label}: ${(e as Error).message}`);
      }
    }

    if (ids.length === 0) {
      return json(502, { error: `nothing could be sent — ${warnings.join("; ")}` });
    }

    // ---- the second fact --------------------------------------------------
    // Through the definer, so it is stamped with the caller's own identity and
    // re-checked. A failure here is a WARNING on a 200: the mail is out, and
    // reporting that as an error would have somebody send it twice.
    const { error: stampError } = await supabase.rpc("mark_shift_report_emailed", {
      p_report_id: report_id,
      p_receipt: {
        sent: ids,
        warnings,
        management_recipients: managementTo.length,
        supervisor_recipients: supervisorTo.length,
        // What the email CLAIMED about the day, kept as a record of what was
        // said rather than as a fact about the day. The record screen compares
        // it against the settled figure once Square reports one.
        net_sales_cents: net_sales_cents ?? null,
        tips_cents: tips_cents ?? null,
        sales_provisional: sales_provisional ?? false,
      },
    });
    if (stampError) warnings.push(`the report was emailed but not stamped: ${stampError.message}`);

    return json(200, {
      sent: ids,
      warning: warnings.length > 0 ? warnings.join("; ") : undefined,
    });
  } catch (e) {
    if (e instanceof TransportError) return json(e.status, { error: e.message });
    return json(500, { error: (e as Error).message });
  }
});
