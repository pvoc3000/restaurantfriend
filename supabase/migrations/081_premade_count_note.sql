-- ============================================================================
-- restaurantfriend — migration 081 · a premade count can carry a note
--
-- Why (Mark, 2026-09-01): "We currently cannot leave a note for production
-- items in the premade sheet. We should be able to."
--
-- Page 4 of the shift report counts what was made and what was left over, and
-- a count on its own does not explain itself: "18 made, 0 left" and "18 made,
-- 0 left because we dropped a tray and re-fried" are the same two numbers.
--
-- ---------------------------------------------------------------------------
-- IT STAYS ON THE DRAFT ROW AND IS NEVER FLUSHED TO THE SCHEDULE LINE
--
-- The obvious build is the one `shift_report_batches` already uses: a `notes`
-- column that `submit_shift_report` writes through onto the real record
-- (`production_batches.notes`). That is right there and WRONG here, because the
-- two target columns are not the same kind of thing.
--
-- `production_batches.notes` is a note ABOUT THE BATCH — the same fact the
-- supervisor is recording, so writing through completes it.
-- `production_schedule_items.note` is an INSTRUCTION: 013 snapshots it at
-- generation, 069 copies a special order's own line note into it, and it PRINTS
-- on the packet as what the kitchen is being told to make. A supervisor's
-- "dropped a tray" landing there would overwrite the order with the outcome —
-- corrupting a document somebody has already worked from.
--
-- So there is no flush and `submit_shift_report` is UNTOUCHED, which is worth
-- having on its own: that function is applied, it is 200 lines, and 055's rule
-- means changing it means reproducing all of it. The note travels the way the
-- rest of the report's judgement does — in the emailed report, in the premades
-- table beside the two numbers it explains.
--
-- ---------------------------------------------------------------------------
-- NO POLICY CHANGE. 070's `shift_report_counts_write` is a `for all` over the
-- row, so it already covers a new column — the same reason 060 needed none for
-- `purchase_requests.details`. Nullable, so nothing existing has to move.
--
-- PROBE, don't read a note in a file:
--
--   select column_name, is_nullable from information_schema.columns
--    where table_name = 'shift_report_counts' and column_name = 'note';
--                                                  -- one row, YES
--
--   select count(*) from pg_policy
--    where polrelid = 'public.shift_report_counts'::regclass;   -- still 2
--
-- Depends on 070. Run in the Supabase SQL editor. RERUNNABLE.
-- ============================================================================

alter table shift_report_counts
  add column if not exists note text;

comment on column shift_report_counts.note is
  'The supervisor''s note about this line''s count — why 18 were made, or where the missing tray went. Reported in the emailed shift report and deliberately NOT flushed onto production_schedule_items.note, which is an instruction rather than an outcome. See migration 081.';
