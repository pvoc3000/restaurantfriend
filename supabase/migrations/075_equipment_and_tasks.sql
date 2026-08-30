-- ============================================================================
-- restaurantfriend — migration 075 · the work spine: equipment and tasks
--
-- Why (Mark, 2026-08-29): "we kind of need to think of checklists, tasks, and
-- maintenance requests as one, interconnected and interdependent module. We
-- might even want to build it all at once."
--
-- This is the first of three. The module is one machine in four costumes:
--
--     Observation  →  Finding  →  Work  →  Verification
--
-- A checklist run, a manager's walkthrough and an inspection log are all
-- OBSERVATIONS (076). A flagged item, an out-of-range fridge and an inspector's
-- citation are all FINDINGS. A task and a maintenance request are the same
-- WORK, at two levels of escalation — and that is this file. The next walk is
-- the verification.
--
-- 075 lands FIRST because 076's `checklist_run_items.task_id` references
-- `location_tasks`, and because equipment is the noun everything else points
-- at.
--
-- THE PAYOFF THIS TABLE EXISTS FOR (Mark, same day): a manager flags the dirty
-- fryer on a walkthrough and it appears on EVERY SUBSEQUENT SUPERVISOR'S
-- CHECKLIST until somebody does it. That is why a task is its own record with
-- one identity and one close, rather than a row copied onto thirty nights: copy
-- it and the task's life is smeared across thirty rows, and "when was this
-- actually finished" becomes a query rather than a column.
--
-- ONE TABLE FOR TASKS AND MAINTENANCE REQUESTS, told apart by `kind` (Mark's
-- choice this session). 035's precedent in his own words — "In retrospect,
-- these should really be all in one table: Events. What were 'ratings' are
-- really just shift events… Events already had different types, what's one more"
-- — and 051's `kind` column. Two nav entries, two `DataTable` screens, one set
-- of policies, one attachments story. Splitting them would duplicate the whole
-- open/close/carry-forward machine to serve a column.
--
-- WHY EQUIPMENT IS IN v1 AND NOT DEFERRED. Without it a task says "the fryer"
-- as a STRING, so nothing can ever be aggregated: no repair history, no
-- per-unit temperature trend, no cost-per-asset. 076's `number` items point at
-- a row here, which is what turns "the walk-in read 39 again" into "this walk-in
-- has crept 36 → 39 over six weeks" — a failing compressor visible before it
-- fails. Adding the FK afterwards would mean matching free text to rows by
-- hand, which is the expensive kind of migration.
--
-- Depends on 001 (orgs, locations, shop_sections, vendors, the RLS helpers),
-- 025 (vendor_invoices).
--
-- Run in the Supabase SQL editor BEFORE deploying — the new screens select
-- these columns, 059's order rather than 012's. NOT rerunnable (create table
-- fails a second time, which is how you know it already ran).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. equipment — the noun
-- ----------------------------------------------------------------------------
create table equipment (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,

  -- Location-scoped, not org-scoped: a walk-in is a thing in a building.
  location_id uuid not null references locations(id) on delete cascade,

  -- Where it stands, in the walk order the guide and the checklist both use.
  -- `on delete set null` matches `inventory_item_locations` — deleting a shelf
  -- must move what stood on it to "No section", never delete the fryer.
  shop_section_id uuid references shop_sections(id) on delete set null,

  name text not null,

  -- Free vocabulary, `PickList allowNew` — 'Walk-in', 'Fryer', 'Mixer', 'Hood'.
  -- Design rule 2: the business's own words are data. NOT a check constraint,
  -- because the next thing that breaks will be a kind nobody listed.
  kind text,

  make text,
  model text,
  serial text,

  installed_on date,

  -- NULL MEANS "DOES NOT LAPSE" — 034's rule verbatim, and the reason no
  -- backfill is needed: every row starts honest. `lib/employeeDocuments`'
  -- `expiryState` / the 60-day "soon" window read this unchanged.
  warranty_ends_on date,

  -- The plumber and the landlord are already vendors, with `order_type: 'none'`
  -- (they never produce an order). `on delete set null` — losing a vendor must
  -- not take the fryer with it.
  service_vendor_id uuid references vendors(id) on delete set null,

  notes text,
  is_active boolean not null default true,

  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- DELIBERATELY NOT unique on (location_id, name). 038's lesson: a name is a
-- LABEL, and a composite unique makes the first rename fail with no order of
-- edits that works — "Walk-in 1" becoming "Walk-in (kitchen)" while a second
-- row already holds that text. The create dialog WARNS instead,
-- `findPossibleRehires`' treatment.
create index equipment_location_idx on equipment (location_id, is_active);
create index equipment_warranty_idx on equipment (org_id, warranty_ends_on)
  where warranty_ends_on is not null;

create trigger equipment_updated_at
  before update on equipment
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- 2. location_tasks — the work
-- ----------------------------------------------------------------------------
create table location_tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  location_id uuid not null references locations(id) on delete cascade,

  -- 'task'        — something the crew does: boil out the fryer, reorder gloves
  -- 'maintenance' — something a vendor does: the compressor, the plumbing
  --
  -- One table, two screens. Promotion between them is an UPDATE, which is the
  -- whole point: "waiting on a plumber" is not a supervisor's task and should
  -- leave the nightly list without losing its history.
  kind text not null default 'task' check (kind in ('task', 'maintenance')),

  title text not null,
  details text,

  shop_section_id uuid references shop_sections(id) on delete set null,
  equipment_id uuid references equipment(id) on delete set null,

  priority text not null default 'normal'
    check (priority in ('low', 'normal', 'high')),

  status text not null default 'open'
    check (status in ('open', 'in_progress', 'done', 'cancelled')),

  -- WHICH SHIFT IS ASKED. "Boil out the fryer before morning" is the closing
  -- shift's job; "call the linen company" is anybody's. NULL means any.
  --
  -- 035's vocabulary VERBATIM and it has to be — 070 learned this the hard way:
  -- a second spelling fails another table's own check halfway through, in front
  -- of somebody standing in a shop at 9pm.
  target_shift text
    check (target_shift in ('opening', 'mid', 'closing', 'off_site')),

  -- Does it ride on every subsequent checklist until it is done? Default TRUE,
  -- because that is what a flagged fryer is for. False is the standing job
  -- somebody wants tracked without putting it in front of a supervisor nightly.
  carry_forward boolean not null default true,

  due_on date,

  -- Where it came from. Filled by 076, which is why the column is added there
  -- rather than here — `checklist_run_items` does not exist yet.

  -- The money seam, unused in v1 and deliberately present: a repair bill is
  -- already an ordinary vendor invoice (025 takes ALL vendor bills, not just
  -- PO-born ones), so cost-to-date per asset is a join away rather than a
  -- migration away.
  vendor_id uuid references vendors(id) on delete set null,
  vendor_invoice_id uuid references vendor_invoices(id) on delete set null,

  resolution_note text,
  done_by uuid references auth.users(id),
  done_at timestamptz,

  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- 032's SHAPE VERBATIM: the requirement rides the DECISION, not the column.
  -- Closing a task because it is done needs no essay — the row says done and
  -- names who and when. CANCELLING is the only record a vanished job ever gets,
  -- so it has to say why. Demanding a sentence for the common case is how
  -- people learn to stop reading the dialog, which is exactly what 029 got
  -- wrong and 032 fixed.
  constraint location_tasks_reason_when_cancelled
    check (status <> 'cancelled' or (resolution_note is not null and btrim(resolution_note) <> ''))
);

