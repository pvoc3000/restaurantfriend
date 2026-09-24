// The delivery estimate's network half: read the org's delivery settings and
// the origin shop's address, ask Google for the DRIVING distance, and price it
// with `deliveryFee.ts`. Shared by `inquiry-delivery-quote` (what the form
// shows) and `submit-inquiry` (what the lead is written with), so the two can
// only disagree if Google does.
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

export type DeliveryQuoteResult =
  | { state: "ok"; miles: number; fee: number }
  | { state: "outside_area"; miles: number }
  | { state: "not_configured" }
  | { state: "address_not_found" }
  | { state: "error"; detail: string };

export async function quoteDelivery(
  admin: SupabaseClient,
  orgId: string,
  destination: string
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

  const { data: shop } = await admin
    .from("locations")
    .select("address")
    .eq("id", cfg.origin_location_id!)
    .eq("org_id", orgId)
    .maybeSingle();
  const origin = originAddress(shop?.address);
  if (!origin) return { state: "not_configured" };

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
  return deliveryFee(meters, cfg);
}
