// Run from the repo root after `npm run fixtures` (it reads the compiled orderTotals):
//   node --env-file=migration/.env migration/check-order-money-parity.cjs
// Migration 128 derives order totals in SQL for customer invoices; this checks
// special_order_money against web's orderTotals. Read-only.
// Read-only: SQL special_order_money vs TS orderTotals over real orders.
const path = require('path');
const root = process.cwd();
const { createClient } = require(require.resolve('@supabase/supabase-js', { paths: [path.join(root, 'migration')] }));
const { orderTotals } = require(path.join(root, 'web/.fixtures-build/web/src/lib/specialOrders.js'));
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  const { data: org } = await sb.from('orgs').select('settings').limit(1).single();
  const minimum = Number(org.settings?.special_orders?.rush_minimum ?? 25);
  const pick = async (q) => { const out = []; for (let f = 0; ; f += 1000) { const { data, error } = await q().range(f, f + 999); if (error) throw error; out.push(...data); if (data.length < 1000) break; } return out; };
  const recent = await pick(() => sb.from('special_orders').select('id').eq('kind', 'order').gte('event_date', '2026-01-01').order('id'));
  const older = await pick(() => sb.from('special_orders').select('id').eq('kind', 'order').lt('event_date', '2026-01-01').order('id'));
  const sample = [...recent, ...older.filter((_, i) => i % 12 === 0)].map((o) => o.id);
  let checked = 0, mismatch = [];
  for (let i = 0; i < sample.length; i += 200) {
    const ids = sample.slice(i, i + 200);
    const [{ data: orders }, { data: items }] = await Promise.all([
      sb.from('special_orders').select('id, number, tax_rate, discount_amount, discount_rate, delivery_charge, rush_fee, rush_rate').in('id', ids),
      sb.from('special_order_items').select('order_id, qty, unit_price, taxable, sort, id').in('order_id', ids).order('sort', { ascending: true, nullsFirst: false }).order('id').limit(10000),
    ]);
    for (const o of orders) {
      const lines = items.filter((l) => l.order_id === o.id);
      const t = orderTotals(o, lines, [], { cutoffBusinessDays: 2, minimum, rate: 0.3 });
      const { data: m, error } = await sb.rpc('special_order_money', { p_order: o.id });
      if (error) throw error;
      const s = m[0]; checked++;
      const keys = [['subtotal','subtotal'],['discount','discount'],['deliveryCharge','delivery'],['rushFee','rush'],['tax','tax'],['total','total']];
      const bad = keys.filter(([a, b]) => Math.abs(t[a] - Number(s[b])) >= 0.005);
      if (bad.length) mismatch.push({ number: o.number, bad: bad.map(([a, b]) => `${b} ts=${t[a]} sql=${s[b]}`).join('; ') });
    }
  }
  console.log(`checked ${checked} orders (${recent.length} from 2026 + every 12th older), mismatches: ${mismatch.length}`);
  mismatch.slice(0, 20).forEach((m) => console.log(' ', m.number, m.bad));
})().catch((e) => { console.error(e); process.exit(1); });
