-- ============================================================================
-- restaurantfriend — migration 070 · the supervisor shift report
--
-- Why (Mark, 2026-08-28): "Let's talk about the supervisor shift report. It's
-- time. Everything we need is in place (except for checklists)."
--
-- The closing shift report is the last daily routine still running in
-- FileMaker. It tells the next shift and the managers what happened: how the
-- shift went, how the staff did, what was sold, what was made and what was left
-- over — and on the way through it is where tomorrow's production schedules and
-- special orders get generated and printed. It is emailed to the team when
-- complete, in two versions: with staff ratings to management, without them to
-- supervisors.
--
-- 035 predicted this file in as many words. It merged FMP's Ratings and Events
-- into `employee_events`, gave `kind = 'shift'` a score and a shift slot, and
-- then deliberately built no writer for either — "it is the PRODUCTION module's
-- screen, not this one's" — because supervisors rate two or three people at the
-- end of a shift ALONGSIDE sales, tips and production counts, and a
-- ratings-only screen would be built twice. This is that screen. 43,918
-- `kind='shift'` rows exist and every one of them came from FileMaker.
--
-- NO HISTORY MIGRATES (Mark, 2026-08-28), the production module's rule.
-- FMP's `Operations/ShiftReports.mer` — 13,059 rows, 2017–2026, 7,334 closing /
-- 5,403 opening / 309 off-site, median 557 characters of narrative — stays on
-- disk. It is still READ, and two things were taken from it rather than
-- invented: the six `Task_*_isComplete_b` flags (three of which survive here,
-- see below) and the shift vocabulary, which already matches 035's.
--
-- ---------------------------------------------------------------------------
-- WHY THE CHILD TABLES EXIST AT ALL, GIVEN THE MODULE WRITES THROUGH
--
-- Two of Mark's decisions pull against each other and this is where they are
-- reconciled. WRITE-THROUGH: no permanent second copy of any fact — a rating
-- becomes an `employee_events` row, a count becomes a schedule line's actual, a
-- yield becomes a batch's. NOTHING WRITES UNTIL SEND: the report is revisable
-- until it is submitted, so none of that may happen while it is a draft.
--
-- So the three child tables are the DRAFT, and `submit_shift_report` below is
-- the one act that flushes them into the tables that own those facts. After the
-- flush each draft row keeps a pointer to the row it created, which makes it a
-- transcript rather than a duplicate: the report records what was submitted,
-- the owning table records what is true now, and if somebody later corrects an
-- event the two are supposed to differ.
--
-- The draft is PERSISTED, not held in a browser. "Pause & close and resume
-- later" is one of the three commands Mark specified, and a dropped iPad at
-- 9pm must not cost a shift.
--
-- ---------------------------------------------------------------------------
-- WHY NO SALES COLUMNS
--
-- There are none, and that is the point. Square's reporting day runs 1:00 AM to
-- 12:59 AM PT and `SyncFromSquare` stops at yesterday, so when the closing
-- supervisor writes this there is NO `daily_sales` row for today at all. The
-- report reads a provisional figure live and never stores it: `daily_sales` is
-- the settled reporting day and it feeds `tip_pools`, so a partial day landing
-- there would corrupt payroll. What the email quoted is kept in
-- `email_receipt` as a record of what was CLAIMED, never as a fact about the
-- day. Consequence: FMP's `Task_SalesData_isComplete_b` has no counterpart,
-- because Square types the figure and there is no act left to complete.
--
-- Depends on 001 (orgs, locations), 017 (locations.open_days), 020 (employees),
-- 029 (break_premiums, period_editable_on), 035 (employee_events), 040/044
-- (production_schedule_items), 044/045 (production_batches).
--
-- Run in the Supabase SQL editor BEFORE deploying — the new screens select
-- these columns, 059's order rather than 012's. NOT rerunnable (create table
-- fails a second time, which is how you know it already ran).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. shift_reports — the record
-- ----------------------------------------------------------------------------
create table shift_reports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,

  -- The SHOP the shift was worked at. `kitchen_location_id` is the kitchen
  -- tomorrow's paper is generated FOR, which on a closing report at DF02 is
  -- often DF01 — decision 9 of the production brief, the same split
  -- `production_schedules` draws.
  location_id uuid not null references locations(id) on delete restrict,
  kitchen_location_id uuid references locations(id) on delete restrict,

  report_date date not null,

  -- 035's vocabulary VERBATIM, and it has to be: `submit_shift_report` writes
  -- this straight into `employee_events.shift`, so a second spelling would fail
  -- that table's own check halfway through a flush, in front of somebody
  -- standing in a shop at 9pm.
  shift text not null check (shift in ('opening', 'mid', 'closing', 'off_site')),

  supervisor_employee_id uuid references employees(id) on delete set null,

  -- What pages 7 and 8 are ABOUT. Asked on page 1 because both need it.
  next_production_date date,

  narrative text,

  status text not null default 'draft' check (status in ('draft', 'sent')),

  -- Three flags, and each is an act NOTHING ELSE CAN OBSERVE. FMP had six:
  -- `Task_Log` is answered by `narrative` being non-empty, `Task_SalesData` by
  -- Square, and `Task_Checklist` has no feature behind it yet — a column for an
  -- unbuilt feature is a claim nothing can ever satisfy, so it is not created.
  task_ratings_done boolean not null default false,
  task_special_orders_done boolean not null default false,
  task_schedules_done boolean not null default false,

  -- SENT and EMAILED are two facts and must not share a column. `sent_at` means
  -- the facts were committed; `emailed_at` means the team was told. Collapsing
  -- them lets the flush succeed, the mail fail, and the report read "sent" with
  -- nobody told — and since `submit_shift_report` refuses to run twice there
  -- would be no way back. Apart they are recoverable: a row with one and not
  -- the other is offered a Resend, which writes only the timestamp.
  sent_at timestamptz,
  sent_by uuid references auth.users(id),
  sent_receipt jsonb,
  emailed_at timestamptz,
  emailed_by uuid references auth.users(id),
  email_receipt jsonb,

  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- DELIBERATELY NOT unique on (location_id, report_date, shift). A handover
