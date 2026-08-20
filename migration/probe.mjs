import { createClient } from "@supabase/supabase-js";
const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
// 053
const { error: e53 } = await s.from("special_orders").select("taken_by_employee_id").limit(1);
console.log("053 · taken_by_employee_id:", e53 ? "MISSING — " + e53.message : "present");
const { error: eFn } = await s.rpc("special_order_takers", { p_org_id: "00000000-0000-0000-0000-000000000000" });
console.log("053 · special_order_takers:", eFn ? eFn.message : "returned without error");
// 054 — the triggers only show themselves by firing, so look for entries the app never wrote
const { data: ev } = await s.from("special_order_events")
  .select("message,author,happened_at,order_id").eq("source","app")
  .gte("happened_at","2026-08-19T00:00:00Z").order("happened_at",{ascending:false}).limit(15);
console.log("\nrecent app entries:", ev.length);
for (const e of ev) console.log(" ", e.happened_at.slice(0,19), "|", e.author ?? "—", "|", e.message);
