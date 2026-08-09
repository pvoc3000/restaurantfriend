-- ============================================================================
-- restaurantfriend — migration 045 · a batch log is a DOCUMENT with items
--
-- Mark, 2026-08-09, on what 044 got wrong:
--
--   "what we are currently calling 'batch logs' are really 'batch log items',
--    and a batch log record is really just a date the log was generated, who
--    generated it, what the status is … basically a way to associate batch
--    logs together."
--
-- So `production_batch_logs` is the header and `production_batches` becomes its
-- item. That is the same shape `production_schedules` / `production_schedule_items`
-- already has, which is the argument for it: one idiom for "a generated
-- document for a day", not a second one.
--
-- ---------------------------------------------------------------------------
-- THE DATE MOVES TO THE HEADER, and that is the point rather than a detail.
--
-- 044 put `batch_date` on every item and generation spread a week of items
-- across four dates by reading each element's scheduled WEEKDAY. Mark:
--
--   "Weekly production logs is a collection of things that need to be made
--    sometime that week - not on any specific day. Our production staff has two
--    days to get it done and they're free to do it on whatever day and in
--    whatever order. I'm not here to micromanage them."
--
-- With one date on the log, "the date the batch log was generated" is
-- STRUCTURALLY true instead of a convention, and there is no second place for a
-- date to disagree — 016's `nextDeliveryDate` trap, avoided by having one
-- answer. `production_batches.batch_date` is therefore DROPPED.
--
-- ---------------------------------------------------------------------------
-- THE WEEKDAY WAS PROVABLY EMPTY, which is what makes the collapse safe.
--
-- Measured before writing this, over the real data: at DF01, 26 WEEKLY-class
-- element-day rows over 26 DISTINCT elements; at DF02, 30 over 30. **ZERO
-- elements are scheduled on more than one weekday.** The weekday axis has only
-- ever said "once a week" in a needlessly specific way, so collapsing it to
-- (element, kitchen) loses nothing and cannot conflict.
--
-- ---------------------------------------------------------------------------
-- BUT THE WEEKLY PAR IS NOT THE WEEKLY LIST. Mark's "all we need from them are
-- the weekly pars (I think)" is half right, and the half that isn't would have
-- tripled the log: at DF01 **70** element-locations carry a stock par and only
-- **26** are on the weekly list; DF02, 78 against 30. The par says HOW MUCH;
-- something still has to say WHICH. That is what `on_weekly_log` is — it is
-- Mark's "keep the pars and locations from element days" written down, the
-- (element, location) PAIRS being exactly the membership.
--
-- ---------------------------------------------------------------------------
-- `production_element_days` IS NOT DROPPED (Mark: "leave them alone for now").
-- It is still the ONLY source for the packet's AB and Weekly element sheets,
-- which filter by that same dead weekday. Deprecating it here means GENERATION
-- stops reading it — nothing else changes, and the packet is untouched. When
-- those sheets are revisited, this table is what they let go of.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. The weekly list, collapsed onto (element, kitchen)
-- ----------------------------------------------------------------------------
alter table production_element_locations
  -- Whether this kitchen makes this element on its weekly round. NOT derivable
  -- from the par — see the header.
  add column on_weekly_log boolean not null default false,

  -- FileMaker's ORDER column, which Mark asked the list to show. Thin in the
  -- real data (5 of 26 at DF01, 1 of 30 at DF02) and carried across anyway,
  -- because dropping the source of a column he named would be a worse answer
  -- than an empty column.
  add column weekly_sort integer,

  -- FMP's `batchAmount_n` x `batchPortion_t` — "make 2 X", "make 50 #". What
  -- the round asks for, as distinct from the par it is keeping up.
  add column weekly_amount numeric(12,3),
  add column weekly_unit   text;

-- The backfill is 1:1 because no element is scheduled on two weekdays. If that
-- ever stops being true this takes the LOWEST sort, which is the order the
-- kitchen knows the batch by.
with weekly as (
  select distinct on (ed.element_id, ed.location_id)
         ed.element_id, ed.location_id, ed.sort, ed.batch_amount, ed.batch_unit
    from production_element_days ed
    join production_elements e on e.id = ed.element_id
   where not ed.is_excluded
     and e.is_active
     and e.schedule_class = 'WEEKLY'
   order by ed.element_id, ed.location_id, ed.sort nulls last, ed.id
)
update production_element_locations el
   set on_weekly_log = true,
       weekly_sort   = w.sort,
       weekly_amount = w.batch_amount,
       weekly_unit   = w.batch_unit
  from weekly w
 where el.element_id = w.element_id
   and el.location_id = w.location_id;

create index production_element_locations_weekly_idx
  on production_element_locations (location_id, weekly_sort)
  where on_weekly_log;