-- produces two closing reports for one night legitimately, and 024's lesson is
-- that a statement true of finished data is still wrong as a constraint. The
-- create dialog WARNS instead — `findPossibleRehires`' treatment.
create index shift_reports_org_date_idx on shift_reports (org_id, report_date desc);
create index shift_reports_location_date_idx on shift_reports (location_id, report_date desc);
create index shift_reports_open_idx on shift_reports (org_id, status) where status = 'draft';

create trigger shift_reports_updated_at
  before update on shift_reports
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- 2. shift_report_ratings — the draft, then the transcript
-- ----------------------------------------------------------------------------
create table shift_report_ratings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  report_id uuid not null references shift_reports(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete restrict,

  position text,

  -- 035's range, including ZERO, which is real: a supervisor writing the shift
  -- off. 132 historical rows carry one and 65 of them read "NO CALL/NO SHOW".
  score numeric(3,2) check (score is null or (score >= 0 and score <= 5)),
  note text,

  -- FMP's "received a 30 minute break" / "reason break was missed". Null means
  -- the supervisor has not answered yet, which is not the same as "no".
  got_break boolean,
  break_reason text,

  -- Filled by the flush. Their presence is what says this row has been
  -- submitted; their absence on a `sent` report means the flush skipped it and
  -- `sent_receipt` says why.
  employee_event_id uuid references employee_events(id) on delete set null,
  break_premium_id uuid references break_premiums(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (report_id, employee_id)
);

create index shift_report_ratings_report_idx on shift_report_ratings (report_id);

create trigger shift_report_ratings_updated_at
  before update on shift_report_ratings
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- 3. shift_report_counts — made / left over, per schedule line
-- ----------------------------------------------------------------------------
create table shift_report_counts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  report_id uuid not null references shift_reports(id) on delete cascade,

  -- CASCADE, so a line struck off the schedule mid-shift takes its draft count
  -- with it. The alternative is a count pointing at nothing, which the flush
  -- would have to discover and explain.
  schedule_item_id uuid not null
    references production_schedule_items(id) on delete cascade,

  made numeric(10,2) check (made is null or made >= 0),
  leftover numeric(10,2) check (leftover is null or leftover >= 0),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (report_id, schedule_item_id)
);