-- The nightly question — "what is open at this shop for this shift" — and the
-- record screen's "what is open on this fryer".
create index location_tasks_open_idx on location_tasks (location_id, status)
  where status in ('open', 'in_progress');
create index location_tasks_equipment_idx on location_tasks (equipment_id)
  where equipment_id is not null;
create index location_tasks_org_created_idx on location_tasks (org_id, created_at desc);

create trigger location_tasks_updated_at
  before update on location_tasks
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- 3. RLS
-- ----------------------------------------------------------------------------
-- EQUIPMENT: read is membership — what stands in the shop is a shop-floor fact,
-- and 076's checklist items point at these rows, so anyone who can walk a
-- checklist has to be able to resolve the name. Write is purchaser+
-- (`canWriteCatalog`), because the equipment register is a catalog.
--
-- TASKS: supervisor+ on every verb. This is 044's distinction and it is the one
-- to understand before editing either file — a schedule line is a purchaser's
-- document with two supervisor-writable cells, which is a COLUMN rule and
-- therefore a definer function; a task is a supervisor's own record end to end,
-- which is a ROW rule and therefore a policy. Nothing here is column-scoped.
--
-- THERE IS NO DELETE POLICY ON location_tasks, and that is 059's rule rather
-- than an omission: cancelling IS the eraser, it demands a reason, and a
-- cancelled task drops off every open list by itself. A delete would remove the
-- only record that somebody once thought the fryer needed attention. Note the
-- consequence, which is the same one 059 documented: a `delete` from the app
-- removes ZERO ROWS AND RETURNS NO ERROR, so the screen must never offer one.

alter table equipment enable row level security;
alter table location_tasks enable row level security;

create policy equipment_select on equipment for select
  using (org_id in (select user_org_ids()));

create policy equipment_write on equipment for all
  using (user_has_role(org_id, array['owner', 'admin', 'purchaser']))
  with check (user_has_role(org_id, array['owner', 'admin', 'purchaser']));

create policy location_tasks_select on location_tasks for select
  using (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']));

create policy location_tasks_insert on location_tasks for insert
  with check (
    user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor'])
    and created_by = auth.uid()
  );

-- A task is worked by whoever is on tonight, so UPDATE is not author-scoped the
-- way 070's draft report is: the supervisor who closes the fryer job is by
-- definition not the manager who raised it. WITH CHECK restates the same set —
-- 059's lesson that USING says which rows and WITH CHECK says what they may
-- BECOME, so a row cannot be updated out of its own org.
create policy location_tasks_update on location_tasks for update
  using (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']))
  with check (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']));

-- ============================================================================
-- Probes (run these, don't trust a note in CLAUDE.md):
--
--   select count(*) from equipment;               -- table exists, 0 today
--   select count(*) from location_tasks;          -- table exists, 0 today
--
--   select conname from pg_constraint
--    where conrelid = 'public.location_tasks'::regclass and contype = 'c';
--     → includes location_tasks_reason_when_cancelled
--
--   select polname, polcmd from pg_policy
--    where polrelid = 'public.location_tasks'::regclass;
--     → THREE rows (select, insert, update) and NO delete. A fourth named
--       delete would mean somebody added an eraser that bypasses the reason.
-- ============================================================================
