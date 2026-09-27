import { createClient } from "@supabase/supabase-js";
const URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(URL, KEY, { auth: { persistSession: false } });
const { data: owner } = await admin.from("org_members").select("user_id").eq("role", "owner").limit(1).single();
const { data: u } = await admin.auth.admin.getUserById(owner.user_id);
const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: u.user.email });
const sess = await (await fetch(`${URL}/auth/v1/verify`, { method: "POST", headers: { apikey: KEY, "Content-Type": "application/json" }, body: JSON.stringify({ type: "magiclink", token_hash: link.properties.hashed_token }) })).json();
const ref = new globalThis.URL(URL).hostname.split(".")[0];
const value = "base64-" + Buffer.from(JSON.stringify(sess)).toString("base64url");
const chunks = []; for (let i = 0; i < value.length; i += 3180) chunks.push(value.slice(i, i + 3180));
const cookie = chunks.length === 1 ? `sb-${ref}-auth-token=${value}` : chunks.map((c, i) => `sb-${ref}-auth-token.${i}=${c}`).join("; ");
try {
  for (const [p, want] of JSON.parse(process.env.PAGES)) {
    const r = await fetch(`http://localhost:3000${p}`, { headers: { Cookie: cookie }, redirect: "manual" });
    const html = await r.text();
    const text = html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
    const err = /Could not load|Unhandled Runtime Error|Application error|"digest"/i.exec(html);
    console.log(`\n== ${p} → ${r.status}${err ? " !! " + err[0] : ""}`);
    for (const w of want) { const i = text.indexOf(w); console.log(i >= 0 ? `   · ${text.slice(i, i + 200)}` : `   ✗ missing: ${w}`); }
  }
} finally {
  await fetch(`${URL}/auth/v1/logout?scope=local`, { method: "POST", headers: { apikey: KEY, Authorization: `Bearer ${sess.access_token}` } });
  console.log("\nsession signed out");
}
