-- ============================================================================
-- restaurantfriend — migration 072 · a sent shift report can be reopened
--
-- Why (Mark, 2026-08-28, within an hour of the first real send): "can you just
-- make the report I sent a draft so I can walk through it again?"
--
-- 070 made a sent report a document — read-only, and `submit_shift_report`
-- refuses to run twice. That is right for the ordinary case and leaves no way
-- back at all, so the first time anybody wanted one it had to be done by hand
-- against the database. 059's purchase requests already have Reopen for exactly
-- this reason; this is that command.
--
-- ---------------------------------------------------------------------------
-- IT IS NOT A STATUS FLIP, AND THAT IS THE WHOLE OF IT
--
-- `submit_shift_report` INSERTS `employee_events` rather than upserting — there
-- is no natural key to upsert on, because a person can legitimately be rated
-- twice on one day by two shifts. So flipping `status` alone and letting
-- somebody press Send again produces a SECOND rating for the same person on the
-- same day, silently, and the only sign is a number in a list nobody is
-- looking at.
--
-- Reopening therefore has to UNDO the flush: the events it created, the
-- premiums, the counts it poured onto the schedule and the yields onto the
-- batches. What it must NOT touch is the DRAFT — the ratings, counts and
-- batches on the report itself are what the person typed and what they are
-- about to walk again.
--
-- ---------------------------------------------------------------------------
-- IT REFUSES TO DESTROY SOMEBODY ELSE'S NUMBER
--
-- A count is reverted only if the schedule line STILL HOLDS what the flush put
-- there. If somebody has recounted that line since — at the bench, on the
-- schedule screen, through 044's own definer — their figure stands and the
-- reopen says so in its receipt. The alternative is that reopening a report
-- from Tuesday quietly erases Thursday's count, which is the failure the
-- never-overwrite rule exists to prevent everywhere else in this module.
--
-- Same for a closed pay period: a premium inside one is LEFT and named rather
-- than deleted, because that fortnight is paid and its numbers are not ours to
-- move any more.
--
-- ---------------------------------------------------------------------------
-- WHAT IT DELIBERATELY LEAVES ALONE
--
-- The three `task_*` flags. They record acts that happened in the WORLD — paper
-- came out of a printer — and reopening the record does not un-print it.
--
-- OWNER/ADMIN ONLY, which is 070's own rule for updating a sent report. A
-- supervisor may write and send their own report; taking a sent one back is a
-- manager's call, because it un-writes rows on other people's HR records.
--
-- Depends on 070. Run in the Supabase SQL editor BEFORE deploying — the record
-- screen calls it. Rerunnable (create or replace).
-- ============================================================================

create or replace function public.reopen_shift_report(p_report_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report   shift_reports%rowtype;
  v_rating   record;
  v_count    record;
  v_batch    record;
  v_events   integer := 0;
  v_premiums integer := 0;
  v_counts   integer := 0;
  v_batches  integer := 0;
  v_kept     jsonb := '[]'::jsonb;
  v_name     text;
begin
  select * into v_report from shift_reports where id = p_report_id;

  if v_report.id is null then
    raise exception 'No such shift report';
  end if;

  if v_report.org_id not in (select user_org_ids()) then
    raise exception 'Not your organisation';
  end if;

  -- 070's own rule for touching a sent report.
  if not user_has_role(v_report.org_id, array['owner', 'admin']) then
    raise exception 'only a manager or the owner can reopen a sent report';
  end if;

  if v_report.status <> 'sent' then
    raise exception 'That report is already a draft';
  end if;

  -- ---- the HR rows the flush created ---------------------------------------
  for v_rating in
    select * from shift_report_ratings
     where report_id = p_report_id
       and (employee_event_id is not null or break_premium_id is not null)
  loop
    if v_rating.employee_event_id is not null then
      delete from employee_events where id = v_rating.employee_event_id;
      if found then v_events := v_events + 1; end if;
    end if;

    if v_rating.break_premium_id is not null then
      -- A paid fortnight is not ours to edit. Leave it, name it, carry on —
      -- and leave the POINTER too, so the row still says which premium it
      -- produced rather than losing the link along with the ability to undo it.
      if period_editable_on(v_report.org_id, v_report.report_date) then
        delete from break_premiums where id = v_rating.break_premium_id;
        if found then v_premiums := v_premiums + 1; end if;
      else
        select coalesce(nickname, first_name) || ' ' || last_name into v_name
          from employees where id = v_rating.employee_id;
        v_kept := v_kept || jsonb_build_object(
          'kind', 'premium',
          'employee', coalesce(v_name, 'someone'),
          'reason', 'that pay period is closed, so the premium was left in place'
        );
        continue;
      end if;
    end if;

    update shift_report_ratings
       set employee_event_id = null,
           break_premium_id  = null
     where id = v_rating.id;
  end loop;

  -- ---- the counts it poured onto the schedule ------------------------------
  for v_count in
    select c.* from shift_report_counts c
     where c.report_id = p_report_id
       and (c.made is not null or c.leftover is not null)
  loop
    -- ONLY IF THE LINE STILL HOLDS WHAT WE WROTE. `is not distinct from` so a
    -- null on either side compares properly rather than yielding null.
    update production_schedule_items li
       set made       = null,
           leftover   = null,
           counted_by = null,
           counted_at = null
     where li.id = v_count.schedule_item_id
       and li.made     is not distinct from v_count.made
       and li.leftover is not distinct from v_count.leftover;

    if found then
      v_counts := v_counts + 1;
    else
      select i.item_name into v_name
        from production_schedule_items i where i.id = v_count.schedule_item_id;
      v_kept := v_kept || jsonb_build_object(
        'kind', 'count',
        'item', coalesce(v_name, 'a line'),
        'reason', 'somebody has counted it since, so their figure was left alone'
      );
    end if;
  end loop;

  -- ---- and the yields onto the batches -------------------------------------
  for v_batch in
    select b.* from shift_report_batches b where b.report_id = p_report_id
  loop
    update production_batches pb
       set yield_count = null,
           yield_size  = null,
           yield_unit  = null
     where pb.id = v_batch.batch_id
       and pb.yield_count is not distinct from v_batch.yield_count
       and pb.yield_size  is not distinct from v_batch.yield_size;

    if found then v_batches := v_batches + 1; end if;
  end loop;

  -- ---- the report itself: EVERY stamp, not just the status ------------------
  -- A row reading `draft` while still claiming it was emailed on Friday is the
  -- record disagreeing with itself — 059's Reopen clears all four of its
  -- columns together for the same reason. The `task_*` flags stay: paper that
  -- came out of a printer did not go back in.
  update shift_reports
     set status        = 'draft',
         sent_at       = null,
         sent_by       = null,
         sent_receipt  = null,
         emailed_at    = null,
         emailed_by    = null,
         email_receipt = null
   where id = p_report_id;

  return jsonb_build_object(
    'report_id', p_report_id,
    'events_removed',   v_events,
    'premiums_removed', v_premiums,
    'counts_reverted',  v_counts,
    'batches_reverted', v_batches,
    'kept', v_kept
  );
end;
$$;

revoke all on function public.reopen_shift_report(uuid) from public;
revoke all on function public.reopen_shift_report(uuid) from anon;
grant execute on function public.reopen_shift_report(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- After this runs:
--   select public.reopen_shift_report(null);
--     → raises "No such shift report" from its first statement.
--   select count(*) from pg_proc where proname = 'reopen_shift_report';  → 1
-- ============================================================================
