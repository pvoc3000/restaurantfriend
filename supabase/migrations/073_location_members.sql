-- ============================================================================
-- restaurantfriend — migration 073 · which shops a member may work at
--
-- Why (Mark, 2026-08-29): "in my FMP version of the app, I could give users I
-- granted access to the app to a permission setting, a default location, and
-- set which locations they had access to in the app. We could do something
-- similar and add some settings to the Admin section of the employee detail
-- screen."
--
-- 001 predicted this table by name — "per-location roles can be added later
-- (`location_members`) without disturbing this" — and CLAUDE.md has carried it
-- as an open thread since 2026-08-01, with a note to settle one question
-- before building: whether the rule is "may WORK AT" or "may SEE".
--
-- ---------------------------------------------------------------------------
-- IT IS "MAY WORK AT", AND THAT IS A UI RULE THAT SAYS SO
--
-- Mark's answer (2026-08-29). It restricts which shops you can SWITCH to — the
-- masthead picker and the Locations list's Work here — and therefore which
-- shop's guide, purchase orders, receiving and shift reports you meet in the
-- ordinary course, because every one of those follows the working location.
--
-- It is NOT a data boundary. DF02's rows stay readable to a DF01 member who
-- goes looking, and several screens are deliberately ORG-WIDE — special
-- orders, customers, employees, events, sales all treat location as a filter
-- rather than a scope. Making this a security rule would mean rewriting every
-- location-scoped policy in the schema AND rethinking those screens, which is
-- a different and much larger decision. If it is ever wanted, it is a new
-- migration and this table is the right thing for it to read.
--
-- ---------------------------------------------------------------------------
-- NO ROWS MEANS EVERY LOCATION
--
-- The single most important rule here. An empty table is what exists the
-- moment this migration runs, and it must mean "nobody is restricted" rather
-- than "nobody can work anywhere" — otherwise applying it logs the whole
-- company out of every shop at once.
--
-- So a member with NO rows is unrestricted, and the grid is opt-in per person.
-- It also means the UI has to offer "all shops" as a real state rather than as
-- the absence of one — the `nullif`/`par_by_weekday` discipline: silence and a
-- choice are different sentences.
--
-- ---------------------------------------------------------------------------
-- NO DEFAULT LOCATION COLUMN, DELIBERATELY
--
-- FMP had one and Mark's own reading is that it is redundant (2026-08-29):
-- "it's the default working location on sign in — but we can get that from the
-- location already assigned to them." `employees.main_location_id` is that
-- assignment, and `employees.user_id` is the link, so a new member's first
-- working location is derivable and `org_members.last_active_location_id`
-- already carries every session after it. A column here would be a second
-- answer to a question that already has one.
--
-- ---------------------------------------------------------------------------
-- OWNER AND ADMIN ARE NEVER RESTRICTED
--
-- Enforced in `may_work_at` rather than by refusing to store rows, so the grid
-- can be filled in for somebody who is later promoted without their rows
-- having to be cleared. An owner who can lock themselves out of a shop is a
-- support call, and there is no version of this feature where that is useful.
--
-- Depends on 001 (org_members, locations) and 002 (set_my_member_profile).
-- Run in the Supabase SQL editor BEFORE deploying — the session selects it.
-- NOT rerunnable (create table fails a second time).
-- ============================================================================

