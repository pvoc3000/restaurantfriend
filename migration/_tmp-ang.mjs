import { createClient } from "@supabase/supabase-js";
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: emp } = await db.from("employees").select("id, first_name, last_name, homebase_id")
  .ilike("last_name", "%castellanos%");
console.log("employees:", emp);
const ids = (emp ?? []).map(e => e.id);

const { data: rows, error } = await db.from("timesheets")
  .select("id, employee_id, workday, business_date, workweek_start, clock_in, clock_out, unpaid_break_minutes, sick_hours, kind, source_hours_regular, source_hours_overtime, source_hours_double_ot, source_hours_paid, hours_regular, hours_overtime, hours_double_ot, ot_decision, ot_reason, location_id, position, source_payload")
  .in("employee_id", ids)
  .gte("workday", "2026-08-03")
  .order("clock_in");
if (error) console.log("err", error);
for (const r of rows ?? []) {
  console.log(JSON.stringify({
    wd: r.workday, bd: r.business_date, ww: r.workweek_start,
    in: r.clock_in, out: r.clock_out, brk: r.unpaid_break_minutes,
    src: [r.source_hours_regular, r.source_hours_overtime, r.source_hours_double_ot, r.source_hours_paid],
    ours: [r.hours_regular, r.hours_overtime, r.hours_double_ot],
    dec: r.ot_decision, reason: r.ot_reason, pos: r.position,
  }));
}
