// supabase/functions/sales-nightly/index.ts
//
// THE MORNING SALES RUN — Sync from Square, Post to QuickBooks, and an email.
//
// Mark, 2026-10-29: weeks of doing both by hand every morning went cleanly,
// so this does them at 7 AM and sends "a nice summary email … sales and
// deposits for the previous day [compared] to the same day 52 weeks ago. This
// is what Shogo did and I miss it." A problem is named in the same email with
// its fix, and on a banner on the Sales screen (migration 212's row).
//
// WHO CALLS IT
//   · pg_cron (213), with the `x-sales-automation-secret` header matching the
//     SALES_AUTOMATION_SECRET edge secret. It fires at 14:00 and 15:00 UTC;
//     only the one that is 7 AM in the org's zone runs, and 212's unique
//     index allows one such run per date. It answers at once and works in the
//     background (`EdgeRuntime.waitUntil`), so pg_net's timeout never cuts it.
//   · Run Now on the Sales screen — a signed-in purchaser or above, who waits
//     for the answer. `dry_run` syncs nothing and posts nothing.
//   Deployed --no-verify-jwt, because the cron has no JWT; both doors are
//   checked here.
//
// IT SIGNS IN AS ITS OWN MEMBER, AND DOES EXACTLY WHAT THE BROWSER DOES.
// `orgs.settings.sales_automation.bot_user_id` names a purchaser member. Its
// session is minted here with service_role — `generateLink` + `verifyOtp`,
// the PIN unlock's mechanism — and signed out at the end. With it this calls
// `sync-square-sales` and `qbo-sync` as the Sales screen does, so every role
// check, RLS policy and `auth.uid()` in `record_daily_sales` runs unchanged
// and the posts are stamped with the bot's identity. The alternative was a
// service_role door in both functions, which would rewrite the gates on the
// code that writes money; this rewrites none.
//
// THE ENTRY IS BUILT BY THE BROWSER'S OWN CODE. `_shared/generated/` is
// `web/src/lib/salesPosting.ts` copied byte for byte (web/scripts/
// sync-shared.mjs); `npm run fixtures` fails if the copy is stale. Never edit
// the copy, and redeploy this function after the source changes.
//
// The service_role client here only READS (scoped by org_id explicitly, since
// it bypasses RLS) and writes the run's own row. Everything that writes sales
// or money goes through the bot's session.

import { createClient } from "npm:@supabase/supabase-js@2";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  buildDeposit,
  buildJournalEntry,
  type DepositBuild,
  type JournalBuild,
  type PayoutPostingRef,
  type PostingShop,
  type SalesBreakdown,
  type SalesMapping,
  type SalesPostingRef,
  type SquarePayout,
} from "../_shared/generated/salesPosting.ts";
import {
  addDays,
  emptyTally,
  problem,
  renderSummaryEmail,
  runWindow,
  sameDayLastYear,
  type DepositLine,
  type RunProblem,
  type RunSummary,
  type ShopDay,
  type Tally,
} from "../_shared/salesAutomation.ts";
import { resolveTransport, sendMail, TransportError, type ProviderConfig } from "../_shared/email.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

const URL_ = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type Settings = {
  enabled: boolean;
  /** The member the run signs in as — a purchaser or above. */
  botUserId: string | null;
};

function readSettings(settings: Record<string, unknown>): Settings {
  const s = (settings.sales_automation ?? {}) as Record<string, unknown>;
  const bot = typeof s.bot_user_id === "string" && s.bot_user_id.trim() ? s.bot_user_id.trim() : null;
  return { enabled: s.enabled === true, botUserId: bot };
}

/**
 * WHO GETS THE EMAIL IS DECIDED BY ROLE, NOT A LIST — the shift report's rule
 * (Mark, 2026-08-28): the owner and managers. Nobody maintains a list, so
 * nobody forgets to take a leaver off one. The bot never receives it.
 */
async function recipientsFor(admin: SupabaseClient, orgId: string, botUserId: string | null): Promise<string[]> {
  const { data: members } = await admin
    .from("org_members")
    .select("user_id, role")
    .eq("org_id", orgId)
    .in("role", ["owner", "admin"]);
  const wanted = new Set(((members ?? []) as { user_id: string }[]).map((m) => m.user_id));
  if (botUserId) wanted.delete(botUserId);
  const out: string[] = [];
  for (const id of wanted) {
    const { data } = await admin.auth.admin.getUserById(id);
    if (data?.user?.email) out.push(data.user.email);
  }
  return out.sort();
}

