// qbo-sync — everything QuickBooks that a signed-in person asks for.
//
// Design rule 1: the Supabase client here carries the CALLER's JWT, so every
// query and every write flows through RLS exactly as it would from the browser.
// The explicit role check just gives a readable error instead of a raw PL/pgSQL
// exception.
//
// THE SERVICE_ROLE ESCALATION IS BOUNDED TO ONE THING: reading and rewriting
// `accounting_connections`, which migration 081 gave zero policies precisely so
// that nothing else can. `submit-inquiry`'s shape — gate first, escalate for the
// one write that has to bypass, never for the whole request.
//
// Modes, all POST:
//   authorize_url  → where to send the browser to connect (owner/admin)
//   meta           → the connected company, which is how you prove it works
//   accounts       → expense accounts (fully qualified), for the pickers
//   vendors        → QBO vendors, for the mapping picker on a vendor record
//   items          → service items, for the settings picker
//   push_bill      → send one approved invoice to QuickBooks as a Bill
//   disconnect     → revoke at Intuit and forget the token (owner/admin)
//
// Disconnect lives HERE and not on `qbo-oauth` deliberately: that function is
// deployed without JWT verification, so a disconnect there could be triggered
// by anyone who found the URL.

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  INTUIT_AUTHORIZE,
  QBO_SCOPE,
  QboError,
  loadConnection,
  qboFetch,
  qboQuote,
  readQboCreds,
  redirectUri,
  revokeToken,
} from "../_shared/qbo.ts";

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

