-- ============================================================================
-- restaurantfriend — migration 030 · timesheet imports
--
-- Phase 3 of docs/timesheets-brief.md (the brief numbers this 028; Invoices took
-- 025/026 the same day it was written, so add two). Depends on 028.
--
-- A per-run record of every Homebase file that was read: what it claimed to
-- cover, how many rows did what, and a `report` naming every row the importer
-- refused. Plus the private bucket the file itself lands in, so a disagreement
-- three months later can be settled against the original rather than against
-- somebody's memory of it.
--
-- ---------------------------------------------------------------------------
-- WHAT THE REAL FILES TURNED OUT TO BE
--
-- Measured on Mark's 2026-08-04 exports (DF01 and DF02, the 07/20–08/02
-- fortnight), because the brief was written without them:
--
--   * There is NO shift id. The brief said this decides the idempotency key,
--     and the answer is that there isn't one — so `source_row_key` on 028 stays
--     the natural tuple plus an occurrence ordinal, exactly as the FileMaker
--     load does it.
--
--   * `Payroll ID` IS `employees.legacy_id`. 18 of 18 people at DF01 and 11 of
--     11 at DF02 matched on it. So the importer matches on an id from day one
--     and never has to guess from a name — which is the whole reason 028 added
--     `homebase_id` as somewhere to record a match that ISN'T the legacy id.
--
--   * HOMEBASE DOES NOT SPLIT SHIFTS AT MIDNIGHT. `Clock in date` and
--     `Clock out date` are separate columns and an overnight shift arrives
--     whole, with correct California overtime on it. Zero adjacent-at-midnight
--     pairs across both shops. The brief's central premise does not hold for
--     this export, so the stitcher is a safety net rather than the main path.
--
--   * The file is not a flat CSV: three preamble lines (shop name, payroll
--     period, blank), a header, then per-employee blocks each followed by a
--     "Totals for X" row and an all-hyphen separator. `-` means null in every
--     column. `Role` carries FileMaker numbering ("01 Overnight Baker") even
--     though `ts_Position` in the FMP export no longer does.
--
-- Run in the Supabase SQL editor. NOT rerunnable.
-- ============================================================================

create table timesheet_imports (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,

  -- Which shop the file was exported for. Nullable: the shop is read from the
  -- file's first line, and a file we cannot place still deserves a record of
  -- having been refused.
  location_id uuid references locations(id) on delete set null,

  file_name    text not null,
  content_type text,
  byte_size    integer,
  -- {org_id}/{import_id}/{uuid}.csv — the first folder segment is what 018's
  -- storage policies authorise on, which is why the shape is not negotiable.
  storage_path text,

  -- The dates AS READ FROM THE FILE, not as chosen by whoever uploaded it.
  -- Homebase prints "Payroll Period 07/20/2026 To 08/02/2026" on line 2, and
  -- storing it is what lets the app say "this file covers a fortnight you have
  -- already closed" instead of importing it into the wrong one.
  period_start date,
  period_end   date,

  status text not null default 'parsed'
         check (status in ('parsed', 'committed', 'discarded')),

  -- Five counts, so the run can be read at a glance without opening the report.
  rows_read     integer not null default 0,
  rows_matched  integer not null default 0,
  rows_created  integer not null default 0,
  rows_updated  integer not null default 0,
  rows_refused  integer not null default 0,

  -- What was stitched, what was refused and which ids matched nobody. jsonb
  -- rather than a child table — 019's argument for putting the extraction on
  -- the attachment: it is 1:1 with the run, it is read as a whole, and it
  -- should die with the row.
  report jsonb,

  imported_by uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index timesheet_imports_org_idx on timesheet_imports (org_id, created_at desc);

create trigger trg_timesheet_imports_updated before update on timesheet_imports
  for each row execute function set_updated_at();

-- Owner/admin on every verb, matching `timesheets`: this row carries a report
-- naming employees and their hours.
alter table timesheet_imports enable row level security;

create policy timesheet_imports_select on timesheet_imports for select
  using (user_has_role(org_id, array['owner', 'admin']));

create policy timesheet_imports_insert on timesheet_imports for insert
  with check (user_has_role(org_id, array['owner', 'admin']));

create policy timesheet_imports_update on timesheet_imports for update
  using (user_has_role(org_id, array['owner', 'admin']))
  with check (user_has_role(org_id, array['owner', 'admin']));

create policy timesheet_imports_delete on timesheet_imports for delete
  using (user_has_role(org_id, array['owner', 'admin']));

-- ----------------------------------------------------------------------------
-- The bucket
-- ----------------------------------------------------------------------------
-- Private, like po-attachments and employee-documents. A payroll file is a list
-- of who worked when, which is the same class of fact as an employee record.
insert into storage.buckets (id, name, public)
values ('timesheet-imports', 'timesheet-imports', false)
on conflict (id) do nothing;

-- REUSING public.storage_folder_org() from 018, never redefining it. It returns
-- null instead of raising on a non-uuid first segment, which matters because
-- Postgres gives no guarantee it evaluates the bucket_id test first — and it is
-- already revoked from public/anon and granted to authenticated.
create policy timesheet_imports_objects_select on storage.objects for select
  to authenticated
  using (
    bucket_id = 'timesheet-imports'
    and public.storage_folder_org(name) in (select user_org_ids())
  );

create policy timesheet_imports_objects_insert on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'timesheet-imports'
    and user_has_role(public.storage_folder_org(name), array['owner', 'admin'])
  );

create policy timesheet_imports_objects_delete on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'timesheet-imports'
    and user_has_role(public.storage_folder_org(name), array['owner', 'admin'])
  );

-- ============================================================================
-- Verify (in the SQL editor, after running):
--
--   select count(*) from timesheet_imports;                     -- 0
--   select id, public from storage.buckets
--    where id = 'timesheet-imports';                            -- present, false
--   select policyname from pg_policies where tablename = 'objects'
--     and policyname like 'timesheet_imports%';                 -- three
--   select policyname, cmd from pg_policies
--    where tablename = 'timesheet_imports';                     -- four
-- ============================================================================
