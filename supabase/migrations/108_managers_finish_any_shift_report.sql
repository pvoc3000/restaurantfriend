-- ============================================================================
-- restaurantfriend — migration 108 · a manager can finish anybody's draft
--
-- Why (Mark, 2026-09-18): "I can reopen someone else's report, but I can't
-- send it or close it again." 106 left a manager's reopen reaching ANY report,
-- and the report then became a draft only its author could touch — so a
-- manager reopening a colleague's report to fix it produced one nobody else
-- could finish.
--
-- The rest of 070 already says a manager may: `shift_reports_update` and
-- `_delete` exempt owner/admin from the author rule, and `submit_shift_report`
-- does too ("the only way to rescue a draft left by somebody who has left").
-- The three DRAFT tables were the exception — their write policies named the
-- author with no manager exemption — so a manager could edit page 1 and send
-- the report but not correct a count or a rating on it. This brings them into
-- line with their parent. Nothing about SUPERVISORS changes: they still write
-- only drafts they created.
--
-- Reading is unchanged: managers already read all three (the ratings select
-- policy names owner/admin explicitly).
--
-- Run in the Supabase SQL editor. Rerunnable (drop if exists / create).
-- ============================================================================

drop policy if exists shift_report_ratings_write on shift_report_ratings;
create policy shift_report_ratings_write on shift_report_ratings for all
  using (
    exists (
      select 1 from shift_reports r
       where r.id = shift_report_ratings.report_id
         and r.status = 'draft'
         and (
           user_has_role(r.org_id, array['owner', 'admin'])
           or (
             r.created_by = auth.uid()
             and user_has_role(r.org_id, array['purchaser', 'supervisor'])
           )
         )
    )
  )
  with check (
    exists (
      select 1 from shift_reports r
       where r.id = shift_report_ratings.report_id
         and r.status = 'draft'
         and (
           user_has_role(r.org_id, array['owner', 'admin'])
           or (
             r.created_by = auth.uid()
             and user_has_role(r.org_id, array['purchaser', 'supervisor'])
           )
         )
    )
  );

drop policy if exists shift_report_counts_write on shift_report_counts;
create policy shift_report_counts_write on shift_report_counts for all
  using (
    exists (
      select 1 from shift_reports r
       where r.id = shift_report_counts.report_id
         and r.status = 'draft'
         and (
           user_has_role(r.org_id, array['owner', 'admin'])
           or (
             r.created_by = auth.uid()
             and user_has_role(r.org_id, array['purchaser', 'supervisor'])
           )
         )
    )
  )
  with check (
    exists (
      select 1 from shift_reports r
       where r.id = shift_report_counts.report_id
         and r.status = 'draft'
         and (
           user_has_role(r.org_id, array['owner', 'admin'])
           or (
             r.created_by = auth.uid()
             and user_has_role(r.org_id, array['purchaser', 'supervisor'])
           )
         )
    )
  );

drop policy if exists shift_report_batches_write on shift_report_batches;
create policy shift_report_batches_write on shift_report_batches for all
  using (
    exists (
      select 1 from shift_reports r
       where r.id = shift_report_batches.report_id
         and r.status = 'draft'
         and (
           user_has_role(r.org_id, array['owner', 'admin'])
           or (
             r.created_by = auth.uid()
             and user_has_role(r.org_id, array['purchaser', 'supervisor'])
           )
         )
    )
  )
  with check (
    exists (
      select 1 from shift_reports r
       where r.id = shift_report_batches.report_id
         and r.status = 'draft'
         and (
           user_has_role(r.org_id, array['owner', 'admin'])
           or (
             r.created_by = auth.uid()
             and user_has_role(r.org_id, array['purchaser', 'supervisor'])
           )
         )
    )
  );

-- ----------------------------------------------------------------------------
-- After this runs:
--   select policyname, qual like '%owner%' from pg_policies
--    where tablename like 'shift_report_%' and policyname like '%_write';  → 3 rows, all true
-- ============================================================================
