// sync-square-sales — daily net sales and tips, from Square's Reporting API.
//
// Why this exists (Mark, 2026-08-23): the closing supervisors used to type the
// day's sales and tips into a FileMaker shift report, and the numbers they were
// transcribing were Square's own. "If we're connected directly to square, I do
// not see a need for the supervisors to enter anything anymore, and I would
// prefer it if they didn't."
//
// WHAT MAKES THE FIGURES MATCH THE DASHBOARD, which is the whole point: the
// Reporting API's `reporting_day` dimension is the seller's own REPORTING DAY,
// and Donut Friend's runs 1:00 AM – 12:59 AM PT. Aggregating orders by UTC
// timestamp — the obvious alternative — can never reproduce that, so the
// numbers would be close, always slightly different, and impossible to
// reconcile against the screen Mark actually reads.
//
// It must be `reporting_day` and NOT `local_reporting_timestamp`; see the note
// on the queries below, which is the one detail here that cost a backfill.
//
// Design rule 1: the Supabase client here carries the CALLER's JWT, so every
// query and the write flow through RLS exactly as they would from the browser.
// The explicit role check just gives a readable error instead of a raw PL/pgSQL
// exception at the end of a long backfill.
//
// THE CALLER LOOPS OVER MONTHS; THIS FUNCTION DOES ONE WINDOW. A single
// seven-year request is exactly the one that dies at the wall clock having
// written nothing, where a per-month call is always short, re-runnable by name,
// and gives the browser a progress line for free. Migration 063's upsert makes
// a partial backfill harmless: re-running January re-lands January.

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

// ---------------------------------------------------------------------------
// Square
// ---------------------------------------------------------------------------

const SQUARE_BASE = "https://connect.squareup.com";

// PINNED, never omitted. Without this header Square uses the ACCOUNT's default
// version, which drifts when somebody clicks something in the developer
// console — and a drifting version under a beta endpoint is an outage nobody
// changed anything to cause. Bump deliberately, with a re-verify against the
// dashboard afterwards.
const SQUARE_VERSION = "2026-07-15";

/**
 * `Continue wait` is a **200** whose body is an error — the Reporting API's way
 * of saying "still computing". Re-issue the IDENTICAL request after a backoff.
 *
 * Capped at ~90s per window on purpose: the chunking above means a window that
 * will not settle is a retry of one month, not a dead backfill.
 */
const BACKOFF_MS = [1000, 2000, 4000, 8000, 15000, 30000, 30000];

type SquareCell = { squareLocationId: string; date: string; value: unknown };

class SquareError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

/**
 * MONEY UNITS ARE THE ONE THING THAT MUST NOT BE GUESSED.
 *
 * Square's REST APIs use integer cents in a Money object; the Reporting API is
 * a cube engine and may hand back a decimal string. A wrong assumption here is
 * a factor-of-100 error across every day we ever store, and it would read as
 * truth — which is precisely why `npm run verify:square` diffs the whole
 * backfill against Mark's own dashboard export before anybody trusts it.
 *
 * So this function REFUSES what it cannot read exactly rather than rounding
 * something plausible into the database — `parseDollarsToCents`' posture. A
 * decimal with a sub-cent remainder is a signal that the unit assumption is
 * wrong, not a rounding opportunity.
 */
function moneyToCents(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;

  if (typeof raw === "object") {
    // A Money object: {amount, currency}, amount already in the smallest unit.
    const amount = (raw as { amount?: unknown }).amount;
    return typeof amount === "number" && Number.isInteger(amount)
      ? amount
      : typeof amount === "string" && /^-?\d+$/.test(amount)
        ? Number(amount)
        : null;
  }

  const s = String(raw).trim();

  // A bare integer is ambiguous — 5306 could be $53.06 or $5,306 — so it is
  // NOT accepted as dollars. Square sends decimals for this measure; if a real
  // response ever arrives as integer cents, decide it here deliberately and say
  // so in docs/square-setup.md rather than letting a default settle it.
  const m = /^-?\d+(?:\.\d+)?$/.exec(s);
  if (!m) return null;

  const asDollars = Number(s);
  if (!Number.isFinite(asDollars)) return null;

  const cents = asDollars * 100;
  const rounded = Math.round(cents);
  // More than a hundredth of a cent off an exact cent means the unit
  // assumption is wrong. Report it; never round it away.
  if (Math.abs(cents - rounded) > 1e-4) return null;
  if (!Number.isSafeInteger(rounded)) return null;

  return rounded;
}

