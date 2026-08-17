-- ============================================================================
-- restaurantfriend — migration 051 · Special Orders, phase 1
--
-- The module specced in `docs/special-orders-brief.md`. Six tables, a number
-- sequence, a private bucket, and the org settings the rest of the module
-- reads. Nothing here generates, sends or materializes anything — those are
-- phases 3 and 5 and they arrive as their own migrations.
--
-- Run in the Supabase SQL editor. NOT rerunnable (create table, and the bucket
-- insert is `on conflict do nothing` but the policies are not).
--
-- ---------------------------------------------------------------------------
-- FIVE THINGS THE BRIEF GOT WRONG, each measured against the real export
-- before a line of this was written. The brief was designed from a `parseInt`
-- reading of `OrderID`, and that one mistake produced three of the five.
--
-- 1. **THE ORDER NUMBER IS TEXT, NOT AN INTEGER.** The brief says
--    `number (int, unique per org)`. The export carries `2899-01`, `2899-02`,
--    `2899-03`, `3932 cont.`, `5689a`, `5691a`, `5697a`, `5542b`, `5753a`,
--    `5915a` and `7220a` — eleven real order numbers a human typed a suffix
--    onto, which is how FileMaker lets you split one job into parts. An
--    integer column silently rounds every one of them into a collision with
--    its unsuffixed sibling. Text is also `purchase_orders.po_number`'s own
--    precedent, so the app already knows how to sort and search one.
--
-- 2. **THERE IS EXACTLY ONE DUPLICATED NUMBER, NOT FIVE.** The brief names
--    "2899 x3, 3932/5542/6002 x2" — but `2899-01/-02/-03` are three DISTINCT
--    numbers, and `parseInt("2899-01")` is 2899, which is where the phantom
--    duplicates came from. Over the raw strings there is one: **`6002`,
--    twice**, and the two rows are DIFFERENT ORDERS (customer 4916, event
--    9/9/2021, $253.88, paid; customer 4917, event 9/24/2021, $188.89,
--    unpaid). So neither may be dropped. The transform keeps both, gives the
--    later one `6002-2`, and records the collision in `legacy_seq` — 028's
--    `source_row_key` lesson, applied to the one row that needs it.
--
-- 3. **THE EVENT TIME IS A TIME, and the brief left it unspecified.** Of 8,185
--    filled `Event_Time` values, 8,166 parse (`8 AM`, `10:30 AM`, `12:00:00`);
--    the 19 that do not are all the literal string `?`, which is what "we
--    don't know yet" looks like in FileMaker and which NULL says better. A
--    text column would have cost the list its "date then time" ordering — the
--    thing the whole screen is arranged around — to preserve nineteen question
--    marks.
--
-- 4. **`Notes_Invoice` IS NOT A PER-ORDER NOTE.** It is filled on 8,060 rows
--    and 8,052 of them read "We appreciate your business!" — it is the invoice
--    document's FOOTER, stored once per order by a FileMaker default. Copying
--    it 8,052 times would make a boilerplate sentence look like eight thousand
--    deliberate remarks and put a document's design in the data. It goes to
--    `orgs.settings.special_orders.invoice_footer` (design rule 2); only the
--    eight rows that say something else keep a `notes_invoice`.
--
-- 5. **`Order_ToDo` IS ALMOST ALWAYS EMPTY** — 8,233 of 8,334. The brief's
--    ten-value vocabulary is FileMaker's VALUE LIST, not its data, and the
--    data also holds "OH HOLD", "*", "HOLIDAY" and "No need to print *page
--    2*". So `todo` is free text with a PickList over the vocabulary and
--    `allowNew`, exactly as decision 4 says — this note exists so nobody
--    later "cleans up" the column into a check constraint that would refuse a
--    quarter of the real values.
--
-- ---------------------------------------------------------------------------
-- KIND AND STATUS: the brief's open question 2, answered.
--
-- `status` is NULLABLE, with `check ((kind = 'order') = (status is not null))`.
-- A biconditional rather than a default, because the two readings are not
-- equally honest: a template with status 'lead' is a claim about a workflow
-- the record is not in, and every list filter would have to know to ignore it.
-- Null makes "this record has a status" and "this record is an order" the SAME
-- QUESTION, which is what "legal by construction" was asking for — the app can
-- test either one and cannot get a different answer.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. CUSTOMERS
-- ----------------------------------------------------------------------------
-- The first table in this schema whose rows are members of the PUBLIC. Read is
-- gated with write (decision 7) because a name, a home address, a phone and an
-- email are PII of the `employees` class — 020's reasoning, and the second
-- table to follow it.
--
-- NO CREDIT CARD COLUMNS, EVER. `Customers.mer` carries `CC_Num`, `CC_Code`,
-- `CC_Expiration` and `CC_BillingZip`, filled on up to 39 rows, in plain text.
-- The transform is a field allow-list precisely so those cannot arrive by
-- accident, and this comment is the other half of that guard: a column added
-- here later would give them somewhere to land.
--
-- Balance, spend and order count are DERIVED (FMP kept them as calc fields and
-- the temptation to store them is exactly decision 6's disease).
create table customers (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references orgs(id) on delete cascade,

  -- FMP CustomerID. 5,874 rows, all distinct, so this one CAN be unique.
  legacy_id  text,

  first_name text,
  last_name  text,
  company    text,
  phone      text,
  email      text,

  -- `locations.address`'s idiom: street/street2/city/state/zip + formatted.
  -- jsonb rather than five columns for the reason 017 gave — an address is
  -- read whole and written whole, and `InlineValue` has a json path for it.
  address    jsonb not null default '{}',

  notes      text,

  source         text not null default 'app' check (source in ('app', 'filemaker')),
  source_payload jsonb,

  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),

  unique (org_id, legacy_id)
);

