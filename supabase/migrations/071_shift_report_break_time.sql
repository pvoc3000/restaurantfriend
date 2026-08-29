-- ============================================================================
-- restaurantfriend — migration 071 · what time the break was taken
--
-- Why (Mark, 2026-08-28, testing the shift report): "In fmp we had supervisors
-- enter the time of the break."
--
-- 070 asked only WHETHER a meal was taken. FileMaker asked WHEN, and that turns
-- out to be the more useful half — California's rule is about TIMING, not
-- provision: §512 and *Brinker* want the meal to begin within five hours, and
-- `lib/breakRules` already distinguishes `late_meal` from `no_meal` for exactly
-- that reason. A supervisor who ticks the box has told us the break happened; a
-- supervisor who writes 4:45pm against a 10am start has told us it was late,
-- which is a premium the shop owes and the tick alone conceals.
--
-- ---------------------------------------------------------------------------
-- WHY IT IS A `time` AND NOT A TIMESTAMP
--
-- The supervisor is reading a clock on a wall, not recording an instant. The
-- workday is already on the report (`report_date`) and the shop's timezone is
-- already on the org, so the two together resolve it whenever anybody needs an
-- instant — and storing one here would mean deciding a zone at entry, which is
-- the mistake `lib/timeZone` exists to stop being made casually.
--
-- It is also NULLABLE and stays nullable even when the box is ticked. "They got
-- their break and I didn't note the time" is the common case and is not the
-- same claim as "they got no break"; forcing a time would make a supervisor
-- invent one, which is worse than not knowing.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS DELIBERATELY DOES NOT DO
--
-- It does not reach `break_premiums`. 070's flush records a premium when the
-- box is UNTICKED with a reason, and that rule is untouched: whether a LATE
-- meal owes a premium is `lib/breakRules`' judgement over the punches, and the
-- punches are not imported until the pay period ends. The time is recorded now
-- so that judgement has something to work from later; wiring it into the flush
-- before the punches exist would be guessing with somebody's pay.
--
-- Depends on 070. Run in the Supabase SQL editor BEFORE deploying — the ratings
-- page selects this column. NOT rerunnable (add column fails a second time).
-- ============================================================================

alter table shift_report_ratings
  add column break_started_at time;

comment on column shift_report_ratings.break_started_at is
  'Wall-clock time the meal break began, as the supervisor read it. Null means '
  'unrecorded, which is not the same as no break — `got_break` answers that.';

-- ----------------------------------------------------------------------------
-- After this runs:
-- ----------------------------------------------------------------------------
--   select column_name, data_type, is_nullable
--     from information_schema.columns
--    where table_name = 'shift_report_ratings' and column_name = 'break_started_at';
--     → one row, `time without time zone`, YES.
-- ============================================================================
