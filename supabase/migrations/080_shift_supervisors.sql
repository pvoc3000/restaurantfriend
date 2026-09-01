-- ============================================================================
-- restaurantfriend — migration 080 · the shift's supervisor is you, unless it
--                                    isn't
--
-- Two functions, from one exchange (Mark, 2026-09-01). He first asked that the
-- supervisor picker be "filtered by employees with the 'supervisor' and
-- 'manager' positions", then asked the better question: "why are we setting the
-- supervisor who's filling out the report? Why not just use whoever is logged
-- in?"
--
-- Measured on the live database before answering, which is what decided the
-- shape:
--
--   * 3 of 3 app users are linked to an employee record (`employees.user_id`).
--     So a default taken from the login works for EVERYBODY today, rather than
--     for one person with the rest silently getting nothing.
--   * 4 of the 5 real reports have supervisor = author.
--   * The fifth is 2026-08-28, where Mark filed the closing report for Test.
--
-- So the login supplies the DEFAULT and the picker survives for the fifth case
-- — a handover, a manager filing for somebody, a correction the next morning.
-- 070 declined a unique constraint on (location, date, shift) precisely because
-- a handover produces two reports for one night; the same shift really can be
-- somebody else's.
--
-- ---------------------------------------------------------------------------
-- 1. my_employee_id — "which employee am I?"
--
-- CLAUDE.md predicted this function in as many words. 056's own known gap says
-- of the special-order create path: "Resolving the signed-in member to their
-- employee row needs `employees.user_id`, which a supervisor cannot read — a
-- third definer, not built." This is it, and `special_orders.taken_by` can seed
-- itself from the same call whenever that is picked up.
--
-- It answers ONLY for the caller. There is no id parameter to point at somebody
-- else, so it cannot be turned into a lookup: 020 gates `employees` READ to
-- owner/admin because the row carries a home address and a date of birth, and
-- nothing here widens that by a column. Membership is the gate, because knowing
-- who YOU are is not a privilege — `set_my_member_profile`'s reasoning.
--
-- Null is a real answer, not a failure: `employees.user_id` is nullable, so an
-- app user with no HR record simply has no employee to be. The report's
-- supervisor column is nullable too, and page 1's picker is how it gets set.
--
-- ---------------------------------------------------------------------------
-- 2. shift_supervisors — who the picker offers
--
-- Both pickers read 053's `special_order_takers`, which returns the whole
-- non-inactive roster — 28 people, of whom 11 could ever run a shift. That is
-- not merely long: the commonest way to fill this field wrongly is to pick the
-- name above or below the right one.
--
-- WHY A SECOND NARROW FUNCTION RATHER THAN A COLUMN ON THE FIRST. `employees`
-- READ is owner/admin (020), so a SUPERVISOR — the person actually writing the
-- report — cannot read the table that knows anybody's position. The filter has
-- to happen inside a definer or not at all. Widening `special_order_takers` to
-- return `position` was rejected twice over: changing a function's RETURN TYPE
-- needs a drop and recreate, and that one has three other callers (special
-- orders, tasks, the ratings roster) which would all have to be re-verified for
-- a column none of them wants; and 053's own header says what it returns and
-- why — "id and NAME, and nothing else". 044's `production_operators` and 053
-- are both second narrow functions for exactly this reason. This is the third.
--
-- The full roster is still fetched beside this one on both screens: it resolves
-- the NAME of whoever is already recorded, including somebody who has since
-- changed position or left. The app appends that person to the list rather than
-- dropping them — a `PickList` renders an unknown value as its raw uuid.
--
-- WHICH POSITIONS, MEASURED RATHER THAN ASSUMED. `employees.position` is the
-- third of the three position vocabularies this schema carries (031) and the
-- one holding the shop's own words. Counted over all 443 rows that have one, by
-- non-inactive / total:
--
--     Supervisor        9 / 45        FOH                0 / 114
--     DF                6 / 107       BOH                0 / 53
--     Sr. DF            3 / 37        Sr. AB             0 / 7
--     Baker             3 / 27        Overnight Baker    0 / 2
--     Manager           2 / 10        Contractor         0 / 2
--     Sr. Baker         2 / 5         PA                 0 / 1
--     AB                1 / 16        Kitchen Supervisor 0 / 1
--     Fryer             1 / 12        General Manager    0 / 1
--     Overnight Fryer   1 / 3
--
-- So the filter is 11 of the 28 people who could be offered today.
--
-- IT IS A CONTAINS MATCH, NOT AN EQUALS. "Kitchen Supervisor" and "General
-- Manager" are plainly the thing Mark named, and an equals test would withhold
-- them for a spelling. Both are inactive today, so this costs nothing now and
-- is right the day one of them is filled — which is the point of choosing it
-- while the answer is free. Case-insensitive for the same reason.
--
-- ---------------------------------------------------------------------------
-- PROBE, don't read a note in a file:
--
--   select public.my_employee_id(
--     (select org_id from org_members limit 1));   -- your own employee uuid
--
-- CORRECTED 2026-09-01, after applying: from a SERVICE_ROLE script that probe
-- does not return null, it RAISES 'Not your organisation'. `user_org_ids()`
-- resolves from `auth.uid()`, which service_role has none of, so the empty set
-- fails the org guard before the lookup is ever reached — migration 014's
-- footgun, one layer earlier than this header guessed. That raise is a PASS: it
-- proves the body ran. To tell it apart from the function being absent, probe a
-- deliberate typo as a control, which answers 'Could not find the function'.
-- Only this comment changed; the SQL below is byte-identical to what was run.
--
--   select * from public.shift_supervisors(
--     (select org_id from org_members limit 1));   -- 11 rows today
--
--   select public.shift_supervisors(null);         -- raises 'no organisation given'
--
--   select proname, count(*) from pg_proc
--    where proname in ('my_employee_id', 'shift_supervisors')
--    group by 1;                                   -- 1 each
--
-- That last one matters: two rows would mean an argument list drifted and an
-- overload is live beside this (033's `freeze_pay_period` trap).
--
-- Depends on 020 (employees, employees.user_id) and 053 (the function both of
-- these are modelled on). Run in the Supabase SQL editor. RERUNNABLE.
-- ============================================================================

/**
 * Which employee the CALLER is, or null if their login has no HR record.
 *
 * Takes no employee id and returns no column but the key, so it can only ever
 * answer for you. Scoped by org because an employee belongs to one.
 */
create or replace function public.my_employee_id(p_org_id uuid)
returns uuid
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_org_id is null then
    raise exception 'no organisation given';
  end if;

  if p_org_id not in (select user_org_ids()) then
    raise exception 'Not your organisation';
  end if;

  -- `employees.user_id` is unique, so this is at most one row. No status test:
  -- if your own record has been marked inactive that is a thing to fix on the
  -- record, not a reason to stop knowing who you are.
  select e.id into v_id
    from employees e
   where e.org_id = p_org_id
     and e.user_id = auth.uid();

  return v_id;
end;
$$;

comment on function public.my_employee_id(uuid) is
  'The caller''s own employees.id, or null when their login has no HR record. Answers only for auth.uid() — see migration 080.';

/**
 * The roster for the SHIFT SUPERVISOR picker: id and name, supervisors and
 * managers only.
 *
 * 053's `special_order_takers` with one extra `where` and the same everything
 * else — same two columns, same org guard, same role gate, same exclusion of
 * people who have left. A historical report naming somebody who has since moved
 * on keeps its link; the app resolves that name from the full roster.
 */
create or replace function public.shift_supervisors(p_org_id uuid)
returns table (id uuid, name text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_org_id is null then
    raise exception 'no organisation given';
  end if;

  if p_org_id not in (select user_org_ids()) then
    raise exception 'Not your organisation';
  end if;

  if not user_has_role(p_org_id, array['owner', 'admin', 'purchaser', 'supervisor']) then
    raise exception 'insufficient role to read the roster';
  end if;

  return query
    select e.id,
           (coalesce(nullif(btrim(e.nickname), ''), e.first_name)
             || ' ' || e.last_name)::text
      from employees e
     where e.org_id = p_org_id
       -- Active and new hires, 053's rule: somebody who left in 2019 did not
       -- run last night's shift.
       and e.status <> 'inactive'
       and (e.position ilike '%supervisor%' or e.position ilike '%manager%')
     order by e.last_name, e.first_name;
end;
$$;

comment on function public.shift_supervisors(uuid) is
  'Supervisors and managers, id and name only, for the shift report''s supervisor picker. 053''s shape narrowed by position — see migration 080.';

-- 002's rule, live on every function in this schema: a new public function is
-- executable by `anon` under Supabase's defaults, and revoking from PUBLIC does
-- NOT undo that. Revoke from `anon` BY NAME.
revoke all on function public.my_employee_id(uuid) from public;
revoke all on function public.my_employee_id(uuid) from anon;
grant execute on function public.my_employee_id(uuid) to authenticated;

revoke all on function public.shift_supervisors(uuid) from public;
revoke all on function public.shift_supervisors(uuid) from anon;
grant execute on function public.shift_supervisors(uuid) to authenticated;
