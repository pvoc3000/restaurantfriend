import { createClient } from "@supabase/supabase-js";
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const TZ = "America/Los_Angeles";
const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, hour12: false,
  year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit" });
function local(iso) {
  const p = Object.fromEntries(fmt.formatToParts(new Date(iso)).filter(x=>x.type!=="literal").map(x=>[x.type,x.value]));
  let h = p.hour === "24" ? "00" : p.hour;
  return { date: `${p.year}-${p.month}-${p.day}`, min: Number(h)*60 + Number(p.minute) };
}

const { data: org } = await db.from("orgs").select("settings").limit(1).single();
console.log("payroll settings:", JSON.stringify(org.settings.payroll ?? null), "tz:", org.settings.timezone);

// paginated, ORDERED (the audit lesson)
let rows = [], from = 0;
for (;;) {
  const { data, error } = await db.from("timesheets")
    .select("id, employee_id, workday, clock_in, clock_out, kind, source_hours_regular, source_hours_overtime, source_hours_double_ot")
    .order("id").range(from, from + 999);
  if (error) { console.log("ERR", error); break; }
  rows = rows.concat(data);
  if (data.length < 1000) break;
  from += 1000;
}
const ids = new Set(rows.map(r=>r.id));
console.log(`fetched ${rows.length}, distinct ${ids.size}  (must be equal)`);

// group by employee+workday
const days = new Map();
for (const r of rows) {
  const k = `${r.employee_id}|${r.workday}`;
  (days.get(k) ?? days.set(k, []).get(k)).push(r);
}

let multi = 0, falseDouble = 0, premiumHours = 0, affectedPeople = new Set(), byYear = new Map();
for (const [k, list] of days) {
  if (list.length < 2) continue;
  multi++;
  const punched = list.filter(r=>r.clock_in && r.clock_out).sort((a,b)=>a.clock_in<b.clock_in?-1:1);
  if (punched.length < 2) continue;
  // gap between end of one and start of next
  let maxGapH = 0;
  for (let i=1;i<punched.length;i++) {
    const gap = (new Date(punched[i].clock_in) - new Date(punched[i-1].clock_out)) / 36e5;
    if (gap > maxGapH) maxGapH = gap;
  }
  // a genuine double = back-to-back-ish. A "false" one = a full rest period between,
  // AND the later shift starts in the evening (i.e. it belongs to the NEXT workday)
  const last = punched[punched.length-1];
  const startLocal = local(last.clock_in).min;
  if (maxGapH >= 8 && startLocal >= 18*60) {
    falseDouble++;
    affectedPeople.add(list[0].employee_id);
    const prem = punched.reduce((n,r)=>n + Number(r.source_hours_overtime ?? 0) + Number(r.source_hours_double_ot ?? 0), 0);
    premiumHours += prem;
    const y = k.split("|")[1].slice(0,4);
    byYear.set(y, (byYear.get(y) ?? 0) + 1);
  }
}
console.log(`employee-workdays with 2+ shifts: ${multi}`);
console.log(`  ...of which "false double" (>=8h rest between AND later shift starts >=18:00 local): ${falseDouble}`);
console.log(`  people affected: ${affectedPeople.size}, premium hours on those days: ${premiumHours.toFixed(2)}`);
console.log("  by year:", [...byYear.entries()].sort());

// how many shifts start in the evening at all (would move under a 20:00 workday)
let evening = 0, earlyAM = 0, total = 0;
for (const r of rows) { if (!r.clock_in) continue; total++;
  const m = local(r.clock_in).min;
  if (m >= 18*60) evening++;
  if (m < 6*60) earlyAM++;
}
console.log(`shifts with a punch: ${total}; starting >=18:00 local: ${evening}; starting <06:00: ${earlyAM}`);