-- ----------------------------------------------------------------------------
-- 2. production_batch_logs — the document
-- ----------------------------------------------------------------------------
create table production_batch_logs (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,

  -- The KITCHEN. Restrict, like a schedule's: a log is a record of a day's
  -- work, and deleting a shop must not take it.
  location_id uuid not null references locations(id),

  -- THE date — the day the log was generated, and the only date in the model.
  log_date    date not null,

  -- open → complete, and nothing else. A log is a work list: it is being
  -- worked or it is done. `void` is deliberately absent — a log generated by
  -- mistake is DELETED, which its items cascade from.
  status text not null default 'open' check (status in ('open', 'complete')),

  generated_by uuid references auth.users(id),
  generated_at timestamptz not null default now(),
  printed_by   uuid references auth.users(id),
  printed_at   timestamptz,
  note         text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One log per kitchen per day. Generating twice tops the same one up rather
  -- than making a second, which is what "a way to associate batch logs
  -- together" needs to mean.
  unique (location_id, log_date)
);

create index production_batch_logs_day_idx
  on production_batch_logs (org_id, log_date desc, location_id);

create trigger trg_production_batch_logs_updated before update
  on production_batch_logs
  for each row execute function set_updated_at();

alter table production_batch_logs enable row level security;

-- 044's posture, unchanged: a supervisor owns this document.
create policy production_batch_logs_select on production_batch_logs for select
  using (org_id in (select user_org_ids()));

