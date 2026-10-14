-- ============================================================================
-- restaurantfriend — migration 203 · Rescued: what went out in Too Good To Go
--                                    boxes is not sold
--
-- Mark, 2026-10-14: "the more successful the program is, the less donuts we're
-- throwing away making it look in Restaurant Friend that we're selling out, so
-- we aren't lowering production on some donuts that we probably need to."
--
-- `sold` was `made − leftover`, and the boxes are packed and handed out in the
-- last hour, BEFORE the closer counts — so every boxed donut arrived in `sold`.
-- A third count fixes it: RESCUED, what went into the boxes, entered on the
-- Premades sheet the supervisor already counts from.
--
--   sold = made − leftover − rescued
--
-- "Rescued", not "Donated": a Too Good To Go box is SOLD at a discount, so
-- "donated" would be untrue on the very thing it is for, and it is the word for
-- a tax-deductible gift. Rescued covers a food-bank pickup too.
--
-- ONE RULE TO KNOW: a donut is in exactly one bucket. Rescued is what was
-- PACKED; a box nobody collects stays rescued and is not unpacked into the
-- leftover count, or it is subtracted twice.
--
-- What changes:
--   1. `rescued` on `production_schedule_items` and on the report's draft rows
--      (`shift_report_counts`), 040's type and check.
--   2. `v_production_schedule_lines` — still the SOLE definition of `sold`.
--      `create or replace` can only APPEND a column, so `rescued` goes last.
--   3. `set_schedule_actual` writes it, for the schedule screen.
--   4. `submit_shift_report` carries it to the schedule; `reopen_shift_report`
--      takes it back. Both restated IN FULL from 156 / 155 (055's rule),
--      changed only in the lines marked 203.
--
-- History is not corrected, and cannot be: every count before this was taken
-- after the boxes had gone, and nothing records how many there were.
--
-- Depends on 156. RERUNNABLE.
-- ============================================================================


-- 1. The column, twice --------------------------------------------------------

alter table production_schedule_items
  add column if not exists rescued numeric(10,2)
    check (rescued is null or rescued >= 0);

comment on column production_schedule_items.rescued is
  'Packed for Too Good To Go (or any giveaway) before close — not sold. 203.';

alter table shift_report_counts
  add column if not exists rescued numeric(10,2)
    check (rescued is null or rescued >= 0);


-- 2. v_production_schedule_lines ------------------------------------------------
-- Restated with its options and grant (043's lesson), although `create or
-- replace` keeps both.

create or replace view v_production_schedule_lines with (security_invoker = true) as
select
  li.id,
  li.org_id,
  li.schedule_id,
  li.item_id,
  li.item_name,
  li.item_type,
  li.subtype,
  li.finish,
  li.size,
  li.tally_box_size,
  li.tray_capacity,
  li.tray_number,
  li.tray_band,
  li.par,
  li.planned_par,
  li.par_source,
  li.made,
  li.leftover,
  li.counted_by,
  li.counted_at,
  li.note,
  li.unit_cost,
  li.unit_price,
  li.cost_unresolved,
  li.costed_at,
  li.sort,
  s.schedule_date,
  s.location_id,
  s.kitchen_location_id,
  s.source,
  s.title       as schedule_title,
  s.generated_at,
  s.printed_at,
  -- 203: rescued comes off too. A blank Rescued subtracts nothing, so every
  -- schedule counted before this reads exactly as it did.
  case when li.made is null then null
       else li.made - coalesce(li.leftover, 0) - coalesce(li.rescued, 0) end as sold,
  (li.made is not null or li.leftover is not null or li.rescued is not null) as has_actuals,
  li.rescued
from production_schedule_items li
join production_schedules s on s.id = li.schedule_id;

grant select on v_production_schedule_lines to authenticated;


-- 3. set_schedule_actual --------------------------------------------------------
-- 044's function with a third column on the whitelist. The authors clear only
-- when this write empties the LAST of the three.

create or replace function public.set_schedule_actual(
  p_line_id uuid,
  p_column  text,
  p_value   numeric
)
returns production_schedule_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_row production_schedule_items;
begin
  if p_column is null or p_column not in ('made', 'leftover', 'rescued') then
    raise exception
      'set_schedule_actual writes made, leftover or rescued, not %', coalesce(p_column, 'null');
  end if;

  if p_value is not null and p_value < 0 then
    raise exception 'A count cannot be negative';
  end if;

  select li.org_id into v_org
    from production_schedule_items li where li.id = p_line_id;

  if v_org is null then
    raise exception 'No such schedule line';
  end if;

  if v_org not in (select user_org_ids()) then
    raise exception 'Not your organisation';
  end if;

  if not user_has_role(v_org, array['owner', 'admin', 'purchaser', 'supervisor']) then
    raise exception 'insufficient role to record a count';
  end if;

  update production_schedule_items
     set made     = case when p_column = 'made'     then p_value else made     end,
         leftover = case when p_column = 'leftover' then p_value else leftover end,
         rescued  = case when p_column = 'rescued'  then p_value else rescued  end,

         -- Against the row's own current values in one statement, so two
         -- people counting one line at once cannot lose a number.
         counted_by = case
           when p_value is null
            and (p_column = 'made'     or made     is null)
            and (p_column = 'leftover' or leftover is null)
            and (p_column = 'rescued'  or rescued  is null)
           then null else auth.uid() end,
         counted_at = case
           when p_value is null
            and (p_column = 'made'     or made     is null)
            and (p_column = 'leftover' or leftover is null)
            and (p_column = 'rescued'  or rescued  is null)
           then null else now() end
   where id = p_line_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.set_schedule_actual(uuid, text, numeric) from public;
revoke all on function public.set_schedule_actual(uuid, text, numeric) from anon;
grant execute on function public.set_schedule_actual(uuid, text, numeric) to authenticated;


-- 4. submit_shift_report (from 156) ----------------------------------------------

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
  -- 044's whitelist shape: `made`, `leftover`, `rescued` (203) and the two
  -- author columns,
  -- nothing else. `par`, `par_source` and every cost column are unreachable
  -- from here by construction, exactly as they are from `set_schedule_actual`.
  for v_count in
    select c.* from shift_report_counts c
     where c.report_id = p_report_id
       -- 203: a line with only Rescued filled in is still a count to carry.
       and (c.made is not null or c.leftover is not null or c.rescued is not null)
  loop
    update production_schedule_items
       set made       = coalesce(v_count.made, made),
           leftover   = coalesce(v_count.leftover, leftover),
           rescued    = coalesce(v_count.rescued, rescued),   -- 203
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
       -- 156: THE DRAFT IS THE WHOLE ROW, so it is written as it stands —
       -- an emptied field empties the batch. The Donut batches page saves every
       -- field of a row together, starting from what the batch held.
       set yield_count = v_batch.yield_count,
           yield_size  = v_batch.yield_size,
           yield_unit  = v_batch.yield_unit,
           -- 154: who made it, from the same page.
           operator_employee_id = v_batch.operator_employee_id,
           -- A Made amount entered IS the batch done (153, on Made since 155);
           -- an explicit status still wins.
           status      = coalesce(v_batch.status,
                                  case when v_batch.yield_count is not null
                                         or v_batch.yield_size is not null
                                       then 'complete' end,
                                  status),
           notes       = nullif(btrim(coalesce(v_batch.notes, '')), '')
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

revoke all on function public.submit_shift_report(uuid) from public;
revoke all on function public.submit_shift_report(uuid) from anon;
grant execute on function public.submit_shift_report(uuid) to authenticated;


-- 5. reopen_shift_report (from 155) ----------------------------------------------

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
       and (c.made is not null or c.leftover is not null or c.rescued is not null)  -- 203
  loop
    -- ONLY IF THE LINE STILL HOLDS WHAT WE WROTE. `is not distinct from` so a
    -- null on either side compares properly rather than yielding null.
    update production_schedule_items li
       set made       = null,
           leftover   = null,
           rescued    = null,                                       -- 203
           counted_by = null,
           counted_at = null
     where li.id = v_count.schedule_item_id
       and li.made     is not distinct from v_count.made
       and li.leftover is not distinct from v_count.leftover
       and li.rescued  is not distinct from v_count.rescued;        -- 203

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
