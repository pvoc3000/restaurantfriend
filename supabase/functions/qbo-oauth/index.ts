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
import { exchangeCode, QboError } from "../_shared/qbo.ts";

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
    .select("id, org_id");

  if (claimError) {
    return back({ quickbooks: "error", reason: "lookup_failed" });
  }
  if (!claimed || claimed.length === 0) {
    // Expired, already used, or never ours. All three are the same answer, and
    // saying which would tell a stranger whether a state value exists.
    return back({ quickbooks: "error", reason: "expired" });
  }

  const row = claimed[0] as { id: string; org_id: string };

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

  return back({ quickbooks: "connected" });
});