create index shift_report_counts_report_idx on shift_report_counts (report_id);

create trigger shift_report_counts_updated_at
  before update on shift_report_counts
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- 4. shift_report_batches — what the overnight bake produced
-- ----------------------------------------------------------------------------
create table shift_report_batches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  report_id uuid not null references shift_reports(id) on delete cascade,
  batch_id uuid not null references production_batches(id) on delete cascade,

  -- (10,3) because that is 044's own precision on these columns. A draft at
  -- (10,2) would round a real yield on the way in and then write the rounded
  -- number, which is a data change disguised as a storage decision.
  yield_count numeric(10,3) check (yield_count is null or yield_count >= 0),
  yield_size numeric(10,3) check (yield_size is null or yield_size >= 0),
  yield_unit text,

  -- 044's vocabulary verbatim, same reason as `shift`.
  status text check (status in ('to_do', 'in_progress', 'complete', 'skipped', 'test')),
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (report_id, batch_id)
);

create index shift_report_batches_report_idx on shift_report_batches (report_id);

create trigger shift_report_batches_updated_at
  before update on shift_report_batches
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- 5. Row level security
-- ----------------------------------------------------------------------------
-- READ is supervisor+ on the report itself, because a report is WRITTEN TO BE
-- READ by the team — that is the whole purpose Mark stated. WRITE is supervisor+
-- and only while the report is a draft you created (059's `preq_author_update`
-- shape). A sent report is a document, which is the closed-pay-period rule
-- applied here; owner/admin may still correct one.
--
-- THE RATINGS TABLE IS THE EXCEPTION AND IT IS THE MOST IMPORTANT RULE IN THIS
-- FILE. Its SELECT is owner/admin OR the report's own author — never plain
-- supervisor+. The two emails are careful to send ratings to management only;
-- if any supervisor could open the record screen and read them, the app would
-- undo in one click the boundary the mail is built around. Same fact, stated in
-- the only place that can enforce it.

alter table shift_reports enable row level security;
alter table shift_report_ratings enable row level security;
alter table shift_report_counts enable row level security;
alter table shift_report_batches enable row level security;

