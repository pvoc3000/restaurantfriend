-- ============================================================================
-- restaurantfriend — migration 155 · donut batches use MADE, not batch_count
--
-- Mark, 2026-09-30: "did you create a 'Batch' field just for what we've been
-- working on? I think we should reuse the 'made' fields from the regular batch
-- log instead. The three fields." He is right: 153's `batch_count` was a second
-- answer to "how much was made", beside the `yield_count × yield_size
-- yield_unit` trio every batch already has — the batch record's MADE.
--
--   1. The eight counts recorded today (DF01, 2026-09-30) move into Made: the
--      count into `yield_count`, unit "batch" — a unit the FileMaker history
--      already uses. On the batches AND on the sent report's draft rows, so
--      reopen still recognises them as the report's own. Only where Made is
--      empty, so nothing already measured is overwritten. Backed up first to
--      `FMP Export/pre155-batch-count-2026-09-30.json`.
--   2. `submit_shift_report` and `reopen_shift_report` restated IN FULL from
--      154 without `batch_count` (055's rule). Made was always flushed and
--      reverted (070, 107); the one change is that a Made amount, rather than a
--      count, marks the batch complete.
--   3. `batch_count` dropped from `production_batches` and
--      `shift_report_batches`.
--
-- Depends on 154. NOT rerunnable (the drops).
-- ============================================================================

-- 1. The counts, into Made -------------------------------------------------
update production_batches
   set yield_count = batch_count,
       yield_unit  = coalesce(yield_unit, 'batch')
 where batch_count is not null
   and yield_count is null
   and yield_size  is null;

update shift_report_batches
   set yield_count = batch_count,
       yield_unit  = coalesce(yield_unit, 'batch')
 where batch_count is not null
   and yield_count is null
   and yield_size  is null;


-- 2. The flush and its undo, without batch_count -----------------------------
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

    -- ---- the missed break is RECORDED, and pays nothing --------------------
    -- 087. This used to insert a `break_premiums` row decided `owed`, which is
    -- the line Mark struck out: "I don't think the app should automatically add
    -- premium pay - the need for it should be suggested in Timesheets and
    -- something the user has to click to make happen."
    --
    -- That is already how Timesheets works and always has been. `ShiftPremium`
    -- appears on a row whenever the workday carries a finding — derived from
    -- the PUNCHES by `assessWorkday`, on every render, never stored (decision
    -- 3) — and a human picks owed / waived / not owed and types the reason 032
    -- requires for the first. So the suggestion happens whether or not this
    -- function writes anything, and what this was doing was pre-empting that
    -- judgement with the conservative answer before anybody had looked at the
    -- punches.
    --
    -- The supervisor's testimony is not lost. It stays on
    -- `shift_report_ratings` and travels in the emailed report; what it no
    -- longer does is DECIDE.
    if v_rating.got_break is false then
      v_breaks := v_breaks + 1;
    end if;

    -- `break_premium_id` is deliberately NOT set: nothing here creates a
    -- premium any more. The column stays, and 072's reopen still clears one,
    -- which is what keeps a report sent BEFORE 086 reversible.
    update shift_report_ratings
       set employee_event_id = v_event_id
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
           -- 154: who made it, from the same page.
           operator_employee_id = coalesce(v_batch.operator_employee_id, operator_employee_id),
           -- A Made amount entered IS the batch done (153, on Made since 155);
           -- an explicit status still wins.
           status      = coalesce(v_batch.status,
                                  case when v_batch.yield_count is not null
                                         or v_batch.yield_size is not null
                                       then 'complete' end,
                                  status),
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
-- 002's rule: `create or replace` keeps existing grants, but state them anyway
-- so a fresh replay of the migrations lands in the same place as production.
revoke all on function public.submit_shift_report(uuid) from public;
revoke all on function public.submit_shift_report(uuid) from anon;
grant execute on function public.submit_shift_report(uuid) to authenticated;


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

    -- 154: the preparer, on the same terms.
    if v_batch.operator_employee_id is not null then
      update production_batches pb
         set operator_employee_id = null
       where pb.id = v_batch.batch_id
         and pb.operator_employee_id = v_batch.operator_employee_id;
    end if;
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


-- 3. The field goes ---------------------------------------------------------
alter table production_batches   drop column batch_count;
alter table shift_report_batches drop column batch_count;
