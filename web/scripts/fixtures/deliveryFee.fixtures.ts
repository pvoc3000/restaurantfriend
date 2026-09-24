// `supabase/functions/_shared/deliveryFee.ts` — the inquiry form's delivery
// estimate (4b): base + per mile × driving miles from one shop, up to a max.

import { test, eq, ok, no } from "./harness";
import {
  deliveryConfigured,
  deliveryFee,
  originAddress,
  readDeliveryConfig,
  METERS_PER_MILE,
} from "../../../supabase/functions/_shared/deliveryFee";

const cfg = readDeliveryConfig({ origin_location_id: "df01", base_fee: 20, per_mile: 2.5, max_miles: 25 });

test("deliveryFee: base + rate × miles, miles rounded to a tenth first", () => {
  // 8.43 mi → 8.4 → 20 + 21.00
  eq(deliveryFee(8.43 * METERS_PER_MILE, cfg), { state: "ok", miles: 8.4, fee: 41 });
  eq(deliveryFee(0, cfg), { state: "ok", miles: 0, fee: 20 });
});

test("deliveryFee: the maximum is inclusive; beyond it there is no fee", () => {
  eq(deliveryFee(25 * METERS_PER_MILE, cfg).state, "ok");
  eq(deliveryFee(25.2 * METERS_PER_MILE, cfg), { state: "outside_area", miles: 25.2 });
});

test("deliveryFee: no maximum means every distance is priced; no base is zero", () => {
  const open = readDeliveryConfig({ origin_location_id: "x", per_mile: 3 });
  eq(deliveryFee(100 * METERS_PER_MILE, open), { state: "ok", miles: 100, fee: 300 });
});

test("configured only with a shop AND a per-mile rate", () => {
  ok(deliveryConfigured(cfg));
  no(deliveryConfigured(readDeliveryConfig({ origin_location_id: "x", base_fee: 20 })));
  no(deliveryConfigured(readDeliveryConfig({ per_mile: 2 })));
  no(deliveryConfigured(readDeliveryConfig(null)));
});

test("readDeliveryConfig: numeric strings read, junk and negatives drop", () => {
  eq(readDeliveryConfig({ base_fee: "15", per_mile: "abc", max_miles: -3, origin_location_id: " " }), {
    origin_location_id: null,
    base_fee: 15,
    per_mile: null,
    max_miles: null,
  });
});

test("originAddress: the SHIPPING address (the shop), not billing (the office)", () => {
  const addr = {
    billing: { street1: "543 S Broadway", city: "Los Angeles", state: "CA", zip: "90013" },
    shipping: { street1: "5107 York Blvd", city: "Los Angeles", state: "CA", zip: "90042" },
  };
  eq(originAddress(addr), "5107 York Blvd, Los Angeles, CA 90042");
  eq(originAddress({ shipping: { city: "Los Angeles" } }), null, "no street, no route");
  eq(originAddress(null), null);
});
