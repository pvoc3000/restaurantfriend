// order-delivery-distance — the order screen's delivery distance (Mark,
// 2026-10-01: "calculate delivery distance on the order screen too").
//
// Measures the DRIVING distance from the order's KITCHEN to its delivery
// address with `_shared/deliveryQuote` — the same helper the website inquiry
// uses, so the two can only disagree if Google does — and writes it onto the
// order.
//
// EVERYTHING RUNS AS THE CALLER. The order, the org's rates and the kitchen's
// address are read through the caller's own session, and the write is a plain
// update under their RLS, so this function can change nothing the person
// pressing the button could not change by typing. No service_role key.
//
// THE DISTANCE IS ALWAYS REPLACED; THE CHARGE ONLY WHEN IT IS EMPTY. A new
// address makes the old distance wrong, so it goes. The charge is a price
// somebody may have typed or quoted, and the website estimate's rule (fill an
// empty one, never overwrite) is the one that keeps a quoted price from moving
// under a customer.

import { createClient } from "npm:@supabase/supabase-js@2";

import { quoteDelivery } from "../_shared/deliveryQuote.ts";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { order_id } = (await req.json().catch(() => ({}))) as { order_id?: string };
    if (!order_id) return json(400, { error: "missing order_id" });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } }
    );
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return json(401, { error: "not signed in" });

    const { data: order, error: orderError } = await supabase
      .from("special_orders")
      .select("id, org_id, kitchen_location_id, delivery_address, delivery_charge")
      .eq("id", order_id)
      .maybeSingle();
    if (orderError) return json(400, { error: orderError.message });
    if (!order) return json(404, { error: "order not found" });

    const address = ((order.delivery_address as string | null) ?? "").replace(/\s+/g, " ").trim();
    if (address.length < 5) return json(200, { state: "no_address" });
    if (!order.kitchen_location_id) return json(200, { state: "no_kitchen" });

    const result = await quoteDelivery(supabase, order.org_id, address, order.kitchen_location_id);
    if (result.state === "error") {
      console.error("order-delivery-distance", result.detail);
      return json(200, { state: "error" });
    }
    if (result.state !== "ok" && result.state !== "outside_area") {
      return json(200, { state: result.state });
    }

    const fillCharge = result.state === "ok" && order.delivery_charge === null;
    const { data: written, error: writeError } = await supabase
      .from("special_orders")
      .update({
        delivery_distance: result.miles,
        ...(fillCharge ? { delivery_charge: result.fee } : {}),
      })
      .eq("id", order.id)
      .select("id");
    if (writeError) return json(400, { error: writeError.message });
    // A zero-row update is RLS saying no without an error.
    if (!written || written.length === 0) {
      return json(403, { error: "You can't change this order's delivery." });
    }

    return json(200, {
      state: result.state,
      miles: result.miles,
      fee: result.state === "ok" ? result.fee : null,
      charge_set: fillCharge,
    });
  } catch (e) {
    console.error("order-delivery-distance", e instanceof Error ? e.message : String(e));
    return json(200, { state: "error" });
  }
});
