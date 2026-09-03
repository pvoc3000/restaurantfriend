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
//   classes        → QBO Classes, for the per-shop picker (Plus and above)
//   departments    → QBO Locations, ditto — Intuit calls them Departments
//   items          → service items, for the settings picker
//   push_bill      → send one approved invoice to QuickBooks as a Bill
//   find_bills     → what QuickBooks already has, so a bill can be ADOPTED
//                    rather than created twice (the Bill.com parallel run)
//   refresh_status → what QuickBooks says is still owed. RETURNS, never stores
//   customers      → QBO customers, for the mapping picker on a customer
//   tax_codes      → QBO tax codes, for the settings picker (084)
//   push_invoice   → send one special order to QuickBooks as an Invoice
//   disconnect     → revoke at Intuit and forget the token (owner/admin)
//
// Disconnect lives HERE and not on `qbo-oauth` deliberately: that function is
// deployed without JWT verification, so a disconnect there could be triggered
// by anyone who found the URL.

import { createClient } from "npm:@supabase/supabase-js@2";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  INTUIT_AUTHORIZE,
  QBO_SCOPE,
  QboError,
  loadConnection,
  qboFetch,
  qboQuote,
  isStaleObject,
  qboUpload,
  readQboCreds,
  redirectUri,
  revokeToken,
} from "../_shared/qbo.ts";

/**
 * One file to put on the QuickBooks document that was just written.
 *
 * `storage_path` means the bytes are already in the private `po-attachments`
 * bucket and are fetched through the CALLER's client, so 018's storage policy
 * decides — `extract-invoice`'s route. `pdf_base64` means the browser rendered
 * it just now (the customer's own invoice sheet), which is `send-po-email`'s
 * route and the only one available for a document that exists nowhere else.
 */
type AttachRequest = {
  key: string;
  file_name: string;
  content_type: string;
  metadata: unknown;
  storage_path?: string;
  pdf_base64?: string;
};

/**
 * Upload each file and hand back what QuickBooks said, RAW.
 *
 * IT DOES NOT JUDGE THE ANSWER. A refused file returns HTTP 200 with a
 * per-item `Fault`, and reading that is `attachableFromResponse` in
 * `web/src/lib/quickbooks.ts` — fixture-pinned against the real sandbox
 * refusal. Interpreting it here as well would be `taxDisagreement` again, which
 * shipped as two copies a day earlier and had to be pulled back to one.
 *
 * THE ENTITY REF IS OVERWRITTEN, NEVER TRUSTED. The caller composes the
 * metadata so its shape and `IncludeOnSend: false` stay in the pure module, but
 * the pointer is replaced with the document this request actually created —
 * otherwise a caller could hang a file on any transaction in the company file.
 *
 * A FAILURE HERE IS NEVER FATAL. The bill or invoice is already in QuickBooks
 * by the time this runs; the paperwork not following it is worth a sentence,
 * not a 500 that reads as the push having failed.
 */
async function runAttachments(
  entity: string,
  entityId: string,
  requests: AttachRequest[],
  supabase: SupabaseClient,
  admin: SupabaseClient,
  conn: Parameters<typeof qboUpload>[1]
): Promise<{ key: string; response?: unknown; error?: string }[]> {
  const out: { key: string; response?: unknown; error?: string }[] = [];

  for (const r of requests.slice(0, 10)) {
    try {
      let bytes: Uint8Array;
      if (r.storage_path) {
        const { data, error } = await supabase.storage
          .from("po-attachments")
          .download(r.storage_path);
        if (error || !data) {
          out.push({ key: r.key, error: `Could not read ${r.file_name}: ${error?.message ?? "no file"}` });
          continue;
        }
        bytes = new Uint8Array(await data.arrayBuffer());
      } else if (r.pdf_base64) {
        const bin = atob(r.pdf_base64);
        bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      } else {
        out.push({ key: r.key, error: `Nothing to attach for ${r.file_name}.` });
        continue;
      }

      const meta = { ...(r.metadata as Record<string, unknown>) };
      meta.AttachableRef = [
        { EntityRef: { type: entity, value: String(entityId) }, IncludeOnSend: false },
      ];

      const response = await qboUpload(admin, conn, meta, bytes, r.file_name, r.content_type);
      out.push({ key: r.key, response });
    } catch (e) {
      out.push({
        key: r.key,
        error: e instanceof QboError ? e.message : `Could not attach ${r.file_name}.`,
      });
    }
  }
  return out;
}

