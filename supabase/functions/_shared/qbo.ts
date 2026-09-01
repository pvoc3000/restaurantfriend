// _shared/qbo.ts — the QuickBooks Online credential and transport layer.
//
// One token layer, two callers (`qbo-oauth` and `qbo-sync`), which is
// `_shared/email.ts`'s shape and its reason. THIS FILE IS COMPILED IN AT DEPLOY
// TIME: changing it means redeploying BOTH functions, and the deployed copy of
// whichever you forget keeps running the old code until you do.
//
// ---------------------------------------------------------------------------
// WHERE THE CREDENTIAL LIVES, AND WHY IT IS SPLIT IN TWO
//
// `_shared/email.ts` states this app's rule: credentials live in edge-function
// secrets, never in the DB, because `orgs.settings` is readable by every org
// member. That rule holds here for the STATIC half — the client id and secret
// are in `QBO_CREDS`, exactly like `EMAIL_CREDS_*`.
//
// It cannot hold for the other half. A QBO refresh token ROTATES: the token
// endpoint returns a new one and invalidates the old, so whatever comes back
// must be stored. An edge function cannot rewrite its own secret. So the
// rotating half lives in `accounting_connections` (migration 081), which has
// RLS on and ZERO policies — invisible to every authenticated user, written
// only from here under `service_role`.
//
// ---------------------------------------------------------------------------
// PERSIST BEFORE USE. THIS IS THE ORDERING THAT MATTERS.
//
// The moment Intuit answers a refresh, the old token is already dead. If we
// then use the new access token and only afterwards fail to write the new
// refresh token, the connection is permanently unrecoverable — and the push
// that just succeeded makes it look like everything worked, which is the worst
// of both. So `accessTokenFor` writes the pair FIRST, checks the write landed,
// and only then hands the access token back.
//
// `previous_refresh_token` keeps one generation because Intuit tolerates the
// old value briefly, so a write that lands after a crash still has something to
// fall back on.
//
// One user pressing buttons, so two simultaneous refreshes are possible and not
// defended against beyond the expiry skew. Accepted deliberately: the cost is a
// reconnect, the cure is on screen, and a lock here would be machinery for a
// race that needs two people pressing the same button in the same second.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

/** A refusal the caller hands back verbatim. Every one names the exact thing
 *  that is missing — "QuickBooks failed" sends somebody to read logs they do
 *  not have. `TransportError`'s shape, for the same reason. */
export class QboError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

// From Intuit's own OpenID discovery document, not from a blog:
// https://developer.intuit.com/.well-known/openid_configuration/
export const INTUIT_AUTHORIZE = "https://appcenter.intuit.com/connect/oauth2";
export const INTUIT_TOKEN = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
export const INTUIT_REVOKE = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";

/** Decision 2: accounting only. `com.intuit.quickbooks.payment` is the
 *  merchant-account scope and this integration deliberately does not take it. */
export const QBO_SCOPE = "com.intuit.quickbooks.accounting";

/** PINNED, never omitted — an unpinned minor version silently changes which
 *  fields come back, which is `SQUARE_VERSION`'s lesson one provider over.
 *  Bump deliberately, with a re-verify against a real document afterwards. */
export const QBO_MINOR_VERSION = "75";

export type QboEnvironment = "sandbox" | "production";

export function apiBase(environment: string): string {
  return environment === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";
}

/** The one place the redirect URI is composed, because Intuit matches it
 *  byte-for-byte against the console and a mismatch is an opaque refusal. */
export function redirectUri(): string {
  const url = Deno.env.get("SUPABASE_URL");
  if (!url) throw new QboError("SUPABASE_URL is not set", 500);
  return `${url.replace(/\/+$/, "")}/functions/v1/qbo-oauth`;
}

// ---------------------------------------------------------------------------
// The static credential
// ---------------------------------------------------------------------------

export type QboCreds = { client_id: string; client_secret: string };

/**
 * Read `QBO_CREDS`.
 *
 * IT STRIPS C0 CONTROL CHARACTERS BEFORE PARSING, copied from
 * `_shared/email.ts` rather than reinvented — setting this means pasting a
 * client secret into a shell or a dashboard field, and one that arrives with a
 * newline stuck to it produces "Bad control character in string literal", which
 * names neither the secret nor the cause. Nothing legitimate in here contains
 * a control character, and a genuinely truncated secret still fails at Intuit
 * with `invalid_client`, which says what is wrong.
 */
