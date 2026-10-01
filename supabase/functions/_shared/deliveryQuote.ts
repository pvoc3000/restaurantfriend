// The delivery estimate's network half: read the org's delivery settings and
// the origin shop's address, ask Google for the DRIVING distance, and price it
// with `deliveryFee.ts`. Shared by `inquiry-delivery-quote` (what the form
// shows) and `submit-inquiry` (what the lead is written with), so the two can
// only disagree if Google does.
//
// THE ORIGIN IS THE KITCHEN (Mark, 2026-10-01: "delivery should be measured
// from the kitchen location, not a set location the user chooses in
// settings"). A caller that knows the kitchen passes it as `from`. One that
// does not — the public form, before there is an order — measures from EVERY
// open shop and takes the NEAREST, and that shop becomes the lead's kitchen
// (Mark chose this over asking the customer or a default kitchen). It costs one
// request per open shop with a street address: two today.
//
// Google Routes API, `computeRoutes`, one origin and one destination, field
// mask `routes.distanceMeters` — the cheapest SKU that answers the question.
// The key is `GOOGLE_MAPS_API_KEY` in the functions' secrets, never the page.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

import {
  deliveryConfigured,
  deliveryFee,
  originAddress,
  readDeliveryConfig,
} from "./deliveryFee.ts";

/** `location_id` is the shop the distance was measured FROM. */
export type DeliveryQuoteResult =
  | { state: "ok"; miles: number; fee: number; location_id: string }
  | { state: "outside_area"; miles: number; location_id: string }
  | { state: "not_configured" }
  | { state: "address_not_found" }
  | { state: "error"; detail: string };

type Leg = { state: "ok"; meters: number } | { state: "address_not_found" } | { state: "error"; detail: string };

async function drivingMeters(key: string, origin: string, destination: string): Promise<Leg> {
  const res = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "routes.distanceMeters",
    },
    body: JSON.stringify({
      origin: { address: origin },
      destination: { address: destination },
      travelMode: "DRIVE",
      units: "IMPERIAL",
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    routes?: { distanceMeters?: number }[];
    error?: { message?: string; status?: string };
  };
  if (!res.ok) {
    // Google answers an address it cannot place with 400 INVALID_ARGUMENT or
    // NOT_FOUND; anything else is ours (a bad key, a disabled API, quota).
    const status = body.error?.status ?? "";
    if (res.status === 400 || status === "NOT_FOUND" || status === "INVALID_ARGUMENT") {
      return { state: "address_not_found" };
    }
    return { state: "error", detail: body.error?.message ?? `HTTP ${res.status}` };
  }
  const meters = body.routes?.[0]?.distanceMeters;
  if (typeof meters !== "number") return { state: "address_not_found" };
  return { state: "ok", meters };
}

export async function quoteDelivery(
  admin: SupabaseClient,
  orgId: string,
  destination: string,
  /** The kitchen. Omit to measure from the nearest open shop. */
  from: string | null = null
): Promise<DeliveryQuoteResult> {
  const key = Deno.env.get("GOOGLE_MAPS_API_KEY");
  if (!key) return { state: "not_configured" };

  const { data: org, error: orgError } = await admin
    .from("orgs")
    .select("settings")
    .eq("id", orgId)
    .maybeSingle();
  if (orgError) return { state: "error", detail: orgError.message };
  const settings = (org?.settings ?? {}) as { special_orders?: { delivery?: unknown } };
  const cfg = readDeliveryConfig(settings.special_orders?.delivery);
  if (!deliveryConfigured(cfg)) return { state: "not_configured" };

  // The kitchen alone, or every open physical shop — the same set
  // `inquiry_price_location` will accept as a price location.
  let query = admin
    .from("locations")
    .select("id, address")
    .eq("org_id", orgId)
    .eq("is_active", true)
    .eq("kind", "physical");
  if (from) query = query.eq("id", from);
  const { data: shops, error: shopError } = await query;
  if (shopError) return { state: "error", detail: shopError.message };
  const origins = (shops ?? [])
    .map((s) => ({ id: s.id as string, address: originAddress(s.address) }))
    .filter((s): s is { id: string; address: string } => s.address !== null);
  if (origins.length === 0) return { state: "not_configured" };

  const legs = await Promise.all(origins.map((o) => drivingMeters(key, o.address, destination)));
  let best = -1;
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    if (leg.state !== "ok") continue;
    const held = legs[best];
    if (best < 0 || (held.state === "ok" && leg.meters < held.meters)) best = i;
  }
  const nearest = legs[best];
  if (best < 0 || nearest.state !== "ok") {
    // Every leg failed. An unplaceable address fails them all alike; anything
    // else is reported as the first error.
    const err = legs.find((l) => l.state === "error");
    return err && err.state === "error" ? err : { state: "address_not_found" };
  }
  const id = origins[best].id;
  const meters = nearest.meters;
  return { ...deliveryFee(meters, cfg), location_id: id };
}
