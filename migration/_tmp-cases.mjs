import { createClient } from "@supabase/supabase-js";
import { proposeOvertime } from "../web/.fixtures-build/src/lib/overtime.js";
import { workedHours } from "../web/.fixtures-build/src/lib/timesheets.js";
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const TZ = "America/Los_Angeles";
const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, hour12:false, year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit" });
const local = (iso) => { const p = Object.fromEntries(fmt.formatToParts(new Date(iso)).filter(x=>x.type!=="literal").map(x=>[x.type,x.value])); const h = p.hour==="24"?"00":p.hour; return { date:`${p.year}-${p.month}-${p.day}`, min:Number(h)*60+Number(p.minute), hhmm:`${h}:${p.minute}` }; };
const addDays=(d,n)=>{const t=new Date(d+"T12:00:00Z");t.setUTCDate(t.getUTCDate()+n);return t.toISOString().slice(0,10);};
const mondayOf=(d)=>{const t=new Date(d+"T12:00:00Z");return addDays(d,-((t.getUTCDay()+6)%7));};

let rows=[],from=0;
for(;;){const{data,error}=await db.from("timesheets").select("id, employee_id, workday, workweek_start, clock_in, clock_out, unpaid_break_minutes, source_hours_overtime, source_hours_double_ot").order("id").range(from,from+999);if(error)throw error;rows=rows.concat(data);if(data.length<1000)break;from+=1000;}
const{data:emps}=await db.from("employees").select("id, first_name, last_name, status");
const name=Object.fromEntries(emps.map(e=>[e.id,`${e.first_name} ${e.last_name}`]));
const active=Object.fromEntries(emps.map(e=>[e.id,e.status]));

function build(b){return rows.map(r=>{const h=workedHours(r)??0;let wd=r.workday;if(b!==null&&r.clock_in){const l=local(r.clock_in);wd=l.min>=b?addDays(l.date,1):l.date;}return{id:r.id,employee_id:r.employee_id,workday:wd,workweek_start:b===null?r.workweek_start:mondayOf(wd),hours:h,starts_at:r.clock_in};}).filter(s=>s.hours>0);}
const base=proposeOvertime(build(null));
const alt=proposeOvertime(build(21*60));

const byId=Object.fromEntries(rows.map(r=>[r.id,r]));
const changed=[];
for(const[id,v]of alt){const o=base.get(id);if(!o)continue;const d=(v.overtime+v.double_ot)-(o.overtime+o.double_ot);if(Math.abs(d)>=0.015)changed.push({id,d,o,v,r:byId[id]});}
changed.sort((a,b)=>a.r.workday<b.r.workday?1:-1);
console.log(`\n=== boundary 21:00 — shifts whose premium changes, 2026 only ===`);
for(const c of changed.filter(x=>x.r.workday>="2026-01-01")){
  const i=local(c.r.clock_in),o2=local(c.r.clock_out);
  console.log(`${c.r.workday} ${String(name[c.r.employee_id]).padEnd(24)} ${i.hhmm}→${o2.hhmm}  now OT ${c.o.overtime.toFixed(2)}/DT ${c.o.double_ot.toFixed(2)}  →  OT ${c.v.overtime.toFixed(2)}/DT ${c.v.double_ot.toFixed(2)}   Δ${c.d>0?"+":""}${c.d.toFixed(2)}`);
}
const upPeople=new Set(changed.filter(x=>x.d>0).map(x=>name[x.r.employee_id]));
console.log(`\nshifts gaining premium under 21:00 (all years): ${changed.filter(x=>x.d>0).length} — ${[...upPeople].join(", ")}`);
console.log(`shifts losing premium: ${changed.filter(x=>x.d<0).length}`);