export function readQboCreds(): QboCreds {
  const raw = Deno.env.get("QBO_CREDS");
  if (!raw) {
    throw new QboError(
      "secret QBO_CREDS is not set (Edge Functions → Secrets). See docs/quickbooks-setup.md.",
      500
    );
  }
  // deno-lint-ignore no-control-regex
  const cleaned = raw.replace(/[\u0000-\u001F]/g, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new QboError(
      `secret QBO_CREDS is not valid JSON (${e instanceof Error ? e.message : String(e)}). ` +
        'It should read {"client_id":"…","client_secret":"…"} on ONE line. ' +
        "See docs/quickbooks-setup.md.",
      500
    );
  }
  const c = parsed as Partial<QboCreds>;
  if (!c.client_id || !c.client_secret) {
    throw new QboError(
      "secret QBO_CREDS is missing client_id or client_secret. It should read " +
        '{"client_id":"…","client_secret":"…"}.',
      500
    );
  }
  return { client_id: c.client_id, client_secret: c.client_secret };
}

function basicAuth(creds: QboCreds): string {
  return "Basic " + btoa(`${creds.client_id}:${creds.client_secret}`);
}

// ---------------------------------------------------------------------------
// The connection row
// ---------------------------------------------------------------------------

export type Connection = {
  id: string;
  org_id: string;
  status: string;
  realm_id: string | null;
  environment: string;
  refresh_token: string | null;
  access_token: string | null;
  access_token_expires_at: string | null;
  bill_expense_account_ref: string | null;
  invoice_item_ref: string | null;
};

const CONNECTION_COLUMNS =
  "id, org_id, status, realm_id, environment, refresh_token, access_token, " +
  "access_token_expires_at, bill_expense_account_ref, invoice_item_ref";

/** The row, or a refusal that says how to fix it. `admin` must be a
 *  service_role client — 081's table has no policies, so nothing else can read
 *  it, which is the point. */
export async function loadConnection(
  admin: SupabaseClient,
  orgId: string
): Promise<Connection> {
  const { data, error } = await admin
    .from("accounting_connections")
    .select(CONNECTION_COLUMNS)
    .eq("org_id", orgId)
    .eq("provider", "qbo")
    .maybeSingle();

  if (error) {
    throw new QboError(`Could not read the QuickBooks connection: ${error.message}`, 500);
  }
  if (!data) {
    throw new QboError(
      "QuickBooks is not connected. Connect it in Settings → Accounting.",
      400
    );
  }

  const conn = data as Connection;
  if (conn.status !== "connected" || !conn.realm_id || !conn.refresh_token) {
    throw new QboError(
      conn.status === "disconnected"
        ? "The QuickBooks connection has ended. Reconnect it in Settings → Accounting."
        : "QuickBooks is not connected yet. Finish connecting in Settings → Accounting.",
      400
    );
  }
  return conn;
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  x_refresh_token_expires_in?: number;
};

async function postToken(body: URLSearchParams): Promise<TokenResponse> {
  const creds = readQboCreds();
  const res = await fetch(INTUIT_TOKEN, {
    method: "POST",
    headers: {
      Authorization: basicAuth(creds),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });

  const text = await res.text();
  if (res.ok) return JSON.parse(text) as TokenResponse;

  // Report the SHAPE of what went wrong, never the value — `squareFailure`'s
  // rule, and here it settles the specific question "is the refresh token dead
  // or is the client secret wrong", which is otherwise an afternoon.
  let parsed: { error?: string; error_description?: string } | null = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }

  if (parsed?.error === "invalid_grant") {
    throw new QboError(
      "QuickBooks no longer accepts this connection — it was disconnected there, " +
        "or went 100 days without being used. Reconnect it in Settings → Accounting.",
      400
    );
  }
  if (parsed?.error === "invalid_client") {
    throw new QboError(
      "QuickBooks refused the app credentials. Check QBO_CREDS holds this " +
        "environment's Client ID and Secret — sandbox keys do not work against production.",
      500
    );
  }

  const detail = parsed?.error_description ?? parsed?.error ?? text.slice(0, 300);
  throw new QboError(`QuickBooks refused the token request (${res.status}): ${detail}`, 502);
}

/** The authorization-code exchange, run once per connect by `qbo-oauth`. */
export function exchangeCode(code: string): Promise<TokenResponse> {
  return postToken(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(),
    })
  );
}

/** How long before expiry we refresh anyway. A minute-long push that starts
 *  with 30 seconds left would otherwise 401 halfway through. */
const EXPIRY_SKEW_MS = 5 * 60 * 1000;

/**
 * A usable access token, refreshing first if the stored one is spent.
 *
 * See the header for why the write comes before the use. The `.select()` on the
 * update is not decoration: an update that matched no row returns NO error, and
 * a cheerful false success here means the next call finds a refresh token
 * Intuit has already invalidated.
 */
