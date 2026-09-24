// inquiry-delivery-quote — what delivery to an address comes to, for the
// public inquiry form's estimate (special orders 4b, Mark 2026-09-24).
//
// NO SIGNED-IN CALLER, like `submit-inquiry`, and it WRITES NOTHING: it reads
// the org's delivery settings and one shop's address with the service role,
// asks Google for the driving distance, and answers with a state, the miles
// and the fee. Never the rate, never the origin, never the key.
//
// ---------------------------------------------------------------------------
// EVERY CALL COSTS MONEY, so it is rationed three ways
// ---------------------------------------------------------------------------
// · the page asks on BLUR of the address field, never per keystroke;
// · answers are CACHED by (org, normalised address) for an hour, in memory —
//   per warm instance, which is exactly as long as the same customer is
//   fiddling with the same form;
// · a per-IP cap, also in memory. Not a wall (a cold start forgets it), but
//   the thing it stops — a script looping over addresses — is also stopped by
//   the key's own quota, which is where the real ceiling belongs.
//
// Its answers, all HTTP 200 except a malformed request:
//   { state: "ok", miles, fee } · { state: "outside_area" } ·
//   { state: "not_configured" } · { state: "address_not_found" } ·
//   { state: "busy" } · { state: "error" }
// The page shows a fee for "ok", "we'll quote it" for "outside_area", and
// "added to your quote" for everything else — so no failure here can stop
// somebody sending their inquiry.

import { createClient } from "npm:@supabase/supabase-js@2";

import { quoteDelivery, type DeliveryQuoteResult } from "../_shared/deliveryQuote.ts";

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

const CACHE_MS = 60 * 60 * 1000;
const cache = new Map<string, { at: number; result: DeliveryQuoteResult }>();

const WINDOW_MS = 10 * 60 * 1000;
const PER_IP = 20;
const seen = new Map<string, number[]>();

function allow(ip: string): boolean {
  const now = Date.now();
  const recent = (seen.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= PER_IP) {
    seen.set(ip, recent);
    return false;
  }
  recent.push(now);
  seen.set(ip, recent);
  return true;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { org_id, address } = (await req.json().catch(() => ({}))) as {
      org_id?: string;
      address?: string;
    };
    const destination = typeof address === "string" ? address.replace(/\s+/g, " ").trim() : "";
    if (!org_id || !UUID.test(org_id) || destination.length < 5 || destination.length > 300) {
      return json(400, { error: "org_id and an address are required" });
    }

    const cacheKey = `${org_id}|${destination.toLowerCase()}`;
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.at < CACHE_MS) return json(200, publicShape(hit.result));

    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
    if (!allow(ip)) return json(200, { state: "busy" });

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const result = await quoteDelivery(admin, org_id, destination);
    if (result.state === "error") {
      // Ours, not the customer's — logged for whoever reads the function's
      // logs, and never cached, so fixing the key fixes the next call.
      console.error("inquiry-delivery-quote", result.detail);
    } else {
      cache.set(cacheKey, { at: Date.now(), result });
    }
    return json(200, publicShape(result));
  } catch (e) {
    console.error("inquiry-delivery-quote", e instanceof Error ? e.message : String(e));
    return json(200, { state: "error" });
  }
});

/** Only what a customer may see. `outside_area` drops its miles on purpose:
 *  "we'll quote it" is the whole answer. */
function publicShape(r: DeliveryQuoteResult): Record<string, unknown> {
  if (r.state === "ok") return { state: "ok", miles: r.miles, fee: r.fee };
  return { state: r.state };
}
