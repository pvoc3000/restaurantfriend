#!/usr/bin/env node
/**
 * Restaurant Friend — FMP Special Orders → special-orders.json (migration 051).
 *
 *   node transform-special-orders.mjs           # dry run, prints the report
 *   node transform-special-orders.mjs --write   # writes ../../FMP Export/transformed/
 *
 * Four source files into five tables. Run `transform-production-items.mjs`
 * first if you want the item links resolved — this reads its output to check
 * that `menuItemKey_n` really is a production item id (it is; see below), but
 * the LOADER is what resolves them against the live database.
 *
 * ---------------------------------------------------------------------------
 * THE FIVE THINGS THIS SCRIPT IS FOR
 *
 * 1. SPLITTING KIND FROM STATUS. FileMaker's `Order_Type` holds a workflow
 *    ladder (Lead/Quote/Invoice/Order/Cancelled), two kinds of record
 *    (Standing Order, Template) and a provenance (Square Online) in one field.
 *    Decision 3. Junk values ('order', '=="', empty) derive a status from the
 *    stage dates rather than defaulting to `lead`, because an order with a
 *    paid invoice is not a lead however badly its type field is spelled.
 *
 * 2. READING BOTH ERAS OF ITEMS. `VersionNumber_n = "2"` marks the Aug-2021
 *    rebuild. Before it, items live in 20-slot GS-separated repeating fields
 *    (27,445 materialized slots over 5,198 orders); after it, in OrderItems
 *    rows (20,605). Where an order has BOTH — 35 of them — OrderItems wins.
 *
 * 3. SYNTHESIZING THE MISSING PAYMENTS. Payment ROWS exist only since Mar
 *    2022. 6,430 orders carry a nonzero `Spent_c` and 5,267 of them have no
 *    rows, so each gets ONE synthetic payment — otherwise the unpaid/overdue
 *    filters would report twelve years of settled orders as outstanding.
 *
 * 4. PARSING THE LOG. `History_Notes` is one text blob per order, entries
 *    separated by VT (0x0B), and it has THREE formats plus continuation
 *    lines. 106,373 entries over 7,597 orders.
 *
 * 5. REPORTING THE MONEY RATHER THAN RECONCILING IT. Decision 6 stores only
 *    the inputs. This diffs what the lines now derive against what FileMaker
 *    stored and reports the gap — era arithmetic and hand edits are expected,
 *    and pretending otherwise would mean writing a total.
 *
 * ---------------------------------------------------------------------------
 * MEASURED CORRECTIONS TO THE BRIEF (each one is in migration 051's header too)
 *
 *   · `OrderID` IS TEXT: 2899-01, 3932 cont., 5689a, 5542b, 7220a …
 *   · There is ONE duplicated number (6002), not five — the brief's other four
 *     were `parseInt` collapsing the suffixed numbers above. Both 6002 rows
 *     are different orders and both migrate.
 *   · `Notes_Invoice` is boilerplate on 8,052 of 8,060 rows and does NOT
 *     migrate as a per-order note; it is the invoice footer, in org settings.
 *   · `menuItemKey_n` IS a production item id — checked, not assumed: over the
 *     20,518 lines whose key matches, the line's own donut name agrees with
 *     the production item's name on 19,482 and the SIZE agrees on 19,497 of
 *     19,520. So migrated lines carry `production_item_id` and history is
 *     schedulable, which the brief did not expect.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, process.env.MER_DIR ?? '../../FMP Export/Special Orders');
const DATA = resolve(HERE, process.env.DATA_DIR ?? '../../FMP Export/transformed');
const OUT = resolve(DATA, 'special-orders.json');
const PRODUCTION_ITEMS = resolve(DATA, 'production-items.json');
const APPLY = process.argv.includes('--write');

/** FileMaker's two in-field separators. GS separates repeating slots, VT is
 *  the in-field return — both appear inside ordinary CSV fields. */
const GS = String.fromCharCode(0x1d);
const VT = String.fromCharCode(0x0b);

/* ========================================================================== */
/* Parsing                                                                    */
/* ========================================================================== */

