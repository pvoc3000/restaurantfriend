-- ============================================================================
-- restaurantfriend — migration 209 · a new employee gets an Organization ID
-- ============================================================================
-- Mark, 2026-10-20: "when creating a new employee, they should be assigned an
-- organization ID. We can start from 1000 so we don't duplicate anything from
-- FMP."
--
-- "Organization ID" is the label the employee record's Payroll tab already
-- gives `employees.legacy_id` — FileMaker's Employee_ID, and the number
-- Homebase exports as `Payroll ID` (030), which is how timesheet imports find
-- the person. Until now someone created in the app had none unless it was
-- typed in by hand. Measured before writing this: 449 people, 447 numbered,
-- range 1–739 (738 and 739 typed by hand for two app-created hires), no number
-- at or above 1000, one org. So 1000 clears everything FileMaker issued.
--
-- What changes:
-- 1. `orgs.settings.hr.first_employee_number` = 1000, where it isn't set —
--    design rule 2, the `customer_invoices.first_number` pattern (146).
-- 2. A BEFORE INSERT trigger fills `legacy_id` when the insert leaves it null:
--    the larger of (the org's highest + 1) and that first number. So the next
--    is 1000, then 1001… An insert that names its own number (the FileMaker
--    loader) keeps it, and the field stays editable on the Payroll tab.
--    Why a trigger rather than a column default or a sequence: a default
--    can't see the row's `org_id`, and one shared sequence would number every
--    org from the same counter. The advisory lock makes two creates at once
--    take turns, so they can't both read the same highest number; the existing
--    `unique (org_id, legacy_id)` is the backstop either way.
-- 3. Dulce Hernandez, created in the app this morning with no number, gets
--    the first one (1000). Marcos Benavidez (inactive, no number) is left
--    blank — Mark's choice.
--
-- Order: apply this; the web change (the delete dialog no longer calls a 1000+
-- number "migrated from FileMaker") can deploy before or after.
--
-- Run in the Supabase SQL editor. RERUNNABLE.
-- ============================================================================

begin;

update public.orgs
   set settings = jsonb_set(
         coalesce(settings, '{}'::jsonb),
         '{hr}',
         coalesce(settings -> 'hr', '{}'::jsonb) || '{"first_employee_number": 1000}'::jsonb
       )
 where settings #> '{hr,first_employee_number}' is null;

create or replace function public.assign_employee_number()
returns trigger
language plpgsql
-- Definer, so the highest number is read over EVERY employee in the org and
-- not only the rows the inserting user's RLS lets them see.
security definer
set search_path = public
as $$
declare
  v_first text;
begin
  if new.legacy_id is not null then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtext('employee_number:' || new.org_id::text));
  select settings #>> '{hr,first_employee_number}' into v_first from orgs where id = new.org_id;
  select greatest(coalesce(max(legacy_id), 0) + 1,
                  case when v_first ~ '^[0-9]{1,9}$' then v_first::int else 1000 end)
    into new.legacy_id
    from employees
   where org_id = new.org_id;
  return new;
end;
$$;

revoke all on function public.assign_employee_number() from public, anon, authenticated;

drop trigger if exists trg_employees_number on public.employees;
create trigger trg_employees_number before insert on public.employees
  for each row execute function public.assign_employee_number();

-- Dulce Hernandez. By id, and only while still blank, so a rerun (or a number
-- typed in since) leaves her alone.
update public.employees
   set legacy_id = 1000
 where id = 'bac5ae00-8088-4ddb-a7ec-e2e89d497937'
   and legacy_id is null;

commit;

notify pgrst, 'reload schema';

-- ----------------------------------------------------------------------------
-- After this runs (read-only):
--   select settings #> '{hr,first_employee_number}' from orgs;            → 1000
--   select legacy_id from employees where id = 'bac5ae00-8088-4ddb-a7ec-e2e89d497937'; → 1000
--   select tgname from pg_trigger where tgname = 'trg_employees_number';  → 1 row
-- ============================================================================