/**
 * The document's CURRENT sync token, after attachments have touched it.
 *
 * ATTACHING A FILE BUMPS THE PARENT'S OWN SyncToken, and so does deleting one.
 * The push response carries the token from BEFORE that, so recording it leaves
 * the row exactly one behind and the next update fails with a stale-object
 * fault (5010) — measured on Bill 145, stored 9 against a live 10, and it
 * failed on the very next push.
 *
 * Only called when something was actually attached, so an ordinary push still
 * costs one round trip.
 */
async function currentSyncToken(
  admin: SupabaseClient,
  conn: Parameters<typeof qboUpload>[1],
  entity: string,
  id: string,
  fallback: string
): Promise<string> {
  try {
    const sql = `select * from ${entity} where Id = '${id}'`;
    const res = (await qboFetch(admin, conn, `query?query=${encodeURIComponent(sql)}`)) as {
      QueryResponse?: Record<string, Record<string, unknown>[]>;
    };
    const live = res.QueryResponse?.[entity]?.[0];
    const token = live?.SyncToken;
    return token === undefined || token === null ? fallback : String(token);
  } catch {
    // A failed re-read is not worth failing the push over: the document and its
    // paperwork are both in QuickBooks. The row is then one behind and the next
    // update says so in QuickBooks' own words.
    return fallback;
  }
}

/**
 * Post a document, and if QuickBooks says our copy is stale, re-read the token
 * and post it once more.
 *
 * WHY THIS EXISTS. An update carries the `SyncToken` we last saw. Anything that
 * touches the document in QuickBooks moves it — a bookkeeper editing the bill,
 * or an attachment going on — and the next update is then refused with fault
 * 5010. Before this, that was UNRECOVERABLE FROM THE APP: nothing re-read the
 * token, so a bill somebody had edited in QuickBooks could never be updated
 * from here again, and the message blamed a colleague by name ("You and Craig
 * Carlson were working on this at the same time"). `lib/quickbooks.ts` has
 * called 5010 "recoverable — re-read and push again" since the day it shipped
 * while offering no way to do either.
 *
 * ONCE, AND ONLY ON AN UPDATE.
 *   · A CREATE cannot be stale — it names no Id — and retrying one that failed
 *     for some other reason is how you write the document twice.
 *   · Once, not until it works: a document somebody is actively editing would
 *     spin, and each turn of the loop is a write to a customer's books.
 *   · Only on 5010, matched on the CODE. The message names a person and is
 *     Intuit's to reword.
 *
 * The retry re-reads the token from QuickBooks rather than incrementing the one
 * we hold: the document may have moved by several, and a guess that happens to
 * be right is worse than one that fails, because it teaches you to trust it.
 */
async function postDocument(
  admin: SupabaseClient,
  conn: Parameters<typeof qboUpload>[1],
  entity: string,
  payload: Record<string, unknown>
): Promise<{ saved: Record<string, Record<string, unknown>>; retried: boolean }> {
  const path = entity.toLowerCase();
  try {
    const saved = (await qboFetch(admin, conn, path, {
      method: "POST",
      body: JSON.stringify(payload),
    })) as Record<string, Record<string, unknown>>;
    return { saved, retried: false };
  } catch (e) {
    const id = payload.Id;
    if (!isStaleObject(e) || id === undefined || id === null || String(id).trim() === "") {
      throw e;
    }
    const fresh = await currentSyncToken(
      admin, conn, entity, String(id), String(payload.SyncToken ?? "")
    );
    // Unchanged token means the re-read failed or told us what we already knew,
    // and pushing the same thing again would fail the same way. Report the
    // original refusal, which at least names the fault.
    if (String(fresh) === String(payload.SyncToken ?? "")) throw e;

    const saved = (await qboFetch(admin, conn, path, {
      method: "POST",
      body: JSON.stringify({ ...payload, SyncToken: String(fresh) }),
    })) as Record<string, Record<string, unknown>>;
    return { saved, retried: true };
  }
}

/** Said out loud when a push had to re-read the token first: something else
 *  moved the document, and the person should know their update landed ON TOP of
 *  a change they have not seen. Yellow, not red — it worked. */