type Org = { id: string; name: string; settings: Record<string, unknown> };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const body = (await req.json().catch(() => ({}))) as { dry_run?: boolean };
  const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });

  // --- the cron's door -----------------------------------------------------
  const secret = Deno.env.get("SALES_AUTOMATION_SECRET")?.trim();
  const presented = req.headers.get("x-sales-automation-secret")?.trim();
  if (presented) {
    if (!secret || presented !== secret) return json(401, { error: "wrong secret" });
    const { data: orgs, error } = await admin.from("orgs").select("id, name, settings");
    if (error) return json(500, { error: error.message });
    const now = Date.now();
    const due = ((orgs ?? []) as Org[]).filter((o) => {
      const s = readSettings(o.settings ?? {});
      const zone = (o.settings?.timezone as string) || "America/Los_Angeles";
      return s.enabled && runWindow(now, zone).isRunHour;
    });
    if (due.length === 0) return json(200, { ran: 0, reason: "not enabled, or not 7 AM in any enabled org's zone" });

    const work = (async () => {
      for (const org of due) {
        try {
          await runForOrg(admin, org, { trigger: "cron", dryRun: false, startedBy: null });
        } catch (e) {
          console.error(`sales-nightly ${org.id}:`, e);
        }
      }
    })();
    if (typeof EdgeRuntime !== "undefined") {
      EdgeRuntime.waitUntil(work);
      return json(202, { started: due.length });
    }
    await work;
    return json(200, { ran: due.length });
  }

  // --- Run Now -------------------------------------------------------------
  const caller = createClient(URL_, ANON, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false },
  });
  const {
    data: { user },
  } = await caller.auth.getUser();
  if (!user) return json(401, { error: "not signed in" });
  const { data: member } = await caller
    .from("org_members")
    .select("role, org_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();
  if (!member || !["owner", "admin", "purchaser"].includes(member.role as string)) {
    return json(403, { error: "a purchaser or above is required to run the morning sales run" });
  }
  const { data: org, error: orgErr } = await admin
    .from("orgs")
    .select("id, name, settings")
    .eq("id", member.org_id)
    .maybeSingle();
  if (orgErr || !org) return json(500, { error: orgErr?.message ?? "no org" });

  try {
    const run = await runForOrg(admin, org as Org, {
      trigger: "manual",
      dryRun: body.dry_run === true,
      startedBy: user.id,
    });
    return json(200, run);
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// One org's run
// ---------------------------------------------------------------------------

type RunResult = {
  id: string | null;
  status: "ok" | "attention" | "failed" | "skipped";
  problems: RunProblem[];
  emailed: boolean;
  email_error: string | null;
};

async function runForOrg(
  admin: SupabaseClient,
  org: Org,
  opts: { trigger: "cron" | "manual"; dryRun: boolean; startedBy: string | null }
): Promise<RunResult> {
  const settings = readSettings(org.settings ?? {});
  const zone = (org.settings?.timezone as string) || "America/Los_Angeles";
  const window = runWindow(Date.now(), zone);

  // The claim: for the cron, 212's unique index turns a second run on one
  // date into a conflict here rather than a second set of posts.
  const { data: claimed, error: claimErr } = await admin
    .from("sales_automation_runs")
    .insert({
      org_id: org.id,
      trigger: opts.trigger,
      dry_run: opts.dryRun,
      local_date: window.localDate,
      window_from: window.from,
      window_to: window.to,
      started_by: opts.startedBy,
    })
    .select("id")
    .maybeSingle();
  if (claimErr) {
    if (claimErr.code === "23505") {
      return { id: null, status: "skipped", problems: [], emailed: false, email_error: null };
    }
    throw new Error(
      /sales_automation_runs/.test(claimErr.message)
        ? "migration 212 has not been applied (sales_automation_runs is missing)"
        : claimErr.message
    );
  }
  const runId = (claimed as { id: string }).id;

  const problems: RunProblem[] = [];
  let summary: RunSummary | null = null;
  let crashed = false;
  let bot: BotSession | null = null;

  try {
    // --- sign in as the run's own member -----------------------------------
    if (!opts.dryRun) {
      const minted = await mintBotSession(admin, org.id, settings.botUserId);
      if ("problem" in minted) {
        problems.push(minted.problem);
      } else {
        bot = minted;
      }
    }

    // --- 1. sync ------------------------------------------------------------
    const notes: string[] = [];
    if (bot) {
      const { data, message } = await invoke(bot.client, "sync-square-sales", {
        from: window.from,
        to: window.to,
      });
      if (message) {
        problems.push(problem("square_sync", `Sync from Square failed: ${message}`));
      } else {
        for (const w of (data?.warnings as string[] | undefined) ?? []) notes.push(w);
        const strays = (data?.unmapped_square_locations as string[] | undefined) ?? [];
        if (strays.length) notes.push(`Square locations with no shop here: ${strays.join(", ")}`);
      }
    }

    // --- 2. what there is to post ------------------------------------------
    const ctx = await readContext(admin, org);
    const { data: dayRows, error: dayErr } = await admin
      .from("daily_sales")
      .select("id, location_id, business_date, net_sales_cents, tips_cents, breakdown, external_ref")
      .eq("org_id", org.id)
      .gte("business_date", window.from)
      .lte("business_date", window.to)
      .order("business_date");
    if (dayErr) throw new Error(dayErr.message);
    const { data: payoutRows, error: payErr } = await admin
      .from("square_payouts")
      .select("id, location_id, square_payout_id, end_to_end_id, status, payout_type, sent_at, arrival_date, amount_cents, external_ref, post_error")
      .eq("org_id", org.id)
      .gte("arrival_date", window.from)
      .order("arrival_date");
    if (payErr) throw new Error(payErr.message);

    // --- 3. build every day and payout, the dialog's way --------------------
    type Planned<B> = { label: { shop: string; date: string }; build: B; action: "create" | "update" | "skip" | "refused"; id: string };
    const days: Planned<JournalBuild>[] = [];
    const unmapped = new Map<string, { name: string; kind: string; cents: number; shop: string; dates: Set<string> }>();
    for (const r of (dayRows ?? []) as Record<string, unknown>[]) {
      const shop = ctx.shops.get(r.location_id as string);
      // Days with no breakdown are the archive (FileMaker, or before 104):
      // there is nothing to post for them, and nothing has ever posted them.
      if (!shop || !r.breakdown) continue;
      const build = buildJournalEntry({
        breakdown: r.breakdown as SalesBreakdown,
        mappings: ctx.mappings,
        shop,
        businessDate: r.business_date as string,
        netSalesCents: Number(r.net_sales_cents),
        tipsCents: Number(r.tips_cents),
        existing: (r.external_ref as SalesPostingRef | null) ?? null,
        orgName: org.name,
      });
      const label = { shop: shop.code, date: r.business_date as string };
      if (!build.ok) {
        days.push({ label, build, action: "refused", id: r.id as string });
        for (const reason of build.refusals) problems.push(problem("day_refused", reason, label));
        continue;
      }
      for (const u of build.unmapped) {
        const key = `${u.kind}|${u.key}`;
        const seen = unmapped.get(key) ?? { name: u.name, kind: u.kind, cents: 0, shop: shop.code, dates: new Set<string>() };
        seen.cents += u.cents;
        seen.dates.add(label.date);
        unmapped.set(key, seen);
      }
      // UNCHANGED MEANS THE ENTRY IS THE SAME, not the breakdown. 104's
      // `breakdown_hash` is an md5 of the whole document, `pulled_at`
      // included, so every sync makes every re-pulled day look "pulled again"
      // — and this run re-syncs a week each morning. The journal hash covers
      // the DocNumber, the date and every line (side, cents, account, source);
      // when it matches what was posted, QuickBooks already holds this entry,
      // and sending it again would be twelve identical updates a day.
      const stored = (r.external_ref as SalesPostingRef | null)?.qbo;
      const unchanged = Boolean(stored?.id) && stored?.journal_hash === build.hash;
      days.push({ label, build, action: unchanged ? "skip" : build.mode, id: r.id as string });
    }
    for (const u of unmapped.values()) {
      const dates = [...u.dates].sort();
      problems.push(
        problem(
          "day_unmapped",
          `“${u.name}” (${u.kind}, ${dollars(u.cents)} over ${dates.length} day${dates.length === 1 ? "" : "s"}) has no account and posted to the default.`
        )
      );
    }

    const deposits: Planned<DepositBuild>[] = [];
    const payouts = ((payoutRows ?? []) as Record<string, unknown>[]).map(toPayout);
    for (const p of payouts) {
      const shop = ctx.shops.get(p.location_id);
      if (!shop) continue;
      const build = buildDeposit({ payout: p, mappings: ctx.mappings, shop, orgName: org.name });
      const label = { shop: shop.code, date: p.arrival_date };
      if (!build.ok) {
        deposits.push({ label, build, action: "refused", id: p.id });
        for (const reason of build.refusals) problems.push(problem("deposit_refused", reason, label));
        continue;
      }
      const stored = p.external_ref?.qbo;
      const unchanged =
        Boolean(stored?.id) &&
        stored?.deposit_hash === build.hash &&
        stored?.amount_cents === p.amount_cents &&
        stored?.arrival_date === p.arrival_date;
      deposits.push({ label, build, action: unchanged ? "skip" : build.mode, id: p.id });
    }

    // --- 4. post, one after another ------------------------------------------
    // A test run sends nothing, so it counts what it WOULD send as created
    // or updated; the email heads that block "Would post" on a dry run.
    const entries = tallyOf(days, opts.dryRun);
    const depositTally = tallyOf(deposits, opts.dryRun);
    const depositState = new Map<string, string>();
    for (const d of deposits) depositState.set(d.id, d.action === "skip" ? "already posted" : d.action === "refused" ? "refused" : "not sent");

    const connected = await isConnected(admin, org.id);
    if (!connected) {
      problems.push(problem("qbo_connection", "QuickBooks is not connected, so nothing was posted."));
    }
    if (bot && connected) {
      let stopped = false;
      const notSent: { shop: string; date: string; what: string }[] = [];
      for (const d of days) {
        if (d.action !== "create" && d.action !== "update") continue;
        if (stopped) {
          notSent.push({ ...d.label, what: "entry" });
          continue;
        }
        const ok = d.build as Extract<JournalBuild, { ok: true }>;
        const { data, message } = await invoke(bot.client, "qbo-sync", {
          mode: "post_daily_sales",
          daily_sales_id: d.id,
          payload: ok.body,
          journal_hash: ok.hash,
        });
        if (message) {
          entries.failed++;
          problems.push(problem("day_failed", `QuickBooks refused the entry: ${message}`, d.label));
          stopped = true;
        } else if (data?.skipped) {
          entries.skipped++;
        } else if (data?.updated) {
          entries.updated++;
        } else {
          entries.created++;
        }
      }
      for (const d of deposits) {
        if (d.action !== "create" && d.action !== "update") continue;
        if (stopped) {
          notSent.push({ ...d.label, what: "deposit" });
          continue;
        }
        const ok = d.build as Extract<DepositBuild, { ok: true }>;
        const { data, message } = await invoke(bot.client, "qbo-sync", {
          mode: "post_square_payout",
          payout_id: d.id,
          payload: ok.body,
          deposit_hash: ok.hash,
        });
        if (message) {
          depositTally.failed++;
          depositState.set(d.id, "failed");
          problems.push(problem("deposit_failed", `QuickBooks refused the deposit: ${message}`, d.label));
          stopped = true;
        } else if (data?.skipped) {
          depositTally.skipped++;
          depositState.set(d.id, "already posted");
        } else {
          if (data?.updated) depositTally.updated++;
          else depositTally.created++;
          depositState.set(d.id, data?.updated ? "updated" : "posted");
        }
      }
      if (notSent.length) {
        problems.push(
          problem(
            "not_attempted",
            `Not sent after that failure: ${notSent.map((n) => `${n.shop} ${n.date} ${n.what}`).join(", ")}.`
          )
        );
      }
    }

    // --- 5. the summary: yesterday, and the same weekday a year ago ---------
    const yesterday = window.to;
    const lastYear = sameDayLastYear(yesterday);
    // THE SHOPS THAT TRADED THIS WEEK, not every active one with a Square id:
    // ONLINE has both and has not sold since July, and listing it would be a
    // row of dashes and a "no sales yesterday" problem every morning. A shop
    // that sold during the week and not yesterday is the gap worth naming.
    const tradedThisWeek = new Set(((dayRows ?? []) as Record<string, unknown>[]).map((r) => r.location_id as string));
    const shopsWithSquare = [...ctx.shops.values()]
      .filter((s) => s.square && s.active && tradedThisWeek.has(s.id))
      .sort((a, b) => a.code.localeCompare(b.code));
    const { data: compareRows, error: cmpErr } = await admin
      .from("daily_sales")
      .select("location_id, business_date, net_sales_cents")
      .eq("org_id", org.id)
      .in("business_date", [yesterday, lastYear]);
    if (cmpErr) throw new Error(cmpErr.message);
    const net = new Map<string, number>();
    for (const r of (compareRows ?? []) as Record<string, unknown>[]) {
      net.set(`${r.location_id}|${r.business_date}`, Number(r.net_sales_cents));
    }
    const shopDays: ShopDay[] = shopsWithSquare.map((s) => ({
      shop: s.code,
      netCents: net.get(`${s.id}|${yesterday}`) ?? null,
      lastYearCents: net.get(`${s.id}|${lastYear}`) ?? null,
    }));
    for (const s of shopDays) {
      if (s.netCents === null && !opts.dryRun) {
        problems.push(problem("missing_day", "Square has no sales for this shop yesterday.", { shop: s.shop, date: yesterday }));
      }
    }

    const today = window.localDate;
    const depositLines: DepositLine[] = payouts
      .filter((p) => p.arrival_date >= yesterday && p.arrival_date <= addDays(today, 1))
      .map((p) => {
        const d = deposits.find((x) => x.id === p.id);
        return {
          shop: ctx.shops.get(p.location_id)?.code ?? "?",
          arrivalDate: p.arrival_date,
          amountCents: p.amount_cents,
          docNumber: d?.build.ok ? d.build.docNumber : null,
          state: opts.dryRun ? (d?.action === "skip" ? "already posted" : d?.action ?? "—") : depositState.get(p.id) ?? "—",
        };
      })
      .sort((a, b) => a.arrivalDate.localeCompare(b.arrivalDate) || a.shop.localeCompare(b.shop));

    summary = {
      businessDate: yesterday,
      lastYearDate: lastYear,
      shops: shopDays,
      deposits: depositLines,
      entries,
      depositTally,
      notes,
    };
  } catch (e) {
    crashed = true;
    problems.push(problem("crash", e instanceof Error ? e.message : String(e)));
  } finally {
    if (bot) await bot.end();
  }

  // --- 6. record, then email ------------------------------------------------
  const status: RunResult["status"] = crashed ? "failed" : problems.length ? "attention" : "ok";
  let emailed = false;
  let emailError: string | null = null;
  const recipients = await recipientsFor(admin, org.id, settings.botUserId);
  if (recipients.length === 0) {
    emailError = "No owner or manager has an email address to send the morning summary to.";
  } else {
    try {
      const mail = renderSummaryEmail({
        orgName: org.name,
        appUrl: Deno.env.get("APP_URL") ?? null,
        dryRun: opts.dryRun,
        window: { from: window.from, to: window.to },
        summary,
        problems,
      });
      const transport = resolveTransport({
        orgProvider: org.settings?.email_provider as ProviderConfig | undefined,
        orgName: org.name,
      });
      await sendMail(transport, {
        to: recipients.join(", "),
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      });
      emailed = true;
    } catch (e) {
      emailError = e instanceof TransportError || e instanceof Error ? e.message : String(e);
    }
  }

  const { error: saveErr } = await admin
    .from("sales_automation_runs")
    .update({
      finished_at: new Date().toISOString(),
      status,
      problems,
      summary,
      emailed_to: emailed ? recipients.join(", ") : null,
      emailed_at: emailed ? new Date().toISOString() : null,
      email_error: emailError,
    })
    .eq("id", runId);
  if (saveErr) console.error(`sales-nightly: the run row was not saved: ${saveErr.message}`);

  return { id: runId, status, problems, emailed, email_error: emailError };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type BotSession = { client: SupabaseClient; end: () => Promise<void> };

/**
 * A real session for the run's own member. `generateLink` makes a magic-link
 * token WITHOUT sending anything, and `verifyOtp` spends it — the PIN
 * unlock's own mechanism. The membership is checked here so a misconfigured
 * address is a sentence in the email, not a 403 three calls later.
 */
async function mintBotSession(
  admin: SupabaseClient,
  orgId: string,
  userId: string | null
): Promise<BotSession | { problem: RunProblem }> {
  if (!userId) {
    return { problem: problem("bot", "No member is chosen for the run to sign in as, so nothing was synced or posted.") };
  }
  const { data: found } = await admin.auth.admin.getUserById(userId);
  const email = found?.user?.email;
  if (!email) {
    return { problem: problem("bot", "The member the run signs in as no longer has an account, so nothing was synced or posted.") };
  }
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const hashed = link?.properties?.hashed_token;
  if (linkErr || !hashed) {
    return { problem: problem("bot", `Could not sign in as ${email}: ${linkErr?.message ?? "no link"}. Nothing was synced or posted.`) };
  }
  const anon = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: verified, error: otpErr } = await anon.auth.verifyOtp({ token_hash: hashed, type: "magiclink" });
  const session = verified?.session;
  if (otpErr || !session) {
    return { problem: problem("bot", `Could not sign in as ${email}: ${otpErr?.message ?? "no session"}. Nothing was synced or posted.`) };
  }
  const { data: m } = await admin
    .from("org_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (!m || !["owner", "admin", "purchaser"].includes(m.role as string)) {
    await admin.auth.admin.signOut(session.access_token, "local").catch(() => undefined);
    return {
      problem: problem("bot", `${email} is not a purchaser or above here, so it may not sync or post. Nothing was synced or posted.`),
    };
  }
  const client = createClient(URL_, ANON, {
    global: { headers: { Authorization: `Bearer ${session.access_token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return {
    client,
    end: async () => {
      await admin.auth.admin.signOut(session.access_token, "local").catch(() => undefined);
    },
  };
}

/** `invokeQbo`'s rule (web/src/lib/qboClient): the real sentence is in the
 *  body of a non-2xx answer, not in the SDK's message. */
async function invoke(
  client: SupabaseClient,
  fn: string,
  body: Record<string, unknown>
): Promise<{ data: Record<string, unknown> | null; message: string | null }> {
  const { data, error } = await client.functions.invoke(fn, { body });
  if (!error) return { data: (data ?? {}) as Record<string, unknown>, message: null };
  let message = error.message;
  try {
    const ctx = (error as { context?: Response }).context;
    const parsed = await ctx?.json();
    if (parsed?.error) message = parsed.error as string;
  } catch {
    /* keep the SDK's message */
  }
  return { data: null, message };
}

type Shop = PostingShop & { id: string; square: boolean; active: boolean };

async function readContext(
  admin: SupabaseClient,
  org: Org
): Promise<{ shops: Map<string, Shop>; mappings: SalesMapping[] }> {
  const [locs, maps] = await Promise.all([
    admin
      .from("locations")
      .select("id, code, is_active, square_location_id, qbo_class_ref, qbo_class_name, qbo_location_ref, qbo_location_name")
      .eq("org_id", org.id),
    admin
      .from("accounting_sales_mappings")
      .select("kind, square_key, square_name, account_ref, account_name")
      .eq("org_id", org.id),
  ]);
  if (locs.error) throw new Error(locs.error.message);
  if (maps.error) throw new Error(maps.error.message);
  const shops = new Map<string, Shop>();
  for (const l of (locs.data ?? []) as Record<string, unknown>[]) {
    shops.set(l.id as string, {
      id: l.id as string,
      code: l.code as string,
      qbo_class_ref: (l.qbo_class_ref as string | null) ?? null,
      qbo_class_name: (l.qbo_class_name as string | null) ?? null,
      qbo_location_ref: (l.qbo_location_ref as string | null) ?? null,
      qbo_location_name: (l.qbo_location_name as string | null) ?? null,
      square: Boolean(l.square_location_id),
      active: l.is_active === true,
    });
  }
  return { shops, mappings: (maps.data ?? []) as SalesMapping[] };
}

async function isConnected(admin: SupabaseClient, orgId: string): Promise<boolean> {
  // The token row is service_role's to read; only its status matters here,
  // and `qbo-sync` will say more if the post itself fails.
  const { data } = await admin
    .from("accounting_connections")
    .select("status")
    .eq("org_id", orgId)
    .eq("provider", "qbo")
    .maybeSingle();
  return (data as { status?: string } | null)?.status === "connected";
}

function toPayout(r: Record<string, unknown>): SquarePayout {
  return {
    id: r.id as string,
    location_id: r.location_id as string,
    square_payout_id: r.square_payout_id as string,
    end_to_end_id: (r.end_to_end_id as string | null) ?? null,
    status: r.status as string,
    payout_type: (r.payout_type as string | null) ?? null,
    sent_at: r.sent_at as string,
    arrival_date: r.arrival_date as string,
    amount_cents: Number(r.amount_cents),
    external_ref: (r.external_ref as PayoutPostingRef | null) ?? null,
    post_error: (r.post_error as string | null) ?? null,
  };
}

function tallyOf(planned: { action: string }[], wouldSend: boolean): Tally {
  const t = emptyTally();
  for (const p of planned) {
    if (p.action === "skip") t.skipped++;
    if (p.action === "refused") t.refused++;
    if (wouldSend && p.action === "create") t.created++;
    if (wouldSend && p.action === "update") t.updated++;
  }
  return t;
}

function dollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
}
