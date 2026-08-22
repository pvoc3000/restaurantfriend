import { createClient } from "@supabase/supabase-js";
import { proposeOvertime } from "../web/.fixtures-build/src/lib/overtime.js";
import { workedHours } from "../web/.fixtures-build/src/lib/timesheets.js";

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const TZ = "America/Los_Angeles";
const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, hour12: false, year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit" });
function local(iso) {
  const p = Object.fromEntries(fmt.formatToParts(new Date(iso)).filter(x=>x.type!=="literal").map(x=>[x.type,x.value]));
  const h = p.hour === "24" ? "00" : p.hour;
  return { date: `${p.year}-${p.month}-${p.day}`, min: Number(h)*60 + Number(p.minute) };
}
const addDays = (d, n) => { const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate()+n); return t.toISOString().slice(0,10); };
const mondayOf = (d) => { const t = new Date(d + "T12:00:00Z"); const dow = (t.getUTCDay() + 6) % 7; return addDays(d, -dow); };

let rows = [], from = 0;
for (;;) {
  const { data, error } = await db.from("timesheets")
    .select("id, employee_id, workday, workweek_start, clock_in, clock_out, unpaid_break_minutes, kind, source_hours_overtime, source_hours_double_ot")
    .order("id").range(from, from + 999);
  if (error) throw error;
  rows = rows.concat(data); if (data.length < 1000) break; from += 1000;
}
console.log(`rows ${rows.length}, distinct ${new Set(rows.map(r=>r.id)).size}`);

function build(boundaryMin) {
  return rows.map(r => {
    const hours = workedHours(r) ?? 0;
    let workday = r.workday;
    if (boundaryMin !== null && r.clock_in) {
      const l = local(r.clock_in);
      workday = l.min >= boundaryMin ? addDays(l.date, 1) : l.date;
    }
    return { id: r.id, employee_id: r.employee_id, workday,
      workweek_start: boundaryMin === null ? r.workweek_start : mondayOf(workday),
      hours, starts_at: r.clock_in };
  }).filter(s => s.hours > 0);
}
function totals(shifts) {
  const p = proposeOvertime(shifts);
  let ot=0, dot=0; const per = new Map();
  for (const [id, v] of p) { ot += v.overtime; dot += v.double_ot; per.set(id, v); }
  return { ot, dot, per };
}

const base = totals(build(null));
console.log(`\nCURRENT (midnight workday):  OT ${base.ot.toFixed(2)}h   double ${base.dot.toFixed(2)}h`);

for (const b of [17,18,19,20,21,22]) {
  const alt = totals(build(b*60));
  let moved = 0, up = 0, down = 0;
  for (const [id, v] of alt.per) {
    const o = base.per.get(id); if (!o) continue;
    const d = (v.overtime + v.double_ot) - (o.overtime + o.double_ot);
    if (Math.abs(d) >= 0.015) { moved++; if (d > 0) up++; else down++; }
  }
  console.log(`boundary ${String(b).padStart(2,"0")}:00 → OT ${alt.ot.toFixed(2)}h  double ${alt.dot.toFixed(2)}h   | shifts changed ${moved} (more premium ${up}, less ${down})  Δpremium ${((alt.ot+alt.dot)-(base.ot+base.dot)).toFixed(2)}h`);
}
