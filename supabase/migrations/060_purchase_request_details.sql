-- ============================================================================
-- restaurantfriend — migration 060 · a request can explain itself
--
-- Why (Mark, 2026-08-21): "I also think we should have a detail box so people
-- can explain the request."
--
-- 059 gave a request one text field, and it turns out to be doing two jobs.
-- "The big rainbow sprinkles" is the thing you scan down a queue; "the ones we
-- use on the Bacon Maple, not the little ones — we're down to half a tub and
-- Saturday is busy" is what the purchaser needs before they can buy the right
-- thing. Put both in one field and either the list becomes a wall of
-- paragraphs or the explanation never gets written.
--
-- So `request_text` stays the LINE — short, NOT NULL, what the row shows and
-- what the search box matches first — and `details` is the paragraph, nullable,
-- because most requests genuinely are one line and demanding prose for them is
-- how people stop filing requests at all.
--
-- Note what this is NOT: `resolution_note` is the ANSWER (059), written by
-- whoever resolves it. This is the ASK. Two people, two moments, two columns —
-- and the reason 059 merged `dismiss_reason` into one note column does not
-- apply, because that merge was about two spellings of the same act.
--
-- A SEPARATE MIGRATION rather than an edit to 059, which is applied: once a
-- migration has run it is history, and a file that no longer describes what was
-- run is how the harness and production quietly stop being the same database
-- (055's rule).
--
-- Depends on 059. Run in the Supabase SQL editor BEFORE deploying — the list
-- selects this column. NOT rerunnable (add column fails a second time, which
-- means it already ran).
-- ============================================================================

alter table purchase_requests add column details text;

comment on column purchase_requests.details is
  'The requester''s own explanation — why this, which one, how urgent it '
  'really is. Optional: most requests are one line. Distinct from '
  'resolution_note, which is the answer rather than the ask.';

notify pgrst, 'reload schema';

-- ============================================================================
-- Verify (in the SQL editor, after running):
--
--   select count(*) from purchase_requests where details is not null;
--     -- 0: the column exists and no existing request claims to have an
--     --    explanation nobody wrote
--   select column_name, is_nullable from information_schema.columns
--    where table_name = 'purchase_requests' and column_name = 'details';
--     -- details | YES
-- ============================================================================
