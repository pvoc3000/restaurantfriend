-- 093 — an inspection log is the record of a visit, not a walk.
--
-- Mark, 2026-09-05: "conceptually I think of the inspection log as a record
-- of a visit by the health inspector (or some other city or county inspector).
-- It's the result of their inspection and nothing more. Not a walk. No need
-- for a template as far as I can tell. … I would just build a way to record an
-- inspection, upload the report, and track what things we need to work on."
--
-- 076 modelled an inspection as a `checklist_runs` row of kind 'inspection' —
-- a template walked by a named person — on the brief's reading that a run, a
-- walkthrough and an inspection were "all observations". They are, but the
-- observer is different: on an inspection the OBSERVER IS THE INSPECTOR, who
-- brings their own form and leaves a document. What the shop keeps is that
-- document and the outcome. FileMaker had exactly this shape — `InspectionLog`,
-- 13 records: type, date, score, a container holding the hardcopy, and two
-- free-text fields, `Violations` and `Violations_Corrected`. This table is
-- that record, with the paper going to 077's bucket and the follow-up going to
-- 075's tasks.
--
-- ITS OWN TABLE, NOT MORE COLUMNS ON `checklist_runs`. A run without a
-- template would have needed `template_id` made nullable on a table whose
-- every reader — the walk, the PDF, the shift report's page, the
-- "which items fail most" question — assumes items exist. A table with no
-- items and no shift is a different record that happens to share a nav band.
-- `checklist_runs`' `kind` check keeps 'inspection' so nothing that stored one
-- breaks (none exist today; the loader never wrote any).
--
-- `score` IS TEXT. FMP's is, and it holds "98" on every one of the 13 real
-- rows — but an inspector elsewhere writes "A" or "Pass", and a numeric column
-- would refuse the first one of those. `lib/inspections` reads a number out
-- of it where there is one.
--
-- `inspection_type` IS FREE TEXT, NOT A CHECK. All 13 real rows say "Health";
-- a fire marshal or the city's business licence inspector will be the next
-- values, and the screen's picker offers what exists with `allowNew` — 059's
-- `todo` argument.
--
-- RLS follows 075's tasks: supervisor+ on select, insert and update, because a
-- supervisor is the person standing there when the inspector walks in. DELETE
-- is owner/admin — 023's rule, deletion is for the typo, and a record that
-- says a county inspector scored the shop is exactly the kind of thing a typo
-- should not make permanent. The documents cascade (facility_photos) and the
-- tasks are kept with the link set null: work raised from an inspection is
-- still work.
--
-- Rerunnable? NO — `create table` fails a second time, which is the signal it
-- already ran. Run in the Supabase SQL editor. Probes at the bottom.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The record
-- ----------------------------------------------------------------------------
create table inspections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  location_id uuid not null references locations(id) on delete cascade,

  -- The day the inspector came. Typed by whoever files the record, so it is
  -- never derived from `current_date` (the after-4pm-Pacific trap); the app
  -- seeds the org's own day and it is editable.
  inspected_on date not null,
  inspection_type text not null default 'Health',
  inspector text,
  score text,

  -- FMP's two paragraphs, kept as paragraphs: what they found, and what was
  -- done about it. The TASKS below are the structured half of the second.
  violations text,
  violations_corrected text,
  notes text,

  -- FMP's `_InspectionID.text`, so a reload can match rather than duplicate.
  legacy_id text,
  source_payload jsonb,

  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint inspections_legacy_unique unique (org_id, legacy_id)
);

comment on table inspections is
  'A visit by a health (or other) inspector: the date, the score, the report on file and what was found. Not a checklist — see 093.';

create index inspections_location_date_idx on inspections (location_id, inspected_on desc);

create trigger inspections_touch
  before update on inspections
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- 2. The report goes in 077's bucket, owned by the inspection
--    The object key is `{org_id}/{inspection_id}/{uuid}.{ext}`; 077's four
--    storage policies test the FIRST segment only, so no storage policy
--    changes. The one-owner CHECK widens from two owners to three.
-- ----------------------------------------------------------------------------
alter table facility_photos
  add column inspection_id uuid references inspections(id) on delete cascade;

alter table facility_photos drop constraint facility_photos_one_owner;
alter table facility_photos add constraint facility_photos_one_owner
  check (
    (run_item_id is not null)::int
    + (task_id is not null)::int
    + (inspection_id is not null)::int = 1
  );

create index facility_photos_inspection_idx on facility_photos (inspection_id)
  where inspection_id is not null;

-- ----------------------------------------------------------------------------
-- 3. A task can come FROM an inspection
--    `set null`, not cascade: deleting the record of the visit does not make
--    the drain any less loose. Mirrors `source_run_item_id`'s shape (076).
-- ----------------------------------------------------------------------------
alter table location_tasks
  add column source_inspection_id uuid references inspections(id) on delete set null;

create index location_tasks_inspection_idx on location_tasks (source_inspection_id)
  where source_inspection_id is not null;

-- ----------------------------------------------------------------------------
-- 4. RLS
-- ----------------------------------------------------------------------------
alter table inspections enable row level security;

create policy inspections_select on inspections for select
  using (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']));

create policy inspections_insert on inspections for insert
  with check (
    user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor'])
    and created_by = auth.uid()
  );

create policy inspections_update on inspections for update
  using (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']))
  with check (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']));

create policy inspections_delete on inspections for delete
  using (user_has_role(org_id, array['owner', 'admin']));

-- ============================================================================
-- Probes (run these, don't trust a note in CLAUDE.md):
--
--   select count(*) from inspections;                      -- exists; 13 after the load
--   select column_name from information_schema.columns
--     where table_name = 'facility_photos' and column_name = 'inspection_id';
--   select column_name from information_schema.columns
--     where table_name = 'location_tasks' and column_name = 'source_inspection_id';
--   select polname, polcmd from pg_policy
--     where polrelid = 'public.inspections'::regclass;     -- FOUR, one of them a delete
--   -- the widened owner check must still refuse a photo with NO owner:
--   insert into facility_photos (org_id, storage_path) select id, 'x' from orgs limit 1;  -- ERROR
-- ============================================================================