function parseCSV(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function table(name, label) {
  const path = resolve(SRC, name);
  if (!existsSync(path)) { console.error(`No ${path}`); process.exit(1); }
  const all = parseCSV(readFileSync(path, 'utf8')).filter((r) => r.some((c) => c.trim() !== ''));
  const header = all[0].map((h) => h.trim());
  const rows = [], malformed = [];
  for (const [i, r] of all.slice(1).entries()) {
    if (r.length !== header.length) { malformed.push({ line: i + 2, width: r.length }); continue; }
    const o = {};
    header.forEach((h, j) => { o[h] = r[j]; });
    rows.push(o);
  }
  console.log(`  ${label}: ${rows.length} rows, ${header.length} columns` +
    (malformed.length ? `, ${malformed.length} MALFORMED (skipped)` : ''));
  return { rows, header, malformed };
}

/* ========================================================================== */
/* Field readers                                                              */
/* ========================================================================== */

/** Trimmed text, or null. Strips the wrapping double quotes FileMaker leaves
 *  on some values ("DeliverLA" on 357 rows) and treats a VT-only cell as empty
 *  — one customer's Company is a bare vertical tab. */
function text(v) {
  let s = (v ?? '').replace(//g, '\n').trim();
  if (!s) return null;
  if (s.length > 1 && s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1).trim();
  return s || null;
}

/** M/D/YYYY (and the four rows spelled with . or -) → ISO. `?` and anything
 *  else → null, counted by the caller. */
function date(v) {
  const s = (v ?? '').trim();
  if (!s) return null;
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (!m) return undefined;                       // undefined = unparsable, vs null = absent
  const [, mo, d, y] = m;
  const iso = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  // Round-trip, because new Date("2026-02-31") rolls over rather than failing
  // — lib/invoiceExtraction's lesson, and this file has 8,259 chances to hit it.
  const probe = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(probe.getTime()) || probe.toISOString().slice(0, 10) !== iso) return undefined;
  return iso;
}

/** "8 AM" · "10:30 AM" · "12:00:00" · "14:00" → HH:MM:SS. `?` → undefined. */
function time(v) {
  const s = (v ?? '').trim();
  if (!s) return null;
  const m = /^(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*(am|pm|a|p)?\.?$/i.exec(s);
  if (!m) return undefined;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0), sec = Number(m[3] ?? 0);
  const mer = (m[4] ?? '').toLowerCase();
  if (mer.startsWith('p') && h < 12) h += 12;
  if (mer.startsWith('a') && h === 12) h = 0;
  if (h > 23 || min > 59 || sec > 59) return undefined;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/** A number, with FileMaker's `$`, commas and stray `%` stripped. */
function num(v) {
  const s = (v ?? '').replace(/[$,\s%]/g, '').trim();
  if (!s) return null;
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/** FileMaker booleans are "1" — and `Order_IgnoreBalance` has one cell reading
 *  "0\v1", a multi-value artifact. Any 1 among the values wins. */
function bool(v) {
  return (v ?? '').split(VT).some((x) => x.trim() === '1');
}

const WEEKDAY = { MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6, SUN: 7 };

/* ========================================================================== */
/* Load the four files                                                        */
/* ========================================================================== */

console.log(`Reading ${SRC}`);
const SO = table('SpecialOrders.mer', 'SpecialOrders');
const OI = table('OrderItems.mer', 'OrderItems');
const OP = table('OrderPayments.mer', 'OrderPayments');
const CU = table('Customers.mer', 'Customers');

const report = {
  malformed: [...SO.malformed, ...OI.malformed, ...OP.malformed, ...CU.malformed],
  skippedOrders: [],
  numberCollisions: [],
  unparsable: new Map(),
  statusDerived: 0,
  kindTally: new Map(),
  statusTally: new Map(),
  orphanItems: new Map(),
  orphanPayments: [],
  syntheticPayments: 0,
  paymentsDisagree: [],
  totalsDisagree: [],
  eventsUnparsed: 0,
  eventsContinued: 0,
  raggedSlots: 0,
  cappedAt20: 0,
  invoiceFooterSkipped: 0,
  noCustomer: 0,
  orphanCustomer: [],
  itemLinkMissing: 0,
};
const bad = (what) => report.unparsable.set(what, (report.unparsable.get(what) ?? 0) + 1);

/* ========================================================================== */
/* 1. CUSTOMERS — a field ALLOW-LIST, which is what keeps the card numbers out */
/* ========================================================================== */
/* `CC_Num`, `CC_Code`, `CC_Expiration` and `CC_BillingZip` are in this file in
 * plain text. They are never named below, and that is the design: a drop-list
 * would have to be maintained against every future re-export, an allow-list
 * cannot leak a column nobody added to it. Same rule as the HR transform's. */

const customers = [];
for (const r of CU.rows) {
  const legacy = text(r.CustomerID);
  if (!legacy) continue;
  const address = {
    street: text(r.Address_Street_1),
    street2: text(r.Address_Street_2),
    city: text(r.Address_City),
    state: text(r.Address_State),
    zip: text(r.Address_Zip),
    formatted: text(r.Address_Formatted),
  };
  const hasAddress = Object.values(address).some((v) => v);
  customers.push({
    legacy_id: legacy,
    first_name: text(r.First_Name),
    last_name: text(r.Last_Name),
    company: text(r.Company),
    phone: text(r.Phone_Number),
    email: text(r.Email)?.toLowerCase() ?? null,
    address: hasAddress ? address : {},
    notes: text(r.Notes),
    source: 'filemaker',
    // FMP's own calc fields ride along so a question about them is answerable
    // without the .mer. They are NOT columns — decision 6's rule, and the same
    // reason `Spent_c` is not a balance.
    source_payload: {
      fmp_num_orders: text(r.Num_Orders_c),
      fmp_spent_total: text(r.Spent_Total_c),
      fmp_balance_due: text(r.BalanceDue_c),
      fmp_modified: text(r.Record_Modified),
    },
  });
}
const CUSTOMER_IDS = new Set(customers.map((c) => c.legacy_id));

/* ========================================================================== */
/* 2. ORDERS                                                                  */
/* ========================================================================== */

/** Order_Type → {kind, status, provenance}. Decision 3. */
function classify(type) {
  const t = (type ?? '').trim().toLowerCase();
  if (t === 'standing order') return { kind: 'standing_order', status: null };
  if (t === 'template') return { kind: 'template', status: null };
  if (t === 'lead') return { kind: 'order', status: 'lead' };
  if (t === 'quote') return { kind: 'order', status: 'quote' };
  if (t === 'invoice') return { kind: 'order', status: 'invoice' };
  if (t === 'order') return { kind: 'order', status: 'order' };
  if (t === 'cancelled') return { kind: 'order', status: 'cancelled' };
  if (t === 'square online') return { kind: 'order', status: 'order', provenance: 'square_online' };
  return null;                                     // junk — the caller derives
}

/** What the stage dates say, for the 9 rows whose type is junk. Better than a
 *  blanket `lead`: an order with a paid invoice is not a lead however badly
 *  its type field is spelled. */
function statusFromDates(r) {
  if (date(r.Date_Invoice_Paid)) return 'order';
  if (date(r.Date_Invoice_Sent)) return 'invoice';
  if (date(r.Date_Quote_Sent)) return 'quote';
  return 'lead';
}

/** A row with no order number, no customer, no event and no description is a
 *  FileMaker record somebody created and abandoned. Four exist. */
function isEmptyStub(r) {
  return !text(r.OrderID) && !text(r.CustomerID) && !text(r.Event_Description) &&
         (date(r.Event_Date) ?? undefined) === undefined;
}

const seenNumber = new Map();
const orders = [];
/** number → the order KEY children attach to (the first occurrence). */
const orderByNumber = new Map();

for (const r of SO.rows) {
  if (isEmptyStub(r)) {
    report.skippedOrders.push(`empty stub created ${text(r.Record_Created) ?? '?'}`);
    continue;
  }
  const legacy = text(r.OrderID);
  if (!legacy) {
    report.skippedOrders.push(`no OrderID, created ${text(r.Record_Created) ?? '?'}`);
    continue;
  }

  const seq = (seenNumber.get(legacy) ?? 0) + 1;
  seenNumber.set(legacy, seq);
  // The suffix is only added to the SECOND and later occurrence, so 8,329 of
  // the 8,330 numbers are exactly what FileMaker shows and what a customer has
  // in their inbox.
  const number = seq === 1 ? legacy : `${legacy}-${seq}`;
  if (seq > 1) report.numberCollisions.push(`${legacy} → ${number}`);

  let cls = classify(r.Order_Type);
  if (!cls) {
    cls = { kind: 'order', status: statusFromDates(r) };
    report.statusDerived++;
  }
  report.kindTally.set(cls.kind, (report.kindTally.get(cls.kind) ?? 0) + 1);
  report.statusTally.set(cls.status ?? '(none)', (report.statusTally.get(cls.status ?? '(none)') ?? 0) + 1);

  const D = (col) => { const v = date(r[col]); if (v === undefined) { bad(col); return null; } return v; };
  const T = (col) => { const v = time(r[col]); if (v === undefined) { bad(col); return null; } return v; };
  const N = (col) => { const v = num(r[col]); if (v === undefined) { bad(col); return null; } return v; };

  const customerLegacy = text(r.CustomerID);
  if (!customerLegacy) report.noCustomer++;
  else if (!CUSTOMER_IDS.has(customerLegacy)) report.orphanCustomer.push(`${number} → customer ${customerLegacy}`);

  const standingDays = (r.Event_standingOrderDays ?? '')
    .split(VT).map((d) => WEEKDAY[d.trim().toUpperCase()]).filter(Boolean);

  const fulfillment = /delivery/i.test(r.PickupOrDelivery ?? '') ? 'delivery' : 'pickup';

  // Header note 4: the invoice footer is boilerplate, not a note.
  const invoiceNote = text(r.Notes_Invoice);
  const isFooter = invoiceNote && /^we appreciate your business!?$/i.test(invoiceNote);
  if (isFooter) report.invoiceFooterSkipped++;

  const order = {
    legacy_id: legacy,
    legacy_seq: seq,
    number,
    kind: cls.kind,
    status: cls.status,
    todo: text(r.Order_ToDo),
    flag_reason: null,      // FMP had no such field; flagging starts with the app
    customer_legacy: customerLegacy,
    contact_name: text(r.Contact_Name),
    contact_phone: text(r.Contact_Phone),
    contact_email: text(r.Contact_email)?.toLowerCase() ?? null,
    allergen_info: text(r.Allergen_Info),
    title: text(r.Event_Description),
    event_date: D('Event_Date'),
    event_time: T('Event_Time'),
    ready_by_time: T('Time_ToBeReady'),
    // Trap: `Location` is filled on only 187 recent rows because the field is
    // new in FileMaker. A null pickup shop on history is HONEST — inferring it
    // from Kitchen would put a shop on 8,147 orders that never named one.
    location_code: text(r.Location),
    kitchen_code: (() => { const k = text(r.Kitchen); return k && k !== 'Unspecified' ? k : null; })(),
    fulfillment,
    delivery_address: text(r.Event_Address),
    delivery_distance: N('Event_Distance'),
    delivery_cost: N('Delivery_Cost_c'),
    delivery_company: text(r.Delivery_Company),
    delivery_company_phone: text(r.Delivery_Company_Phone),
    delivery_tracking: text(r.Delivery_TrackingNumber),
    delivery_window_start: T('Time_DeliveryWindowStart'),
    delivery_window_end: T('Time_DeliveryWindowEnd'),
    delivery_boxes: N('Order_pkgs'),
    delivery_weight_lbs: N('Order_lbs'),
    tax_rate: N('Tax_Rate'),
    discount_amount: N('Discount_Amount'),
    discount_rate: N('Discount_Rate'),
    delivery_charge: N('Delivery_Charge'),
    rush_fee: N('Rush_Fee_c'),
    ignore_balance: bool(r.Order_IgnoreBalance),
    taken_by: text(r.OrderTakenBy),
    notes_general: text(r.Notes_General),
    notes_quote: text(r.Notes_Quote),
    notes_production: text(r.Notes_Order),
    notes_invoice: isFooter ? null : invoiceNote,
    notes_receipt: text(r.Notes_Receipt),
    standing_days: cls.kind === 'standing_order' && standingDays.length ? standingDays : null,
    // Decision 13: the 10 live standing orders migrate with starts_on NULL, and
    // THE MIGRATION MATERIALIZES NOTHING. The first top-up happens in the app,
    // after Mark has confirmed they came over right — otherwise cutover day
    // creates a week of wholesale orders nobody has checked.
    starts_on: null,
    ends_on: null,
    paused: false,
    date_initiated: D('Date_Created'),
    quote_sent_at: D('Date_Quote_Sent'),
    quote_returned_at: D('Date_Quote_Returned'),
    invoice_sent_at: D('Date_Invoice_Sent'),
    invoice_paid_at: D('Date_Invoice_Paid'),
    receipt_sent_at: D('Date_Receipt_Sent'),
    delivery_scheduled_at: D('Date_Delivery_Scheduled'),
    order_printed_at: D('Date_Order_Printed'),
    order_scheduled_at: D('Date_Order_Scheduled'),
    // Decision 12: FMP misnamed the inbound SUBJECT `Email_Token` and pasted it
    // into replies so Mail.app would thread them. We keep it as what it is.
    inbound_subject: text(r.Email_Token),
    inbound_message_id: null,
    source: 'filemaker',
    source_payload: {
      fmp_order_type: text(r.Order_Type),
      fmp_version: text(r.VersionNumber_n) ?? '1',
      provenance: cls.provenance ?? null,
      // Decision 6: the stored totals ride along, and nothing reads them.
      fmp_subtotal: text(r.Order_Subtotal), fmp_subtotal2: text(r.Order_Subtotal2),
      fmp_tax: text(r.Order_Tax), fmp_tax2: text(r.Order_Tax2),
      fmp_total: text(r.Order_Total), fmp_total2: text(r.Order_Total2),
      fmp_spent: text(r.Spent_c),
      fmp_rush_percent: text(r.Rush_Fee_percent),
      fmp_delivery_type: text(r.Delivery_Type),
      fmp_premade_schedule_id: text(r.premadeScheduleID),
      fmp_terms: text(r.Terms),
      fmp_created: text(r.Record_Created),
      fmp_modified: text(r.Record_Modified),
      raw_event_date: date(r.Event_Date) === undefined ? text(r.Event_Date) : undefined,
      raw_event_time: time(r.Event_Time) === undefined ? text(r.Event_Time) : undefined,
    },
    __v2: (text(r.VersionNumber_n) ?? '') === '2',
    __row: r,
  };
  orders.push(order);
  if (!orderByNumber.has(legacy)) orderByNumber.set(legacy, order);
}

/* ========================================================================== */
/* 3. ITEMS — OrderItems where present, repeating fields otherwise            */
/* ========================================================================== */

const itemsByOrder = new Map();
for (const r of OI.rows) {
  const k = text(r.orderNumber_n);
  if (!k) { report.orphanItems.set('(blank order number)', (report.orphanItems.get('(blank order number)') ?? 0) + 1); continue; }
  if (!orderByNumber.has(k)) { report.orphanItems.set(k, (report.orphanItems.get(k) ?? 0) + 1); continue; }
  if (!itemsByOrder.has(k)) itemsByOrder.set(k, []);
  itemsByOrder.get(k).push(r);
}

const items = [];
for (const o of orders) {
  const rows = itemsByOrder.get(o.legacy_id);

  // OrderItems WINS where present — 35 v1 orders have both, and the child rows
  // are the later, richer record.
  if (rows && o.legacy_seq === 1) {
    rows.sort((a, b) => (num(a.sortOrder_n) ?? 1e9) - (num(b.sortOrder_n) ?? 1e9));
    rows.forEach((r, i) => {
      const key = text(r.menuItemKey_n);
      if (!key) report.itemLinkMissing++;
      items.push({
        order_legacy: o.legacy_id,
        order_seq: o.legacy_seq,
        sort: num(r.sortOrder_n) ?? i + 1,
        production_item_legacy: key,
        // `itemName_t` is the CUSTOMIZED name and is what prints. Falling back
        // to the donut keeps a line that never got one from being nameless.
        name: text(r.itemName_t) ?? text(r.itemDonut_t) ?? 'Item',
        item_donut: text(r.itemDonut_t),
        item_type: normalizeItemType(text(r.itemType_t)),
        item_cut: text(r.itemCut_t),
        item_finish: text(r.itemFinish_t),
        item_size: text(r.itemSize_t),
        notes: text(r.notes_t),
        qty: num(r.quantity_n) ?? 0,
        unit_price: num(r.price_n) ?? 0,
        taxable: (r.plusTax_b ?? '').trim() === '1',
        legacy_key: text(r._PrimaryKey),
      });
    });
    continue;
  }

  // v1: the 20 GS-separated slots. A slot MATERIALIZES iff any of desc / qty /
  // price / notes is non-empty — they are ragged (33 orders carry a price with
  // no description), so keying on the description alone would drop real lines.
  const desc = (o.__row.Item_Desc ?? '').split(GS);
  const qty = (o.__row.Item_QTY ?? '').split(GS);
  const price = (o.__row.Item_Price ?? '').split(GS);
  const notes = (o.__row.Item_Notes ?? '').split(GS);
  const taxed = (o.__row.Item_Taxed ?? '').split(GS);
  let made = 0;
  for (let i = 0; i < 20; i++) {
    const cells = [desc[i], qty[i], price[i], notes[i]].map((x) => (x ?? '').trim());
    if (!cells.some(Boolean)) continue;
    if (!cells[0]) report.raggedSlots++;
    made++;
    items.push({
      order_legacy: o.legacy_id,
      order_seq: o.legacy_seq,
      sort: i + 1,
      production_item_legacy: null,   // v1 kept no key at all
      name: text(desc[i]) ?? 'Item',
      item_donut: null, item_type: null, item_cut: null, item_finish: null, item_size: null,
      notes: text(notes[i]),
      qty: num(qty[i]) ?? 0,
      unit_price: num(price[i]) ?? 0,
      // The whole field is either "Plus Tax" or empty — 22,127 and 5,318 over
      // 27,445 slots, no third value — so this needs no guessing.
      taxable: (taxed[i] ?? '').trim().toLowerCase() === 'plus tax',
      legacy_key: `${o.legacy_id}#${o.legacy_seq}#${i + 1}`,
    });
  }
  // FileMaker's own cap. 27 orders fill all twenty slots, and any line the
  // customer ordered beyond that was never in the file to migrate.
  if (made === 20) report.cappedAt20++;
}

/** Decision 5's `Misc*` rule needs a type it can test. The junk variants are
 *  four rows in 20,605 and each folds into the value it is a misspelling of. */
function normalizeItemType(t) {
  if (!t) return null;
  const s = t.trim();
  if (/^misc/i.test(s)) return s.toLowerCase() === 'misc' ? 'Misc' : s;   // keep "Misc- Cupcake liners" visible
  if (/^(raised \(nv\)|nv raised|raised \(non-vegan\))$/i.test(s)) return 'Raised (non-vegan)';
  return s;
}

/* ========================================================================== */
/* 4. PAYMENTS                                                                */
/* ========================================================================== */

const paymentsByOrder = new Map();
for (const r of OP.rows) {
  const k = text(r.OrderNumber_t);
  if (!k || !orderByNumber.has(k)) { report.orphanPayments.push(k ?? '(blank)'); continue; }
  if (!paymentsByOrder.has(k)) paymentsByOrder.set(k, []);
  paymentsByOrder.get(k).push(r);
}

const payments = [];
for (const o of orders) {
  const rows = o.legacy_seq === 1 ? paymentsByOrder.get(o.legacy_id) : undefined;
  const spent = num(o.__row.Spent_c) ?? 0;

  if (rows?.length) {
    let sum = 0;
    for (const r of rows) {
      const amount = num(r.PaymentAmount_n) ?? 0;
      sum += amount;
      payments.push({
        order_legacy: o.legacy_id,
        order_seq: o.legacy_seq,
        paid_on: date(r.PaymentDate_d) ?? null,
        amount,
        payment_type: text(r.PaymentType_t),
        note: text(r.PaymentNote_t),
        legacy_key: text(r._PrimaryKey_t),
      });
    }
    // ROWS WIN. `Spent_c` was a calc field and 1,085 orders disagree with it;
    // reconciling would mean choosing a number, which decision 6 forbids.
    if (spent && Math.abs(sum - spent) > 0.005) {
      report.paymentsDisagree.push(`${o.number}: rows ${sum.toFixed(2)} vs Spent_c ${spent.toFixed(2)}`);
    }
    continue;
  }

  // Payment ROWS only exist since Mar 2022. Without this, twelve years of
  // settled orders read as unpaid and every overdue filter is a lie.
  if (spent > 0) {
    report.syntheticPayments++;
    payments.push({
      order_legacy: o.legacy_id,
      order_seq: o.legacy_seq,
      paid_on: o.invoice_paid_at ?? o.event_date ?? null,
      amount: spent,
      payment_type: 'legacy',
      note: 'FMP paid total (no payment rows in this era)',
      legacy_key: `${o.legacy_id}#${o.legacy_seq}#spent`,
    });
  }
}

/* ========================================================================== */
/* 5. THE LOG                                                                 */
/* ========================================================================== */
/* Three formats, plus continuation lines. A line that does not begin with a
 * date is a CONTINUATION of the entry above it (2,117 of them — addresses,
 * mostly), and joining them back is the difference between a readable log and
 * a log with the second half of every address as its own mystery entry. */

const ENTRY = new RegExp(
  '^(\\d{1,2}/\\d{1,2}/\\d{4})' +          // 1 date
  '(?:\\s+(\\d{1,2}:\\d{2}:\\d{2}\\s*[AP]M))?' +  // 2 time, optional
  '\\s*(?:\\[([^\\]]*)\\])?' +             // 3 author, optional
  '\\s*:\\s?([\\s\\S]*)$', 'i');           // 4 message

function stamp(d, t) {
  const iso = date(d);
  if (!iso) return null;
  if (!t) return `${iso}T12:00:00`;        // noon, so a date-only entry cannot
                                            // cross a day boundary in any zone
  const parsed = time(t);
  return `${iso}T${parsed ?? '12:00:00'}`;
}

const events = [];
for (const o of orders) {
  const blob = o.__row.History_Notes ?? '';
  if (!blob.trim()) continue;
  let current = null;
  let n = 0;
  for (const line of blob.split(VT)) {
    const s = line.trim();
    if (!s) continue;
    const m = ENTRY.exec(s);
    if (m) {
      const [, d, t, author, message] = m;
      current = {
        order_legacy: o.legacy_id,
        order_seq: o.legacy_seq,
        happened_at: stamp(d, t),
        author: (author ?? '').trim() || null,
        message: message.trim(),
        source: 'filemaker',
        legacy_key: `${o.legacy_id}#${o.legacy_seq}#${++n}`,
      };
      events.push(current);
    } else if (current) {
      current.message += `\n${s}`;
      report.eventsContinued++;
    } else {
      // Text before any dated entry — 149 of them, and every one is a real
      // note ("Paid by check #12649"). Undated rather than dropped; the order's
      // own creation date is the honest timestamp.
      report.eventsUnparsed++;
      current = {
        order_legacy: o.legacy_id,
        order_seq: o.legacy_seq,
        happened_at: o.date_initiated ? `${o.date_initiated}T12:00:00` : null,
        author: null,
        message: s,
        source: 'filemaker',
        legacy_key: `${o.legacy_id}#${o.legacy_seq}#${++n}`,
      };
      events.push(current);
    }
  }
}
// happened_at is NOT NULL in 051. An entry whose date will not parse keeps its
// message and takes the order's creation date; one with neither is dropped and
// counted, because a log entry with no time has nowhere to sit in the list.
const datedEvents = events.filter((e) => e.happened_at);
const undated = events.length - datedEvents.length;

/* ========================================================================== */
/* 6. THE MONEY DIFF — reported, never reconciled (decision 6)                */
/* ========================================================================== */

const linesByOrder = new Map();
for (const i of items) {
  const k = `${i.order_legacy}#${i.order_seq}`;
  if (!linesByOrder.has(k)) linesByOrder.set(k, []);
  linesByOrder.get(k).push(i);
}

for (const o of orders) {
  const lines = linesByOrder.get(`${o.legacy_id}#${o.legacy_seq}`) ?? [];
  if (!lines.length) continue;
  const subtotal = lines.reduce((a, l) => a + l.qty * l.unit_price, 0);
  const stored = num(o.__v2 ? o.__row.Order_Subtotal2 : o.__row.Order_Subtotal);
  if (stored === null || stored === undefined) continue;
  if (Math.abs(subtotal - stored) > 0.02) {
    report.totalsDisagree.push({
      number: o.number, version: o.__v2 ? 2 : 1,
      derived: Number(subtotal.toFixed(2)), stored: Number(stored.toFixed(2)),
    });
  }
}

/* ========================================================================== */
/* 7. Report                                                                  */
/* ========================================================================== */

for (const o of orders) { delete o.__row; delete o.__v2; }

const out = { customers, orders, items, payments, events: datedEvents };

console.log('\n── TRANSFORMED ──');
console.log(`  customers : ${customers.length}`);
console.log(`  orders    : ${orders.length}`);
console.log(`  items     : ${items.length}`);
console.log(`  payments  : ${payments.length} (${report.syntheticPayments} synthesized from Spent_c)`);
console.log(`  events    : ${datedEvents.length}` + (undated ? ` (${undated} dropped, no usable date)` : ''));

console.log('\n── ORDERS ──');
console.log(`  kinds   : ${[...report.kindTally].map(([k, n]) => `${k}=${n}`).join('  ')}`);
console.log(`  statuses: ${[...report.statusTally].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}=${n}`).join('  ')}`);
if (report.statusDerived) console.log(`  ${report.statusDerived} order(s) had a junk Order_Type; status derived from the stage dates`);
if (report.numberCollisions.length) {
  console.log(`  NUMBER COLLISIONS (${report.numberCollisions.length}) — both rows migrate, the later one suffixed:`);
  for (const c of report.numberCollisions) console.log(`    · ${c}`);
}
if (report.skippedOrders.length) {
  console.log(`  SKIPPED ${report.skippedOrders.length} row(s):`);
  for (const s of report.skippedOrders) console.log(`    · ${s}`);
}
console.log(`  ${report.noCustomer} order(s) name no customer; ${report.orphanCustomer.length} name one that does not exist`);
for (const o of report.orphanCustomer) console.log(`    · ${o}`);
console.log(`  ${report.invoiceFooterSkipped} boilerplate "We appreciate your business!" notes NOT migrated (they are the invoice footer, in org settings)`);

console.log('\n── ITEMS ──');
const v2Lines = items.filter((i) => i.production_item_legacy).length;
console.log(`  ${v2Lines} line(s) carry a production item key, ${items.length - v2Lines} do not (v1 kept none)`);
if (report.raggedSlots) console.log(`  ${report.raggedSlots} ragged slot(s) — a price or qty with no description; kept`);
if (report.cappedAt20) console.log(`  ${report.cappedAt20} order(s) fill all 20 repeating slots — FileMaker's cap, so lines may be missing at source`);
if (report.orphanItems.size) {
  const total = [...report.orphanItems.values()].reduce((a, b) => a + b, 0);
  console.log(`  ORPHANED: ${total} line(s) name an order number with no parent:`);
  for (const [k, n] of report.orphanItems) console.log(`    · order "${k}" — ${n} line(s)`);
}

console.log('\n── PAYMENTS ──');
console.log(`  ${report.paymentsDisagree.length} order(s) have rows that disagree with Spent_c — ROWS WIN, Spent_c rides in source_payload`);
for (const p of report.paymentsDisagree.slice(0, 5)) console.log(`    · ${p}`);
if (report.paymentsDisagree.length > 5) console.log(`    … and ${report.paymentsDisagree.length - 5} more`);
if (report.orphanPayments.length) console.log(`  ORPHANED: ${report.orphanPayments.length} payment(s) with no parent order`);

console.log('\n── THE LOG ──');
console.log(`  ${report.eventsContinued} continuation line(s) folded into the entry above them`);
console.log(`  ${report.eventsUnparsed} undated note(s) kept, stamped with the order's creation date`);

console.log('\n── MONEY (reported, not reconciled — decision 6) ──');
console.log(`  ${report.totalsDisagree.length} of ${orders.length} orders: lines do not reproduce FileMaker's stored subtotal`);
const byV = { 1: 0, 2: 0 };
for (const d of report.totalsDisagree) byV[d.version]++;
console.log(`    v1 ${byV[1]}  ·  v2 ${byV[2]}`);
for (const d of report.totalsDisagree.slice(0, 5)) {
  console.log(`    · ${d.number} (v${d.version}): derived ${d.derived} vs stored ${d.stored}`);
}

if (report.unparsable.size) {
  console.log('\n── UNPARSABLE CELLS (left null, raw kept in source_payload where it matters) ──');
  for (const [k, n] of [...report.unparsable].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${n}`);
}
if (report.malformed.length) {
  console.log(`\n${report.malformed.length} MALFORMED source line(s) skipped: ${report.malformed.map((m) => `line ${m.line} (width ${m.width})`).join(', ')}`);
}

/* A cross-check the loader repeats against the live catalog. */
if (existsSync(PRODUCTION_ITEMS)) {
  const pi = JSON.parse(readFileSync(PRODUCTION_ITEMS, 'utf8')).items ?? [];
  const keys = new Set(pi.map((p) => String(p.source_payload?.fmp_item_id)));
  const linked = items.filter((i) => i.production_item_legacy);
  const hit = linked.filter((i) => keys.has(String(i.production_item_legacy))).length;
  console.log(`\n── ITEM LINKS (checked against production-items.json) ──`);
  console.log(`  ${hit} of ${linked.length} keyed lines resolve to a production item`);
  console.log(`  (the loader resolves them against the live catalog, not this file)`);
}

if (!APPLY) {
  console.log('\nDry run. Re-run with --write to save.');
  process.exit(0);
}
if (!existsSync(DATA)) mkdirSync(DATA, { recursive: true });
writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(`\nWrote ${OUT}`);