async function squareFetch(
  token: string,
  path: string,
  init: RequestInit & { rawToken?: string } = {}
): Promise<Record<string, unknown>> {
  const res = await fetch(`${SQUARE_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Square-Version": SQUARE_VERSION,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  // Always read the body BEFORE checking res.ok — the useful message lives
  // there, and `res.statusText` alone tells a user nothing they can act on.
  let body: Record<string, unknown>;
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    throw new SquareError(`Square returned an unreadable response (${res.status}).`, 502);
  }

  if (!res.ok) {
    const errs = body?.errors as { detail?: string; code?: string }[] | undefined;
    const detail = errs?.[0]?.detail ?? errs?.[0]?.code ?? (body?.error as string) ?? res.statusText;
    throw new SquareError(`Square refused the request: ${detail}`, res.status === 401 ? 401 : 502);
  }

  return body;
}

/** One Reporting API query, retried through `Continue wait`. */
async function loadCube(
  token: string,
  query: Record<string, unknown>
): Promise<{ rows: Record<string, unknown>[]; calls: number; waitedMs: number }> {
  let waitedMs = 0;
  for (let attempt = 0; ; attempt++) {
    const body = await squareFetch(token, "/reporting/v1/load", {
      method: "POST",
      body: JSON.stringify({ query }),
    });

    // The `Continue wait` case: a 200 that is not an answer.
    if (typeof body.error === "string" && /continue wait/i.test(body.error)) {
      const delay = BACKOFF_MS[attempt];
      if (delay === undefined) {
        throw new SquareError(
          `Square is still computing this window after ${Math.round(waitedMs / 1000)}s — try a shorter date range.`,
          502
        );
      }
      await new Promise((r) => setTimeout(r, delay));
      waitedMs += delay;
      continue;
    }

    const data = (body.data ?? (body as { result?: { data?: unknown } }).result?.data) as
      | Record<string, unknown>[]
      | undefined;

    if (!Array.isArray(data)) {
      // A beta API that renamed a cube lands here. 422, not 500: Square
      // answered, we could not use the answer.
      throw new SquareError(
        `Square's answer had no data array — the cube or measure names may have changed. Got keys: ${Object.keys(body).join(", ")}`,
        422
      );
    }

    return { rows: data, calls: attempt + 1, waitedMs };
  }
}

/**
 * Pull one measure over a window, as cells.
 *
 * The cube's own key names come back prefixed and, on some deployments,
 * granularity-suffixed (`Sales.reporting_day.day`), so the reader
 * matches on a SUFFIX rather than an exact string. A rename still fails, and
 * fails loudly at the row level rather than silently returning nothing.
 */
function readCells(
  rows: Record<string, unknown>[],
  measureKey: string,
  locationKey: string,
  timeKey: string
): SquareCell[] {
  return rows.map((row) => {
    const pick = (want: string): unknown => {
      if (want in row) return row[want];
      const k = Object.keys(row).find((key) => key === want || key.startsWith(`${want}.`));
      return k ? row[k] : undefined;
    };

    const rawDate = pick(timeKey);
    const date = typeof rawDate === "string" ? rawDate.slice(0, 10) : "";

    return {
      squareLocationId: String(pick(locationKey) ?? ""),
      date,
      value: pick(measureKey),
    };
  });
}

// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const payload = await req.json().catch(() => ({}));
    const { mode, from, to } = payload as { mode?: string; from?: string; to?: string };

    // The two catalogue modes need no window; the sync needs one.
    const NO_WINDOW_MODES = ["locations", "meta"];
    if (!NO_WINDOW_MODES.includes(mode ?? "") && (!from || !to)) {
      return json(400, {
        error: `missing from and to (or mode: ${NO_WINDOW_MODES.map((m) => `'${m}'`).join(" / ")})`,
      });
    }
    if (from && to && from > to) {
      return json(400, { error: "`from` is after `to`" });
    }

    // --- the secret ---------------------------------------------------------
    //
    // A bare token, not JSON: it is one field, and wrapping a single string in
    // JSON invents a parse error for nothing.
    //
    // The strip-and-trim is not defensive programming for its own sake. A
    // ~100-character token pasted into a dashboard field arrives with a
    // trailing newline (see `_shared/email.ts` — a real bug, "Bad control
    // character in string literal at position 262"), and Square rejects that as
    // an invalid token with no hint about why. Nothing in a Square token can
    // legitimately be a control character, so removing them cannot destroy a
    // real value — and cannot hide a TRUNCATED one either, which still fails at
    // Square with a message that says so.
    const rawToken = Deno.env.get("SQUARE_ACCESS_TOKEN");
    const token = rawToken
      // deno-lint-ignore no-control-regex
      ?.replace(/[\u0000-\u001F\u007F]/g, "")
      .trim()
      .replace(/^["']|["']$/g, "");

    if (!token) {
      return json(500, {
        error:
          "SQUARE_ACCESS_TOKEN is not set on this project (Edge Functions → Secrets) — see docs/square-setup.md",
      });
    }

    // --- the caller ---------------------------------------------------------
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return json(401, { error: "not signed in" });

    const { data: member } = await supabase
      .from("org_members")
      .select("role, org_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();

    if (!member || !["owner", "admin"].includes(member.role as string)) {
      return json(403, {
        error: "a manager or the owner is required to sync sales from Square",
      });
    }

    // --- mode: locations ----------------------------------------------------
    //
    // Fifteen lines, and it is the difference between copy-pasting an id out of
    // a dashboard URL and choosing from a list. It also lets the setup doc
    // carry a self-check: if the timezone Square reports for a shop is not the
    // org's own, stop and ask, because the reporting day will not line up.
    // --- mode: meta ---------------------------------------------------------
    //
    // The cube catalogue, straight from Square. This exists because the first
    // backfill was WRONG in a way only real data showed: net sales and tips
    // disagreed with the dashboard on 32 and 10 cells, always as adjacent pairs
    // that summed to zero — a late-night order landing on the wrong side of a
    // day boundary, never a wrong amount. Guessing a second dimension name
    // would have been guessing twice; this asks.
    if (mode === "meta") {
      let body: Record<string, unknown>;
      try {
        body = await squareFetch(token, "/reporting/v1/meta");
      } catch (e) {
        return squareFailure(e, rawToken, token);
      }
      return json(200, body);
    }

    if (mode === "locations") {
      let body: Record<string, unknown>;
      try {
        body = await squareFetch(token, "/v2/locations");
      } catch (e) {
        return squareFailure(e, rawToken, token);
      }
      const locations = (body.locations ?? []) as Record<string, unknown>[];
      return json(200, {
        locations: locations.map((l) => ({
          id: l.id,
          name: l.name,
          status: l.status,
          timezone: l.timezone,
          currency: l.currency,
        })),
      });
    }

    // --- mode: sync ---------------------------------------------------------
    const { data: locs, error: locError } = await supabase
      .from("locations")
      .select("id, code, square_location_id")
      .not("square_location_id", "is", null);

    if (locError) {
      return json(500, {
        error: /square_location_id/.test(locError.message)
          ? "locations.square_location_id does not exist — migration 063 has not been applied yet"
          : locError.message,
      });
    }
    if (!locs?.length) {
      return json(400, {
        error:
          "no location has a Square id yet — set one on each shop's record first (see docs/square-setup.md)",
      });
    }

    const bySquareId = new Map<string, { id: string; code: string }>();
    for (const l of locs) {
      bySquareId.set(l.square_location_id as string, { id: l.id as string, code: l.code as string });
    }

    const dateRange = [from, to];
    let calls = 0;
    let waitedMs = 0;

    // TWO REQUESTS, NOT ONE. The two measures live in different cubes (`Sales`
    // and `Orders`), and a cube engine generally refuses mixed-cube measures
    // unless the cubes are joined. Weak corroboration that they are two
    // reports: Mark's dashboard exported them as two separate files. If a
    // single combined query turns out to work, collapsing these is a small,
    // safe edit — the join below stops mattering.
    // `reporting_day`, NOT `local_reporting_timestamp` — and the difference is
    // an hour of somebody's takings landing on the wrong day.
    //
    // Square describes `reporting_day` as "Seller reporting day for this row's
    // revenue recognition timestamp, REPRESENTED AS MIDNIGHT ON THE LOCAL
    // REPORTING DATE". It is the seller's reporting day already resolved.
    // `local_reporting_timestamp` is the raw local timestamp, so asking for
    // `day` granularity truncates it at midnight and throws the 1:00 AM offset
    // away.
    //
    // MEASURED, not reasoned about. The first backfill used the timestamp and
    // disagreed with Mark's dashboard on 32 net-sales cells and 10 tip cells —
    // always as ADJACENT PAIRS THAT SUMMED TO ZERO (−$52.00 on 03-28, +$52.00
    // on 03-29), which is a single late-night order on the wrong side of a
    // boundary and never a wrong amount. The dashboard held the money on the
    // EARLIER day, we held it on the later one: exactly midnight-vs-1am.
    // `/reporting/v1/meta` then named the right dimension outright.
    const netQuery = {
      measures: ["Sales.net_sales"],
      dimensions: ["Sales.location_id"],
      timeDimensions: [{ dimension: "Sales.reporting_day", dateRange, granularity: "day" }],
    };
    const tipsQuery = {
      measures: ["Orders.tips_amount"],
      dimensions: ["Orders.location_id"],
      timeDimensions: [{ dimension: "Orders.reporting_day", dateRange, granularity: "day" }],
    };

    let netRows: Record<string, unknown>[];
    let tipRows: Record<string, unknown>[];
    try {
      const net = await loadCube(token, netQuery);
      calls += net.calls;
      waitedMs += net.waitedMs;
      netRows = net.rows;

      const tips = await loadCube(token, tipsQuery);
      calls += tips.calls;
      waitedMs += tips.waitedMs;
      tipRows = tips.rows;
    } catch (e) {
      return squareFailure(e, rawToken, token);
    }

    const warnings: string[] = [];
    const unmapped = new Set<string>();

    // Join the two measures on (square location, date).
    const merged = new Map<string, { net: number | null; tips: number | null }>();

    const absorb = (
      cells: SquareCell[],
      field: "net" | "tips",
      label: string
    ) => {
      for (const c of cells) {
        if (!c.squareLocationId || !c.date) continue;
        if (!bySquareId.has(c.squareLocationId)) {
          unmapped.add(c.squareLocationId);
          continue;
        }
        const cents = moneyToCents(c.value);
        if (cents === null) {
          // Never a silent zero. An unreadable figure is the money-unit
          // question showing itself, and it must be a sentence somebody reads.
          warnings.push(
            `${label} for ${bySquareId.get(c.squareLocationId)?.code} on ${c.date} was not a readable amount (${JSON.stringify(c.value)})`
          );
          continue;
        }
        const key = `${c.squareLocationId}|${c.date}`;
        const cur = merged.get(key) ?? { net: null, tips: null };
        cur[field] = cents;
        merged.set(key, cur);
      }
    };

    absorb(
      readCells(netRows, "Sales.net_sales", "Sales.location_id", "Sales.reporting_day"),
      "net",
      "Net sales"
    );
    absorb(
      readCells(tipRows, "Orders.tips_amount", "Orders.location_id", "Orders.reporting_day"),
      "tips",
      "Tips"
    );

    for (const id of unmapped) {
      // NAMED, never guessed. This is what catches a Square location nobody
      // told us about — the same thing the CSV's Total row catches from the
      // other side.
      warnings.push(`Square location ${id} is not mapped to any shop — its days were skipped`);
    }

    const rows: Record<string, unknown>[] = [];
    const perLocation = new Map<string, number>();

    for (const [key, v] of merged) {
      const [squareId, date] = key.split("|");
      const loc = bySquareId.get(squareId)!;

      // A DATE WITH NO CELL WRITES NOTHING, and a half-answered one is the same
      // case. A zero row claims "the shop took $0.00"; absence is the truth,
      // which is "Square reports nothing". The two are different sentences and
      // only one of them is honest.
      if (v.net === null && v.tips === null) continue;
      if (v.net === null) {
        warnings.push(`No net sales figure for ${loc.code} on ${date} — the day was skipped`);
        continue;
      }

      rows.push({
        location_id: loc.id,
        business_date: date,
        net_sales_cents: v.net,
        // A day with sales and no tip row genuinely took no tips; Square omits
        // the cell rather than sending a zero.
        tips_cents: v.tips ?? 0,
      });
      perLocation.set(loc.code, (perLocation.get(loc.code) ?? 0) + 1);
    }

    const { data: report, error: writeError } = await supabase.rpc("record_daily_sales", {
      p_rows: rows,
    });

    if (writeError) {
      return json(500, {
        error: /record_daily_sales/.test(writeError.message)
          ? "record_daily_sales does not exist — migration 063 has not been applied yet"
          : writeError.message,
      });
    }

    return json(200, {
      from,
      to,
      ...(report as Record<string, unknown>),
      locations: [...perLocation].map(([code, days]) => ({ code, days })),
      unmapped_square_locations: [...unmapped],
      warnings,
      square_calls: calls,
      waited_ms: waitedMs,
    });
  } catch (e) {
    if (e instanceof SquareError) return json(e.status, { error: e.message });
    return json(500, { error: e instanceof Error ? e.message : String(e) });
  }
});

/**
 * A Square failure, with `extract-invoice`'s `key_shape` diagnostic on a 401.
 *
 * It reports the SHAPE of the credential received and never its value — enough
 * to tell "the key is wrong" from "the key was mangled on the way in", which is
 * the distinction that otherwise costs an afternoon.
 */
function squareFailure(e: unknown, rawToken: string | undefined, token: string): Response {
  const err = e instanceof SquareError ? e : new SquareError(String(e));
  if (err.status !== 401) return json(err.status, { error: err.message });

  return json(401, {
    error:
      "Square rejected the access token. The secret this function received is described below — if it looks right, the token itself is wrong, revoked, or lacks the Reporting permission; if it looks wrong, re-set the secret. See docs/square-setup.md.",
    key_shape: {
      length: token.length,
      starts_with_EAAA: token.startsWith("EAAA"),
      had_surrounding_whitespace: rawToken !== rawToken?.trim(),
      had_quotes: /^["']|["']$/.test(rawToken?.trim() ?? ""),
      // deno-lint-ignore no-control-regex
      had_control_characters: /[\u0000-\u001F\u007F]/.test(rawToken ?? ""),
    },
  });
}