const STALE_RETRY_NOTE =
  "This had been changed in QuickBooks since it was last sent from here, so it " +
  "was re-read first. Your update was applied on top of that change.";

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

      // THE CLIENT ID DOES NOT COME BACK WITH THIS. Until 2026-09-02 the whole
      // Intuit consent URL was returned here, so the app's own client id sat in
      // a JSON response, in browser memory and in devtools — which is what
      // Intuit refused the production-key questionnaire over ("app client ID …
      // must not be exposed within your app").
      //
      // The browser is handed the handshake token instead and navigates to
      // `qbo-oauth?start=<state>`, which builds the URL server-side and
      // redirects. The client id then appears only in the address bar during
      // the hop to Intuit, which is the protocol itself and unavoidable — but
      // it is never in anything this app serves.
      //
      // `readQboCreds()` is still called, and only to FAIL EARLY: a missing or
      // malformed secret should be a sentence on the settings screen, not a
      // redirect that dead-ends at Intuit.
      readQboCreds();

      return json(200, { state, environment, redirect_uri: redirectUri() });
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
        tax_code_ref?: string | null;
        tax_code_name?: string | null;
      };
      for (const k of [
        "bill_expense_account_ref",
        "bill_expense_account_name",
        "invoice_item_ref",
        "invoice_item_name",
        "tax_code_ref",
        "tax_code_name",
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
        /** Paperwork to put on the bill once it exists. The caller decides
         *  WHICH — `attachmentsToSend` skips anything already up, because a
         *  second upload of the same file makes a second copy (measured). */
        attachments?: AttachRequest[];
      };
      if (!req.invoice_id || !req.entity || !req.payload) {
        return json(400, { error: "missing invoice_id, entity or payload" });
      }
      if (req.entity !== "Bill" && req.entity !== "VendorCredit") {
        return json(400, { error: `unknown entity: ${req.entity}` });
      }

      const { data: invoice, error: invErr } = await supabase
        .from("vendor_invoices")
        .select("id, org_id, vendor_id, location_id, status, total, is_credit, invoice_number, external_ref")
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

      // The mapping is the SHOP's, not the vendor's (Mark, 2026-09-01: every
      // QuickBooks setting lives on the vendor's per-location row). Read here
      // rather than trusted from the payload.
      const [{ data: vendor }, { data: atShop }] = await Promise.all([
        supabase.from("vendors").select("name").eq("id", invoice.vendor_id).maybeSingle(),
        supabase
          .from("vendor_locations")
          .select("external_ref")
          .eq("vendor_id", invoice.vendor_id)
          .eq("location_id", invoice.location_id)
          .maybeSingle(),
      ]);
      const vendorRef =
        (atShop?.external_ref as { qbo?: { id?: string } } | null)?.qbo?.id ?? null;
      if (!vendorRef) {
        return json(400, {
          error: `No QuickBooks vendor is linked to ${vendor?.name ?? "this vendor"} at this ` +
            "shop. Set it on the vendor's record, under that location.",
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
      const { saved, retried } = await postDocument(admin, conn, req.entity, req.payload);

      const doc = saved?.[req.entity];

      // WHAT QUICKBOOKS KEPT, not what we sent. It accepts a DepartmentRef or a
      // ClassRef and SILENTLY DISCARDS it when the matching preference is off —
      // measured on Mark's own first bill, where the class stuck and the
      // location vanished with a 200 and no fault. A push that reports success
      // while quietly dropping half the coding is the exact shape this app
      // spends its time refusing, so the answer is checked rather than assumed.
      const warnings: string[] = [];
      if (retried) warnings.push(STALE_RETRY_NOTE);
      const sentDept = (req.payload as { DepartmentRef?: unknown }).DepartmentRef;
      if (sentDept && !doc?.DepartmentRef) {
        warnings.push(
          "QuickBooks did not keep the location. Turn on Track locations in " +
            "Account and settings → Advanced → Categories, then push again."
        );
      }
      const sentLine = (req.payload.Line as Record<string, Record<string, unknown>>[] | undefined)?.[0];
      const sentClass = (sentLine?.AccountBasedExpenseLineDetail as Record<string, unknown> | undefined)
        ?.ClassRef;
      const savedLine = (doc?.Line as Record<string, Record<string, unknown>>[] | undefined)?.[0];
      const savedClass = (savedLine?.AccountBasedExpenseLineDetail as Record<string, unknown> | undefined)
        ?.ClassRef;
      if (sentClass && !savedClass) {
        warnings.push(
          "QuickBooks did not keep the class. Turn on Track classes in " +
            "Account and settings → Advanced → Categories, then push again."
        );
      }
      if (!doc?.Id || doc?.SyncToken === undefined || doc?.SyncToken === null) {
        return json(502, {
          error: "QuickBooks saved the document but did not return an id and sync token.",
        });
      }

      // Through the CALLER's client and the definer RPC, never a direct update:
      // `vendor_invoices_update` is purchaser+ with no column restriction, so
      // `external_ref` is writable straight through PostgREST otherwise (081).
      // WHAT WAS ALREADY ATTACHED SURVIVES THIS WRITE. 081's merge is
      // `external_ref || p_ref` at the TOP level, so the whole `qbo` branch is
      // replaced — a ref built from the push response alone therefore ERASES
      // the attachment record, and the next push, seeing nothing recorded,
      // attaches a second copy of the same invoice. Measured on Bill 145: the
      // second push emptied `attachments` while the file sat in QuickBooks.
      // The same shape as the sync token a commit earlier, one level up: the
      // server was still rebuilding a ref from parts.
      const priorBill = (invoice.external_ref as { qbo?: { attachments?: Record<string, string> } } | null)
        ?.qbo?.attachments;
      const ref = {
        qbo: {
          id: String(doc.Id),
          sync_token: String(doc.SyncToken),
          doc_number: doc.DocNumber === undefined || doc.DocNumber === null
            ? null
            : String(doc.DocNumber),
          entity: req.entity,
          ...(priorBill && Object.keys(priorBill).length ? { attachments: priorBill } : {}),
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

      // The invoice scan, AFTER the bill is recorded — the document has to
      // exist before anything can hang off it, and if this half fails the bill
      // is still safely on the books and recorded as such.
      const attachRequests = (req.attachments ?? []) as AttachRequest[];
      const attachmentResults = attachRequests.length
        ? await runAttachments(req.entity!, String(doc.Id), attachRequests, supabase, admin, conn)
        : [];
      if (attachRequests.length) {
        ref.qbo.sync_token = await currentSyncToken(
          admin, conn, req.entity!, String(doc.Id), ref.qbo.sync_token
        );
      }

      await admin
        .from("accounting_connections")
        .update({ last_used_at: new Date().toISOString() })
        .eq("id", conn.id);

      return json(200, {
        entity: req.entity,
        warnings,
        qbo_id: String(doc.Id),
        doc_number: ref.qbo.doc_number,
        sync_token: ref.qbo.sync_token,
        updated: Boolean((req.payload as { Id?: string }).Id),
        attachment_results: attachmentResults,
        // THE WHOLE REF, so a caller recording attachments adds to what was
        // written here rather than rebuilding it and quietly dropping a field.
        ref,
      });
    }

    // -----------------------------------------------------------------------
    // refresh_status — what QuickBooks says is still owed
    // -----------------------------------------------------------------------
    //
    // IT RETURNS THE ANSWER AND STORES NOTHING, which is the whole design.
    // `lib/invoices`, migration 025 and 051 all say the same thing in the same
    // words: there is no `paid` status here, because payment is a fact
    // QuickBooks owns and two truths about one sum of money is worse than one
    // truth elsewhere. A balance written into our row is stale the moment it
    // lands and is then rendered as though it were current —
    // `sync-square-sales`' `preview` mode refuses a partial day for exactly
    // this reason, and this is the same refusal.
    //
    // So the screens show it with an "as of" and it disappears on reload.
    // -----------------------------------------------------------------------
    // find_bills — what QuickBooks already has under these invoices' numbers
    //
    // The parallel run with Bill.com: bills reach the books there and sync to
    // QuickBooks, so nearly every invoice in this app ALREADY exists over there
    // (measured: 51 of 52) and pushing would double it. This finds the one that
    // is already there so it can be adopted instead.
    //
    // IT TAKES INVOICE IDS, NOT NUMBERS, and reads the numbers itself through
    // the CALLER's client. A caller handing over arbitrary numbers could use
    // this to ask what is in the books one guess at a time; ids go through RLS.
    //
    // IT PROPOSES NOTHING. The rule — vendor refuses, amount caveats, two
    // matches is a hand-pick — is `proposeBillLink` in `web/src/lib`, where the
    // fixtures can reach it. This returns candidates and stops, which is the
    // split `taxDisagreement` had to be pulled back to.
    // -----------------------------------------------------------------------
    if (mode === "find_bills") {
      const wanted = (body as unknown as { invoice_ids?: string[] }).invoice_ids;
      let sel = supabase
        .from("vendor_invoices")
        .select("id, invoice_number")
        .not("invoice_number", "is", null);
      if (Array.isArray(wanted) && wanted.length > 0) sel = sel.in("id", wanted);
      const { data: rows, error: rowsError } = await sel;
      if (rowsError) return json(500, { error: rowsError.message });

      const numbers = [
        ...new Set(
          (rows ?? [])
            .map((r) => String((r as { invoice_number: string }).invoice_number).trim())
            .filter(Boolean)
        ),
      ];
      if (numbers.length === 0) return json(200, { candidates: [] });

      const conn = await loadConnection(admin, orgId);
      const candidates: Record<string, unknown>[] = [];
      for (const entity of ["Bill", "VendorCredit"] as const) {
        // Chunked because the query is a URL, and a few hundred quoted numbers
        // is how you find the length limit the hard way.
        for (let i = 0; i < numbers.length; i += 40) {
          const list = numbers.slice(i, i + 40).map(qboQuote).join(",");
          const sql = `select * from ${entity} where DocNumber in (${list}) maxresults 1000`;
          const res = (await qboFetch(admin, conn, `query?query=${encodeURIComponent(sql)}`)) as {
            QueryResponse?: Record<string, Record<string, unknown>[]>;
          };
          for (const d of res.QueryResponse?.[entity] ?? []) {
            candidates.push({
              id: String(d.Id),
              sync_token: String(d.SyncToken),
              doc_number: d.DocNumber === undefined || d.DocNumber === null ? null : String(d.DocNumber),
              entity,
              total: Number(d.TotalAmt ?? 0),
              vendor_ref: (d.VendorRef as { value?: string } | undefined)?.value ?? null,
              vendor_name: (d.VendorRef as { name?: string } | undefined)?.name ?? null,
              txn_date: d.TxnDate === undefined || d.TxnDate === null ? null : String(d.TxnDate),
              balance: d.Balance === undefined || d.Balance === null ? null : Number(d.Balance),
            });
          }
        }
      }

      await admin
        .from("accounting_connections")
        .update({ last_used_at: new Date().toISOString() })
        .eq("id", conn.id);

      return json(200, { candidates, checked_at: new Date().toISOString() });
    }

    if (mode === "refresh_status") {
      const wanted = (body as unknown as { invoice_ids?: string[] }).invoice_ids;

      // Through the CALLER's client: RLS decides which invoices they can see,
      // so this can never report on another org's books.
      let q = supabase
        .from("vendor_invoices")
        .select("id, invoice_number, external_ref, qbo_balance")
        .not("external_ref->qbo->>id", "is", null);
      if (Array.isArray(wanted) && wanted.length > 0) q = q.in("id", wanted);
      const { data: rows, error: rowsError } = await q;
      if (rowsError) return json(500, { error: rowsError.message });

      type Pushed = {
        id: string;
        invoice_number: string | null;
        external_ref: { qbo?: { id?: string; entity?: string } };
        qbo_balance: number | null;
      };
      const pushed = (rows ?? []) as Pushed[];
      if (pushed.length === 0) {
        return json(200, { checked_at: new Date().toISOString(), statuses: [] });
      }

      const conn = await loadConnection(admin, orgId);

      // Grouped by entity, because a Bill and a VendorCredit are different
      // tables in QuickBooks and cannot be asked for in one query.
      const byEntity = new Map<string, Pushed[]>();
      for (const r of pushed) {
        // TWO-WAY ON PURPOSE, and only because this query reads
        // `vendor_invoices`, which can hold nothing but a Bill or a
        // VendorCredit. Widen it to `special_orders` and this line silently
        // asks QuickBooks for every customer Invoice as a Bill and finds
        // none — which reads as "no longer in QuickBooks", i.e. as a deleted
        // document rather than a bug. The same ternary shipped in
        // `pushedLabel` and mislabelled the first real invoice (2026-09-02);
        // if A/R status pull is ever built, read the stored entity here.
        const entity = r.external_ref?.qbo?.entity === "VendorCredit" ? "VendorCredit" : "Bill";
        (byEntity.get(entity) ?? byEntity.set(entity, []).get(entity)!).push(r);
      }

      const found = new Map<string, Record<string, unknown>>();
      for (const [entity, group] of byEntity) {
        // Chunked: the query is a URL, and a few hundred ids in an IN list is
        // how you find the length limit the hard way.
        for (let i = 0; i < group.length; i += 100) {
          const ids = group
            .slice(i, i + 100)
            .map((r) => qboQuote(String(r.external_ref!.qbo!.id)))
            .join(",");
          const sql = `select Id, DocNumber, TotalAmt, Balance from ${entity} where Id in (${ids}) maxresults 1000`;
          const res = (await qboFetch(admin, conn, `query?query=${encodeURIComponent(sql)}`)) as {
            QueryResponse?: Record<string, Record<string, unknown>[]>;
          };
          for (const doc of res.QueryResponse?.[entity] ?? []) {
            found.set(`${entity}:${String(doc.Id)}`, doc);
          }
        }
      }

      const statuses = pushed.map((r) => {
        const entity = r.external_ref?.qbo?.entity === "VendorCredit" ? "VendorCredit" : "Bill";
        const key = `${entity}:${r.external_ref?.qbo?.id}`;
        const doc = found.get(key);
        // MISSING IS ITS OWN ANSWER, not a zero: a document deleted or voided
        // in QuickBooks would otherwise read as paid in full.
        if (!doc) {
          return { invoice_id: r.id, qbo_id: r.external_ref?.qbo?.id ?? null, entity, missing: true };
        }
        const balance = Number(doc.Balance ?? 0);
        return {
          invoice_id: r.id,
          qbo_id: String(doc.Id),
          entity,
          doc_number: doc.DocNumber === undefined || doc.DocNumber === null ? null : String(doc.DocNumber),
          total: Number(doc.TotalAmt ?? 0),
          balance,
          settled: Math.abs(balance) < 0.005,
          missing: false,
        };
      });

      // CACHED, SO A LIST COLUMN CAN SAY IT WITHOUT ASKING FIRST (088). The
      // balance is stored WITH the moment it was true and never rendered
      // without it — which is what makes storing somebody else's fact honest,
      // and is the whole of the rule this bends.
      //
      // NULL BALANCE IS A REAL ANSWER HERE: "we asked, and QuickBooks does not
      // have it any more". It reads differently from "nobody asked", which is a
      // null `qbo_checked_at`, and only the pair can tell them apart.
      //
      // Only what CHANGED is written — a re-check of forty settled bills should
      // cost nothing — and each write checks its own row count, because 025's
      // update policy is purchaser+ and below that this changes nothing and
      // returns NO error.
      const checkedAt = new Date().toISOString();
      let stored = 0;
      let refused = 0;
      for (const st of statuses) {
        const row = pushed.find((r) => r.id === st.invoice_id);
        const next = st.missing ? null : Number(st.balance);
        const before = row?.qbo_balance === undefined || row?.qbo_balance === null
          ? null
          : Number(row.qbo_balance);
        if (before === next) continue;
        const { data: done, error: upErr } = await supabase
          .from("vendor_invoices")
          .update({ qbo_balance: next, qbo_checked_at: checkedAt })
          .eq("id", st.invoice_id)
          .select("id");
        if (upErr || !done || done.length === 0) refused++;
        else stored++;
      }

      await admin
        .from("accounting_connections")
        .update({ last_used_at: new Date().toISOString() })
        .eq("id", conn.id);

      return json(200, {
        checked_at: checkedAt,
        statuses,
        stored,
        // Said out loud rather than swallowed: below purchaser+ the figures are
        // still correct on screen and simply will not survive a reload, and a
        // silent difference between those two is how somebody concludes the
        // feature is broken.
        ...(refused ? { not_stored: refused } : {}),
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

    // Class and Location tracking are PLUS-AND-ABOVE features, so an org that
    // has not turned them on simply gets an empty list — which is why these
    // return `[]` rather than refusing: the pickers then say there is nothing
    // to choose instead of the screen showing an error for a feature the
    // company does not use.
    if (mode === "classes" || mode === "departments") {
      const entity = mode === "classes" ? "Class" : "Department";
      // The RECORDS existing is not the same as the FEATURE being on — Mark's
      // sandbox had DF01 and DF02 as Departments with TrackDepartments false,
      // so the picker looked ready and every bill silently lost its location.
      const prefs = (await qboFetch(
        admin,
        conn,
        `query?query=${encodeURIComponent("select * from Preferences")}`
      )) as { QueryResponse?: { Preferences?: { AccountingInfoPrefs?: Record<string, unknown> }[] } };
      const acct = prefs.QueryResponse?.Preferences?.[0]?.AccountingInfoPrefs ?? {};
      const enabled =
        mode === "departments"
          ? acct.TrackDepartments === true
          : acct.ClassTrackingPerTxn === true || acct.ClassTrackingPerTxnLine === true;
      const q = `select Id, Name, FullyQualifiedName from ${entity} where Active = true maxresults 1000`;
      const res = (await qboFetch(admin, conn, `query?query=${encodeURIComponent(q)}`)) as {
        QueryResponse?: Record<string, Row[]>;
      };
      const rows = (res.QueryResponse?.[entity] ?? []).map((r) => ({
        id: String(r.Id),
        name: String(r.FullyQualifiedName ?? r.Name ?? ""),
      }));
      rows.sort((a, b) => a.name.localeCompare(b.name));
      return json(200, { [mode]: rows, enabled });
    }

    if (mode === "customers" || mode === "tax_codes") {
      const entity = mode === "customers" ? "Customer" : "TaxCode";
      const fields = mode === "customers" ? "Id, DisplayName" : "Id, Name";
      const q = `select ${fields} from ${entity} where Active = true maxresults 1000`;
      const res = (await qboFetch(admin, conn, `query?query=${encodeURIComponent(q)}`)) as {
        QueryResponse?: Record<string, Row[]>;
      };
      const rows = (res.QueryResponse?.[entity] ?? []).map((r) => ({
        id: String(r.Id),
        name: String(r.DisplayName ?? r.Name ?? ""),
      }));
      rows.sort((a, b) => a.name.localeCompare(b.name));
      return json(200, { [mode]: rows });
    }

    // -----------------------------------------------------------------------
    // push_invoice — one special order becomes a QuickBooks Invoice
    // -----------------------------------------------------------------------
    //
    // THE AMOUNT IS TRUSTED FROM THE BROWSER, and that is decision 6 rather
    // than laziness: `special_orders` has no stored total by design — every
    // figure is derived from the lines and six inputs by `orderTotals` — so
    // validating it here would mean a PL/pgSQL or Deno twin of that
    // arithmetic, which is the trap decision 6 exists to prevent. The trust
    // boundary is unchanged either way: anyone who can push can already edit
    // the order's lines and prices, so they can make the total anything.
    //
    // What IS checked is every claim that could point the money somewhere
    // else: the customer, the stage, and the statement rule.
    if (mode === "push_invoice") {
      const req = body as unknown as {
        order_id?: string;
        payload?: Record<string, unknown>;
        /** Accepted and ignored since 2026-09-02 — the caller now composes the
         *  tax warning itself (see `theirTax` below). Still declared so a page
         *  loaded before this deploy is not refused for sending it. */
        our_tax?: number;
        /** The customer's own invoice sheet, rendered by the browser just now
         *  and posted as base64 — `send-po-email`'s route, and the only one
         *  available for a document that is not stored anywhere. */
        attachments?: AttachRequest[];
        /** The sheet already on this invoice, to remove first. See below. */
        replace_attachable_id?: string;
      };
      if (!req.order_id || !req.payload) {
        return json(400, { error: "missing order_id or payload" });
      }

      const { data: order, error: orderErr } = await supabase
        .from("special_orders")
        .select("id, kind, status, ignore_balance, customer_id, number, external_ref")
        .eq("id", req.order_id)
        .maybeSingle();
      if (orderErr) return json(500, { error: orderErr.message });
      if (!order) return json(404, { error: "No such order" });

      if (order.kind !== "order") {
        return json(400, { error: "Only an order becomes an invoice." });
      }
      if (order.status !== "invoice" && order.status !== "order") {
        return json(400, {
          error: `Only an invoiced or committed order goes to QuickBooks — it is a ${order.status ?? "lead"}.`,
        });
      }
      if (order.ignore_balance) {
        return json(400, {
          error: "This customer is billed by statement, so this day is not sent on its own.",
        });
      }
      if (!order.customer_id) return json(400, { error: "This order has no customer." });

      const { data: customer } = await supabase
        .from("customers")
        .select("external_ref")
        .eq("id", order.customer_id)
        .maybeSingle();
      const customerRef =
        (customer?.external_ref as { qbo?: { id?: string } } | null)?.qbo?.id ?? null;
      if (!customerRef) {
        return json(400, {
          error: "No QuickBooks customer is linked. Pick one on the customer's record.",
        });
      }
      if ((req.payload.CustomerRef as { value?: string } | undefined)?.value !== customerRef) {
        return json(400, { error: "The payload names a different QuickBooks customer." });
      }

      const conn2 = await loadConnection(admin, orgId);
      const { saved, retried } = await postDocument(admin, conn2, "Invoice", req.payload);
      const doc = saved?.Invoice;
      if (!doc?.Id || doc?.SyncToken === undefined || doc?.SyncToken === null) {
        return json(502, { error: "QuickBooks saved the invoice but returned no id and sync token." });
      }

      // The tax QuickBooks decided. RETURNED, NOT JUDGED: whether it disagrees
      // with the customer's copy, and how to say so, is `taxDisagreement` in
      // `web/src/lib/quickbooks.ts`, which the caller applies to this figure.
      //
      // That rule was written here too until 2026-09-02, and this copy was the
      // one that ran while the fixture-tested one had no caller at all — 016's
      // `nextDeliveryDate` trap, where the tested implementation is not the one
      // in force and the two drift with nothing going red. Deno cannot import
      // from `web/`, so the cure is not a shared module: it is to stop deciding
      // here. Only compose a warning in this function for something the CLIENT
      // cannot see — the coding QuickBooks accepted and then dropped, which is
      // what `push_bill`'s own warnings are, and why they stay there.
      const theirTax = Number(
        (doc.TxnTaxDetail as { TotalTax?: unknown } | undefined)?.TotalTax ?? 0
      );
      const warnings: string[] = [];
      if (retried) warnings.push(STALE_RETRY_NOTE);

      // WHAT WAS ALREADY ATTACHED SURVIVES THIS WRITE. 081's merge is
      // `external_ref || p_ref` at the TOP level, so the whole `qbo` branch is
      // replaced — a ref built from the push response alone therefore ERASES
      // the attachment record, and the next push, seeing nothing recorded,
      // attaches a second copy of the same invoice. Measured on Bill 145: the
      // second push emptied `attachments` while the file sat in QuickBooks.
      // The same shape as the sync token a commit earlier, one level up: the
      // server was still rebuilding a ref from parts.
      const priorOrder = (order.external_ref as { qbo?: { attachments?: Record<string, string> } } | null)
        ?.qbo?.attachments;
      const ref = {
        qbo: {
          id: String(doc.Id),
          sync_token: String(doc.SyncToken),
          doc_number: doc.DocNumber === undefined || doc.DocNumber === null ? null : String(doc.DocNumber),
          entity: "Invoice",
          ...(priorOrder && Object.keys(priorOrder).length ? { attachments: priorOrder } : {}),
        },
      };
      // `special_orders` has ordinary policies (051, supervisor+), so unlike a
      // vendor invoice this needs no definer — but it still checks the row
      // count, because the document is already in QuickBooks by now and a
      // silent failure means the next push creates a second one.
      const { data: recorded, error: recErr } = await supabase
        .from("special_orders")
        .update({ external_ref: ref, synced_at: new Date().toISOString() })
        .eq("id", order.id)
        .select("id");
      if (recErr) return json(500, { error: recErr.message, qbo_id: String(doc.Id) });
      if (!recorded || recorded.length === 0) {
        return json(500, {
          error: "It reached QuickBooks but could not be recorded here, so pushing again " +
            `would duplicate it. Its QuickBooks id is ${doc.Id}.`,
          qbo_id: String(doc.Id),
        });
      }

      // THE CUSTOMER SHEET IS REPLACED, NOT ADDED TO. It is rendered from the
      // figures this push just sent, so a second push means the figures moved
      // and the old copy now disagrees with the invoice it hangs off — the
      // opposite of a bill's scan, which never changes and is left alone.
      // A failed delete is ignored on purpose: somebody may have removed it in
      // QuickBooks, and refusing to attach the new one over that would leave
      // the invoice with no paperwork at all. Measured — deleting one that is
      // already gone answers HTTP 400 "Object Not Found".
      //
      // `SyncToken: "0"` IS NOT A GUESS. QuickBooks ignores the token on an
      // Attachable delete: a deliberately wrong "9" deleted the object anyway
      // (measured 2026-09-02), so this needs no extra round trip to read the
      // current one — which matters, because a stale token that DID bite would
      // leave the old sheet in place beside the new one.
      const stale = (req.replace_attachable_id ?? "").toString().trim();
      if (stale) {
        try {
          await qboFetch(admin, conn, "attachable?operation=delete", {
            method: "POST",
            body: JSON.stringify({ Id: stale, SyncToken: "0" }),
          });
        } catch { /* it is gone, or it was never there */ }
      }

      const sheet = req.attachments as AttachRequest[] | undefined;
      const attachmentResults = sheet?.length
        ? await runAttachments("Invoice", String(doc.Id), sheet, supabase, admin, conn)
        : [];
      // Both the delete above and the upload bump the invoice's own token.
      if (stale || sheet?.length) {
        ref.qbo.sync_token = await currentSyncToken(
          admin, conn, "Invoice", String(doc.Id), ref.qbo.sync_token
        );
      }

      return json(200, {
        entity: "Invoice",
        warnings,
        qbo_id: String(doc.Id),
        doc_number: ref.qbo.doc_number,
        total: Number(doc.TotalAmt ?? 0),
        tax: theirTax,
        updated: Boolean((req.payload as { Id?: string }).Id),
        attachment_results: attachmentResults,
        sync_token: ref.qbo.sync_token,
        // See push_bill: the whole ref, so nothing is rebuilt from parts. This
        // mode did not return `sync_token` at all until 2026-09-02, so a caller
        // reconstructing the ref wrote one with NO token — and a ref without one
        // is not an update, it is a CREATE, which duplicates the invoice.
        ref,
      });
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
