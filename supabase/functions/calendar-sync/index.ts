// calendar-sync — read the org's subscribed calendars (migration 186).
//
// Mark, 2026-10-09: "subscribe to and display google or ical calendars". A
// subscription is an iCal address; this fetches it, writes repeating events
// out day by day, and replaces that subscription's rows in
// `calendar_subscription_events`, which the calendar page draws.
//
// CALLED BY THE CALENDAR PAGE, not by a clock — there is no cron in this app.
// The page asks when a subscription is more than an hour old, and Settings has
// a Refresh. Body: { subscription_id?: string, force?: boolean }. Without an
// id, every active subscription the caller can see is read.
//
// WHO MAY CALL: any signed-in member. The caller's own session is used to list
// the subscriptions (so RLS decides which org's they are), and that list is the
// ONLY thing the service role then acts on.
//
// THE SERVICE ROLE is needed for two things nobody's session can do: read the
// address (`calendar_subscription_urls` has no policies — it is a secret) and
// write the events. Neither the address nor anything from the file but title,
// dates, time and place is ever returned or logged.
//
// WHAT IT WILL FETCH is `_shared/icsExpand.safeFeedUrl`: https only, a real
// hostname, no credentials in the URL. Redirects are followed by hand so each
// hop is checked the same way. 15 seconds, 5 MB.
//
// A FAILURE IS RECORDED, NOT SWALLOWED: `last_error` on the subscription, in
// words the person who pasted the address can act on, and the last good copy
// of the events is left where it is.

import { createClient } from "npm:@supabase/supabase-js@2";
import ICAL from "npm:ical.js@2.2.1";

import { expandFeed, safeFeedUrl } from "../_shared/icsExpand.ts";

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

/** Not read again within this long unless `force` — a page full of people
 *  opening the calendar at once is one fetch, not thirty. */
