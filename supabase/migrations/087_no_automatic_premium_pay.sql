-- ============================================================================
-- restaurantfriend — migration 087 · the shift report stops paying people
--
-- Why (Mark, 2026-09-02): "I don't think the app should automatically add
-- premium pay - the need for it should be suggested in Timesheets and something
-- the user has to click to make happen."
--
-- 070's flush inserted a `break_premiums` row decided `owed`, worth an hour,
-- for every employee the supervisor marked as having missed a meal. Its own
-- comment called that "the conservative reading and the employee's" — and it is
-- still a decision the app was making on nobody's behalf, at 11pm, from one
-- checkbox, before anybody had looked at the punches.
--
-- ---------------------------------------------------------------------------
-- THE SUGGESTION ALREADY EXISTS, AND IT IS EXACTLY WHAT HE DESCRIBES
--
-- `ShiftPremium`, on the timesheet row's expansion, appears whenever the
-- workday carries a finding — DERIVED from the punches by `assessWorkday` on
-- every render and never stored (decision 3) — or already carries a decision.
-- A human then picks owed / waived / not owed and types the reason 032 requires
-- for `owed`. Nothing about that changes here, and nothing needs to: the
-- suggestion happens whether or not this function writes anything, because it
-- is computed from the punches rather than from the report.
--
-- So what 070 was doing was pre-empting that judgement with the answer that
-- pays, and `ShiftPremium` would then show a decision somebody had already
-- "made" without seeing the timesheet it belongs to.
--
-- ---------------------------------------------------------------------------
-- WHAT IS AND IS NOT LOST
--
-- The supervisor's testimony stays. `shift_report_ratings.got_break` and
-- `break_reason` are unchanged, they are still required before a report can be
-- sent, and they travel in the emailed report. What they no longer do is
-- decide.
--
-- KNOWN GAP, stated rather than discovered later: that reason is not yet
-- visible in Timesheets beside the premium control. `ShiftPremium` reads the
-- punches and `break_premiums`, not the shift report — so whoever decides sees
-- THAT a meal is missing and not what the supervisor said about it. Joining
-- them is the natural follow-up and is a screen change, not a schema one.
--
-- ---------------------------------------------------------------------------
-- 072's REOPEN IS DELIBERATELY UNTOUCHED. It deletes a premium by
-- `break_premium_id` when the rating carries one — and after this nothing sets
-- that column, so the branch is a no-op for new reports and STILL CORRECT for
-- every report sent before today, which does carry one. Removing it would make
-- those irreversible.
--
-- `v_breaks` survives and keeps its place in the receipt, now counting missed
-- breaks RECORDED rather than premiums written — which is the more useful of
-- the two figures and the only one still true.
--
-- ---------------------------------------------------------------------------
-- PROBE, don't read a note in a file:
--
--   select count(*) from pg_proc where proname = 'submit_shift_report';   -- 1
--
--   select prosrc like '%insert into break_premiums%'
--     from pg_proc where proname = 'submit_shift_report';                 -- f
--
-- The second is the one that matters; the first catches an argument list having
-- drifted into an overload (033's `freeze_pay_period` trap).
--
-- Reproduced IN FULL per 055's rule — 070 is applied, and a file that no longer
-- describes what was run is how the harness and production stop being the same
-- database. Diffed against 070:402-609; identical but for the block named
-- above, the `v_premium_id` declaration, and the final UPDATE.
--
-- Same argument list, so `create or replace` cannot make an overload.
--
-- Depends on 070. Run in the Supabase SQL editor. RERUNNABLE.
-- ============================================================================

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
-- 002's rule: `create or replace` keeps existing grants, but state them anyway
-- so a fresh replay of the migrations lands in the same place as production.
revoke all on function public.submit_shift_report(uuid) from public;
revoke all on function public.submit_shift_report(uuid) from anon;
grant execute on function public.submit_shift_report(uuid) to authenticated;
