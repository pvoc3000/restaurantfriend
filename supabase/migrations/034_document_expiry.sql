-- ============================================================================
-- restaurantfriend — migration 034 · paperwork can lapse
--
-- Why (Mark, 2026-08-05):
--
--   "can we add an expiration date to employee paperwork? By default, all
--    paperwork should not expire, but some things, like food handler cards, we
--    should be able to set an expiration date. The app should flag employees
--    with expired documents."
--
-- 021 made onboarding completeness DERIVED from the documents on file, which
-- fixed the "checkbox is a claim about paper in a drawer" problem. This is the
-- other half of the same problem: a food handler card that expired in 2023 is
-- on file, so the derived flags say complete, and the thing a health inspector
-- would actually ask about is invisible.
--
-- ONE nullable column. Null is the default and means "this does not lapse",
-- which is the honest reading for a W-4 or a signed handbook receipt — so no
-- existing row needs touching and nothing has to be decided per kind. There is
-- deliberately no per-kind allow-list: which documents expire is a fact about
-- the piece of paper in your hand, not about the vocabulary, and a card issued
-- with no expiry printed on it should be able to say so by staying null.
--
-- Depends on 021. Run in the Supabase SQL editor. NOT rerunnable (add column
-- fails a second time — that means it already ran).
-- ============================================================================

alter table employee_documents add column expires_on date;

comment on column employee_documents.expires_on is
  'When this document lapses. NULL means it does not expire, which is the '
  'default and the case for most onboarding paperwork.';

-- The roster asks "who has something expired?" on every load, over the whole
-- org. Partial, because the great majority of rows will never carry a date and
-- indexing 400 nulls to find the 30 cards is the wrong shape.
create index employee_documents_expires_idx
  on employee_documents (org_id, expires_on)
  where expires_on is not null;

-- ----------------------------------------------------------------------------
-- What this does NOT do: drop employees.food_handler_expires
-- ----------------------------------------------------------------------------
-- Mark's note says this "would negate the need for the food handler card
-- expiration date field", and it will — but not on the day it ships, because
-- the dates and the documents are not in the same place yet. Measured against
-- the live database, 2026-08-05:
--
--   employees.food_handler_expires   124 filled (16 current staff, 108 former)
--   employee_documents               42 rows, of which food_handler_card: 0
--
-- So dropping the column today destroys 124 real dates and moves none of them,
-- and there is nowhere to move them TO: a document row requires a file
-- (`storage_path` is NOT NULL), and nobody has photographed a card yet.
--
-- Until then the app reads the two in priority order, the way receiving prefers
-- the FILED invoice over the last raw reading: if a food handler card is on
-- file, ITS `expires_on` is the answer and the employee column is not shown as
-- one; otherwise the column answers and the screen says where the date will
-- move to. See `foodHandlerExpiry` in web/src/lib/employeeDocuments.ts.
--
-- The follow-up migration drops the column, and its precondition is a
-- measurement rather than a date: every current employee who has a food handler
-- expiry has the card itself on file. Probe before writing it —
--
--   select count(*) from employees e
--    where e.status <> 'inactive'
--      and e.food_handler_expires is not null
--      and not exists (select 1 from employee_documents d
--                       where d.employee_id = e.id
--                         and d.kind = 'food_handler_card');   -- must be 0
--
-- ============================================================================
-- Verify (in the SQL editor, after running):
--
--   select count(*) from employee_documents where expires_on is not null;
--     -- 0: the column exists and every existing document correctly reads as
--     --    "does not expire"
--   select indexname from pg_indexes
--    where tablename = 'employee_documents';    -- includes …_expires_idx
-- ============================================================================