-- The two match keys decision 18's `create_inquiry` uses, email first then
-- phone. NOT unique: 187 email addresses repeat across the 5,874 real
-- customers (families, offices, one person entered twice) and 138 rows have no
-- email at all, so a unique index would refuse the load and, worse, would make
-- the honest answer to "is this a new customer?" a constraint violation
-- instead of the warning `findPossibleRehires` established.
create index customers_email_idx on customers (org_id, lower(email));
create index customers_phone_idx on customers (org_id, phone);
create index customers_name_idx  on customers (org_id, lower(last_name), lower(first_name));

create trigger trg_customers_updated before update on customers
  for each row execute function set_updated_at();

alter table customers enable row level security;

-- Supervisor+ on ALL FOUR VERBS including select (decision 7).
create policy customers_select on customers for select
  using (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']));

create policy customers_insert on customers for insert
  with check (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']));

create policy customers_update on customers for update
  using      (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']))
  with check (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']));

create policy customers_delete on customers for delete
  using (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']));


-- ----------------------------------------------------------------------------
-- 2. THE ORDER NUMBER SEQUENCE
-- ----------------------------------------------------------------------------
-- Seeded at 10000, clear of FileMaker's live maximum of 9887 — 044's batch-log
-- idiom, and a round seed so the first app-made order is legible as one. NOT
-- computed from the data the way 006's was, because the data is text and
-- `max()` over `2899-01` is not a number.
create sequence if not exists special_order_number_seq start with 10000;

/**
 * The next special-order number.
 *
 * `security definer` so it can advance the sequence, which RLS does not cover
 * — and because of that it re-checks what RLS would have (CLAUDE.md's rule for
 * every definer function). Supervisor+, matching the write policies below.
 *
 * Returns TEXT: see header note 1. The suffixed numbers FileMaker carries are
 * the reason, and a caller that wants to do arithmetic on an order number is
 * asking the wrong question.
 */
create or replace function public.next_special_order_number(p_org_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_org_id is null then
    raise exception 'no organisation given';
  end if;

  if not user_has_role(p_org_id, array['owner', 'admin', 'purchaser', 'supervisor']) then
    raise exception 'insufficient role to number a special order';
  end if;

  return nextval('special_order_number_seq')::text;
end $$;

revoke all on function public.next_special_order_number(uuid) from public;
revoke all on function public.next_special_order_number(uuid) from anon;
grant execute on function public.next_special_order_number(uuid) to authenticated;


-- ----------------------------------------------------------------------------
-- 3. SPECIAL ORDERS
-- ----------------------------------------------------------------------------
create table special_orders (
  id      uuid primary key default gen_random_uuid(),
  org_id  uuid not null references orgs(id) on delete cascade,

  -- TEXT. Header note 1.
  number  text not null,

  -- FileMaker's OrderID, and the occurrence ordinal that makes the pair unique
  -- when FileMaker itself let a number repeat. 1 for all but one row in the
  -- whole 8,334-row history; header note 2 names the exception.
  legacy_id  text,
  legacy_seq integer not null default 1,

  -- --------------------------------------------------------------------------
  -- DECISION 3: the one deliberate model change. FMP's `Order_Type` held a
  -- workflow ladder, two kinds of record and a provenance in one field.
  kind   text not null default 'order'
         check (kind in ('order', 'template', 'standing_order')),

  -- lead -> quote -> invoice -> order, plus cancelled. NULL exactly when the
  -- record is not an order; see the header.
  status text check (status in ('lead', 'quote', 'invoice', 'order', 'cancelled')),
  constraint special_orders_status_iff_order
    check ((kind = 'order') = (status is not null)),

  -- Decision 4: MANUAL, and the app never writes it. Free text; header note 5.
  todo        text,
  -- Setting this colours the row red; resolving clears both it and the todo.
  flag_reason text,

  -- --------------------------------------------------------------------------
  -- WHO
  -- Nullable, and `set null` rather than cascade: 75 of the 8,334 real orders
  -- have no customer at all, and deleting a customer must not take twelve
  -- years of orders with them.
  customer_id   uuid references customers(id) on delete set null,

  -- The day-of contact, who is often not the customer (7,735 rows fill it).
  contact_name  text,
  contact_phone text,
  contact_email text,

  allergen_info text,

  -- --------------------------------------------------------------------------
  -- WHAT AND WHEN
  title      text,                      -- FMP Event_Description
  event_date date,                      -- 9 real rows say "?" and land null
  event_time time,                      -- header note 3
  ready_by_time time,

  -- Decision 8. Both nullable and both `restrict`: an order is a document, and
  -- 040's schedules make the same call for the same reason.
  location_id         uuid references locations(id),  -- PICKED UP here
  kitchen_location_id uuid references locations(id),  -- MADE here

  fulfillment text not null default 'pickup' check (fulfillment in ('pickup', 'delivery')),

  delivery_address        text,
  delivery_distance       numeric(8,2),
  delivery_cost           numeric(10,2),   -- what the carrier charges US
  delivery_company        text,
  delivery_company_phone  text,
  delivery_tracking       text,
  delivery_window_start   time,
  delivery_window_end     time,
  delivery_boxes          integer,
  delivery_weight_lbs     numeric(10,2),

  -- --------------------------------------------------------------------------
  -- DECISION 6: THE INPUTS TO THE MONEY, AND NOTHING ELSE.
  --
  -- There is deliberately NO subtotal, tax, total, balance or paid column.
  -- FileMaker had all of them, TWICE (`Order_Subtotal` and `Order_Subtotal2`,
  -- by era), which is how they drifted. Everything is derived in
  -- `lib/specialOrders.ts` from these inputs plus the lines and the payments.
  --
  -- A rewrite adding `total numeric` here to "save a computation" is the one
  -- change this module cannot survive: a stored total is a second answer, and
  -- documents already get their immutable copy by being FILED as PDFs.
  tax_rate        numeric(6,5),          -- snapshotted from the pickup shop, editable
  discount_amount numeric(10,2),
  discount_rate   numeric(6,4),          -- a FRACTION: .10 is ten per cent
  delivery_charge numeric(10,2),         -- what WE charge the customer
  rush_fee        numeric(10,2),
  -- Keeps a wholesale day out of the unpaid/overdue filters (decision 13).
  ignore_balance  boolean not null default false,

  taken_by text,                         -- 59 spellings of the staff; history, not a FK

  -- Each prints on ITS document; `notes_general` prints nowhere (decision 11).
  notes_general    text,
  notes_quote      text,
  notes_production text,
  notes_invoice    text,
  notes_receipt    text,

  -- --------------------------------------------------------------------------
  -- DECISION 13: STANDING ORDERS
  --
  -- A SET of ISO weekdays, not a per-weekday array — so 009/017's seven-slot
  -- `array_length = 7` guard deliberately does NOT apply here.
  --
  -- The check is CONTAINMENT ONLY. Refusing a repeated weekday would need
  -- `count(distinct …)` over `unnest`, and **Postgres does not allow a subquery
  -- in a CHECK constraint** — it raises outright, so this migration would not
  -- apply at all. It is also unnecessary: `special_orders_standing_day` below
  -- is unique on (standing_order_id, event_date), so a duplicated weekday makes
  -- the materializer try to create a day that already exists, which is exactly
  -- the case that index is there to refuse.
  standing_days smallint[]
    check (standing_days is null or standing_days <@ array[1,2,3,4,5,6,7]::smallint[]),
  starts_on date,
  ends_on   date,
  paused    boolean not null default false,
  check (starts_on is null or ends_on is null or ends_on >= starts_on),

  -- Which standing order materialized me. `cascade` is WRONG here and `set
  -- null` is right: deleting a standing order must not delete the wholesale
  -- days already made, invoiced and eaten.
  standing_order_id uuid references special_orders(id) on delete set null,

  -- --------------------------------------------------------------------------
  -- THE STAGE DATES — the list's right-hand grid, and FMP's real to-do list.
  -- Dates, not timestamps: that is what FileMaker recorded and what the grid
  -- shows, and they are hand-editable like PO detail's.
  date_initiated       date,
  quote_sent_at        date,
  quote_returned_at    date,
  invoice_sent_at      date,
  invoice_paid_at      date,
  receipt_sent_at      date,
  delivery_scheduled_at date,
  order_printed_at     date,
  order_scheduled_at   date,

  -- Decision 9's link back to 040's seam. `set null`: unscheduling deletes the
  -- schedule, and a deleted schedule must not delete the order.
  production_schedule_id uuid references production_schedules(id) on delete set null,

  -- Decision 12. The inbound Message-ID is what makes a reply THREAD; the
  -- subject is what FMP misnamed `Email_Token` and pasted into replies by hand.
  inbound_subject    text,
  inbound_message_id text,

  -- Decision 2's seam: a Square invoice id, a QBO doc id. jsonb because there
  -- will be more than one of them and none of them exists yet.
  external_ref jsonb not null default '{}',

  source         text not null default 'app'
                 check (source in ('app', 'filemaker', 'inquiry')),
  source_payload jsonb,

  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),

  unique (org_id, number),
  unique (org_id, legacy_id, legacy_seq)
);

-- Decision 13's IDEMPOTENCY KEY, and the whole reason the materializer can be
-- called from two places on every page load without making anything twice.
-- Partial, so the 8,000 hand-made orders (standing_order_id null) are not
-- constrained to one per day.
--
-- A CANCELLED day still occupies its slot — that is the point. Cancelling
-- Thanksgiving is a decision that must stick, and a row deleted instead of
-- cancelled would be re-created by the next top-up and the donuts would get
-- made. The app therefore has no delete path for a materialized day.
create unique index special_orders_standing_day
  on special_orders (standing_order_id, event_date)
  where standing_order_id is not null;

create index special_orders_event_idx  on special_orders (org_id, event_date desc, event_time);
create index special_orders_status_idx on special_orders (org_id, status) where kind = 'order';
create index special_orders_kind_idx   on special_orders (org_id, kind);
create index special_orders_customer_idx on special_orders (customer_id, event_date desc);
-- The materializer's own sweep: every unpaused standing order in the org.
create index special_orders_standing_idx
  on special_orders (org_id) where kind = 'standing_order';

create trigger trg_special_orders_updated before update on special_orders
  for each row execute function set_updated_at();

alter table special_orders enable row level security;

create policy special_orders_select on special_orders for select
  using (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']));

create policy special_orders_insert on special_orders for insert
  with check (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']));

create policy special_orders_update on special_orders for update
  using      (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']))
  with check (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']));

create policy special_orders_delete on special_orders for delete
  using (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']));


-- ----------------------------------------------------------------------------
-- 4. THE LINES
-- ----------------------------------------------------------------------------
-- Decision 5: COPIES, not links. The same snapshot philosophy as a purchase
-- order line and a schedule line — `production_item_id` is provenance and the
-- route back, never the source of what prints.
create table special_order_items (
  id       uuid primary key default gen_random_uuid(),
  org_id   uuid not null references orgs(id) on delete cascade,
  order_id uuid not null references special_orders(id) on delete cascade,

  -- Drag order (decision 5). Nullable so a hand-inserted line can sort last
  -- rather than fight for a number.
  sort     integer,

  -- `set null`, not restrict: retiring a menu item must not freeze twelve
  -- years of orders, and the snapshot below is what the document prints
  -- anyway. Decision 9 is where the link becomes load-bearing — a line with no
  -- link cannot be scheduled, and the app says so by name.
  production_item_id uuid references production_items(id) on delete set null,

  -- THE SNAPSHOT. Every one editable in place, name included — "Promise Ring
  -- - Glazed - Letter" is a real customized line, and customizing is the point
  -- of the module.
  name        text not null,
  item_donut  text,     -- the un-customized donut, e.g. "Angry Samoa"
  item_type   text,     -- Raised · Cake · Mochi · Old Fashioned · Scrap · Misc
  item_cut    text,     -- production_items.subtype
  item_finish text,
  item_size   text,

  notes      text,

  -- **NO `check (qty >= 0)`**, and this is a MEASUREMENT rather than an
  -- oversight — 024's lesson, found the same way, by replaying the whole real
  -- export through the real constraints on the harness rather than by reading.
  --
  -- Three of the 47,827 real lines carry a negative quantity, and they name
  -- themselves: `short s'morrisseys` (-80), `short (dropped bin)` (-30),
  -- `short donuts (quality issues)` (-26). A negative quantity is how this
  -- shop credits a customer for what it failed to deliver, two of the three
  -- are recent, and the constraint would have failed the production load
  -- PARTWAY THROUGH — on row 30,000-odd of a 47,827-row insert.
  --
  -- It was also incoherent with the line below it: `unit_price` carries no
  -- check, and six real lines use a negative one ("Tasting Discount",
  -- "Wedding Sampler Discount", -$248.50). The same idea — a credit line — was
  -- expressible one way and refused the other.
  qty        numeric(10,2) not null default 0,
  unit_price numeric(10,2) not null default 0,
  taxable    boolean not null default true,

  -- NO extended, subtotal or tax column. qty x unit_price is arithmetic, and
  -- decision 6 says the reader does it. FileMaker stored `priceExtended_c` and
  -- it reads 0 on the very first row of the real export.

  legacy_key text,      -- FMP _PrimaryKey, or `{order}#{slot}` for a v1 repeat

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index special_order_items_order_idx on special_order_items (order_id, sort);
create index special_order_items_item_idx  on special_order_items (production_item_id);
create unique index special_order_items_legacy_key
  on special_order_items (org_id, legacy_key) where legacy_key is not null;

create trigger trg_special_order_items_updated before update on special_order_items
  for each row execute function set_updated_at();

alter table special_order_items enable row level security;

create policy special_order_items_select on special_order_items for select
  using (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']));

create policy special_order_items_insert on special_order_items for insert
  with check (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']));

create policy special_order_items_update on special_order_items for update
  using      (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']))
  with check (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']));

create policy special_order_items_delete on special_order_items for delete
  using (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']));


-- ----------------------------------------------------------------------------
-- 5. PAYMENTS
-- ----------------------------------------------------------------------------
-- Decision 2: rows, with the Square vocabulary kept as free text
-- (`Square Invoice` on 1,188 of the 1,190 real payments) and an `external_ref`
-- from day one. No `paid` status anywhere — payment is a fact QuickBooks will
-- own, and balance is derived from these rows.
create table special_order_payments (
  id       uuid primary key default gen_random_uuid(),
  org_id   uuid not null references orgs(id) on delete cascade,
  order_id uuid not null references special_orders(id) on delete cascade,

  paid_on      date,
  amount       numeric(10,2) not null,
  payment_type text,
  note         text,

  external_ref text,
  legacy_key   text,

  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

create index special_order_payments_order_idx on special_order_payments (order_id, paid_on);
create unique index special_order_payments_legacy_key
  on special_order_payments (org_id, legacy_key) where legacy_key is not null;

create trigger trg_special_order_payments_updated before update on special_order_payments
  for each row execute function set_updated_at();

alter table special_order_payments enable row level security;

create policy special_order_payments_select on special_order_payments for select
  using (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']));

create policy special_order_payments_insert on special_order_payments for insert
  with check (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']));

create policy special_order_payments_update on special_order_payments for update
  using      (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']))
  with check (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']));

create policy special_order_payments_delete on special_order_payments for delete
  using (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']));


-- ----------------------------------------------------------------------------
-- 6. THE LOG
-- ----------------------------------------------------------------------------
-- Decision 16. FMP kept this as ONE TEXT BLOB per order and it is the module's
-- most-written field — 106,373 entries over 7,597 orders, written by 60-odd
-- named people. As rows it is queryable, pageable, and attributable.
--
-- `author` is TEXT, not a user FK: FileMaker's usernames (`tracit`, `levik`,
-- `df01`, `Abim`) are not app accounts and 56,162 of the entries are one
-- person who no longer works here. `author_id` records the app user where
-- there is one, so new entries are attributable properly without pretending
-- the old ones can be.
create table special_order_events (
  id       uuid primary key default gen_random_uuid(),
  org_id   uuid not null references orgs(id) on delete cascade,
  order_id uuid not null references special_orders(id) on delete cascade,

  happened_at timestamptz not null default now(),
  author      text,
  author_id   uuid references auth.users(id),
  message     text not null,

  source text not null default 'app' check (source in ('filemaker', 'app', 'manual')),

  legacy_key text,

  created_at timestamptz not null default now()
);

-- Newest first is the only way this is ever read.
create index special_order_events_order_idx
  on special_order_events (order_id, happened_at desc);
create unique index special_order_events_legacy_key
  on special_order_events (org_id, legacy_key) where legacy_key is not null;

alter table special_order_events enable row level security;

create policy special_order_events_select on special_order_events for select
  using (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']));

create policy special_order_events_insert on special_order_events for insert
  with check (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']));

-- An UPDATE policy exists so a freehand note can be corrected. There is
-- deliberately NO DELETE policy — the log is the record of what was done, and
-- an entry removed is a thing that happened with no trace. (035's employee
-- events made the same call; 023's lesson about a TYPO versus a PERSON does
-- not apply, because a wrong log entry can be corrected in place.)
create policy special_order_events_update on special_order_events for update
  using      (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']))
  with check (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']));


-- ----------------------------------------------------------------------------
-- 7. QUOTE APPROVAL TOKENS (decision 17)
-- ----------------------------------------------------------------------------
-- The table ships here because schema belongs in one migration; the two
-- deliberately-anon RPCs that read it arrive with phase 3, when there is a
-- document for a token to be bound to.
--
-- THE TOKEN IS THE WHOLE CAPABILITY — 128 bits of random, the same trust class
-- as a signed storage URL. What makes that sound is what the token can REACH:
-- one order's quote, and nothing else in the schema.
--
-- APPROVAL BINDS TO A SNAPSHOT. Money is derived live (decision 6), so the
-- order can change after a quote goes out. `document_path` is the exact PDF
-- that was sent, filed in the bucket at send time. Approving signs THAT, not
-- whatever the order says today.
create table special_order_quote_tokens (
  id       uuid primary key default gen_random_uuid(),
  org_id   uuid not null references orgs(id) on delete cascade,
  order_id uuid not null references special_orders(id) on delete cascade,

  token text not null unique,

  -- The object key in `special-order-attachments`. Nullable only so a mint can
  -- be recorded before the upload lands; the app writes both together.
  document_path text,

  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),

  -- Set when a LATER quote is sent. A superseded token's page says "this quote
  -- has been revised — check your email" rather than showing a stale price.
  superseded_at timestamptz,

  -- A token is SPENT by approval.
  approved_at   timestamptz,
  approved_name text,
  -- ip + user_agent, for the same reason a clickwrap ever records them.
  approved_meta jsonb
);

create index special_order_quote_tokens_order_idx
  on special_order_quote_tokens (order_id, created_at desc);

alter table special_order_quote_tokens enable row level security;

-- Supervisor+ like everything else. `anon` reaches this table ONLY through the
-- phase-3 definer functions, which is what makes the exemption auditable:
-- there is no policy here that mentions the public.
create policy special_order_quote_tokens_select on special_order_quote_tokens for select
  using (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']));

create policy special_order_quote_tokens_insert on special_order_quote_tokens for insert
  with check (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']));

create policy special_order_quote_tokens_update on special_order_quote_tokens for update
  using      (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']))
  with check (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']));

create policy special_order_quote_tokens_delete on special_order_quote_tokens for delete
  using (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']));


-- ----------------------------------------------------------------------------
-- 8. ATTACHMENTS (decision 14) — pics and documents, merged
-- ----------------------------------------------------------------------------
create table special_order_attachments (
  id       uuid primary key default gen_random_uuid(),
  org_id   uuid not null references orgs(id) on delete cascade,
  order_id uuid not null references special_orders(id) on delete cascade,

  -- Decision 14's three, plus the two the app itself files. `quote_document`
  -- is what a token binds to; `invoice_document` is the sent invoice.
  kind text not null default 'document'
       check (kind in ('signed_quote', 'quote_document', 'invoice_document',
                       'picture', 'document')),

  storage_path text not null,
  file_name    text,
  content_type text,
  byte_size    bigint,

  uploaded_by uuid references auth.users(id),
  created_at  timestamptz not null default now()
);

create index special_order_attachments_order_idx on special_order_attachments (order_id);

alter table special_order_attachments enable row level security;

create policy special_order_attachments_select on special_order_attachments for select
  using (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']));

create policy special_order_attachments_insert on special_order_attachments for insert
  with check (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']));

create policy special_order_attachments_update on special_order_attachments for update
  using      (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']))
  with check (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']));

create policy special_order_attachments_delete on special_order_attachments for delete
  using (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']));


-- Its own bucket, per 021's test: the AUDIENCE decides. These are supervisor+,
-- which is neither `po-attachments` (purchaser+) nor `employee-documents`
-- (owner/admin), so a third bucket is the honest answer rather than a
-- convenience.
insert into storage.buckets (id, name, public)
values ('special-order-attachments', 'special-order-attachments', false)
on conflict (id) do nothing;

-- 018's four-policy org-folder pattern, verbatim, including its
-- `storage_folder_org()` wrapper — the object key is
-- `{org_id}/{order_id}/{uuid}.{ext}` so the first segment authorises with no
-- join, and the wrapper returns null rather than raising on a junk path.
create policy so_attachments_object_read on storage.objects for select
  using (
    bucket_id = 'special-order-attachments'
    and public.storage_folder_org(name) in (select user_org_ids())
  );

create policy so_attachments_object_insert on storage.objects for insert
  with check (
    bucket_id = 'special-order-attachments'
    and user_has_role(public.storage_folder_org(name),
                      array['owner', 'admin', 'purchaser', 'supervisor'])
  );

create policy so_attachments_object_update on storage.objects for update
  using (
    bucket_id = 'special-order-attachments'
    and user_has_role(public.storage_folder_org(name),
                      array['owner', 'admin', 'purchaser', 'supervisor'])
  );

create policy so_attachments_object_delete on storage.objects for delete
  using (
    bucket_id = 'special-order-attachments'
    and user_has_role(public.storage_folder_org(name),
                      array['owner', 'admin', 'purchaser', 'supervisor'])
  );


-- ----------------------------------------------------------------------------
-- 9. DECISION 18's CURATION FLAG
-- ----------------------------------------------------------------------------
-- What the public inquiry form may offer. **Default FALSE** — the catalog
-- holds Scrap, test items and things that only exist as components, so opting
-- IN is the safe direction and Mark ticks the menu once. A default of true
-- would put the whole 307-item catalog on a public page the day phase 4 ships.
alter table production_items
  add column show_on_inquiry_form boolean not null default false;

create index production_items_inquiry_idx
  on production_items (org_id) where show_on_inquiry_form;


-- ----------------------------------------------------------------------------
-- 10. THE MODULE'S SETTINGS (design rule 2)
-- ----------------------------------------------------------------------------
-- Every number and sentence the module reasons with, in one place, so none of
-- them is a literal in code:
--
--   horizon_days        decision 13's rolling materialization window
--   rush_*              decision 22's terms, which the quote PDF prints
--   attention_*         decision 19's thresholds
--   invoice_footer      header note 4's boilerplate, stored ONCE
--   terms               the quote's terms paragraph (decision 11)
--
-- `||` so an org that already has other settings keeps them, and the key is
-- only written if absent — re-running this must not stamp over an edited
-- footer.
update orgs
   set settings = settings || jsonb_build_object('special_orders', jsonb_build_object(
         'horizon_days', 14,
         'rush_cutoff_business_days', 2,
         'rush_minimum', 25,
         'rush_rate', 0.30,
         'attention_quote_unanswered_days', 5,
         'attention_unpaid_within_days', 7,
         'attention_print_within_days', 2,
         'invoice_footer', 'We appreciate your business!',
         'terms', 'We require two business days notice to put an order into production. Orders placed inside that window incur a rush fee of $25 or 30%, whichever is greater. A signed quote is required before we begin. Cancellations inside two business days are non-refundable.'
       ))
 where not (settings ? 'special_orders');


notify pgrst, 'reload schema';


-- ----------------------------------------------------------------------------
-- After this, these should read:
-- ----------------------------------------------------------------------------
--   select count(*) from customers;                     -> 0 (the load fills it)
--   select count(*) from special_orders;                -> 0
--   select last_value, is_called from special_order_number_seq;
--                                                       -> 10000, false
--     (is_called FALSE means the first call returns 10000, not 10001.)
--
--   select id, public from storage.buckets
--    where id = 'special-order-attachments';            -> 1 row, public = false
--
--   select count(*) from pg_policy
--    where polrelid = 'public.special_orders'::regclass; -> 4
--
--   select settings->'special_orders'->>'horizon_days' from orgs;  -> 14
--
--   select count(*) from production_items where show_on_inquiry_form;  -> 0
--
-- And the two constraints worth proving by BREAKING them, because each is a
-- claim the app relies on and neither shows up in ordinary use:
--
--   insert ... (kind, status) values ('template', 'lead')  -> refused
--     (special_orders_status_iff_order)
--   insert ... (kind, status) values ('order', null)       -> refused
--     (same constraint, the other direction — a check that only fires one way
--      would let every hand-written insert leave status null)
--
-- ----------------------------------------------------------------------------
-- VERIFIED ON THE DOCKER HARNESS, 2026-08-17
-- ----------------------------------------------------------------------------
-- All 51 migrations apply on a Supabase stub. Then, as REAL authenticated
-- roles (`set local role` inside a transaction, asserting `current_user` in the
-- output — outside one it is a silent no-op that leaves you superuser and
-- bypasses RLS):
--
--   · a SUPERVISOR reads 8,330 orders / 47,827 lines / 6,457 payments /
--     5,874 customers and inserts, updates and deletes;
--   · a STAFFER reads **0 of each**, and an UPDATE changes **0 rows and
--     returns NO error** — the footgun every write in the app `.select()`s
--     against — while an INSERT is refused outright;
--   · `anon` cannot execute `next_special_order_number` at all, and a staffer
--     is refused BY NAME from inside its body ("insufficient role to number a
--     special order"); a supervisor gets 10000 then 10001;
--   · a supervisor may write a storage object under their own org's folder and
--     NOT under another's, and a junk path is refused by the POLICY rather
--     than raising a cast error (018's wrapper doing its job).
--
-- Each constraint was checked by BREAKING it: the kind/status biconditional in
-- BOTH directions, weekday 8, a second materialized day for one standing order,
-- and — the one that matters — **a materialized day that has been CANCELLED
-- still blocks re-creation**, which is what stops cancelled Thanksgiving from
-- ordering the donuts again on the next page load.
--
-- Then THE WHOLE REAL EXPORT was replayed through the real constraints, which
-- is what found the `qty >= 0` check documented above — it would have failed
-- the production load partway through. After removing it everything loads:
-- the eleven suffixed numbers survive verbatim, `6002` and `6002-2` sit side
-- by side, the ten standing orders carry the right weekday sets, **zero
-- wholesale days are materialized** (decision 13's requirement of the
-- migration), and the money derives in SQL to $2,373,968.82 of revenue over
-- 8,014 orders against $1,882,797.70 of recorded payments.
-- ----------------------------------------------------------------------------
