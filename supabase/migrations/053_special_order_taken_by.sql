-- ============================================================================
-- restaurantfriend — migration 053 · "Taken by" becomes a link to an employee
--
-- SQL STARTS AT LINE 62. Everything above it is comment.
--
-- Mark, 2026-08-19: "'taken by' should be a link to an employee".
--
-- ---------------------------------------------------------------------------
-- THE TEXT COLUMN STAYS, AND TWELVE YEARS OF HISTORY IS NOT BACKFILLED.
--
-- That is the measurement, not caution. 7,944 of the 8,330 migrated orders
-- carry a `taken_by` — 58 distinct spellings, nearly all bare first names — and
-- a first pass said 98.7% of them "resolve to an employee". They do not. That
-- figure was first-match-wins over 445 people; checked properly, **2,386 of
-- them (30%) match MORE THAN ONE**:
--
--     mark      1298  → Mark Trombino / Mark Belko
--     adam       558  → Adam Palermo / Adam Corona / Adam Izquierdo
--     amanda     368  → five Amandas
--     sarah      144  → four Sarahs
--     chris · crystal · amy · jaime — two to three each
--
-- A backfill would have attributed 558 orders to whichever Adam sorted first
-- and said nothing about it. So `taken_by` keeps its text, `taken_by_employee_id`
-- is null on every historical row, and the app renders the LINK where there is
-- one and the TEXT where there is not. New orders get the link for free, since
-- `createSpecialOrder` knows who is signed in.
--
-- If the old rows are ever worth resolving it is a human sitting with a list,
-- not a migration guessing.
--
-- ---------------------------------------------------------------------------
-- WHY A DEFINER FUNCTION AND NOT A JOIN.
--
-- 020 gates `employees` SELECT to owner/admin, on the reasoning that the table
-- carries a home address and a date of birth. Special orders are SUPERVISOR+
-- (decision 7). So a supervisor can read every order and cannot read the one
-- table that knows whose name is on it — the same wall 044 hit, and its
-- `production_operators` is the answer applied there.
--
-- This is the second of them, and it is a SECOND FUNCTION rather than a
-- generalised one on purpose. 044 says why in as many words: "Named for its one
-- caller rather than something like `employees_for_picker`, because a general
-- name is an invitation for the columns to creep back." Two columns, two
-- callers, two narrow names.
--
-- It differs from 044's in exactly one way and that difference is the point:
-- this one is scoped by ORG, not by location. A special order belongs to the
-- org (decision 8 — `/special-orders` is exempt from the location gate), and
-- whoever answered the phone is not a fact about a shop.
--
-- ---------------------------------------------------------------------------
-- ON DELETE SET NULL, deliberately. 023 lets an owner delete an employee — for
-- a typo, not for a person — and an order must not go with them. The order then
-- reads as "taken by nobody", which is honest, and the legacy text column is
-- still there for the ones that have one.
--
-- Run in the Supabase SQL editor. Rerunnable (add column if not exists +
-- create or replace).
-- ============================================================================

alter table special_orders
  add column if not exists taken_by_employee_id uuid references employees(id) on delete set null;

comment on column special_orders.taken_by_employee_id is
  'Who took the order, as a link. Null on all 8,330 migrated rows — their first names are ambiguous (see 053). `taken_by` keeps the legacy text.';

-- Every order a person has taken, for the employee record to count later.
create index if not exists special_orders_taken_by_employee_idx
  on special_orders (taken_by_employee_id) where taken_by_employee_id is not null;


/**
 * The roster for the "Taken by" picker: id and NAME, and nothing else.
 *
 * No phone, no address, no date of birth, no wage, no status detail — the two
 * columns a picker needs. Same shape as 044's `production_operators`, scoped by
 * org rather than by location; see the header for why it is a second function.
 */
create or replace function public.special_order_takers(p_org_id uuid)
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
     -- Active and new hires. 417 of 445 rows are terminated, and somebody who
     -- left in 2019 is not who just answered the phone. A historical order
     -- naming one keeps its TEXT, so nothing is lost by leaving them out.
     where e.org_id = p_org_id
       and e.status <> 'inactive'
     order by e.last_name, e.first_name;
end;
$$;

-- 002's rule: a new public function is executable by `anon` under Supabase's
-- defaults, and revoking from PUBLIC does not undo that.
revoke all on function public.special_order_takers(uuid) from public;
revoke all on function public.special_order_takers(uuid) from anon;
grant execute on function public.special_order_takers(uuid) to authenticated;
