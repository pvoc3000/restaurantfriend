// qbo-oauth — the QuickBooks authorization callback, and nothing else.
//
// THIS IS THE FIRST FUNCTION IN THIS PROJECT DEPLOYED WITHOUT JWT
// VERIFICATION, and it has to be. Every other "public" function here —
// `submit-inquiry`, `approve-quote`, `request-password-reset` — is public only
// in the RLS sense: they are reached through `supabase.functions.invoke`, which
// sends the anon key, so Supabase's default `verify_jwt` is satisfied. Intuit's
// callback is a TOP-LEVEL BROWSER NAVIGATION with no header to attach. With
// `verify_jwt` on, it is refused with a 401 before a line of this runs, and the
// symptom is "authorize works, the app never connects", with nothing in the
// logs.
//
//   npx supabase functions deploy qbo-oauth --no-verify-jwt --project-ref …
//
// ---------------------------------------------------------------------------
// WHERE ITS AUTHORITY COMES FROM
//
// The `oauth_state` row, and nothing else — `approve-quote`'s posture. The
// state is minted only by `begin_accounting_connection`, which is owner/admin;
// it is unique, expires in ten minutes, and is SPENT by the same statement that
// verifies it, so a replayed link matches zero rows. Zero rows means refuse:
// there is deliberately no fallback to "the only connection row", because that
// would let anyone who found this URL bind their own QuickBooks company to this
// org's books.
//
// It does ONE thing. Disconnect deliberately lives on `qbo-sync`, which is
// authenticated — putting it here would mean an unauthenticated caller could
// end the org's connection by guessing a URL, which is exactly what a
// no-JWT endpoint must not offer.
//
// It always REDIRECTS rather than returning JSON: a person is looking at this
// in a browser tab, and a raw error body is not an answer they can act on. The
// detail lands in `accounting_connections.last_error`, which the settings block
// shows.

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  INTUIT_AUTHORIZE,
  QBO_SCOPE,
  QboError,
  exchangeCode,
  readQboCreds,
  redirectUri,
} from "../_shared/qbo.ts";

function appUrl(): string {
  const url = Deno.env.get("APP_URL");
  if (!url) throw new QboError("APP_URL is not set (Edge Functions → Secrets)", 500);
  return url.replace(/\/+$/, "");
}

/** Back to the settings block, which reads the parameter and says what
 *  happened. `reason` is a short code, never a token or a provider body. */
function back(params: Record<string, string>): Response {
  const q = new URLSearchParams(params).toString();
  return new Response(null, {
    status: 302,
    headers: { Location: `${appUrl()}/settings?${q}` },
  });
}

