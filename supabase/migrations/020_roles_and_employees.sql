-- ============================================================================
-- restaurantfriend — migration 020 · the employee record, and a fifth role
--
-- Why (Mark, 2026-08-01): the app has exactly one user. FMP granted access by
-- typing a username and a PLAIN-TEXT password into two fields on the employee
-- record's ADMIN tab — beside the SSN on the INFO tab of the same record — and
-- picking a "user level" from a 1–5 radio whose meaning lived only in script
-- logic. Everyone with employee access could read everyone's credentials.
--
-- The structural fix is that an EMPLOYEE and a USER are two records, linked:
--
--   employees    the HR record. All ~445 people who ever worked here, almost
--                all terminated. Exists whether or not the person can sign in.
--                Ratings, events, reviews and timesheets will hang off this.
--   org_members  app access (001, already the basis of every RLS policy).
--                A row exists ONLY for someone who can sign in.
--   the link     employees.user_id — nullable (most employees never get
--                access), unique (one person is one login).
--
-- So granting access becomes an ACTION an admin takes on an employee record,
-- not a side effect of a job category. Credentials never touch this database:
-- the invite flow (edge function `invite-member`) hands out a Supabase invite
-- link and the person sets their own password.
--
-- The COLUMNS are here; the VALUES come from the FMP re-export, which lives
-- outside the database — run `migration/transform-hr.mjs` then
-- `migration/load-hr.mjs`. Same division of labour as 010 and 017.
--
-- 021 adds employee documents + their Storage bucket and depends on this file
-- (FK to employees). Apply 020 first. Split so that a problem in the storage
-- half cannot hold the data load hostage — 018's precedent.
--
-- Run in the Supabase SQL editor. NOT rerunnable (create table / add column
-- fail a second time — that means it already ran).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. A fifth role: supervisor
-- ----------------------------------------------------------------------------
-- FMP's levels were 1 staff · 2 supervisor (app access) · 3 manager (desktop)
-- · 4 unused · 5 owner. Mark's mapping onto this schema puts purchasing
-- between supervisor and manager, giving:
--
--   staff · supervisor · purchaser · admin ("Manager" in the UI) · owner
--
-- 'admin' is NOT renamed — it is the value every existing policy names, and a
-- rename would be a rewrite of the whole RLS surface to change a label. The
-- label lives in web/src/lib/roles.ts (ROLE_LABEL), the way ORDER_TYPE_LABEL
-- already labels the vendors' check constraint.
--
-- This is the ONLY role change in this migration, and that is deliberate. Every
-- policy in the schema is one of two shapes:
--
--   membership-only  `org_id in (select user_org_ids())` — role-blind, so a
--                    supervisor inherits it automatically. That is every read
--                    in the app, plus order_guide_entries insert/update,
--                    purchase_requests select/insert, and (via 002)
--                    set_my_member_profile. Exactly what a supervisor needs to
--                    walk the guide and raise a request.
--   explicit array   `user_has_role(org_id, array['owner','admin','purchaser'])`
--                    — the 13-table write loop in 001, preq_resolve,
--                    next_po_number, create_purchase_orders_from_guide (016),
--                    018's three storage writes, and both edge functions.
--                    'supervisor' is not in those arrays, so a supervisor
--                    correctly cannot write the catalog or create a PO.
--
-- So the new role lands with zero policy edits. When supervisors get shift
-- reports and production schedules, those tables' own policies name the role.
--
-- Widening a check constraint can't invalidate an existing row.
alter table org_members drop constraint org_members_role_check;
alter table org_members add constraint org_members_role_check
  check (role in ('owner', 'admin', 'purchaser', 'supervisor', 'staff'));

-- When the invite was sent. The App access block on the employee screen reads
-- this to say "invited 3 days ago, hasn't signed in yet"; without it a pending
-- invite and a member who never sets a display name look identical.
--
-- Written only by the `invite-member` edge function (service client). Readable
-- through 001's members_read, which any member already passes — a member can
-- see roles, so "invited on" is no escalation.
alter table org_members add column invited_at timestamptz;