const FRESH_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 15_000;
const MAX_BYTES = 5 * 1024 * 1024;
const DAYS_BACK = 30;
const DAYS_AHEAD = 365;

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function todayIn(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** The calendar file's text, or a sentence saying why not. */
async function fetchCalendar(start: string): Promise<{ text: string } | { error: string }> {
  let url: string | null = safeFeedUrl(start);
  for (let hop = 0; hop < 4; hop += 1) {
    if (!url) return { error: "That address is not one this can read (it must be https)." };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(url, {
        redirect: "manual",
        signal: controller.signal,
        headers: { Accept: "text/calendar, text/plain;q=0.8, */*;q=0.5", "User-Agent": "restaurantfriend-calendar/1" },
      });
    } catch (e) {
      clearTimeout(timer);
      return {
        error: e instanceof DOMException && e.name === "AbortError"
          ? "The calendar took too long to answer."
          : "The calendar could not be reached.",
      };
    }
    if (response.status >= 300 && response.status < 400) {
      clearTimeout(timer);
      const next = response.headers.get("location");
      await response.body?.cancel();
      url = next ? safeFeedUrl(new URL(next, url).toString()) : null;
      continue;
    }
    if (!response.ok) {
      clearTimeout(timer);
      await response.body?.cancel();
      return {
        error: response.status === 404 || response.status === 410
          ? "The calendar is not at that address any more."
          : response.status === 401 || response.status === 403
            ? "The calendar refused — it may be private. Use its secret iCal address."
            : `The calendar answered with an error (${response.status}).`,
      };
    }
    // Read by hand so a huge body is abandoned rather than buffered.
    const reader = response.body?.getReader();
    if (!reader) {
      clearTimeout(timer);
      return { error: "The calendar sent nothing back." };
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_BYTES) {
          await reader.cancel();
          return { error: "That calendar is too large to read (over 5 MB)." };
        }
        chunks.push(value);
      }
    } catch {
      return { error: "The calendar stopped answering part-way through." };
    } finally {
      clearTimeout(timer);
    }
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) {
      bytes.set(c, at);
      at += c.length;
    }
    return { text: new TextDecoder("utf-8").decode(bytes) };
  }
  return { error: "The calendar address redirects too many times." };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = (await req.json().catch(() => ({}))) as { subscription_id?: string; force?: boolean };

    const asCaller = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
    );
    const {
      data: { user },
    } = await asCaller.auth.getUser();
    if (!user) return json(401, { error: "not signed in" });

    // THE CALLER'S OWN VIEW decides which subscriptions exist for them.
    let query = asCaller
      .from("calendar_subscriptions")
      .select("id, org_id, name, last_fetched_at")
      .eq("is_active", true)
      .eq("has_url", true)
      .order("created_at");
    if (body.subscription_id) query = query.eq("id", body.subscription_id);
    const { data: subscriptions, error: listError } = await query;
    if (listError) return json(400, { error: listError.message });

    const service = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const results: { id: string; name: string; state: string; events?: number; error?: string }[] = [];
    const zones = new Map<string, string>();

    for (const sub of subscriptions ?? []) {
      const last = sub.last_fetched_at ? Date.parse(sub.last_fetched_at as string) : 0;
      if (!body.force && Date.now() - last < FRESH_MS) {
        results.push({ id: sub.id, name: sub.name, state: "fresh" });
        continue;
      }

      const fail = async (message: string) => {
        await service
          .from("calendar_subscriptions")
          .update({ last_error: message, last_fetched_at: new Date().toISOString() })
          .eq("id", sub.id);
        results.push({ id: sub.id, name: sub.name, state: "error", error: message });
      };

      const { data: secret } = await service
        .from("calendar_subscription_urls")
        .select("url")
        .eq("subscription_id", sub.id)
        .maybeSingle();
      if (!secret?.url) {
        await fail("No address has been set for this calendar.");
        continue;
      }

      let timeZone = zones.get(sub.org_id);
      if (!timeZone) {
        const { data: org } = await service.from("orgs").select("settings").eq("id", sub.org_id).maybeSingle();
        timeZone = ((org?.settings as { timezone?: string } | null)?.timezone || "UTC") as string;
        zones.set(sub.org_id, timeZone);
      }

      const fetched = await fetchCalendar(secret.url as string);
      if ("error" in fetched) {
        await fail(fetched.error);
        continue;
      }

      const today = todayIn(timeZone);
      let expanded: ReturnType<typeof expandFeed>;
      try {
        expanded = expandFeed(ICAL, fetched.text, {
          from: addDays(today, -DAYS_BACK),
          to: addDays(today, DAYS_AHEAD),
          timeZone,
        });
      } catch {
        // Never the parser's own message: it can quote the file.
        await fail("That address did not return a calendar. Check it is the iCal address, not the web page.");
        continue;
      }

      // REPLACE WHOLE. Delete then insert, in batches; if the insert fails the
      // subscription says so, and the next read puts it right.
      const { error: deleteError } = await service
        .from("calendar_subscription_events")
        .delete()
        .eq("subscription_id", sub.id);
      if (deleteError) {
        await fail("The calendar was read but could not be saved.");
        continue;
      }
      const rows = expanded.occurrences.map((o) => ({
        org_id: sub.org_id,
        subscription_id: sub.id,
        uid: o.uid.slice(0, 500),
        starts_on: o.starts_on,
        ends_on: o.ends_on,
        start_time: o.start_time,
        title: o.title.slice(0, 300),
        place: o.place ? o.place.slice(0, 300) : null,
      }));
      let saved = true;
      for (let i = 0; i < rows.length && saved; i += 500) {
        const { error: insertError } = await service
          .from("calendar_subscription_events")
          .insert(rows.slice(i, i + 500));
        if (insertError) saved = false;
      }
      if (!saved) {
        await fail("The calendar was read but could not be saved.");
        continue;
      }

      await service
        .from("calendar_subscriptions")
        .update({
          last_fetched_at: new Date().toISOString(),
          last_error: expanded.truncated
            ? "This calendar has more events than can be shown; the first 2,000 are."
            : null,
        })
        .eq("id", sub.id);
      results.push({ id: sub.id, name: sub.name, state: "ok", events: rows.length });
    }

    return json(200, { results });
  } catch (e) {
    console.error("calendar-sync", e instanceof Error ? e.message : String(e));
    return json(200, { results: [], error: "calendar-sync failed" });
  }
});
