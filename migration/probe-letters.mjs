import { createClient } from "@supabase/supabase-js";
const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
async function all(table, cols, order) {
  const out = []; let from = 0;
  for (;;) {
    const { data, error } = await s.from(table).select(cols).order(order).range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...data); if (data.length < 1000) break; from += 1000;
  }
  return out;
}
const lines = await all("special_order_items", "item_cut", "id");
const letters = lines.filter(l => /^letter/i.test(l.item_cut ?? ""));
// extract whatever is inside the quotes
const m = new Map();
let bare = 0, unparsed = [];
for (const l of letters) {
  const g = /"+([^"]*)"*\s*$/.exec(l.item_cut.replace(/^letter/i, "").trim());
  if (!l.item_cut.includes('"')) { bare++; continue; }
  if (g && g[1]) m.set(g[1], (m.get(g[1]) ?? 0) + 1);
  else unparsed.push(l.item_cut);
}
console.log("letter lines:", letters.length, " bare 'Letter':", bare, " unparsed:", unparsed.length);
const sorted = [...m.entries()].sort((a,b)=>b[1]-a[1]);
console.log("distinct chars:", sorted.length);
console.log(JSON.stringify(sorted));
console.log("unparsed samples:", JSON.stringify([...new Set(unparsed)].slice(0,20)));
// case-insensitive fold
const f = new Map();
for (const [k,v] of m) { const u = k.toUpperCase(); f.set(u, (f.get(u)??0)+v); }
console.log("\nfolded upper:", JSON.stringify([...f.entries()].sort((a,b)=>b[1]-a[1])));