-- ----------------------------------------------------------------------------
-- 2. The employee record
-- ----------------------------------------------------------------------------
-- What is deliberately NOT here (Mark, 2026-08-01):
--
--   SSN            never migrates. It is in FMP and in Gusto, which needs it
--                  for W-2s; nothing this app does requires it, and a web-
--                  reachable database is the wrong home for it.
--   pay rates      the payroll module's business. FMP kept a four-row rate card
--                  per employee AND a rate on every timesheet row; both come
--                  across when Time & Payroll is built.
--   earns tips     payroll-adjacent, same reasoning.
--   COVID vax, CalSavers, commuter benefit, POS PIN, payroll name overrides
--                  vestigial or never populated. They stay in the export file,
--                  recoverable if a module ever wants them.
--
-- Kept from the same tab: the food handler card expiry, which is legally
-- relevant and genuinely maintained (dates run to 2028).
create table employees (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,

  -- The access link. NO `on delete cascade`, and no delete of auth users
  -- anywhere: 001's audit columns (price_history.changed_by, par_history,
  -- order_guide_entries.entered_by, purchase_orders.created_by …) reference
  -- auth.users WITHOUT cascade, so deleting a user would be refused for anyone
  -- who ever changed a price — and the history should keep its author anyway.
  -- Access is removed by deleting the org_members row and banning the auth
  -- user; see the `invite-member` function.
  user_id     uuid unique references auth.users(id),

  -- FMP's EmployeeID. The join key every child file uses (Events, Reviews,
  -- Ratings, Timesheets all reference it), so it has to survive the migration
  -- even though nothing in THIS module reads it — those modules are next.
  legacy_id   integer,

  -- FMP: Active 26 / New Hire 2 / Inactive 417. A closed set, labelled in
  -- web/src/lib/employees.ts.
  status      text not null default 'active'
              check (status in ('active', 'new_hire', 'inactive')),

  last_name   text not null,
  first_name  text not null,
  nickname    text,
  phone       text,
  email       text,

  -- ONE text blob, not jsonb. `locations.address` is jsonb because
  -- lib/poProcessing.ts reads `address.shipping` structurally to print a PO's
  -- ship-to; nothing reads an employee address structurally, and splitting 445
  -- messy free-text values into street/city/zip would manufacture errors for a
  -- reader that doesn't exist. A future module with a real need gets a
  -- migration.
  address     text,

  date_of_birth date,

  -- FMP's Location (DF00/DF01/DF02/DF03 — the same codes as the purchasing
  -- export, so they join cleanly). "Main" location: where someone mostly
  -- works, not a restriction on where they may work. Per-location ACCESS
  -- restriction is deliberately not built (Mark wants to revisit it).
  main_location_id uuid references locations(id),

  -- FMP's Full/Part Time: Part Time 365 · Full Time 39 · Full Time + 20 ·
  -- Part Time + 17 · "N-A" 3. Null covers N-A and blank.
  schedule    text
              check (schedule in ('part_time', 'full_time',
                                  'full_time_plus', 'part_time_plus')),

  employment_type text,
  start_date  date,

  -- FMP has no termination date — 417 inactive employees and no record of when
  -- they left. Nullable, backfilled null, filled going forward.
  end_date    date,

  -- 20 free-typed values in FMP, with typo variants ("Sr. DF" and "Sr.DF").
  -- NOT a check constraint: the vocabulary is Donut Friend's own and grows.
  -- The transform normalises the obvious duplicates once; after that it's a
  -- PickList with allowNew, the inventory-category pattern.
  position    text,

  notes       text,

  -- FMP's FHC EX. DATE.
  food_handler_expires date,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- Multiple NULLs are allowed by a Postgres unique index, so employees
  -- created in the app (no FMP row) don't collide.
  unique (org_id, legacy_id)
);

create index employees_org_idx      on employees (org_id);
create index employees_location_idx on employees (main_location_id);

create trigger trg_employees_updated before update on employees
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- 3. RLS — the first table where READ is role-gated
-- ----------------------------------------------------------------------------
-- Every other table in this schema is "any member reads, purchaser+ writes".
-- That is wrong here: this row carries a home address, a date of birth, a
-- personal phone number and eventually a write-up. Read is owner/admin only —
-- the same people who could open the HR file in FMP.
--
-- A supervisor phone list and a "my own record" view are both real future
-- needs (the master plan lists rosters and phone lists). Both are COLUMN-
-- scoped, and RLS filters rows rather than columns, so each arrives as a
-- security definer function naming exactly the safe columns — the
-- set_my_member_profile pattern from 002. Not built now.
alter table employees enable row level security;

create policy employees_select on employees for select
  using (user_has_role(org_id, array['owner', 'admin']));

create policy employees_insert on employees for insert
  with check (user_has_role(org_id, array['owner', 'admin']));

create policy employees_update on employees for update
  using (user_has_role(org_id, array['owner', 'admin']))
  with check (user_has_role(org_id, array['owner', 'admin']));

-- NO delete policy, deliberately — the same enforcement-by-absence as
-- order_guide_entries. An employee is TERMINATED (status = 'inactive'), never
-- deleted: they are the referent of every rating, timesheet and purchase order
-- they ever touched. A delete from the app matches zero rows.
--
-- SUPERSEDED BY MIGRATION 023 (2026-08-02): delete is now open to owner/admin,
-- because this reasoning covers a person and not a typo — see 023's own header
-- for the argument and for where the guard went instead. Left standing rather
-- than edited: this is what the table was, and 023 is why it changed.
--
-- Note this migration adds no new FUNCTION, so there is nothing to revoke from
-- anon (the 002 / 018 lesson applies to functions, not tables).

-- ============================================================================
-- Verify (in the SQL editor, after running):
--
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conrelid = 'org_members'::regclass and contype = 'c';
--                                              -- five roles incl. supervisor
--   select invited_at from org_members limit 1;         -- column exists
--   select count(*) from employees;                     -- 0 before the load
--   select policyname, cmd from pg_policies
--    where tablename = 'employees';                     -- select/insert/update
--                                                       -- and NO delete
-- ============================================================================
