-- ============================================================================
-- restaurantfriend — migration 022 · the eighth onboarding document is
-- "Orientation", not "Training Acknowledgement"
--
-- 021 took its document vocabulary from the FMP layout's eight checkboxes,
-- where the last one is LABELLED "Training Acknowledgement". The full table
-- export (2026-08-01) shows the label and the value list had come apart: the
-- `Paperwork` repeating field holds both values, and over 445 employees it is
--
--   Application 87 · W4 70 · I9 68 · Food Handlers Card 61 ·
--   I9 Documents 56 · Employee Handbook 48 · Orientation 45 ·
--   Notice to Employee 41 · Training Acknowledgement 3
--
-- so "Orientation" is the one people were actually ticking, by 15 to 1. The
-- checkbox was evidently relabelled and the value list never followed.
--
-- `orientation` is added and becomes the required kind (see
-- REQUIRED_ONBOARDING_KINDS in web/src/lib/employeeDocuments.ts).
-- `training_ack` is KEPT rather than dropped — three people have one, and a
-- vocabulary that can't express a document somebody actually signed is worse
-- than one with a rarely-used value in it. It is simply no longer required.
--
-- Run in the Supabase SQL editor. Rerunnable in the sense that it will fail
-- loudly the second time (the constraint name won't exist), which is the
-- signal it already ran.
-- ============================================================================

alter table employee_documents drop constraint employee_documents_kind_check;

alter table employee_documents add constraint employee_documents_kind_check
  check (kind in ('application', 'w4', 'i9', 'i9_docs',
                  'food_handler_card', 'handbook',
                  'notice_to_employee', 'orientation', 'training_ack',
                  'meal_break_waiver', 'review', 'write_up',
                  'other'));

-- ============================================================================
-- Verify (in the SQL editor, after running):
--
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conrelid = 'employee_documents'::regclass
--      and conname = 'employee_documents_kind_check';   -- includes orientation
-- ============================================================================
