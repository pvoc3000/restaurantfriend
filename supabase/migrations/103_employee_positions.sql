-- 103 — the shift report's position vocabulary, readable by the people who
-- write shift reports.
--
-- THE BUG THIS FIXES IS SILENT, WHICH IS WHY IT SURVIVED. The rating page's
-- Position picker is a `PickList` over the shop's own vocabulary, and the run
-- page reads that vocabulary straight off `employees.position` — the third of
-- the three position columns this schema carries, and the one holding the
-- abbreviations a supervisor actually writes ("DF", "Sr. DF", "Overnight
-- Baker"), where `timesheets.position` holds Homebase's Role and
-- `employees.primary_wage_type` holds Gusto's.
--
-- But 020's `employees_select` is OWNER/ADMIN, deliberately — that table
-- carries a home address and a date of birth. So for a SUPERVISOR the select
-- matches zero rows and returns NO error, the picker opens holding nothing,
-- and the one person the shift report is built for has to type a position that
-- is already recorded against every one of their colleagues. Owner/admin saw a
-- full list, which is how it shipped and how it stayed.
--
-- THE FIX IS 020's OWN PREDICTION, VERBATIM: "a supervisor phone list and a
-- 'my own record' view are both real future needs and both COLUMN-scoped, so
-- each arrives as a definer function naming the safe columns … never by
-- loosening this." RLS filters ROWS; "a supervisor may read this one column"
-- is a COLUMN rule, and widening `employees_select` to reach it would hand
-- them the address and the DOB with it.
--
-- 044's `production_operators` and 053's `special_order_takers` are the two
-- precedents, and the second is called TWO LINES ABOVE this one in the same
-- page — the roster of NAMES was already reachable through a definer and the
-- vocabulary of JOBS was not. That asymmetry was the whole defect.
--
-- This is the SAFEST of the three: a name identifies a person, where this
-- returns a distinct set of seventeen job titles and cannot be joined back to
-- anybody. It is aggregate by construction.
--
-- EVERY EMPLOYEE, not just the active ones, which is where it departs from
-- `special_order_takers`. That function filters to non-inactive because
-- somebody who left in 2019 is not who just answered the phone — a claim about
-- PEOPLE. A vocabulary has no such staleness: measured on the live catalog,
-- all employees give 17 distinct positions and non-inactive give 9, and the 8
-- lost include Overnight Baker, General Manager, Kitchen Supervisor, PA and
-- Sr. AB — every one of them a job somebody does at this shop today, absent
-- only because the person filling it is recorded under another title or a
-- stale status. Offering a title nobody currently holds costs one row in a
-- list of seventeen; withholding one costs somebody typing it by hand.
--
-- The picker keeps `allowNew` regardless, so a title this has never seen is
-- still enterable and is never a reason to widen anything here.
--
-- THE RETURNED COLUMN IS `title`, NOT `position` — `position` is a reserved
-- word in a `returns table` list and Postgres refuses it outright (caught by
-- running this, not by reading it). Quoting would work and is worse: the OUT
-- parameter would then shadow `employees.position` inside the body, which
-- plpgsql resolves by raising on any unqualified use. A job title is what these
-- are.
--
-- Rerunnable — `create or replace`, and nothing is dropped.

create or replace function public.employee_positions(p_org_id uuid)
returns table (title text)
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

  -- Supervisor+, matching `special_order_takers`. The run page already refuses
  -- below that (`canEnterCounts`), so this is the stale-session backstop
  -- rather than the gate.
  if not user_has_role(p_org_id, array['owner', 'admin', 'purchaser', 'supervisor']) then
    raise exception 'insufficient role to read the position list';
  end if;

  return query
    select distinct btrim(e.position)::text
      from employees e
     where e.org_id = p_org_id
       and e.position is not null
       and btrim(e.position) <> ''
     order by 1;
end;
$$;

comment on function public.employee_positions(uuid) is
  'The org''s distinct employee position vocabulary — supervisor+, so the shift '
  'report''s rating page can offer it. Column-scoped by design: 020 keeps '
  'employees.select at owner/admin because the row carries an address and a DOB.';

-- 002's rule: a new public function is executable by `anon` under Supabase's
-- defaults, and revoking from PUBLIC does not undo that.
revoke all on function public.employee_positions(uuid) from public;
revoke all on function public.employee_positions(uuid) from anon;
grant execute on function public.employee_positions(uuid) to authenticated;

-- Probe, don't read the ledger:
--
--   select public.employee_positions(null);
--
-- must raise 'no organisation given' from its first statement, which proves the
-- body runs. From a signed-in supervisor session:
--
--   select * from public.employee_positions('<org id>');
--
-- returns the 17 titles where `select position from employees` returns zero
-- rows and no error — which is the pair that says this migration is doing its
-- job rather than merely existing.
