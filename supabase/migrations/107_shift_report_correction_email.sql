-- ============================================================================
-- restaurantfriend — migration 107 · a re-sent shift report is a CORRECTION
--
-- Why (Mark, 2026-09-18, after 106 let a supervisor reopen their own report):
-- "build the corrected email version". A reopened report that is sent again
-- emails the team again. That is right — managers read the email, not the app,
-- and it is the only copy that carries the ratings — but it arrived looking
-- exactly like the first one, so a second copy read as a duplicate rather than
-- as the version that replaces it.
--
-- The app could not tell, because 072's reopen clears `emailed_at` along with
-- every other stamp (correctly: a draft claiming it was emailed on Friday is the
-- record disagreeing with itself). So the fact has to be kept somewhere that is
-- NOT a claim about the current state: `previously_emailed_at`, set by the
-- reopen and never cleared. Non-null on a report being sent means "this email
-- replaces one sent at that time", and the web app marks the subject and the
-- top of both bodies.
--
-- Only the reopen WRITES it. Nothing else in the send path changes: the flush,
-- the mail and `emailed_at` are exactly as they were.
--
-- Run in the Supabase SQL editor. Rerunnable. The web app reads the column in a
-- separate, error-tolerant query, so deploying before this runs only means no
-- email is marked as a correction yet.
-- ============================================================================

alter table public.shift_reports
  add column if not exists previously_emailed_at timestamptz;

comment on column public.shift_reports.previously_emailed_at is
  'When this report was last emailed before being reopened (107). Set by reopen_shift_report, never cleared; non-null makes the next email a correction.';

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

  -- A manager reopens any report; a supervisor or purchaser only their OWN —
  -- the author rule every other shift_reports policy and 070's submit use.
  if not (
    user_has_role(v_report.org_id, array['owner', 'admin'])
    or (
      user_has_role(v_report.org_id, array['purchaser', 'supervisor'])
      and v_report.created_by = auth.uid()
    )
  ) then
    raise exception 'only a manager, or the supervisor who wrote it, can reopen a sent report';
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
  --
  -- EXCEPT THE FACT THAT THE TEAM WAS TOLD (107). `emailed_at` is cleared with
  -- the rest, but when it was set its value moves to `previously_emailed_at`
  -- first, so the next Send knows its email CORRECTS one people have read. A
  -- report reopened after a failed mail keeps the older value rather than
  -- losing it — coalesce, newest first.
  update shift_reports
     set previously_emailed_at = coalesce(emailed_at, previously_emailed_at),
         status        = 'draft',
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
--   select count(*) from information_schema.columns
--    where table_name = 'shift_reports' and column_name = 'previously_emailed_at';  → 1
--   select prosrc like '%previously_emailed_at%'
--     from pg_proc where proname = 'reopen_shift_report';                            → true
-- ============================================================================
