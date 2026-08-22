import { createClient } from "@supabase/supabase-js";
const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const TZ="America/Los_Angeles";
const f=new Intl.DateTimeFormat("en-CA",{timeZone:TZ,hour12:false,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"});
const L=(iso)=>{const p=Object.fromEntries(f.formatToParts(new Date(iso)).filter(x=>x.type!=="literal").map(x=>[x.type,x.value]));const h=p.hour==="24"?"00":p.hour;return{date:`${p.year}-${p.month}-${p.day}`,min:Number(h)*60+Number(p.minute)};};
const addDays=(d,n)=>{const t=new Date(d+"T12:00:00Z");t.setUTCDate(t.getUTCDate()+n);return t.toISOString().slice(0,10);};
const hm=(m)=>`${String(Math.floor(m/60)).padStart(2,"0")}:${String(m%60).padStart(2,"0")}`;
const REST_H=8;

// Label the workday by the calendar date the BULK of it falls on:
//   evening boundary (>=12:00): [D B, D+1 B) is mostly D+1  -> label d+1 when t>=B
//   morning boundary (< 12:00): [D B, D+1 B) is mostly D    -> label d-1 when t< B
function workdayFor(l, B){
  if(B===0) return l.date;
  if(B>=720) return l.min>=B ? addDays(l.date,1) : l.date;
  return l.min>=B ? l.date : addDays(l.date,-1);
}
async function fetchAll(since){let out=[],from=0;for(;;){const{data,error}=await db.from("timesheets").select("id,employee_id,workday,clock_in,clock_out").gte("workday",since).order("id").range(from,from+999);if(error)throw error;out=out.concat(data);if(data.length<1000)break;from+=1000;}return out.filter(r=>r.clock_in&&r.clock_out);}

function score(rows,B){
  const wd=new Map(); let relabeled=0;
  for(const r of rows){const l=L(r.clock_in); const w=workdayFor(l,B); wd.set(r.id,w); if(w!==l.date) relabeled++;}
  const byEmp=new Map();
  for(const r of rows)(byEmp.get(r.employee_id)??byEmp.set(r.employee_id,[]).get(r.employee_id)).push(r);
  let fs=0,bd=0;
  for(const list of byEmp.values()){
    list.sort((a,b)=>a.clock_in<b.clock_in?-1:1);
    for(let i=1;i<list.length;i++){
      const gap=(new Date(list[i].clock_in)-new Date(list[i-1].clock_out))/36e5;
      if(gap<0)continue;
      const same=wd.get(list[i].id)===wd.get(list[i-1].id);
      if(gap>=REST_H&&same)fs++;
      if(gap<REST_H&&!same)bd++;
    }
  }
  return{fs,bd,total:fs+bd,relabeled};
}

for(const[label,since]of[["last 12 months","2025-08-22"],["last 3 years","2023-08-22"]]){
  const rows=await fetchAll(since);
  console.log(`\n=== ${label} — ${rows.length} punched shifts ===`);
  console.log(`  boundary   falseStack  brokenDbl  TOTAL   shifts relabeled`);
  const res=[];
  for(let t=0;t<1440;t+=15){const s=score(rows,t);res.push({t,s});}
  // print every hour, plus every 15 min in the two candidate windows
  for(const{t,s}of res){
    const show = t%60===0 || (t>=19*60&&t<=22*60+30) || (t>=60&&t<=5*60);
    if(!show)continue;
    const star = s.total===Math.min(...res.map(x=>x.s.total)) ? "  <<<" : "";
    console.log(`  ${hm(t)}      ${String(s.fs).padStart(4)}       ${String(s.bd).padStart(4)}    ${String(s.total).padStart(4)}      ${String(s.relabeled).padStart(5)}${star}`);
  }
  const best=Math.min(...res.map(x=>x.s.total));
  console.log(`  best total ${best} at: ${res.filter(x=>x.s.total===best).map(x=>hm(x.t)).join(", ")}`);
}