create policy shift_reports_select on shift_reports for select
  using (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']));

create policy shift_reports_insert on shift_reports for insert
  with check (
    user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor'])
    and created_by = auth.uid()
    and status = 'draft'
  );

create policy shift_reports_update on shift_reports for update
  using (
    user_has_role(org_id, array['owner', 'admin'])
    or (
      user_has_role(org_id, array['purchaser', 'supervisor'])
      and status = 'draft'
      and created_by = auth.uid()
    )
  )
  -- WITH CHECK says what it may BECOME (059's lesson). A supervisor cannot flip
  -- `status` here: `submit_shift_report` is definer and is the only route to
  -- 'sent', which is what keeps the flush and the status in step.
  with check (
    user_has_role(org_id, array['owner', 'admin'])
    or (
      user_has_role(org_id, array['purchaser', 'supervisor'])
      and status = 'draft'
      and created_by = auth.uid()
    )
  );

create policy shift_reports_delete on shift_reports for delete
  using (
    user_has_role(org_id, array['owner', 'admin'])
    or (
      user_has_role(org_id, array['purchaser', 'supervisor'])
      and status = 'draft'
      and created_by = auth.uid()
    )
  );

-- The ratings exception.
create policy shift_report_ratings_select on shift_report_ratings for select
  using (
    user_has_role(org_id, array['owner', 'admin'])
    or exists (
      select 1 from shift_reports r
       where r.id = shift_report_ratings.report_id
         and r.created_by = auth.uid()
    )
  );

create policy shift_report_ratings_write on shift_report_ratings for all
  using (
    exists (
      select 1 from shift_reports r
       where r.id = shift_report_ratings.report_id
         and r.status = 'draft'
         and r.created_by = auth.uid()
         and user_has_role(r.org_id, array['owner', 'admin', 'purchaser', 'supervisor'])
    )
  )
  with check (
    exists (
      select 1 from shift_reports r
       where r.id = shift_report_ratings.report_id
         and r.status = 'draft'
         and r.created_by = auth.uid()
         and user_has_role(r.org_id, array['owner', 'admin', 'purchaser', 'supervisor'])
    )
  );

create policy shift_report_counts_select on shift_report_counts for select
  using (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']));

create policy shift_report_counts_write on shift_report_counts for all
  using (
    exists (
      select 1 from shift_reports r
       where r.id = shift_report_counts.report_id
         and r.status = 'draft'
         and r.created_by = auth.uid()
         and user_has_role(r.org_id, array['owner', 'admin', 'purchaser', 'supervisor'])
    )
  )
  with check (
    exists (
      select 1 from shift_reports r
       where r.id = shift_report_counts.report_id
         and r.status = 'draft'
         and r.created_by = auth.uid()
         and user_has_role(r.org_id, array['owner', 'admin', 'purchaser', 'supervisor'])
    )
  );

create policy shift_report_batches_select on shift_report_batches for select
  using (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']));

create policy shift_report_batches_write on shift_report_batches for all
  using (
    exists (
      select 1 from shift_reports r
       where r.id = shift_report_batches.report_id
         and r.status = 'draft'
         and r.created_by = auth.uid()
         and user_has_role(r.org_id, array['owner', 'admin', 'purchaser', 'supervisor'])
    )
  )
  with check (
    exists (
      select 1 from shift_reports r
       where r.id = shift_report_batches.report_id
         and r.status = 'draft'
         and r.created_by = auth.uid()
         and user_has_role(r.org_id, array['owner', 'admin', 'purchaser', 'supervisor'])
    )
  );

-- ----------------------------------------------------------------------------
-- 6. submit_shift_report — the flush, and the only route to 'sent'
-- ----------------------------------------------------------------------------
-- 044's `set_schedule_actual` is the template: DEFINER, so the body re-checks
-- everything RLS would have, and it touches only what it names.
--
-- It is a definer for two reasons and each one is a table this module must
-- write and a supervisor must not otherwise reach:
--
--   · `employee_events` is owner/admin on ALL FOUR VERBS (035), and rightly —
--     widening SELECT to supervisor would hand every supervisor every written
--     warning in the org. So the rule is not "who may write this table" but
--     "who may write ONE kind of row about a named employee-day", which is a
--     value rule and therefore a function's job, not a policy's.
--   · `break_premiums` is owner/admin AND gated on `period_editable_on` (029).
--
-- ONE TRANSACTION, so an interrupted send cannot leave a report half-flushed
-- with three of its five ratings recorded and no way to tell which.
--
-- It RETURNS A RECEIPT rather than raising on anything it can survive — 040's
-- "names every coercion in its receipt". The distinction it draws throughout:
-- a problem with the REPORT raises and nothing is written; a problem with ONE
-- ROW is skipped, named, and the send proceeds. A supervisor at 9pm must not be
-- stuck because one employee's pay period closed this morning.

create or replace function public.submit_shift_report(p_report_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report      shift_reports%rowtype;
  v_rating      record;
  v_count       record;
  v_batch       record;
  v_event_id    uuid;
  v_premium_id  uuid;
  v_ratings     integer := 0;
  v_breaks      integer := 0;
  v_counts      integer := 0;
  v_batches     integer := 0;
  v_skipped     jsonb := '[]'::jsonb;
  v_name        text;
begin
  select * into v_report from shift_reports where id = p_report_id;

  if v_report.id is null then
    raise exception 'No such shift report';
  end if;

  -- What the SELECT policy would have allowed.
  if v_report.org_id not in (select user_org_ids()) then
    raise exception 'Not your organisation';
  end if;

  if not user_has_role(v_report.org_id,
                       array['owner', 'admin', 'purchaser', 'supervisor']) then
    raise exception 'insufficient role to send a shift report';
  end if;

  -- AND it must be YOUR draft. Found on the harness: with only the role check
  -- above, one supervisor could send a colleague's half-written report while
  -- the UPDATE policy forbade them from so much as fixing a typo in it. A
  -- definer has to re-check what RLS would have, and RLS here says the author.
  -- Owner/admin are exempt because the table's own policy exempts them, which
  -- is also the only way to rescue a draft left by somebody who has left.
  if v_report.created_by is distinct from auth.uid()
     and not user_has_role(v_report.org_id, array['owner', 'admin']) then
    raise exception 'That report belongs to somebody else';
  end if;

  -- Idempotence. Sending twice would insert a second rating for every employee
  -- and re-stamp counts somebody may since have corrected by hand.
  if v_report.status <> 'draft' then
    raise exception 'That report was already sent on %',
      to_char(v_report.sent_at, 'YYYY-MM-DD HH24:MI');
  end if;

  -- ---- ratings → employee_events ------------------------------------------
  for v_rating in
    select * from shift_report_ratings
     where report_id = p_report_id
     order by created_at
  loop
    -- A row somebody added and left blank is not a rating. Skipping quietly is
    -- right here: an empty row is a mistake being abandoned, not a failure.
    if v_rating.score is null
       and coalesce(btrim(v_rating.note), '') = ''
       and v_rating.got_break is null then
      continue;
    end if;

    insert into employee_events (
      org_id, employee_id, location_id, occurred_on, kind,
      score, shift, position, detail,
      author_employee_id, created_by, source
    ) values (
      v_report.org_id, v_rating.employee_id, v_report.location_id,
      v_report.report_date, 'shift',
      v_rating.score, v_report.shift, v_rating.position,
      nullif(btrim(coalesce(v_rating.note, '')), ''),
      v_report.supervisor_employee_id, auth.uid(), 'app'
    )
    returning id into v_event_id;

    v_ratings := v_ratings + 1;
    v_premium_id := null;

    -- ---- the missed break → a break_premiums DECISION ---------------------
    -- Recorded as OWED, which is the conservative reading and the employee's:
    -- the supervisor is saying this person did not get their meal. Whether it
    -- was waived or never owed is a payroll judgement made later on the
    -- timesheet row, where `ShiftPremium` already exists to make it.
    if v_rating.got_break is false then

      -- 032's constraint requires a reason for `owed`, and the dialog requires
      -- one too. If it is somehow blank we SKIP AND NAME IT rather than let a
      -- check constraint abort the whole send.
      if coalesce(btrim(v_rating.break_reason), '') = '' then
        select coalesce(nickname, first_name) || ' ' || last_name into v_name
          from employees where id = v_rating.employee_id;
        v_skipped := v_skipped || jsonb_build_object(
          'kind', 'break',
          'employee', coalesce(v_name, 'someone'),
          'reason', 'no reason was given for the missed break'
        );

      -- A definer bypasses RLS, so 029's period gate has to be re-asked HERE or
      -- this function would quietly write into a pay period that is already
      -- exported and paid. It must not raise either: a closed period is a fact
      -- about last fortnight and no reason to stop tonight's report.
      elsif not period_editable_on(v_report.org_id, v_report.report_date) then
        select coalesce(nickname, first_name) || ' ' || last_name into v_name
          from employees where id = v_rating.employee_id;
        v_skipped := v_skipped || jsonb_build_object(
          'kind', 'break',
          'employee', coalesce(v_name, 'someone'),
          'reason', 'that pay period is closed, so the premium was not recorded'
        );

      else
        -- On the cap's own key, so a second report for the same person and day
        -- CHANGES the decision rather than returning a unique violation to
        -- somebody standing in a shop. §226.7 pays one meal hour per workday.
        insert into break_premiums (
          org_id, employee_id, location_id, workday, kind,
          decision, hours, reason, decided_by
        ) values (
          v_report.org_id, v_rating.employee_id, v_report.location_id,
          v_report.report_date, 'meal',
          'owed', 1, btrim(v_rating.break_reason), auth.uid()
        )
        on conflict (org_id, employee_id, workday, kind) do update
          set decision   = excluded.decision,
              hours      = excluded.hours,
              reason     = excluded.reason,
              decided_by = excluded.decided_by,
              decided_at = now()
        returning id into v_premium_id;

        v_breaks := v_breaks + 1;
      end if;
    end if;

    update shift_report_ratings
       set employee_event_id = v_event_id,
           break_premium_id  = v_premium_id
     where id = v_rating.id;
  end loop;

  -- ---- counts → production_schedule_items ---------------------------------
  -- 044's whitelist shape: `made` and `leftover` and the two author columns,
  -- nothing else. `par`, `par_source` and every cost column are unreachable
  -- from here by construction, exactly as they are from `set_schedule_actual`.
  for v_count in
    select c.* from shift_report_counts c
     where c.report_id = p_report_id
       and (c.made is not null or c.leftover is not null)
  loop
    update production_schedule_items
       set made       = coalesce(v_count.made, made),
           leftover   = coalesce(v_count.leftover, leftover),
           counted_by = auth.uid(),
           counted_at = now()
     where id = v_count.schedule_item_id;

    if found then
      v_counts := v_counts + 1;
    end if;
  end loop;

  -- ---- yields → production_batches ----------------------------------------
  for v_batch in
    select b.* from shift_report_batches b
     where b.report_id = p_report_id
  loop
    update production_batches
       set yield_count = coalesce(v_batch.yield_count, yield_count),
           yield_size  = coalesce(v_batch.yield_size,  yield_size),
           yield_unit  = coalesce(v_batch.yield_unit,  yield_unit),
           status      = coalesce(v_batch.status,      status),
           notes       = coalesce(nullif(btrim(coalesce(v_batch.notes, '')), ''), notes)
     where id = v_batch.batch_id;

    if found then
      v_batches := v_batches + 1;
    end if;
  end loop;

  update shift_reports
     set status  = 'sent',
         sent_at = now(),
         sent_by = auth.uid(),
         sent_receipt = jsonb_build_object(
           'ratings', v_ratings,
           'breaks',  v_breaks,
           'counts',  v_counts,
           'batches', v_batches,
           'skipped', v_skipped
         )
   where id = p_report_id;

  return jsonb_build_object(
    'report_id', p_report_id,
    'ratings', v_ratings,
    'breaks',  v_breaks,
    'counts',  v_counts,
    'batches', v_batches,
    'skipped', v_skipped
  );
end;
$$;

-- 002's lesson: every new public-schema function is executable by `anon`
-- through Supabase's defaults, and revoking from PUBLIC does not undo that.
revoke all on function public.submit_shift_report(uuid) from public;
revoke all on function public.submit_shift_report(uuid) from anon;
grant execute on function public.submit_shift_report(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 7. mark_shift_report_emailed — the second fact
-- ----------------------------------------------------------------------------
-- Separate from the flush on purpose, and callable again: the edge function
-- calls it after the mail is out, and Resend calls it after a retry. It writes
-- ONLY the two stamps and the receipt, so re-running it can never disturb what
-- was already committed.
create or replace function public.mark_shift_report_emailed(
  p_report_id uuid,
  p_receipt   jsonb
)
returns shift_reports
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_row shift_reports%rowtype;
begin
  select org_id into v_org from shift_reports where id = p_report_id;

  if v_org is null then
    raise exception 'No such shift report';
  end if;

  if v_org not in (select user_org_ids()) then
    raise exception 'Not your organisation';
  end if;

  if not user_has_role(v_org, array['owner', 'admin', 'purchaser', 'supervisor']) then
    raise exception 'insufficient role to send a shift report';
  end if;

  update shift_reports
     set emailed_at   = now(),
         emailed_by   = auth.uid(),
         email_receipt = p_receipt
   where id = p_report_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.mark_shift_report_emailed(uuid, jsonb) from public;
revoke all on function public.mark_shift_report_emailed(uuid, jsonb) from anon;
grant execute on function public.mark_shift_report_emailed(uuid, jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- After this runs, these should read:
-- ----------------------------------------------------------------------------
--   select count(*) from shift_reports;                              → 0
--   select count(*) from pg_policy
--    where polrelid = 'public.shift_reports'::regclass;               → 4
--   select count(*) from pg_proc where proname = 'submit_shift_report';
--     → 1. TWO would mean an argument list drifted and an overload is live
--       beside this one — 033's `freeze_pay_period` trap.
--   select public.submit_shift_report(null);
--     → raises "No such shift report" from its first statement, which proves
--       the function exists AND that its guards run.
-- ============================================================================
