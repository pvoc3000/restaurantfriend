-- ============================================================================
-- restaurantfriend — migration 039 · production plans
--
-- Phase 3 of the Production module. A PLAN is what we propose to make at some
-- point in the future; a SCHEDULE (phase 4) is what we actually land on for a
-- particular day. Brief decision 1, and the vocabulary is load-bearing:
-- FileMaker called plans "Donut Schedules" and that ambiguity confused even the
-- design conversation until it was pinned.
--
-- NO HISTORY MIGRATES (Mark, 2026-08-07: "We're starting fresh with new plans
-- and schedules"), so there is no transform and no loader for this phase. FMP's
-- 150 plans and 29,083 tray-day slots stay on disk as reference. What the app
-- needs is an editor good enough to build the first plan in.
--
-- Depends on 037 (production_items) and 001. NOT rerunnable.
--
-- ---------------------------------------------------------------------------
-- THE KITCHEN LIVES ON THE PLAN (decision 9)
--
-- FileMaker put where-a-thing-is-MADE on the Location table, which cannot
-- express the thing Donut Friend actually does: DF01 makes DF02's raised
-- donuts while DF02 makes its own cake donuts. That is two answers for one
-- shop, and a column on `locations` has room for one.
--
-- So a plan is (selling location, KITCHEN, date range, trays), and several
-- plans for one shop may be active at once — their union is that shop's menu.
-- `locations.kitchen_by_weekday` and `shops_for` (017) become vestigial the day
-- this ships; retire them from the Location record rather than maintaining two
-- answers to one question.
--
-- ---------------------------------------------------------------------------
-- OVERLAP IS NOT A CONSTRAINT, DELIBERATELY
--
-- 027 taught the btree_gist exclusion idiom and this is exactly where NOT to
-- reach for it. Overlapping date ranges are now the POINT: two concurrently
-- active plans for one shop is the feature. Even the narrower rule — "the same
-- ITEM twice on one shop's overlapping plans" — must not be a constraint,
-- because it is legitimate (the same donut on two trays) and because the pars
-- SUM, which is a thing to warn about at generation rather than to refuse at
-- write time. Decision 9 says so outright: "a generation-time warning, not a
-- constraint", the under-minimum-vendor pattern.
-- ============================================================================

create table production_plans (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,

  -- Where it SELLS. The shop whose display case this describes.
  location_id uuid not null references locations(id) on delete cascade,

  -- Where it is MADE. Usually the same shop; the whole reason this column
  -- exists is that sometimes it isn't. Nullable because a plan can be written
  -- before anyone has decided which kitchen takes it, and a NOT NULL would
  -- force a guess at exactly the moment the answer is unknown.
  kitchen_location_id uuid references locations(id) on delete set null,

  title       text not null,
  starts_on   date not null,
  -- Open-ended: FMP's own plans mostly ran to a date, but "this is the menu
  -- until we say otherwise" is a real thing to want and null says it exactly.
  ends_on     date,

  is_active   boolean not null default true,
  notes       text,

  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- The one ordering rule worth enforcing. Everything else about dates is a
  -- warning; a plan that ends before it starts is a typo.
  constraint production_plans_dates check (ends_on is null or ends_on >= starts_on)
);

create index production_plans_location_idx
  on production_plans (org_id, location_id, starts_on desc);
create index production_plans_kitchen_idx
  on production_plans (kitchen_location_id) where kitchen_location_id is not null;

create trigger trg_production_plans_updated before update on production_plans
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- production_plan_trays — one display tray
-- ----------------------------------------------------------------------------
--
-- The tray × weekday matrix is FMP's best idea in this module: it models the
-- physical display case the way the order guide models the physical walk.
--
-- `band` is what FileMaker called the tier NAME, and it is a category rather
-- than a shelf — measured over its 957 trays: RAISED 245 · CLASSIC 174 ·
-- SIGNATURE 96 · SEASONAL 86 · V CAKE 61 · BISMARK 46 · SCRAP 36 · OLD F 24.
-- Free text with a PickList over what exists, like every other vocabulary here.

create table production_plan_trays (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  plan_id     uuid not null references production_plans(id) on delete cascade,

  -- TEXT, not integer: FMP's are "01", "05", "07" and a case can grow a "7A".
  -- `sort` is what orders them, so the label stays free.
  tray_number text not null,
  band        text,
  sort        integer,

  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  unique (plan_id, tray_number)
);

create index production_plan_trays_plan_idx on production_plan_trays (plan_id, sort);

create trigger trg_production_plan_trays_updated before update
  on production_plan_trays
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- production_plan_tray_items — what sits on that tray on that day
-- ----------------------------------------------------------------------------
--
-- One row per (tray, weekday, item). A slot USUALLY holds one item and may
-- hold several — half a tray of two things is a real arrangement — which is
-- why this is rows rather than a column on the tray.
--
-- Weekday is ISO, 1 = Monday, matching every other weekday in this schema
-- (009's par arrays, `vendor_locations.order_days`). Getting this wrong by one
-- would silently shift a whole menu by a day.

create table production_plan_tray_items (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  tray_id     uuid not null references production_plan_trays(id) on delete cascade,

  weekday     smallint not null check (weekday between 1 and 7),

  -- RESTRICT, not cascade: deleting an item that is on somebody's menu should
  -- say so rather than quietly emptying a tray. The app counts and reports.
  item_id     uuid not null references production_items(id) on delete restrict,

  sort        integer,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- The same item twice in one slot is meaningless. The same item on two
  -- different trays is not, and is allowed.
  unique (tray_id, weekday, item_id)
);

create index production_plan_tray_items_tray_idx
  on production_plan_tray_items (tray_id, weekday, sort);
create index production_plan_tray_items_item_idx
  on production_plan_tray_items (item_id);

create trigger trg_production_plan_tray_items_updated before update
  on production_plan_tray_items
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- RLS — membership reads, purchaser+ writes, as 036 and 037
-- ----------------------------------------------------------------------------
--
-- Same posture: a plan is what the shop is selling, and anyone working there
-- needs to read it. Writing one is catalog-class work.

alter table production_plans enable row level security;
alter table production_plan_trays enable row level security;
alter table production_plan_tray_items enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'production_plans',
    'production_plan_trays',
    'production_plan_tray_items'
  ] loop
    execute format(
      'create policy %I_select on %I for select
         using (org_id in (select user_org_ids()))', t, t);
    execute format(
      'create policy %I_insert on %I for insert
         with check (user_has_role(org_id, array[''owner'',''admin'',''purchaser'']))', t, t);
    execute format(
      'create policy %I_update on %I for update
         using (user_has_role(org_id, array[''owner'',''admin'',''purchaser'']))
         with check (user_has_role(org_id, array[''owner'',''admin'',''purchaser'']))', t, t);
    execute format(
      'create policy %I_delete on %I for delete
         using (user_has_role(org_id, array[''owner'',''admin'',''purchaser'']))', t, t);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- After this, these should read:
-- ----------------------------------------------------------------------------
--   select count(*) from production_plans;              → 0. Nothing migrates;
--     the first plan is built in the app's own editor.
--
--   -- the schema permits what decision 9 requires — two active plans for one
--   -- shop with overlapping dates and different kitchens:
--   insert into production_plans (org_id, location_id, kitchen_location_id,
--     title, starts_on, ends_on)
--   select o.id, l.id, l.id, 'a', current_date, current_date + 30
--     from orgs o, locations l where l.code = 'DF02' limit 1;
--   -- repeated with a different kitchen must SUCCEED, not raise.
