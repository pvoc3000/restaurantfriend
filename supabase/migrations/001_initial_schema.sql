-- ============================================================================
-- restaurantfriend — initial schema (Purchasing module + foundation)
-- Migration 001 · generated 2026-07-21 from Purchasing-Module-Spec v0.10
--
-- Design rules baked in (see spec §0):
--   1. Every table carries org_id — multi-tenant-ready from day one.
--   2. Row Level Security (RLS) on everything; policies are org-scoped.
--   3. No business-specific hardcoding — names/templates live in settings.
--
-- Conventions:
--   * uuid primary keys, gen_random_uuid()
--   * weekday columns: ISO — 1 = Monday … 7 = Sunday
--   * money: numeric(10,2) · quantities: numeric(10,2)
--   * pars/on-hand are in the inventory item's BASE UNIT (spec §4.1);
--     order quantities are in PACKAGES of the chosen vendor item.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. FOUNDATION: orgs, locations, membership
-- ----------------------------------------------------------------------------

create table orgs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  -- org-wide config: billing entity (PO bill-to), PO number format,
  -- email templates, terminology overrides, etc. (spec §0, §4.9)
  settings    jsonb not null default '{}',
  created_at  timestamptz not null default now()
);

create table locations (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  code        text not null,              -- e.g. 'DF01' (short id used everywhere)
  name        text not null,              -- e.g. 'Donut Friend 01 Highland Park'
  kind        text not null default 'physical'
              check (kind in ('physical','virtual')),  -- EVENT = virtual (§4.8)
  is_active   boolean not null default true,
  -- addresses, open hours, per-location settings (shift pages, labor rate, …)
  address     jsonb not null default '{}',   -- {shipping:{...}, phone:...}
  settings    jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  unique (org_id, code)
);

-- Membership: a user belongs to an org with a role. Per-location roles can be
-- added later (location_members) without disturbing this. (spec §0 rule 3)
create table org_members (
  org_id      uuid not null references orgs(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null default 'staff'
              check (role in ('owner','admin','purchaser','staff')),
  display_name text,
  last_active_location_id uuid references locations(id),
  created_at  timestamptz not null default now(),
  primary key (org_id, user_id)
);

-- ----------------------------------------------------------------------------
-- RLS helpers (defined early so policies can use them)
-- ----------------------------------------------------------------------------

create or replace function public.user_org_ids()
returns setof uuid
language sql stable security definer set search_path = public
as $$
  select org_id from org_members where user_id = auth.uid()
$$;

create or replace function public.user_has_role(p_org uuid, p_roles text[])
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from org_members
    where org_id = p_org and user_id = auth.uid() and role = any(p_roles)
  )
$$;

-- updated_at bookkeeping
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ----------------------------------------------------------------------------
-- 1. VENDORS
-- ----------------------------------------------------------------------------

