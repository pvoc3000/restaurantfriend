-- ============================================================================
-- restaurantfriend — migration 076 · the observation spine: checklists,
-- walkthroughs and inspection logs
--
-- Why (Mark, 2026-08-29): "The checklists are a guide … for the supervisors to
-- use for their walkthrough at the end of their shifts. It includes things to
-- put their eyes on as well as duties they need to accomplish … The list is
-- grouped by shop sections."
--
-- The second of three (075 → 076 → 077). 075 built the WORK; this builds the
-- OBSERVATION that produces it.
--
-- ONE FAMILY, THREE KINDS. A closing checklist, a manager's WALKTHROUGH and an
-- INSPECTION LOG are the same machine — a template, a run, a named person's
-- answers at a time — differing only in who walks it, whether an answer carries
-- a score, and what a flag produces. 035's merge precedent and 051's `kind`
-- column. Three nav entries over one spine.
--
-- ── THE FIVE DECISIONS IN THE SHAPE OF THIS FILE ────────────────────────────
--
-- 1. A RUN SNAPSHOTS ITS TEMPLATE. `prompt`, `section_name`, `sort`, the whole
--    response spec. This is 013's rule (a PO line snapshots description, pack
--    and price) and it is the single most important thing here: without it,
--    rewording an item in September silently rewrites what August's supervisor
--    is recorded as having been asked to check. History would quietly become a
--    claim nobody made.
--
-- 2. A CHECK IS FOUR STATES, NOT A BOOLEAN. pending / done / issue / n/a — the
--    order guide's three-state lesson (entered, explicitly zeroed, untouched
--    are three different sentences and merging any two loses one). "Nobody has
--    been there yet" and "looked at, fine" are not the same fact, and a
--    checklist that cannot tell them apart is a checklist you cannot audit.
--
-- 3. AN ITEM CAN ASK FOR A VALUE (Mark, 2026-08-29: "Having the supervisors
--    enter fridge temperatures, for instance, would be pretty awesome"). With
--    `min_value`/`max_value` on the item, an out-of-range reading raises the
--    issue state BY ITSELF. That is the one place this module lets the app
--    decide anything, and the line is worth stating: the app must never decide
--    what counts as dirty, and it can absolutely decide what counts as above
--    40°F. It is also what makes the data trendable — see 075's equipment note.
--
-- 4. THE SHIFT-REPORT LINK IS AN FK, NOT A (location, date, shift) TUPLE.
--    070 deliberately declined a unique constraint on that tuple because a
--    HANDOVER legitimately produces two closing reports for one night. So the
--    tuple does not identify a report, and a join on it would attach a
--    checklist to the wrong one. `shift_report_id` is nullable: a run is a
--    record in its own right and can be walked with no report at all.
--
-- 5. A SCORE IS PER ITEM (Mark's choice, 2026-08-29, over per-section). The
--    measured hazard is real — 89% of FMP's 40,793 `kind='shift'` ratings are a
--    5, so its five categories discriminated nothing — so the score is NULLABLE
--    and its resting state is "not scored": you score what is worth commenting
--    on. The section roll-up the trend needs is DERIVED from these, never
--    stored, which is `v_production_schedule_lines.sold`'s rule.
--
-- Depends on 001 (orgs, locations, shop_sections, the RLS helpers), 070
-- (shift_reports), 075 (equipment, location_tasks).
--
-- Run in the Supabase SQL editor BEFORE deploying, and AFTER 075 —
-- `checklist_run_items.task_id` references a table 075 creates. NOT rerunnable.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. checklist_templates — the master list
-- ----------------------------------------------------------------------------
create table checklist_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,

  -- LOCATION-SCOPED, and Mark was explicit about why (2026-08-29): "the same
  -- checklist probably wouldn't run at two shops. The layouts are too different
  -- and the requirements aren't even close." Shared masters with per-shop items
  -- is a different and much larger model; duplicate-then-change-location is the
  -- shortcut he asked for instead, and it lives in the app.
  location_id uuid not null references locations(id) on delete cascade,

  kind text not null
    check (kind in ('checklist', 'walkthrough', 'inspection')),

  name text not null,

  -- WHEN IT IS ASKED FOR.
  --
  -- `weekdays` is a SET of ISO days (1 = Monday), the `vendor_locations
  -- .order_days` idiom — NOT a seven-slot positional array like
  -- `par_by_weekday`. `WeekdayPicker` already writes exactly this shape.
  --
  -- BOTH NULLABLE, AND NULL MEANS "NOT SCHEDULED — STARTED BY HAND." That is
  -- what lets a walkthrough and an inspection need no extra machinery at all: a
  -- manager walks when they walk, and an inspector arrives unannounced.
  --
  -- An EMPTY array is refused rather than treated as null, because two
  -- spellings of one sentence is how readers start disagreeing (043's rule
  -- about a nullable par being a second way to say nothing).
  --
  -- `cardinality`, NEVER `array_length(x, 1)`. The latter returns NULL for an
  -- empty array rather than 0, so `array_length(weekdays, 1) > 0` is NULL, the
  -- whole check evaluates to NULL, and A CHECK CONSTRAINT PASSES ON NULL — the
  -- empty array sails straight through. Written that way first and caught on
  -- the harness by asserting the refusal rather than assuming it.
  weekdays smallint[]
    check (
      weekdays is null
      or (cardinality(weekdays) > 0
          and weekdays <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[])
    ),

  -- One template may serve several shifts (Mark: "assigned to a shift or
  -- multiple shifts"). 035's vocabulary VERBATIM — see 075's note on why a
  -- second spelling is a failure in front of somebody standing in a shop.
  shifts text[]
    check (
      shifts is null
      or (cardinality(shifts) > 0
          and shifts <@ array['opening', 'mid', 'closing', 'off_site']::text[])
    ),

  notes text,
  is_active boolean not null default true,

  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- NO CADENCE ENGINE IN v1, deliberately. Preventive maintenance — monthly hood
-- filters, quarterly descale, annual extinguisher — is the obvious extension
-- and wants exactly three shapes (weekday set, every N days, monthly on the
-- Nth). Building a general scheduler is where a feature like this metastasizes,
-- so it is named in docs/checklists-brief.md and not built.

create index checklist_templates_location_idx
  on checklist_templates (location_id, kind, is_active);

create trigger checklist_templates_updated_at
  before update on checklist_templates
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- 2. checklist_template_items — what it asks
-- ----------------------------------------------------------------------------
create table checklist_template_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  template_id uuid not null references checklist_templates(id) on delete cascade,

  -- THE WALK ORDER IS THE SHOP'S OWN. Grouping by `shop_sections` is not just
  -- reuse: it means the closing walk and the ordering walk follow the same
  -- physical route, so a supervisor learns one path through the building.
  -- `on delete set null` (001's own rule for this FK) — deleting a shelf moves
  -- its items to "No section" rather than deleting the question.
  shop_section_id uuid references shop_sections(id) on delete set null,

  -- numeric to match `shop_sections.sort_order`, which FMP fills with 09.5 and
  -- 13.1 — an integer here would make inserting between two rows a renumber.
  sort numeric(8, 2) not null default 0,

  prompt text not null,

  -- WHAT KIND OF ANSWER. 'check' is the ordinary tick; 'number' is decision 3
  -- above; 'text' is a reading somebody writes out; 'choice' is a small set.
  response_type text not null default 'check'
    check (response_type in ('check', 'number', 'text', 'choice')),

  unit text,
  min_value numeric,
  max_value numeric,
  choices text[],

  -- Which unit this question is ABOUT — the walk-in, this fryer. Null for
  -- "sweep the floor". This is what makes a reading trendable per unit.
  equipment_id uuid references equipment(id) on delete set null,

  requires_photo boolean not null default false,

  -- Per-ITEM narrowing, on top of the template's own. Null = every run of this
  -- template. This is how the Friday-only deep clean rides on the daily list
  -- without a second template.
  weekdays smallint[]
    check (
      weekdays is null
      or (cardinality(weekdays) > 0
          and weekdays <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[])
    ),

  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A range that reads backwards would silently flag every reading.
  constraint checklist_template_items_range
    check (min_value is null or max_value is null or min_value <= max_value),

  -- A 'choice' item with nothing to choose from is a question with no answers.
  constraint checklist_template_items_choices_when_choice
    check (response_type <> 'choice'
           or (choices is not null and cardinality(choices) > 0))
);

create index checklist_template_items_template_idx
  on checklist_template_items (template_id, sort);

create trigger checklist_template_items_updated_at
  before update on checklist_template_items
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- 3. checklist_runs — one walk, by one person, on one night
-- ----------------------------------------------------------------------------
create table checklist_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  location_id uuid not null references locations(id) on delete cascade,

  -- `restrict`, not cascade and not set null: a template with runs behind it is
  -- DEACTIVATED, never deleted. Losing it would orphan the "which items fail
  -- most" question that having rows at all is for.
  template_id uuid not null references checklist_templates(id) on delete restrict,

  -- SNAPSHOTTED from the template, so a run's identity cannot change under it
  -- when somebody renames or re-kinds the master. Decision 1.
  kind text not null
    check (kind in ('checklist', 'walkthrough', 'inspection')),
  title text not null,

  -- THE DAY THE SHIFT BELONGS TO, not the day the clock says. A closing walk
  -- finished at 1:15am belongs to YESTERDAY, and `current_date` is UTC, so
  -- after 4pm Pacific it is already tomorrow. Every writer derives this in the
  -- ORG's timezone (`lib/today`) and passes it in; nothing here calls
  -- `current_date`. This is the highest-risk bug in the whole module, because
  -- a run and its shift report must agree.
  business_date date not null,

  -- Nullable: a walkthrough and an inspection have no shift.
  shift text check (shift in ('opening', 'mid', 'closing', 'off_site')),

  status text not null default 'open'
    check (status in ('open', 'submitted')),

  -- Decision 4. Nullable both ways round — a run can stand alone, and a report
  -- can have none, one, or (rarely) several.
  shift_report_id uuid references shift_reports(id) on delete set null,

  notes text,

  started_by uuid references auth.users(id),
  started_at timestamptz not null default now(),
  submitted_by uuid references auth.users(id),
  submitted_at timestamptz,

  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- DELIBERATELY NOT unique on (template_id, business_date, shift). 070 made the
-- same call for the same reason and 024 is the lesson behind both: a statement
-- true of finished data is still wrong as a constraint. Mark, 2026-08-29: "It's
-- possible, but rare, to have multiple checklists for the same day and shift."
-- The create dialog WARNS instead — `findPossibleRehires`' treatment.
create index checklist_runs_location_date_idx
  on checklist_runs (location_id, business_date desc);
create index checklist_runs_report_idx
  on checklist_runs (shift_report_id) where shift_report_id is not null;
create index checklist_runs_open_idx
  on checklist_runs (org_id, status) where status = 'open';

create trigger checklist_runs_updated_at
  before update on checklist_runs
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- 4. checklist_run_items — the snapshot, then the answer
-- ----------------------------------------------------------------------------
create table checklist_run_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  run_id uuid not null references checklist_runs(id) on delete cascade,

  -- Kept `on delete set null` rather than dropped, because it is what makes
  -- "the ice machine has been flagged 6 of the last 10 nights" answerable —
  -- which is the payoff for these being rows instead of a jsonb blob. (A jsonb
  -- answer set is POSITIONAL, so re-generating renumbers it and silently
  -- retargets every note: the invoices brief's argument, verbatim.)
  template_item_id uuid references checklist_template_items(id) on delete set null,

  -- ── the snapshot (decision 1) ───────────────────────────────────────────
  prompt text not null,
  -- The section's NAME as text, not only its id: a shelf that is renamed or
  -- deleted must not rewrite or blank last month's walk. The id rides alongside
  -- so a live run can still group and link.
  section_name text,
  shop_section_id uuid references shop_sections(id) on delete set null,
  sort numeric(8, 2) not null default 0,
  response_type text not null default 'check'
    check (response_type in ('check', 'number', 'text', 'choice')),
  unit text,
  min_value numeric,
  max_value numeric,
  choices text[],
  requires_photo boolean not null default false,
  equipment_id uuid references equipment(id) on delete set null,

  -- ── the answer (decision 2) ─────────────────────────────────────────────
  status text not null default 'pending'
    check (status in ('pending', 'done', 'issue', 'na')),

  value_number numeric,
  value_text text,

  -- Decision 5. 035's range INCLUDING ZERO, which is real — a supervisor
  -- writing the shift off.
  score numeric(3, 2) check (score is null or (score >= 0 and score <= 5)),

  note text,
  checked_by uuid references auth.users(id),
  checked_at timestamptz,

  -- Set when a supervisor turns an issue into work. Deliberately a LINK and not
  -- a copy: without it, three supervisors flag the same fryer on three nights
  -- and file three tasks. With it, night two reads "already reported Tuesday".
  task_id uuid references location_tasks(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- 032's shape a third time: `done` asks for nothing, and the two exits that
  -- need explaining have to explain themselves. An issue with no words is a
  -- flag nobody downstream can act on, and an n/a with no words is indis-
  -- tinguishable from having skipped the question.
  constraint checklist_run_items_note_when_flagged
    check (status not in ('issue', 'na')
           or (note is not null and btrim(note) <> ''))
);

create index checklist_run_items_run_idx on checklist_run_items (run_id, sort);
create index checklist_run_items_issues_idx
  on checklist_run_items (org_id, status) where status = 'issue';
-- The per-unit reading history the equipment record renders.
create index checklist_run_items_equipment_idx
  on checklist_run_items (equipment_id) where equipment_id is not null;
-- "Which items fail most", and "which section is never completed" — the
-- template-health question, which is a signal about the CHECKLIST rather than
-- about the shop.
create index checklist_run_items_template_item_idx
  on checklist_run_items (template_item_id) where template_item_id is not null;

create trigger checklist_run_items_updated_at
  before update on checklist_run_items
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- 5. checklist_run_tasks — what tonight's supervisor did about the backlog
-- ----------------------------------------------------------------------------
-- The carried-forward tasks are RENDERED onto a run, not copied into it: the
-- task keeps one identity, one open/closed state and one history. This table is
-- the small pointer row that still captures the per-night fact — did the person
-- holding tonight's list act on it — so "which tasks were open on the night of
-- 12 August" stays answerable.
create table checklist_run_tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  run_id uuid not null references checklist_runs(id) on delete cascade,
  task_id uuid not null references location_tasks(id) on delete cascade,

  acted text not null default 'pending'
    check (acted in ('pending', 'done', 'not_done')),
  note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (run_id, task_id)
);

create trigger checklist_run_tasks_updated_at
  before update on checklist_run_tasks
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- 6. The back-link 075 could not declare
-- ----------------------------------------------------------------------------
alter table location_tasks
  add column source_run_item_id uuid
      references checklist_run_items(id) on delete set null;

create index location_tasks_source_idx on location_tasks (source_run_item_id)
  where source_run_item_id is not null;

-- ----------------------------------------------------------------------------
-- 7. RLS
-- ----------------------------------------------------------------------------
-- TEMPLATES: read is membership — everyone may see what they will be asked. And
-- WRITE IS purchaser+ (Mark, 2026-08-29: "Managers and purchasers should be
-- able to edit the master lists"), which is `canWriteCatalog`'s set: a master
-- checklist is a catalog.
--
-- RUNS: 070's `shift_reports_*` shape, copied deliberately rather than
-- reinvented. Read is supervisor+, because a report is written to be read by
-- the team. Write is supervisor+ while the run is OPEN AND YOURS — 059's
-- `preq_author_update` lesson, with the WITH CHECK saying what a row may BECOME
-- so a supervisor cannot flip somebody else's run to 'submitted'. Owner/admin
-- may correct a submitted one; that is the closed-pay-period rule applied here.
--
-- THERE IS NO DELETE POLICY ON checklist_runs ONCE SUBMITTED. A completed walk
-- is the record that a named person made a claim at a time; it is superseded,
-- never erased. An OPEN run may be deleted by its author — 023's typo case, and
-- the reason that policy names `status = 'open'`.
--
-- Note the consequence, live on every table here: a write that matches no
-- policy changes ZERO ROWS AND RETURNS NO ERROR, so every write in the app must
-- `.select()` its own result.

alter table checklist_templates enable row level security;
alter table checklist_template_items enable row level security;
alter table checklist_runs enable row level security;
alter table checklist_run_items enable row level security;
alter table checklist_run_tasks enable row level security;

create policy checklist_templates_select on checklist_templates for select
  using (org_id in (select user_org_ids()));

create policy checklist_templates_write on checklist_templates for all
  using (user_has_role(org_id, array['owner', 'admin', 'purchaser']))
  with check (user_has_role(org_id, array['owner', 'admin', 'purchaser']));

create policy checklist_template_items_select on checklist_template_items for select
  using (org_id in (select user_org_ids()));

create policy checklist_template_items_write on checklist_template_items for all
  using (user_has_role(org_id, array['owner', 'admin', 'purchaser']))
  with check (user_has_role(org_id, array['owner', 'admin', 'purchaser']));

create policy checklist_runs_select on checklist_runs for select
  using (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']));

create policy checklist_runs_insert on checklist_runs for insert
  with check (
    user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor'])
    and created_by = auth.uid()
    and status = 'open'
  );

create policy checklist_runs_update on checklist_runs for update
  using (
    user_has_role(org_id, array['owner', 'admin'])
    or (
      user_has_role(org_id, array['purchaser', 'supervisor'])
      and status = 'open'
      and created_by = auth.uid()
    )
  )
  with check (
    user_has_role(org_id, array['owner', 'admin'])
    or (
      user_has_role(org_id, array['purchaser', 'supervisor'])
      and created_by = auth.uid()
    )
  );

create policy checklist_runs_delete on checklist_runs for delete
  using (
    user_has_role(org_id, array['owner', 'admin'])
    or (
      user_has_role(org_id, array['purchaser', 'supervisor'])
      and status = 'open'
      and created_by = auth.uid()
    )
  );

-- The children follow their run, so there is one rule to learn rather than
-- four. Reading is deliberately NOT author-scoped — a handover has to be able
-- to read what the previous shift recorded.
create policy checklist_run_items_select on checklist_run_items for select
  using (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']));

create policy checklist_run_items_write on checklist_run_items for all
  using (
    exists (
      select 1 from checklist_runs r
       where r.id = checklist_run_items.run_id
         and (
           user_has_role(r.org_id, array['owner', 'admin'])
           or (r.status = 'open'
               and r.created_by = auth.uid()
               and user_has_role(r.org_id, array['purchaser', 'supervisor']))
         )
    )
  )
  with check (
    exists (
      select 1 from checklist_runs r
       where r.id = checklist_run_items.run_id
         and (
           user_has_role(r.org_id, array['owner', 'admin'])
           or (r.status = 'open'
               and r.created_by = auth.uid()
               and user_has_role(r.org_id, array['purchaser', 'supervisor']))
         )
    )
  );

create policy checklist_run_tasks_select on checklist_run_tasks for select
  using (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']));

create policy checklist_run_tasks_write on checklist_run_tasks for all
  using (
    exists (
      select 1 from checklist_runs r
       where r.id = checklist_run_tasks.run_id
         and (
           user_has_role(r.org_id, array['owner', 'admin'])
           or (r.status = 'open'
               and r.created_by = auth.uid()
               and user_has_role(r.org_id, array['purchaser', 'supervisor']))
         )
    )
  )
  with check (
    exists (
      select 1 from checklist_runs r
       where r.id = checklist_run_tasks.run_id
         and (
           user_has_role(r.org_id, array['owner', 'admin'])
           or (r.status = 'open'
               and r.created_by = auth.uid()
               and user_has_role(r.org_id, array['purchaser', 'supervisor']))
         )
    )
  );

-- ============================================================================
-- Probes (run these, don't trust a note in CLAUDE.md):
--
--   select count(*) from checklist_templates;   -- 0 today
--   select count(*) from checklist_runs;        -- 0 today
--
--   select column_name from information_schema.columns
--    where table_name = 'location_tasks' and column_name = 'source_run_item_id';
--     → one row. This is the half of 076 that touches 075's table.
--
--   select conname from pg_constraint
--    where conrelid = 'public.checklist_run_items'::regclass and contype = 'c';
--     → includes checklist_run_items_note_when_flagged
--
--   select count(*) from pg_policy
--    where polrelid = 'public.checklist_runs'::regclass;      -- 4
--
-- And the one that would be silent if it broke — an empty weekday set must be
-- REFUSED rather than stored as a second spelling of "any":
--
--   insert into checklist_templates (org_id, location_id, kind, name, weekdays)
--   select id, (select id from locations limit 1), 'checklist', 'x',
--          '{}'::smallint[] from orgs limit 1;
--     → ERROR: violates check constraint
-- ============================================================================