export async function accessTokenFor(
  admin: SupabaseClient,
  conn: Connection
): Promise<string> {
  const expiresAt = conn.access_token_expires_at
    ? Date.parse(conn.access_token_expires_at)
    : 0;
  if (conn.access_token && expiresAt - EXPIRY_SKEW_MS > Date.now()) {
    return conn.access_token;
  }

  let token: TokenResponse;
  try {
    token = await postToken(
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: conn.refresh_token!,
      })
    );
  } catch (e) {
    if (e instanceof QboError && e.status === 400) {
      await markDisconnected(admin, conn.org_id, e.message);
    }
    throw e;
  }

  const now = Date.now();
  const { data, error } = await admin
    .from("accounting_connections")
    .update({
      refresh_token: token.refresh_token,
      previous_refresh_token: conn.refresh_token,
      refresh_token_expires_at: token.x_refresh_token_expires_in
        ? new Date(now + token.x_refresh_token_expires_in * 1000).toISOString()
        : null,
      access_token: token.access_token,
      access_token_expires_at: new Date(now + token.expires_in * 1000).toISOString(),
      status: "connected",
      last_error: null,
    })
    .eq("id", conn.id)
    .select("id");

  if (error || !data || data.length === 0) {
    // The old refresh token is ALREADY dead at this point, so continuing would
    // spend a credential we can never renew. Stop here and say so.
    throw new QboError(
      "QuickBooks issued a new sign-in token and it could not be saved, so the " +
        "connection has to be made again in Settings → Accounting." +
        (error ? ` (${error.message})` : ""),
      500
    );
  }

  return token.access_token;
}

export async function markDisconnected(
  admin: SupabaseClient,
  orgId: string,
  why: string
): Promise<void> {
  await admin
    .from("accounting_connections")
    .update({
      status: "disconnected",
      access_token: null,
      access_token_expires_at: null,
      last_error: why,
    })
    .eq("org_id", orgId)
    .eq("provider", "qbo");
}

/** Best effort: a revoke that fails must not stop us forgetting the token on
 *  our side, or Disconnect would leave a connection nobody can clear. */
export async function revokeToken(refreshToken: string): Promise<boolean> {
  try {
    const creds = readQboCreds();
    const res = await fetch(INTUIT_REVOKE, {
      method: "POST",
      headers: {
        Authorization: basicAuth(creds),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ token: refreshToken }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// The API
// ---------------------------------------------------------------------------

/**
 * One QBO call, with the token handled and the fault unwrapped.
 *
 * `path` is everything after `/v3/company/{realmId}/` — "companyinfo/123",
 * "query?query=…", "bill". The minor version is appended here so no caller can
 * forget it.
 */
export async function qboFetch(
  admin: SupabaseClient,
  conn: Connection,
  path: string,
  init: RequestInit = {}
): Promise<unknown> {
  const token = await accessTokenFor(admin, conn);
  const sep = path.includes("?") ? "&" : "?";
  const url =
    `${apiBase(conn.environment)}/v3/company/${conn.realm_id}/${path}` +
    `${sep}minorversion=${QBO_MINOR_VERSION}`;

  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });

  const text = await res.text();
  if (res.ok) return text ? JSON.parse(text) : null;

  if (res.status === 401) {
    await markDisconnected(admin, conn.org_id, "QuickBooks rejected the access token.");
    throw new QboError(
      "QuickBooks rejected the connection. Reconnect it in Settings → Accounting.",
      400
    );
  }
  if (res.status === 429) {
    throw new QboError(
      "QuickBooks is rate-limiting this connection. Try again in a minute.",
      429
    );
  }

  throw new QboError(`QuickBooks refused the request: ${faultMessage(text, res.status)}`, 502);
}

/** QBO wraps every refusal in a Fault; the useful sentence is inside it, and
 *  the raw envelope tells a person nothing. */
export function faultMessage(text: string, status: number): string {
  try {
    const body = JSON.parse(text) as {
      Fault?: { Error?: { Message?: string; Detail?: string; code?: string }[] };
    };
    const first = body.Fault?.Error?.[0];
    if (first) {
      const parts = [first.Message, first.Detail].filter(Boolean).join(" — ");
      return first.code ? `${parts} (fault ${first.code})` : parts;
    }
  } catch {
    // not JSON
  }
  return `${status} ${text.slice(0, 300)}`;
}

/** QBO's query endpoint wants a SQL-ish string; this is the escaping it needs.
 *  Single quotes double, exactly like SQL. */
export function qboQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