create table vendors (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  name        text not null,
  vendor_type text,                        -- 'Goods', 'Services', … (free text)
  description text,
  order_type  text not null default 'email_po'
              check (order_type in ('email_po','online','in_person','none')),
              -- 'none' = supplier-directory entry (Landlord, plumber — §4.8)
  url         text,
  po_prefix   text,                        -- legacy compat; format is org setting
  notes       text,                        -- operational constraints ("1pm cutoff")
  is_active   boolean not null default true,
  legacy_id   integer,                     -- FMP _PrimaryKey_n, for migration joins
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table vendor_locations (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references orgs(id) on delete cascade,
  vendor_id      uuid not null references vendors(id) on delete cascade,
  location_id    uuid not null references locations(id) on delete cascade,
  account_number text,
  minimum_order  numeric(10,2),            -- per-location minimum (spec §4.8)
  sales_rep      text,
  rep_phone      text,
  rep_email      text,
  order_days     smallint[] not null default '{}',    -- ISO weekdays vendor takes orders
  delivery_days  smallint[] not null default '{}',    -- ISO weekdays vendor delivers
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (vendor_id, location_id)
);

-- ----------------------------------------------------------------------------
-- 2. CATALOG: inventory items ↔ vendor items
-- ----------------------------------------------------------------------------

create table inventory_items (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  name        text not null,               -- 'Flour, All Purpose'
  category    text,                        -- item type: 'Dry Goods', 'Frozen Goods', …
  base_unit   text not null default 'each',-- 'lbs','oz','each','gal' — pars/on-hand unit
  note        text,
  assigned_to uuid references auth.users(id),  -- future feature; column is cheap
  is_active   boolean not null default true,   -- "active master" (§4.7a cascade)
  legacy_id   integer,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table vendor_items (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references orgs(id) on delete cascade,
  vendor_id         uuid not null references vendors(id) on delete cascade,
  inventory_item_id uuid references inventory_items(id) on delete set null,
  product_id        text,                  -- vendor's SKU
  brand             text,
  description       text,
  package_desc      text,                  -- 'BAG', 'CS', 'TUB', 'EA'
  package_content   numeric(10,3),         -- content in the item's base unit (50 = 50 lbs)
  price             numeric(10,2),         -- global/default price
  url               text,
  notes             text,                  -- printed on PO lines ("only order when 1/4 full")
  is_active         boolean not null default true,
  legacy_id         integer,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Rare per-location price override (spec §4.8 — per-account pricing).
create table vendor_item_location_prices (
  vendor_item_id uuid not null references vendor_items(id) on delete cascade,
  location_id    uuid not null references locations(id) on delete cascade,
  org_id         uuid not null references orgs(id) on delete cascade,
  price          numeric(10,2) not null,
  updated_at     timestamptz not null default now(),
  primary key (vendor_item_id, location_id)
);

create table price_history (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references orgs(id) on delete cascade,
  vendor_item_id uuid not null references vendor_items(id) on delete cascade,
  location_id    uuid references locations(id),   -- null = global price change
  old_price      numeric(10,2),
  new_price      numeric(10,2),
  source         text not null default 'manual'
                 check (source in ('manual','receiving','migration')),
  changed_by     uuid references auth.users(id),
  changed_at     timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 3. THE ORDERING PLAN (spec §4.1) + shop walk order
-- ----------------------------------------------------------------------------

create table shop_sections (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references orgs(id) on delete cascade,
  location_id  uuid not null references locations(id) on delete cascade,
  area         text not null,              -- 'Walk In', 'Kitchen', 'Storage'
  sub_area     text,                       -- 'R1 S1'
  display_name text not null,              -- '02 Walk In - R1 S1'
  sort_order   numeric(8,2) not null default 0,  -- numeric: FMP uses 09.5, 13.1 (§4.8)
  created_at   timestamptz not null default now()
);

create table item_locations (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null references orgs(id) on delete cascade,
  inventory_item_id      uuid not null references inventory_items(id) on delete cascade,
  location_id            uuid not null references locations(id) on delete cascade,
  shop_section_id        uuid references shop_sections(id) on delete set null,
  default_vendor_item_id uuid references vendor_items(id) on delete set null,
  default_par            numeric(10,2),    -- in base units
  note                   text,
  is_active              boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (inventory_item_id, location_id)
);

-- One row = "we order this item, at this location, on this weekday."
-- The row's vendor assignment IS the favorite (default, overridable in the
-- moment — spec §4.1). Null vendor/par inherit the item_locations defaults.
create table item_order_days (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references orgs(id) on delete cascade,
  item_location_id uuid not null references item_locations(id) on delete cascade,
  weekday          smallint not null check (weekday between 1 and 7),
  vendor_item_id   uuid references vendor_items(id) on delete set null,  -- override
  par_qty          numeric(10,2),                                       -- override
  par_mode         text not null default 'par' check (par_mode in ('par','fixed')),
  created_at       timestamptz not null default now(),
  unique (item_location_id, weekday)
);

create table par_history (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references orgs(id) on delete cascade,
  item_location_id uuid not null references item_locations(id) on delete cascade,
  weekday          smallint,               -- null = default par changed
  old_par          numeric(10,2),
  new_par          numeric(10,2),
  changed_by       uuid references auth.users(id),
  changed_at       timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 4. GUIDE SESSIONS (the only persisted output of walking the guide — §4.3)
-- ----------------------------------------------------------------------------

create table guide_entries (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references orgs(id) on delete cascade,
  location_id    uuid not null references locations(id) on delete cascade,
  guide_date     date not null,
  vendor_item_id uuid not null references vendor_items(id) on delete cascade,
  on_hand        numeric(10,2),            -- base units; null = not counted
  qty_to_order   numeric(10,2),            -- packages; 0 = explicitly zeroed (red),
                                           -- null = untouched (white) — §4.8 three-state
  entered_by     uuid references auth.users(id),
  entered_at     timestamptz not null default now(),
  unique (location_id, guide_date, vendor_item_id)
);

-- ----------------------------------------------------------------------------
-- 5. PURCHASE ORDERS
-- ----------------------------------------------------------------------------

create table purchase_orders (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id) on delete cascade,
  po_number     text not null,             -- '{vendorLegacyId}-{seq}-{locNum}' via org setting
  vendor_id     uuid not null references vendors(id),
  location_id   uuid not null references locations(id),
  status        text not null default 'draft'
                check (status in ('draft','sent','received','closed','void')),
  sent_via      text check (sent_via in ('email','online','shopping','print')),
  order_date    date not null default current_date,
  delivery_date date,
  notes         text,
  sent_notes    text,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (org_id, po_number)
);

create table po_items (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references orgs(id) on delete cascade,
  po_id            uuid not null references purchase_orders(id) on delete cascade,
  vendor_item_id   uuid references vendor_items(id) on delete set null,
  -- snapshot fields: what was true when ordered (prices/descriptions drift)
  description      text,
  brand            text,
  product_id       text,
  package_desc     text,
  qty_ordered      numeric(10,2) not null default 0,
  qty_received     numeric(10,2),          -- null = not yet received
  unit_price       numeric(10,2),
  discrepancy_note text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table po_attachments (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references orgs(id) on delete cascade,
  po_id        uuid not null references purchase_orders(id) on delete cascade,
  storage_path text not null,              -- Supabase Storage object path
  kind         text not null default 'invoice'
               check (kind in ('invoice','packing_slip','photo','other')),
  added_by     uuid references auth.users(id),
  created_at   timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 6. REMINDERS + PURCHASE REQUESTS (spec §4.7, "Messages" reborn)
-- ----------------------------------------------------------------------------

create table reminders (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references orgs(id) on delete cascade,
  location_id       uuid not null references locations(id) on delete cascade,
  show_on_date      date not null,
  vendor_id         uuid references vendors(id) on delete cascade,
  inventory_item_id uuid references inventory_items(id) on delete cascade,
  message           text not null,
  dismissed_at      timestamptz,
  created_by        uuid references auth.users(id),
  created_at        timestamptz not null default now()
);

create table purchase_requests (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references orgs(id) on delete cascade,
  location_id         uuid not null references locations(id) on delete cascade,
  requested_by        uuid references auth.users(id),
  request_text        text not null,
  photo_path          text,                -- Supabase Storage
  status              text not null default 'open'
                      check (status in ('open','ordered','dismissed')),
  resolved_po_item_id uuid references po_items(id) on delete set null,
  resolved_by         uuid references auth.users(id),
  dismiss_reason      text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 7. TRIGGERS: bookkeeping + automatic history
-- ----------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'vendors','vendor_locations','inventory_items','vendor_items',
    'item_locations','purchase_orders','po_items','purchase_requests'
  ] loop
    execute format(
      'create trigger trg_%s_updated before update on %I
       for each row execute function set_updated_at()', t, t);
  end loop;
end $$;

-- Price changes log themselves (global price)
create or replace function public.log_price_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.price is distinct from old.price then
    insert into price_history (org_id, vendor_item_id, old_price, new_price, source, changed_by)
    values (new.org_id, new.id, old.price, new.price, 'manual', auth.uid());
  end if;
  return new;
end $$;

create trigger trg_vendor_items_price
  after update on vendor_items
  for each row execute function log_price_change();

-- Per-location price overrides log themselves too
create or replace function public.log_location_price_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.price is distinct from old.price then
    insert into price_history (org_id, vendor_item_id, location_id, old_price, new_price, source, changed_by)
    values (new.org_id, new.vendor_item_id, new.location_id, old.price, new.price, 'manual', auth.uid());
  end if;
  return new;
end $$;

create trigger trg_vi_loc_price
  after update on vendor_item_location_prices
  for each row execute function log_location_price_change();

-- Par changes log themselves (default par on item_locations)
create or replace function public.log_par_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.default_par is distinct from old.default_par then
    insert into par_history (org_id, item_location_id, weekday, old_par, new_par, changed_by)
    values (new.org_id, new.id, null, old.default_par, new.default_par, auth.uid());
  end if;
  return new;
end $$;

create trigger trg_item_loc_par
  after update on item_locations
  for each row execute function log_par_change();

-- Par overrides on plan rows
create or replace function public.log_par_override_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.par_qty is distinct from old.par_qty then
    insert into par_history (org_id, item_location_id, weekday, old_par, new_par, changed_by)
    values (new.org_id, new.item_location_id, new.weekday, old.par_qty, new.par_qty, auth.uid());
  end if;
  return new;
end $$;

create trigger trg_item_order_day_par
  after update on item_order_days
  for each row execute function log_par_override_change();

-- ----------------------------------------------------------------------------
-- 8. THE ORDER GUIDE — a view, not a table. (The whole point. Spec §4.6.)
--    App filters by location_id + weekday; renders instantly; no sync scripts.
-- ----------------------------------------------------------------------------

create or replace view v_order_guide as
select
  iod.org_id,
  il.location_id,
  iod.weekday,
  ii.id                                   as inventory_item_id,
  ii.name                                 as item_name,
  ii.category,
  ii.base_unit,
  ss.display_name                         as shop_section,
  ss.sort_order                           as shop_section_sort,
  il.id                                   as item_location_id,
  coalesce(iod.par_qty, il.default_par)   as par_qty,
  iod.par_mode,
  vi.id                                   as vendor_item_id,
  v.id                                    as vendor_id,
  v.name                                  as vendor_name,
  v.order_type                            as vendor_order_type,
  vi.brand,
  vi.description                          as vendor_item_description,
  vi.product_id,
  vi.package_desc,
  vi.package_content,
  coalesce(vilp.price, vi.price)          as effective_price,
  case when vi.package_content > 0
       then round(coalesce(vilp.price, vi.price) / vi.package_content, 4)
  end                                     as unit_price,   -- $ per base unit
  vl.minimum_order                        as vendor_minimum,
  vl.delivery_days                        as vendor_delivery_days,
  -- the active cascade, composed — and explainable (§4.7a)
  (v.is_active and vi.is_active and ii.is_active and il.is_active) as is_orderable,
  case
    when not v.is_active  then 'vendor inactive'
    when not vi.is_active then 'vendor item inactive'
    when not ii.is_active then 'item inactive'
    when not il.is_active then 'item inactive at location'
  end                                     as hidden_reason
from item_order_days iod
join item_locations   il  on il.id = iod.item_location_id
join inventory_items  ii  on ii.id = il.inventory_item_id
left join shop_sections ss on ss.id = il.shop_section_id
left join vendor_items  vi on vi.id = coalesce(iod.vendor_item_id, il.default_vendor_item_id)
left join vendors       v  on v.id  = vi.vendor_id
left join vendor_locations vl on vl.vendor_id = v.id and vl.location_id = il.location_id
left join vendor_item_location_prices vilp
       on vilp.vendor_item_id = vi.id and vilp.location_id = il.location_id;

-- Last-order context per vendor item per location (inline on guide lines — §4.6)
create or replace view v_last_orders as
select distinct on (poi.vendor_item_id, po.location_id)
  po.org_id,
  poi.vendor_item_id,
  po.location_id,
  po.order_date       as last_order_date,
  poi.qty_ordered     as last_qty_ordered,
  poi.qty_received    as last_qty_received,
  poi.unit_price      as last_unit_price
from po_items poi
join purchase_orders po on po.id = poi.po_id
where po.status <> 'void'
order by poi.vendor_item_id, po.location_id, po.order_date desc;

-- ----------------------------------------------------------------------------
-- 9. ROW LEVEL SECURITY
--    Read: any org member. Write: owner/admin/purchaser (staff can create
--    purchase requests and guide entries). service_role bypasses RLS —
--    that's what migration scripts use.
-- ----------------------------------------------------------------------------

alter table orgs                        enable row level security;
alter table locations                   enable row level security;
alter table org_members                 enable row level security;
alter table vendors                     enable row level security;
alter table vendor_locations            enable row level security;
alter table inventory_items             enable row level security;
alter table vendor_items                enable row level security;
alter table vendor_item_location_prices enable row level security;
alter table price_history               enable row level security;
alter table shop_sections               enable row level security;
alter table item_locations              enable row level security;
alter table item_order_days             enable row level security;
alter table par_history                 enable row level security;
alter table guide_entries               enable row level security;
alter table purchase_orders             enable row level security;
alter table po_items                    enable row level security;
alter table po_attachments              enable row level security;
alter table reminders                   enable row level security;
alter table purchase_requests           enable row level security;

create policy org_read on orgs for select
  using (id in (select user_org_ids()));
create policy org_update on orgs for update
  using (user_has_role(id, array['owner','admin']));

create policy members_read on org_members for select
  using (org_id in (select user_org_ids()));
create policy members_write on org_members for all
  using (user_has_role(org_id, array['owner','admin']));

-- Generic policies for org-scoped tables
do $$
declare t text;
begin
  foreach t in array array[
    'locations','vendors','vendor_locations','inventory_items','vendor_items',
    'vendor_item_location_prices','shop_sections','item_locations',
    'item_order_days','purchase_orders','po_items','po_attachments','reminders'
  ] loop
    execute format(
      'create policy %s_read on %I for select
         using (org_id in (select user_org_ids()))', t, t);
    execute format(
      'create policy %s_write on %I for all
         using (user_has_role(org_id, array[''owner'',''admin'',''purchaser'']))
         with check (user_has_role(org_id, array[''owner'',''admin'',''purchaser'']))', t, t);
  end loop;
end $$;

-- History tables: readable by members, written only by triggers/service role
create policy price_history_read on price_history for select
  using (org_id in (select user_org_ids()));
create policy par_history_read on par_history for select
  using (org_id in (select user_org_ids()));

-- Guide entries: any member may enter counts (future: staff walking sections)
create policy guide_read on guide_entries for select
  using (org_id in (select user_org_ids()));
create policy guide_insert on guide_entries for insert
  with check (org_id in (select user_org_ids()));
create policy guide_update on guide_entries for update
  using (org_id in (select user_org_ids()));

-- Purchase requests: any member creates + sees; purchasers resolve
create policy preq_read on purchase_requests for select
  using (org_id in (select user_org_ids()));
create policy preq_insert on purchase_requests for insert
  with check (org_id in (select user_org_ids()));
create policy preq_resolve on purchase_requests for update
  using (user_has_role(org_id, array['owner','admin','purchaser']));

-- ----------------------------------------------------------------------------
-- 10. SEED: the org + known locations. (Everything else arrives via migration.)
-- ----------------------------------------------------------------------------

with new_org as (
  insert into orgs (name, settings) values (
    'Donut Friend',
    '{
      "billing": {
        "entity_name": "DONUT FRIEND, INC.",
        "address1": "543 S Broadway",
        "city": "Los Angeles", "state": "CA", "zip": "90013",
        "phone": "(213) 908-2743", "email": "info@donutfriend.com"
      },
      "po_number_format": "{vendor}-{seq}-{loc}",
      "po_email": { "cc": "info@donutfriend.com" }
    }'::jsonb
  ) returning id
)
insert into locations (org_id, code, name, kind, is_active)
select id, x.code, x.name, x.kind, x.active from new_org,
(values
  ('DF01', 'Donut Friend 01 Highland Park', 'physical', true),
  ('DF02', 'Donut Friend 02 DTLA',          'physical', true),
  ('DF03', 'Donut Friend 03 (Creamo)',      'physical', false),
  ('DF04', 'Donut Friend 04',               'physical', false),
  ('DF05', 'Donut Friend 05',               'physical', false),
  ('EVENT','Offsite Events',                'virtual',  true)
) as x(code, name, kind, active);

-- ============================================================================
-- After running this migration, add yourself to the org (see README §4):
--   1. Supabase Studio → Authentication → Add user (your email + password)
--   2. Run the INSERT in README §4 to make that user an owner.
-- ============================================================================