create policy production_batch_logs_insert on production_batch_logs for insert
  with check (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']));

create policy production_batch_logs_update on production_batch_logs for update
  using      (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']))
  with check (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']));

create policy production_batch_logs_delete on production_batch_logs for delete
  using (user_has_role(org_id, array['owner', 'admin', 'purchaser']));


-- ----------------------------------------------------------------------------
-- 3. production_batches becomes the ITEM
-- ----------------------------------------------------------------------------
-- The table KEEPS its name. "A log has batches" reads correctly, it is what the
-- brief's own table list calls the record, and renaming it would move a
-- sequence, four policies, four storage policies and 044's whole surface to buy
-- a word.
--
-- Nothing has ever been logged in production, so this drops and re-adds rather
-- than migrating rows — verified 0 before writing (the walk's test batches were
-- all removed).

-- Every batch belongs to a log. Cascade: deleting the document takes its lines,
-- exactly as a schedule takes its items.
alter table production_batches
  add column log_id uuid references production_batch_logs(id) on delete cascade;

-- `is_generated` replaces `element_day_id` as the marker, because generation no
-- longer reads element days at all and a provenance column pointing at a table
-- we have stopped consulting would be a lie waiting to be believed.
alter table production_batches
  add column is_generated boolean not null default false;

drop index if exists production_batches_generated_key;
drop index if exists production_batches_day_idx;

alter table production_batches
  drop column element_day_id,
  drop column batch_date,
  -- The rhythm's own labels, which the header's rationale retires: with one
  -- date and no weekday there is no shift to speak of.
  drop column shift;

-- log_id is NOT NULL, set after the column exists so the drop above can run on
-- an empty table without a default to invent.
alter table production_batches
  alter column log_id set not null;

-- One GENERATED batch per element per log. Partial, so logging a second,
-- unplanned batch of the same glaze by hand on the same day is still allowed —
-- which happens, and which a full unique index would refuse.
create unique index production_batches_generated_key
  on production_batches (log_id, element_id)
  where is_generated;

create index production_batches_log_idx on production_batches (log_id);


-- ----------------------------------------------------------------------------
-- 4. generate_production_batches — one kitchen, one date
-- ----------------------------------------------------------------------------
-- DROPPED first, not `create or replace`: the parameter RENAME
-- (p_week_start → p_log_date) is refused outright by a replace ("cannot change
-- name of input parameter"), and the return shape changes too.
drop function if exists public.generate_production_batches(uuid, date, boolean, boolean);

create function public.generate_production_batches(
  p_location_id uuid,
  p_log_date    date,
  p_replace     boolean default false
) returns jsonb
language plpgsql
-- SECURITY INVOKER, 013's precedent: every insert flows through the policies
-- above, which is also what lets a supervisor run it. The batch-number sequence
-- is the one thing invoker cannot reach, so numbers come from 044's definer.
set search_path = public
as $$
declare
  v_org      uuid;
  v_loc_code text;
  v_log_id   uuid;
  v_created_log boolean := false;
  v_existing uuid;
  v_number   text;
  v_version_id    uuid;
  v_version_label text;
  v_created  jsonb := '[]'::jsonb;
  v_skipped  jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  d          record;
  w          record;
begin
  if p_log_date is null then
    raise exception 'no date given';
  end if;

  select l.org_id, l.code into v_org, v_loc_code
    from locations l where l.id = p_location_id;

  if v_org is null then
    raise exception 'unknown location %', p_location_id;
  end if;

  if not user_has_role(v_org, array['owner', 'admin', 'purchaser', 'supervisor']) then
    raise exception 'insufficient role to generate a batch log';
  end if;

  -- The log for that day, made if it isn't there. Generating twice TOPS UP one
  -- log rather than making a second — the unique index says so and this is how
  -- it is honoured.
  select id into v_log_id
    from production_batch_logs
   where location_id = p_location_id and log_date = p_log_date;

  if v_log_id is null then
    insert into production_batch_logs (org_id, location_id, log_date, generated_by)
    values (v_org, p_location_id, p_log_date, auth.uid())
    returning id into v_log_id;
    v_created_log := true;
  end if;

  -- Named once, before the loop: an element on the round with no master recipe
  -- still generates — the batch is real and somebody will make it from memory —
  -- but it is what a baker most wants to hear about.
  for w in
    select e.name as element_name
      from production_element_locations el
      join production_elements e on e.id = el.element_id
     where el.location_id = p_location_id
       and el.on_weekly_log
       and el.is_active
       and e.is_active
       and e.kind = 'made'
       and not exists (
         select 1
           from production_recipe_versions v
           join production_recipes r on r.id = v.recipe_id
          where r.element_id = e.id and v.is_master
       )
     order by e.name
  loop
    v_warnings := v_warnings || jsonb_build_object(
      'kind', 'no_master_recipe', 'element_name', w.element_name);
  end loop;

  -- ONE TABLE, at the grain the fact actually has. No weekday, no shift, no
  -- collapse — `production_element_locations` is already one row per
  -- (element, kitchen).
  for d in
    select el.element_id,
           el.weekly_sort,
           el.weekly_amount,
           el.weekly_unit,
           el.stock_count,
           el.stock_size,
           el.stock_unit,
           e.name as element_name
      from production_element_locations el
      join production_elements e on e.id = el.element_id
     where el.location_id = p_location_id
       and el.on_weekly_log
       and el.is_active
       and e.is_active
     order by el.weekly_sort nulls last, e.name
  loop
    select b.id into v_existing
      from production_batches b
     where b.log_id = v_log_id
       and b.element_id = d.element_id
       and b.is_generated;

    if v_existing is not null and not p_replace then
      v_skipped := v_skipped || jsonb_build_object(
        'batch_id', v_existing, 'element_name', d.element_name, 'reason', 'exists');
      continue;
    end if;

    select v.id, v.version_label
      into v_version_id, v_version_label
      from production_recipe_versions v
      join production_recipes r on r.id = v.recipe_id
     where r.element_id = d.element_id and v.is_master
     limit 1;

    if v_existing is null then
      v_number := public.next_batch_number(p_location_id);

      insert into production_batches (
        org_id, log_id, element_id, location_id, is_generated,
        batch_number, sort,
        created_by, recipe_version_id, recipe_version_label,
        batch_amount, batch_unit,
        par_count, par_size, par_unit, status)
      values (
        v_org, v_log_id, d.element_id, p_location_id, true,
        v_number, d.weekly_sort,
        auth.uid(), v_version_id, v_version_label,
        d.weekly_amount, d.weekly_unit,
        d.stock_count, d.stock_size, d.stock_unit, 'to_do');

      v_created := v_created || jsonb_build_object(
        'element_name', d.element_name, 'batch_number', v_number);
    else
      -- REPLACE refreshes what the round says and leaves every measured thing
      -- alone: status, on-hand, yield, notes, photo, operator and the cost
      -- snapshot are untouched. There is no yield guard here, unlike 044's:
      -- nothing this rewrites can destroy a measurement.
      update production_batches
         set sort                 = d.weekly_sort,
             batch_amount         = d.weekly_amount,
             batch_unit           = d.weekly_unit,
             par_count            = d.stock_count,
             par_size             = d.stock_size,
             par_unit             = d.stock_unit,
             recipe_version_id    = v_version_id,
             recipe_version_label = v_version_label
       where id = v_existing;
    end if;
  end loop;

  return jsonb_build_object(
    'log_id',        v_log_id,
    'log_date',      p_log_date,
    'new_log',       v_created_log,
    'location_id',   p_location_id,
    'location_code', v_loc_code,
    'created',       v_created,
    'skipped',       v_skipped,
    'warnings',      v_warnings);
end;
$$;

revoke all on function public.generate_production_batches(uuid, date, boolean) from public;
revoke all on function public.generate_production_batches(uuid, date, boolean) from anon;
grant execute on function public.generate_production_batches(uuid, date, boolean) to authenticated;


notify pgrst, 'reload schema';


-- ----------------------------------------------------------------------------
-- After this, these should read:
-- ----------------------------------------------------------------------------
--   select count(*) from production_element_locations where on_weekly_log;
--     → 56 (DF01 26 + DF02 30), which is the weekly list and NOT the 148 rows
--       carrying a stock par.
--
--   select count(*) from production_batch_logs;                        → 0
--   select count(*) from production_batches;                           → 0
--
--   select pg_get_function_arguments(oid) from pg_proc
--    where proname = 'generate_production_batches';
--     → exactly ONE row, naming p_log_date. Two rows would mean the drop was
--       skipped and a stale weekly overload is still live.
--
--   select column_name from information_schema.columns
--    where table_name = 'production_batches'
--      and column_name in ('batch_date', 'shift', 'element_day_id');
--     → 0 rows. The date lives on the log now.
--
-- `production_element_days` is UNCHANGED and still has 1,105 rows: the packet's
-- AB and Weekly element sheets read it and were deliberately left alone.
-- ----------------------------------------------------------------------------
