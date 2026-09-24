// WHAT A DELIVERY COMES TO — the inquiry form's estimate (Mark, 2026-09-24:
// "Delivery estimate would be amazing if we can pull it off", priced "per mile
// from the shop").
//
// base fee + per-mile rate × DRIVING miles from one origin shop, up to a
// maximum distance, from `orgs.settings.special_orders.delivery`. Beyond the
// maximum there is no number at all — the form says "we'll quote it", because
// a figure for somewhere we may not go is a promise.
//
// This reverses the special-orders brief's kill-list line "distance stays a
// hand-entered pair": the ESTIMATE is computed; the order's own
// `delivery_charge` is still a field a person edits.
//
// PURE, NO DENO APIS AND NO IMPORTS, so `web/scripts/fixtures` compiles and
// tests this very file (`squareOrder.ts`'s arrangement).

export type DeliveryConfig = {
  origin_location_id: string | null;
  base_fee: number | null;
  per_mile: number | null;
  max_miles: number | null;
};

/** Read defensively — settings are typed by hand in a jsonb editor. */
export function readDeliveryConfig(raw: unknown): DeliveryConfig {
  const r = (raw ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => {
    const x = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
    return typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : null;
  };
  const id = typeof r.origin_location_id === "string" && r.origin_location_id.trim() ? r.origin_location_id : null;
  return {
    origin_location_id: id,
    base_fee: num(r.base_fee),
    per_mile: num(r.per_mile),
    max_miles: num(r.max_miles),
  };
}

/** An estimate is only offered once a shop and a per-mile rate are set — the
 *  same test `inquiry_menu`'s `delivery_estimate` flag makes. */
export function deliveryConfigured(cfg: DeliveryConfig): boolean {
  return cfg.origin_location_id !== null && cfg.per_mile !== null;
}

export const METERS_PER_MILE = 1609.344;

export type DeliveryFee =
  | { state: "ok"; miles: number; fee: number }
  | { state: "outside_area"; miles: number };

/**
 * The fee for a distance. Miles are rounded to a tenth BEFORE pricing, so the
 * figure the customer sees ("8.4 mi") times the rate is the fee they see —
 * pricing the unrounded distance would put a cent's disagreement on the page.
 */
export function deliveryFee(meters: number, cfg: DeliveryConfig): DeliveryFee {
  const miles = Math.round((meters / METERS_PER_MILE) * 10) / 10;
  if (cfg.max_miles !== null && miles > cfg.max_miles) return { state: "outside_area", miles };
  const fee = Math.round(((cfg.base_fee ?? 0) + (cfg.per_mile ?? 0) * miles) * 100) / 100;
  return { state: "ok", miles, fee };
}

/** "5107 York Blvd, Los Angeles, CA 90042" from `locations.address.shipping`
 *  (the shop's street address; `billing` is the office). Null when there is
 *  no street to route from. */
export function originAddress(address: unknown): string | null {
  const a = ((address ?? {}) as Record<string, unknown>).shipping as Record<string, unknown> | undefined;
  if (!a) return null;
  const s = (k: string) => (typeof a[k] === "string" ? (a[k] as string).trim() : "");
  const street = [s("street1"), s("street2")].filter(Boolean).join(" ");
  if (!street) return null;
  const tail = [s("state"), s("zip")].filter(Boolean).join(" ");
  return [street, s("city"), tail].filter(Boolean).join(", ");
}