create table location_members (
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  location_id uuid not null references locations(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (org_id, user_id, location_id)
);

-- The recipient query and the session both read by member; the Locations screen
-- reads by location.
create index location_members_user_idx on location_members (org_id, user_id);
create index location_members_location_idx on location_members (org_id, location_id);

comment on table location_members is
  'Which shops a member may set as their working location. NO ROWS FOR A '
  'MEMBER MEANS EVERY LOCATION — absence is "unrestricted", never "none". '
  'A UI rule, not a data boundary: see the migration header.';

alter table location_members enable row level security;

-- READ is any member: who works where is a roster fact, and `org_members` is
-- already readable org-wide by 001's `members_read`.
create policy location_members_select on location_members for select
  using (org_id in (select user_org_ids()));

-- WRITE is owner/admin — the same pair that may change a role, which is what
-- `canManageMembers` gates in the app.
create policy location_members_write on location_members for all
  using (user_has_role(org_id, array['owner', 'admin']))
  with check (user_has_role(org_id, array['owner', 'admin']));

-- ----------------------------------------------------------------------------
-- may_work_at — the one definition, so the app and the RPC cannot disagree
-- ----------------------------------------------------------------------------
create or replace function public.may_work_at(
  p_org uuid,
  p_user uuid,
  p_location uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    -- Owner and admin are never restricted — asked of P_USER, not of the
    -- caller. `user_has_role` is hardcoded to `auth.uid()`, so using it here
    -- would answer "may Karina work at DF02?" with MARK's role whenever Mark
    -- is the one asking — which the shift report's recipient query does for
    -- every member on the list. Caught on the harness, where the same call
    -- returned false as superuser and true from inside the session.
    exists (
      select 1 from org_members
       where org_id = p_org and user_id = p_user
         and role in ('owner', 'admin')
    )
    -- No rows at all = unrestricted. This is the clause that makes an empty
    -- table harmless, and it must be checked against the member's OWN rows
    -- rather than the table as a whole.
    or not exists (
      select 1 from location_members
       where org_id = p_org and user_id = p_user
    )
    or exists (
      select 1 from location_members
       where org_id = p_org and user_id = p_user and location_id = p_location
    );
$$;

revoke all on function public.may_work_at(uuid, uuid, uuid) from public;
revoke all on function public.may_work_at(uuid, uuid, uuid) from anon;
grant execute on function public.may_work_at(uuid, uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- set_my_member_profile now refuses a shop you may not work at
-- ----------------------------------------------------------------------------
-- 002's version is reproduced whole (055's rule: a migration that has run is
-- history) and gains ONE check. Without it the grid would be advisory — the
-- picker would hide a shop while a hand-rolled POST still switched to it —
-- and a rule the UI enforces alone is one somebody will eventually route
-- around by accident.
create or replace function public.set_my_member_profile(
  p_location_id  uuid default null,   -- null = leave unchanged
  p_display_name text default null    -- null = leave unchanged, '' = clear
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  select org_id into v_org_id
    from org_members
   where user_id = auth.uid()
   order by created_at
   limit 1;

  if v_org_id is null then
    raise exception 'not a member of any org';
  end if;

  if p_location_id is not null and not exists (
    select 1 from locations
     where id = p_location_id and org_id = v_org_id
  ) then
    raise exception 'location % is not in your org', p_location_id;
  end if;

  -- 073. Named rather than silent: a picker that has gone stale should say
  -- what happened, not appear to work and leave you somewhere else.
  if p_location_id is not null
     and not may_work_at(v_org_id, auth.uid(), p_location_id) then
    raise exception 'you do not have access to that shop';
  end if;

  update org_members
     set last_active_location_id = coalesce(p_location_id, last_active_location_id),
         display_name = case
                          when p_display_name is null then display_name
                          else nullif(btrim(p_display_name), '')
                        end
   where user_id = auth.uid()
     and org_id  = v_org_id;
end $$;

revoke all on function public.set_my_member_profile(uuid, text) from public;
revoke all on function public.set_my_member_profile(uuid, text) from anon;
grant execute on function public.set_my_member_profile(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- After this runs:
--   select count(*) from location_members;                     → 0
--   select public.may_work_at(o.id, m.user_id, l.id)
--     from orgs o, org_members m, locations l limit 1;          → true
--     (every member is unrestricted until somebody ticks a box)
--   select count(*) from pg_proc where proname = 'may_work_at'; → 1
-- ============================================================================