type Row = Record<string, unknown>;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = (await req.json().catch(() => ({}))) as {
      mode?: string;
      environment?: string;
    };
    const mode = body.mode;
    if (!mode) return json(400, { error: "missing mode" });

    // The caller, under their own RLS.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return json(401, { error: "not signed in" });

    // FILTERED BY user_id. `members_read` shows you every member of your org, so
    // an unfiltered `.maybeSingle()` here returns one row while the org has one
    // person and starts throwing the moment it has three — the bug that shipped
    // in `NewSpecialOrder` and only surfaced when Mark added a colleague.
    const { data: member } = await supabase
      .from("org_members")
      .select("org_id, role")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!member) return json(403, { error: "not a member of any organisation" });
    const orgId = member.org_id as string;
    const role = member.role as string;
    const isManager = role === "owner" || role === "admin";

    // service_role, for the token row and nothing else.
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // -----------------------------------------------------------------------
    // authorize_url — start the handshake
    // -----------------------------------------------------------------------
    if (mode === "authorize_url") {
      if (!isManager) {
        return json(403, {
          error: "Connecting an accounting system is open to managers and the owner",
        });
      }
      const environment = body.environment === "production" ? "production" : "sandbox";

      // Through the CALLER's client, so 081's own guard runs rather than being
      // re-implemented here.
      const { data: state, error } = await supabase.rpc("begin_accounting_connection", {
        p_org: orgId,
        p_environment: environment,
      });
      if (error) return json(400, { error: error.message });
      if (!state) return json(500, { error: "no handshake was started" });

      const creds = readQboCreds();
      const url =
        `${INTUIT_AUTHORIZE}?` +
        new URLSearchParams({
          client_id: creds.client_id,
          scope: QBO_SCOPE,
          redirect_uri: redirectUri(),
          response_type: "code",
          state: state as string,
        }).toString();

      return json(200, { url, environment, redirect_uri: redirectUri() });
    }

    // -----------------------------------------------------------------------
    // disconnect — revoke there, forget here
    // -----------------------------------------------------------------------
    if (mode === "disconnect") {
      if (!isManager) {
        return json(403, {
          error: "Disconnecting an accounting system is open to managers and the owner",
        });
      }
      const { data } = await admin
        .from("accounting_connections")
        .select("id, refresh_token")
        .eq("org_id", orgId)
        .eq("provider", "qbo")
        .maybeSingle();

      const revoked = data?.refresh_token
        ? await revokeToken(data.refresh_token as string)
        : false;

      // Forget it locally EVEN IF the revoke failed — otherwise a connection
      // Intuit has already dropped can never be cleared from this side.
      if (data?.id) {
        await admin
          .from("accounting_connections")
          .update({
            status: "disconnected",
            realm_id: null,
            refresh_token: null,
            previous_refresh_token: null,
            refresh_token_expires_at: null,
            access_token: null,
            access_token_expires_at: null,
            oauth_state: null,
            oauth_state_expires_at: null,
            last_error: revoked ? null : "Disconnected here; QuickBooks did not confirm the revoke.",
          })
          .eq("id", data.id);
      }
      return json(200, { disconnected: true, revoked_at_intuit: revoked });
    }

    // -----------------------------------------------------------------------
    // set_defaults — which account bills post to, which item invoices use
    // -----------------------------------------------------------------------
    //
    // These live on the connection row (081) because they are ids INSIDE one
    // company file, and that table has zero policies — so this is the only way
    // to write them. A definer function would have done as well; a mode here
    // needs no migration and reuses the manager check already made above.
    if (mode === "set_defaults") {
      if (!isManager) {
        return json(403, {
          error: "Accounting settings are open to managers and the owner",
        });
      }
      const patch: Record<string, string | null> = {};
      const d = body as {
        bill_expense_account_ref?: string | null;
        bill_expense_account_name?: string | null;
        invoice_item_ref?: string | null;
        invoice_item_name?: string | null;
      };
      for (const k of [
        "bill_expense_account_ref",
        "bill_expense_account_name",
        "invoice_item_ref",
        "invoice_item_name",
      ] as const) {
        if (k in d) patch[k] = d[k] ?? null;
      }
      if (Object.keys(patch).length === 0) return json(400, { error: "nothing to set" });

      const { data, error } = await admin
        .from("accounting_connections")
        .update(patch)
        .eq("org_id", orgId)
        .eq("provider", "qbo")
        .select("id");

      // Row count, not the absence of an error: an update matching nothing
      // returns neither, and a settings screen reporting a save that never
      // happened is how the first push posts to the wrong account.
      if (error) return json(500, { error: error.message });
      if (!data || data.length === 0) {
        return json(400, { error: "QuickBooks is not connected yet." });
      }
      return json(200, { saved: true });
    }

    // -----------------------------------------------------------------------
    // Everything below needs a live connection.
    // -----------------------------------------------------------------------
    const conn = await loadConnection(admin, orgId);

    if (mode === "meta") {
      const res = (await qboFetch(admin, conn, `companyinfo/${conn.realm_id}`)) as {
        CompanyInfo?: { CompanyName?: string; LegalName?: string; Country?: string };
      };
      await admin
        .from("accounting_connections")
        .update({ last_used_at: new Date().toISOString() })
        .eq("id", conn.id);
      return json(200, {
        realm_id: conn.realm_id,
        environment: conn.environment,
        company_name: res.CompanyInfo?.CompanyName ?? res.CompanyInfo?.LegalName ?? null,
        country: res.CompanyInfo?.Country ?? null,
      });
    }

    if (mode === "accounts") {
      // Classification 'Expense' covers Expense, Other Expense AND Cost of Goods
      // Sold, which is the set a vendor bill can legitimately post to. Filtering
      // on AccountType instead would silently hide COGS, where most of these
      // bills belong.
      // FULLY QUALIFIED, not `Name`. A sub-account's `Name` is the LEAF only —
      // "Baker Items COGs" — so a chart with several COGS children renders as a
      // list of bare names with no parent and no way to tell them apart, which
      // is how a bill posts to the wrong account (Mark, 2026-09-01).
      // `FullyQualifiedName` is "Cost of Goods Sold:Baker Items COGs", and
      // sorting on it also files every child directly under its parent.
      const q =
        `select Id, Name, FullyQualifiedName, AccountType, AccountSubType from Account ` +
        `where Classification = ${qboQuote("Expense")} and Active = true ` +
        `maxresults 1000`;
      const res = (await qboFetch(admin, conn, `query?query=${encodeURIComponent(q)}`)) as {
        QueryResponse?: { Account?: Row[] };
      };
      const accounts = (res.QueryResponse?.Account ?? []).map((a) => {
        const full = String(a.FullyQualifiedName ?? a.Name ?? "");
        return {
          id: String(a.Id),
          name: full,
          leaf: String(a.Name ?? ""),
          depth: full.split(":").length - 1,
          type: String(a.AccountType ?? ""),
          sub_type: String(a.AccountSubType ?? ""),
        };
      });
      accounts.sort((a, b) => a.name.localeCompare(b.name));
      return json(200, { accounts });
    }

    // -----------------------------------------------------------------------
    // push_bill — one approved invoice becomes a Bill (or a VendorCredit)
    // -----------------------------------------------------------------------
    //
    // THE BROWSER BUILDS THE PAYLOAD AND THIS VALIDATES IT, which is
    // `freeze_pay_period`'s shape: the rule lives once, in the pure,
    // fixture-tested `web/src/lib/quickbooks.ts`, and a Deno twin of it here
    // would be 016's `nextDeliveryDate` trap on money going into somebody's
    // books. `send-po-email` already takes a client-rendered document the same
    // way.
    //
    // What that costs is that a caller could craft a payload, so every claim in
    // it is checked against the invoice it names — amount, vendor, entity and
    // status — read through the CALLER's client so RLS decides what they can
    // see in the first place.
    if (mode === "push_bill") {
      const req = body as unknown as {
        invoice_id?: string;
        entity?: string;
        payload?: Record<string, unknown>;
      };
      if (!req.invoice_id || !req.entity || !req.payload) {
        return json(400, { error: "missing invoice_id, entity or payload" });
      }
      if (req.entity !== "Bill" && req.entity !== "VendorCredit") {
        return json(400, { error: `unknown entity: ${req.entity}` });
      }

      const { data: invoice, error: invErr } = await supabase
        .from("vendor_invoices")
        .select("id, org_id, vendor_id, status, total, is_credit, invoice_number, external_ref")
        .eq("id", req.invoice_id)
        .maybeSingle();
      if (invErr) return json(500, { error: invErr.message });
      if (!invoice) return json(404, { error: "No such invoice" });

      if (invoice.status !== "approved") {
        return json(400, {
          error: "Only an approved invoice goes to QuickBooks — approve it first.",
        });
      }
      const wanted = invoice.is_credit ? "VendorCredit" : "Bill";
      if (req.entity !== wanted) {
        return json(400, { error: `A ${invoice.is_credit ? "credit" : "bill"} posts as ${wanted}` });
      }

      // The vendor mapping, and the account it posts to. Both are read here
      // rather than trusted from the payload.
      const { data: vendor } = await supabase
        .from("vendors")
        .select("name, external_ref")
        .eq("id", invoice.vendor_id)
        .maybeSingle();
      const vendorRef = (vendor?.external_ref as { qbo?: { id?: string } } | null)?.qbo?.id ?? null;
      if (!vendorRef) {
        return json(400, {
          error: `No QuickBooks vendor is linked to ${vendor?.name ?? "this vendor"}. ` +
            "Pick one on the vendor's record.",
        });
      }

      const line = (req.payload.Line as Record<string, unknown>[] | undefined)?.[0];
      const sentRef = (req.payload.VendorRef as { value?: string } | undefined)?.value;
      const sentAmount = Number(line?.Amount);
      const invoiceTotal = Number(invoice.total);

      if (sentRef !== vendorRef) {
        return json(400, { error: "The payload names a different QuickBooks vendor." });
      }
      // Half a cent, matching the app's own money epsilon.
      if (!Number.isFinite(sentAmount) || Math.abs(sentAmount - invoiceTotal) > 0.005) {
        return json(400, {
          error: `The payload's amount (${sentAmount}) does not match the invoice total (${invoiceTotal}).`,
        });
      }

      const conn = await loadConnection(admin, orgId);
      const path = req.entity.toLowerCase();
      const saved = (await qboFetch(admin, conn, path, {
        method: "POST",
        body: JSON.stringify(req.payload),
      })) as Record<string, Record<string, unknown>>;

      const doc = saved?.[req.entity];
      if (!doc?.Id || doc?.SyncToken === undefined || doc?.SyncToken === null) {
        return json(502, {
          error: "QuickBooks saved the document but did not return an id and sync token.",
        });
      }

      // Through the CALLER's client and the definer RPC, never a direct update:
      // `vendor_invoices_update` is purchaser+ with no column restriction, so
      // `external_ref` is writable straight through PostgREST otherwise (081).
      const ref = {
        qbo: {
          id: String(doc.Id),
          sync_token: String(doc.SyncToken),
          doc_number: doc.DocNumber === undefined || doc.DocNumber === null
            ? null
            : String(doc.DocNumber),
          entity: req.entity,
        },
      };
      const { data: recorded, error: recErr } = await supabase.rpc("record_accounting_push", {
        p_invoice: invoice.id,
        p_ref: ref,
      });
      if (recErr) return json(500, { error: recErr.message, qbo_id: String(doc.Id) });
      // Row count, not the absence of an error — and this one matters more than
      // most: the document IS in QuickBooks now, so a silent failure here means
      // the next push creates a SECOND one.
      if (!Array.isArray(recorded) || recorded.length === 0) {
        return json(500, {
          error: "It reached QuickBooks but could not be recorded here, so pushing " +
            `again would duplicate it. Its QuickBooks id is ${doc.Id}.`,
          qbo_id: String(doc.Id),
        });
      }

      await admin
        .from("accounting_connections")
        .update({ last_used_at: new Date().toISOString() })
        .eq("id", conn.id);

      return json(200, {
        entity: req.entity,
        qbo_id: String(doc.Id),
        doc_number: ref.qbo.doc_number,
        sync_token: ref.qbo.sync_token,
        updated: Boolean((req.payload as { Id?: string }).Id),
      });
    }

    if (mode === "vendors") {
      // We never CREATE a vendor in Mark's books — inventing master data from a
      // sync is how duplicate name lists happen, and QBO enforces a globally
      // unique DisplayName (error 6240). This is the list to pick from.
      const q = `select Id, DisplayName from Vendor where Active = true maxresults 1000`;
      const res = (await qboFetch(admin, conn, `query?query=${encodeURIComponent(q)}`)) as {
        QueryResponse?: { Vendor?: Row[] };
      };
      const vendors = (res.QueryResponse?.Vendor ?? []).map((v) => ({
        id: String(v.Id),
        name: String(v.DisplayName ?? ""),
      }));
      vendors.sort((a, b) => a.name.localeCompare(b.name));
      return json(200, { vendors });
    }

    if (mode === "items") {
      const q =
        `select Id, Name, Type from Item where Active = true maxresults 500`;
      const res = (await qboFetch(admin, conn, `query?query=${encodeURIComponent(q)}`)) as {
        QueryResponse?: { Item?: Row[] };
      };
      const items = (res.QueryResponse?.Item ?? [])
        .filter((i) => i.Type === "Service" || i.Type === "NonInventory")
        .map((i) => ({ id: String(i.Id), name: String(i.Name ?? ""), type: String(i.Type ?? "") }));
      items.sort((a, b) => a.name.localeCompare(b.name));
      return json(200, { items });
    }

    return json(400, { error: `unknown mode: ${mode}` });
  } catch (e) {
    if (e instanceof QboError) return json(e.status, { error: e.message });
    return json(500, { error: e instanceof Error ? e.message : String(e) });
  }
});
