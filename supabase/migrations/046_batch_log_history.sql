-- ============================================================================
-- restaurantfriend — migration 046 · the batch log gets its history
--
-- 14,103 FileMaker batches over 609 kitchen-days, 2019-08-20 → 2026-08-04.
-- Production's own brief says NO HISTORY MIGRATES (Mark, 2026-08-07: fresh
-- plans and schedules), and that rule was about PLANS and SCHEDULES — documents
-- that say what to make next. A batch log says what was made, and Mark asked
-- for it directly (2026-08-09). The two-week history on the item record and the
-- "Previously made" column in the batch pane are both reading a table that
-- currently starts on the day we switched over.
--
-- ---------------------------------------------------------------------------
-- IT IS NOT READ-ONLY, AND THAT IS A DECISION (Mark, 2026-08-09: "make it read
-- only only if it needs to be. If it doesn't, then it doesn't").
--
-- It doesn't. The draft of this migration narrowed the update and delete
-- policies to exclude migrated rows, and every argument for that turned out to
-- be about a feeling rather than a failure:
--
--   * 023 already settled the shape of this. 020 refused to give `employees` a
--     delete policy on the grounds that people are terminated, never deleted;
--     023 reversed it, because that rule was right about a PERSON and wrong
--     about a TYPO. A 2024 yield somebody keyed as 40 instead of 4 is a typo,
--     and a history you cannot correct is not more trustworthy than one you can.
--   * A batch is ALREADY a working document here. Nothing else in this schema
--     freezes a record because it is old; a purchase order from last July is
--     still editable, deliberately.
--   * There is no silent-corruption path to guard. Batch numbers run 1–19,541
--     and `next_batch_number` is past 30,000, so nothing collides; the cost
--     columns are null and only fill on an explicit act.
--
-- What history DOES need is to be identifiable, which is what `legacy_id`
-- is for — and the same column makes the load idempotent and reversible.
--
-- ---------------------------------------------------------------------------
-- `is_generated` STAYS FALSE ON EVERY MIGRATED ROW, and this is the trap.
--
-- It reads like the wrong answer: FileMaker generated most of these from its
-- own weekly round, so `true` looks more honest. It is refused by the schema.
-- 045's partial unique index — `(log_id, element_id) where is_generated` —
-- exists to stop OUR generator writing a second row for one element on one day,
-- and the real data has **54 kitchen-days where an element was batched more
-- than once** (51 twice, 3 three times, 1 four times: 58 rows over the line).
-- Marking them generated would refuse 58 real batches mid-load.
--
-- That index has no jurisdiction over history anyway — it guards a function
-- that never ran here. So the flag is false, and the UI stops reading `false`
-- as "logged by hand" when the row carries a `legacy_id`: for a FileMaker batch
-- NEITHER marker is true, and an asterisk on 14,103 rows says nothing.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Where a migrated row came from
-- ----------------------------------------------------------------------------
-- 036/037/040's idiom exactly: a nullable `legacy_id` unique per org, plus the
-- raw record so a question nobody has asked yet can still be answered without
-- going back to the .mer file.
alter table production_batch_logs
  add column legacy_id      text,
  add column source_payload jsonb;

alter table production_batches
  add column legacy_id      text,
  add column source_payload jsonb;

-- UNIQUE PER ORG, and it is what makes the loader idempotent — re-running it
-- updates rather than duplicating, which is 028's `source_row_key` lesson in
-- this table's terms.
--
-- A PLAIN CONSTRAINT, not a partial index, and the difference is not stylistic.
-- Postgres allows unlimited NULLs in a unique index either way, so `where
-- legacy_id is not null` buys nothing here — and it costs the thing the loader
-- needs: inferring a PARTIAL index for `on conflict` requires repeating its
-- predicate in the conflict target, which PostgREST's `onConflict` cannot
-- express (it takes a column list and nothing else). So an upsert against a
-- partial index fails at the loader with an error about no matching constraint.
-- 036, 037 and 040 all use the plain form for exactly this reason.
alter table production_batch_logs
  add constraint production_batch_logs_legacy_key unique (org_id, legacy_id);

alter table production_batches
  add constraint production_batches_legacy_key unique (org_id, legacy_id);

-- The list is about to go from 1 row to 610, and it opens on the most recent
-- kitchen-days. 045 already indexes (org_id, log_date desc, location_id), which
-- covers that; nothing further is needed here.


-- ----------------------------------------------------------------------------
-- 2. Notes for the reader
-- ----------------------------------------------------------------------------
comment on column production_batch_logs.legacy_id is
  'FileMaker provenance. Composed as BL:<location code>:<date>, because FMP has '
  'no batch-log record at all — the header is derived from the (location, date) '
  'pairs its batches fall into, which is exactly what 045 keys this table on.';

comment on column production_batches.legacy_id is
  'FileMaker''s __BatchLogID, which is a real key: 14,103 distinct over 14,103 '
  'rows with no blanks. Prefixed B: to match the schema''s other legacy ids.';

comment on column production_batches.source_payload is
  'The FileMaker row as exported. Holds the fields with no column here — '
  'Batch_Yield_full_c, the search globals, _CreatedBy — and the ORIGINAL '
  'Batch_Status string, so normalising "1 TO DO" to to_do stays reversible.';
