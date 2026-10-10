-- ============================================================================
-- 181 — CALENDAR ENTRIES, AND THE FOUR THINGS ONE CAN SWITCH OFF
--
-- Mark, 2026-10-09: "blackout dates. The idea is to create a space where the
-- user can enter dates that do different things: refuse to accept any new
-- special order inquiries… turn off production", and then: "Can we morph this
-- idea into a calendar page for the app? We can add blackout dates there, but
-- also… put down notes, events".
--
-- ONE TABLE FOR BOTH. A note or an event is an entry with no switch on; a
-- blackout is the same entry with one or more on. The switches are independent
-- (Mark: "for maximum flexibility, let's keep production, standing orders, and
-- special orders separate") — "Christmas, we're closed" and "Valentine's, we're
-- open but full" want opposite things from production.
--
--   no_special_orders   /inquiry refuses the date (182); staff are WARNED
--   no_standing_orders  the standing-order top-up skips the day (183)
--   no_production       Generate Schedules skips the day (184)
--   shop_closed         no checklists asked, no closing report or sales expected
--
-- `location_ids` EMPTY MEANS EVERY SHOP — `ui/PickSet`'s convention, and the
-- shape `locations.shops_for` already has (017). An array rather than a
-- junction table because every reader asks one question, "does this entry
-- cover shop X", and `= any()` answers it in the row.
--
-- WHO WRITES IS A ROW RULE, so the policy can state it: a supervisor or a
-- purchaser may write an entry with NO switch on (a note); only a manager or
-- an owner may write one with a switch on, and only they may change or delete
-- one that has.
--
-- An entry never changes anything that already exists. An order or a schedule
-- made before the entry stays; deleting the entry lets the next top-up or
-- generate fill the day.
--
-- This migration changes no existing function. RERUNNABLE.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The table
-- ----------------------------------------------------------------------------
create table if not exists calendar_entries (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references orgs(id) on delete cascade,
  title              text not null check (btrim(title) <> ''),
  starts_on          date not null,
  ends_on            date not null,
  location_ids       uuid[] not null default '{}',
  no_special_orders  boolean not null default false,
  no_standing_orders boolean not null default false,
  no_production      boolean not null default false,
  shop_closed        boolean not null default false,
  note               text,
  created_by         uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint calendar_entries_range check (ends_on >= starts_on)
);

comment on table calendar_entries is
  'A note, an event or a blackout on /calendar (181). All-day, inclusive on '
  'both ends. A blackout is an entry with one or more of the four switches on.';
comment on column calendar_entries.location_ids is
  'The shops this entry is about. EMPTY MEANS EVERY SHOP.';
comment on column calendar_entries.title is
  'Shown on the calendar, and to the CUSTOMER on /inquiry when '
  'no_special_orders is on.';

create index if not exists calendar_entries_range_idx
  on calendar_entries (org_id, starts_on, ends_on);

drop trigger if exists trg_calendar_entries_updated on calendar_entries;
create trigger trg_calendar_entries_updated before update on calendar_entries
  for each row execute function set_updated_at();

alter table calendar_entries enable row level security;

drop policy if exists calendar_entries_select on calendar_entries;
create policy calendar_entries_select on calendar_entries for select
  using (org_id in (select user_org_ids()));

-- The same test three times: managers write anything; a supervisor or a
-- purchaser writes only a row with every switch off. On UPDATE it is both the
-- `using` (the row as it was) and the `with check` (the row as it would be),
-- so a supervisor can neither edit a blackout nor turn a note into one.
drop policy if exists calendar_entries_insert on calendar_entries;
create policy calendar_entries_insert on calendar_entries for insert
  with check (
    user_has_role(org_id, array['owner', 'admin'])
    or (
      user_has_role(org_id, array['purchaser', 'supervisor'])
      and not (no_special_orders or no_standing_orders or no_production or shop_closed)
    )
  );

drop policy if exists calendar_entries_update on calendar_entries;
create policy calendar_entries_update on calendar_entries for update
  using (
    user_has_role(org_id, array['owner', 'admin'])
    or (
      user_has_role(org_id, array['purchaser', 'supervisor'])
      and not (no_special_orders or no_standing_orders or no_production or shop_closed)
    )
  )
  with check (
    user_has_role(org_id, array['owner', 'admin'])
    or (
      user_has_role(org_id, array['purchaser', 'supervisor'])
      and not (no_special_orders or no_standing_orders or no_production or shop_closed)
    )
  );

drop policy if exists calendar_entries_delete on calendar_entries;
create policy calendar_entries_delete on calendar_entries for delete
  using (
    user_has_role(org_id, array['owner', 'admin'])
    or (
      user_has_role(org_id, array['purchaser', 'supervisor'])
      and not (no_special_orders or no_standing_orders or no_production or shop_closed)
    )
  );

revoke all on table calendar_entries from anon;

-- ----------------------------------------------------------------------------
-- 2. "Is this date blacked out here?" — the one question, asked in SQL
-- ----------------------------------------------------------------------------
-- Returns the covering entry's TITLE, or null. `p_location_ids` is every shop
-- the thing being checked touches (an order's pickup shop and its kitchen; a
-- schedule's selling shop and its kitchen): the date is covered if an entry is
-- for every shop, or names any one of them. Nulls in the array are ignored, so
-- a caller can pass `array[location_id, kitchen_location_id]` as they stand.
--
-- `p_effect` is one of 'special_orders' | 'standing_orders' | 'production' |
-- 'closed'. An unknown effect matches nothing rather than raising, because the
-- callers (183, 184) are functions that must not fail a page load.
--
-- INVOKER: a signed-in caller reads through the select policy above; the
-- definer `create_inquiry` (182) calls it as its owner. The TypeScript twin is
-- `blackoutFor` in web/src/lib/blackoutDates.ts — keep the two in step.
create or replace function public.blackout_name(
  p_org_id       uuid,
  p_location_ids uuid[],
  p_date         date,
  p_effect       text
)
returns text
language sql
stable
security invoker
set search_path = public
as $$
  select e.title
    from calendar_entries e
   where e.org_id = p_org_id
     and p_date between e.starts_on and e.ends_on
     and case p_effect
           when 'special_orders'  then e.no_special_orders
           when 'standing_orders' then e.no_standing_orders
           when 'production'      then e.no_production
           when 'closed'          then e.shop_closed
           else false
         end
     and (
       e.location_ids = '{}'
       or e.location_ids && array_remove(coalesce(p_location_ids, '{}'), null)
     )
   order by e.starts_on, e.created_at
   limit 1
$$;

revoke all on function public.blackout_name(uuid, uuid[], date, text) from public, anon, authenticated;
grant execute on function public.blackout_name(uuid, uuid[], date, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. What the PUBLIC /inquiry form may know
-- ----------------------------------------------------------------------------
-- Only the entries that refuse a special order, only from today on, and only
-- the four fields the form draws: never the note, never the other switches.
--
--   { "default_location_id": uuid | null,
--     "entries": [{ "title", "starts_on", "ends_on", "location_ids" }] }
--
-- `default_location_id` is the shop an inquiry is made at when the customer
-- has not named one — `inquiry_price_location(org, null)`, the same call 182
-- makes — so the form can disable exactly the days `create_inquiry` would
-- refuse, instead of guessing and being contradicted after Submit.
--
-- Like `inquiry_shops` (057) it never raises; an unknown org gets no entries.
create or replace function public.inquiry_blackouts(p_org_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v       jsonb;
  v_today date;
begin
  if p_org_id is null then
    return jsonb_build_object('default_location_id', null, 'entries', '[]'::jsonb);
  end if;

  select (now() at time zone coalesce(nullif(o.settings ->> 'timezone', ''), 'UTC'))::date
    into v_today
    from orgs o
   where o.id = p_org_id;

  if v_today is null then
    return jsonb_build_object('default_location_id', null, 'entries', '[]'::jsonb);
  end if;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'title',        e.title,
               'starts_on',    e.starts_on,
               'ends_on',      e.ends_on,
               'location_ids', to_jsonb(e.location_ids)
             )
             order by e.starts_on, e.ends_on
           ),
           '[]'::jsonb
         )
    into v
    from calendar_entries e
   where e.org_id = p_org_id
     and e.no_special_orders
     and e.ends_on >= v_today;

  return jsonb_build_object(
    'default_location_id', inquiry_price_location(p_org_id, null),
    'entries', v);
end;
$$;

revoke all on function public.inquiry_blackouts(uuid) from public, anon, authenticated;
grant execute on function public.inquiry_blackouts(uuid) to anon, authenticated;