Deno.serve(async (req) => {
  let url: URL;
  try {
    url = new URL(req.url);
  } catch {
    return new Response("bad request", { status: 400 });
  }

  // ---------------------------------------------------------------------
  // ?start=<state> — the hop to Intuit, built where the client id lives
  //
  // The browser navigates here rather than being handed the consent URL, so
  // this app's client id is never in a response it serves, never in its
  // JavaScript and never in devtools. Intuit refused the production-key
  // questionnaire over exactly that (2026-09-02).
  //
  // THE STATE IS NOT SPENT HERE. It is the callback's to consume, in the same
  // UPDATE that verifies it; spending it now would make the round trip fail on
  // the way back. This only reads it, to confirm the handshake is real and
  // still live before sending anyone to Intuit.
  //
  // That it needs no JWT is fine and is the same reasoning the callback rests
  // on: knowing a uuid that `begin_accounting_connection` minted for a
  // manager, within its ten minutes, buys nothing but a trip to Intuit's own
  // consent screen — and the callback still has to verify the same value.
  // ---------------------------------------------------------------------
  const start = url.searchParams.get("start");
  if (start) {
    const startAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const { data: live } = await startAdmin
      .from("accounting_connections")
      .select("id")
      .eq("oauth_state", start)
      .gt("oauth_state_expires_at", new Date().toISOString())
      .maybeSingle();
    if (!live) return back({ quickbooks: "error", reason: "expired" });

    let creds;
    try {
      creds = readQboCreds();
    } catch {
      return back({ quickbooks: "error", reason: "no_app_credentials" });
    }
    const authorize =
      `${INTUIT_AUTHORIZE}?` +
      new URLSearchParams({
        client_id: creds.client_id,
        scope: QBO_SCOPE,
        redirect_uri: redirectUri(),
        response_type: "code",
        state: start,
      }).toString();
    return new Response(null, { status: 302, headers: { Location: authorize } });
  }

  // Intuit's own refusal — the person pressed Cancel, or the app is not
  // authorised for this company.
  const providerError = url.searchParams.get("error");
  if (providerError) {
    return back({ quickbooks: "error", reason: providerError.slice(0, 60) });
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const realmId = url.searchParams.get("realmId");

  if (!code || !state || !realmId) {
    return back({ quickbooks: "error", reason: "incomplete" });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // SPEND THE STATE IN THE SAME STATEMENT THAT VERIFIES IT. One UPDATE …
  // WHERE … RETURNING, so a replay of this URL finds nothing. Note it clears
  // ONLY the state: the tokens on the row, if this is a reconnect, are still
  // the working ones until the exchange below succeeds.
  const { data: claimed, error: claimError } = await admin
    .from("accounting_connections")
    .update({ oauth_state: null, oauth_state_expires_at: null })
    .eq("oauth_state", state)
    .gt("oauth_state_expires_at", new Date().toISOString())
    .select("id, org_id, realm_id");

  if (claimError) {
    return back({ quickbooks: "error", reason: "lookup_failed" });
  }
  if (!claimed || claimed.length === 0) {
    // Expired, already used, or never ours. All three are the same answer, and
    // saying which would tell a stranger whether a state value exists.
    return back({ quickbooks: "error", reason: "expired" });
  }

  const row = claimed[0] as { id: string; org_id: string; realm_id: string | null };

  let token;
  try {
    token = await exchangeCode(code);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await admin
      .from("accounting_connections")
      .update({ status: "error", last_error: message })
      .eq("id", row.id);
    return back({ quickbooks: "error", reason: "exchange_failed" });
  }

  const now = Date.now();
  const { data: saved, error: saveError } = await admin
    .from("accounting_connections")
    .update({
      status: "connected",
      realm_id: realmId,
      refresh_token: token.refresh_token,
      previous_refresh_token: null,
      refresh_token_expires_at: token.x_refresh_token_expires_in
        ? new Date(now + token.x_refresh_token_expires_in * 1000).toISOString()
        : null,
      access_token: token.access_token,
      access_token_expires_at: new Date(now + token.expires_in * 1000).toISOString(),
      connected_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("id", row.id)
    .select("id");

  // The row count, not the absence of an error: an update that matched nothing
  // returns no error, and reporting a connection that was never stored would
  // leave a token live at Intuit that this app has no record of.
  if (saveError || !saved || saved.length === 0) {
    return back({ quickbooks: "error", reason: "not_saved" });
  }

  // A DIFFERENT COMPANY FILE MEANS EVERY STORED ACCOUNT ID IS NOW WRONG.
  //
  // `vendors.expense_account_ref` (082) and the QBO vendor id in
  // `vendors.external_ref` (081) are ids INSIDE one realm. Point the app at
  // another company — sandbox to production, most obviously — and id "80" is
  // either a different account or none at all, so a bill posts somewhere
  // nobody chose and every screen still looks settled. That is the failure
  // 081 put the connection's own defaults on the connection row to avoid; the
  // per-vendor overrides live on `vendors` and cannot be cleared that way.
  //
  // Only on a CHANGE. Reconnecting the same realm — an expired token, a
  // revoke at Intuit — must not throw away mappings that are still correct.
  const realmChanged = row.realm_id !== null && row.realm_id !== realmId;

  // EVERY CLEAR BELOW IS CHECKED. Each is an `await`ed write against a whole
  // table, and a swallowed failure is the worst outcome this function has: the
  // app would report a clean switch while a stale id still pointed at the OLD
  // company file — so a bill would post to whatever account that id happens to
  // name in the NEW books, and every screen would look settled. Nothing can be
  // retried automatically once the realm has moved, so the honest thing is to
  // say which part did not clear and let a person finish it by hand.
  const failed: string[] = [];
  const clear = async (what: string, run: PromiseLike<{ error: unknown }>) => {
    const { error } = await run;
    if (error) {
      failed.push(what);
      console.error(JSON.stringify({ at: "qbo", where: "remap", what, error: String(error) }));
    }
  };

  if (realmChanged) {
    await clear("connection defaults", admin
      .from("accounting_connections")
      .update({ bill_expense_account_ref: null, bill_expense_account_name: null,
                invoice_item_ref: null, invoice_item_name: null,
                tax_code_ref: null, tax_code_name: null })
      .eq("id", row.id));

    // WHERE THE MAPPINGS ACTUALLY LIVE. 083 moved every QBO setting onto the
    // vendor's PER-SHOP row — the account, the QBO Location, the Class and the
    // QBO vendor itself — and this block was still clearing `vendors`, which
    // nothing has read since. Measured before fixing: it cleared 2 rows nobody
    // reads and left 20 live ids pointing into the old company.
    await clear("vendor mappings", admin
      .from("vendor_locations")
      .update({
        expense_account_ref: null, expense_account_name: null,
        qbo_location_ref: null, qbo_location_name: null,
        qbo_class_ref: null, qbo_class_name: null,
        external_ref: {},
      })
      .eq("org_id", row.org_id));

    // `vendors` is cleared too. 082's columns still exist and a stale value
    // there is only ever confusing, but this is no longer the one that matters.
    await clear("vendors", admin
      .from("vendors")
      .update({ expense_account_ref: null, expense_account_name: null,
                external_ref: {} })
      .eq("org_id", row.org_id)
      .neq("external_ref", "{}"));
    await clear("vendor accounts", admin
      .from("vendors")
      .update({ expense_account_ref: null, expense_account_name: null })
      .eq("org_id", row.org_id)
      .not("expense_account_ref", "is", null));

    await clear("customer mappings", admin
      .from("customers")
      .update({ external_ref: {} })
      .eq("org_id", row.org_id)
      .neq("external_ref", "{}"));

    // AND THE DOCUMENTS THEMSELVES, which is the half with money in it. A
    // pushed bill carries the QuickBooks id, sync token and attachment ids it
    // was given — all meaningless in another company. Left alone, `pushMode`
    // reads the id and says "update", so pressing Send would try to overwrite
    // whatever document 145 happens to be in the NEW books, and the real bill
    // would never be created there at all.
    //
    // Cleared, they read as never pushed, which is the truth: in this company
    // they have not been. `synced_at` goes with them or the row claims a sync
    // that happened to somebody else's ledger.
    await clear("pushed bills", admin
      .from("vendor_invoices")
      .update({ external_ref: {}, synced_at: null })
      .eq("org_id", row.org_id)
      .not("external_ref->qbo", "is", null));

    await clear("pushed invoices", admin
      .from("special_orders")
      .update({ external_ref: {}, synced_at: null })
      .eq("org_id", row.org_id)
      .not("external_ref->qbo", "is", null));
  }

  return back({
    quickbooks: "connected",
    // "1" means every realm-scoped id was cleared. "partial" means at least one
    // table refused, so an id from the OLD company is still on a row here and a
    // person has to finish it — which the screen says, naming what is left.
    ...(realmChanged
      ? { remapped: failed.length ? "partial" : "1", ...(failed.length ? { left: failed.join(",").slice(0, 120) } : {}) }
      : {}),
  });
});
