-- ============================================================================
-- restaurantfriend — migration 021 · the employee's paperwork
--
-- Why (Mark, 2026-08-01): FMP tracked onboarding as EIGHT CHECKBOXES on the
-- employee record — Application, W4, I9, I9 Documents, Food Handlers Card,
-- Employee Handbook, Notice to Employee, Training Acknowledgement — with the
-- documents themselves nowhere in the system. A checkbox is a claim that a
-- piece of paper exists somewhere; it goes stale the moment someone ticks it
-- optimistically, and it can't be audited.
--
--   "Onboarding paperwork seems like it should not be a check list but flags
--    that are set when those documents are uploaded."
--
-- So the flags are DERIVED and never stored: the app asks which kinds of
-- document exist for this employee and says what's missing
-- (web/src/lib/employeeDocuments.ts, `missingPaperwork`). Upload the W-4 and
-- the W-4 line goes from missing to filed; there is no separate thing to keep
-- in sync, and "complete" cannot be true without the file.
--
-- This also gives the HR module the filing cabinet FMP never had. FMP's Events
-- table grew a "Document" type in 2024 (81 rows, 73 of them flagged as having
-- a paper original) precisely because there was nowhere else to put a signed
-- form. Those rows land here when the Events module is migrated.
--
-- Depends on 020 (FK to employees). Apply 020 first.
-- Run in the Supabase SQL editor. NOT rerunnable — the bucket insert is
-- guarded, but `create table` and `create policy` are not.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The table
-- ----------------------------------------------------------------------------
create table employee_documents (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references orgs(id) on delete cascade,

  -- Cascade here, unlike employees.user_id: a document is ABOUT this employee
  -- and means nothing without them. (Employees are never deleted anyway —
  -- 020 gives that table no delete policy — so this is belt and braces.)
  employee_id  uuid not null references employees(id) on delete cascade,

  -- `{org_id}/{employee_id}/{uuid}.{ext}` — org first, so the storage policies
  -- below authorise from the path alone with no join. Same shape as 018's
  -- po-attachments keys, and the uuid rather than the original filename keeps
  -- two files called "scan.pdf" apart.
  storage_path text not null,

  -- The vocabulary is FMP's own paperwork list plus the three things that were
  -- being filed as "Events" for want of anywhere better. `other` is the
  -- catch-all and never satisfies a required kind.
  kind         text not null default 'other'
               check (kind in ('application', 'w4', 'i9', 'i9_docs',
                               'food_handler_card', 'handbook',
                               'notice_to_employee', 'training_ack',
                               'meal_break_waiver', 'review', 'write_up',
                               'other')),

  file_name    text,
  content_type text,
  byte_size    bigint,
  added_by     uuid references auth.users(id),
  created_at   timestamptz not null default now()
);

create index employee_documents_employee_idx
  on employee_documents (employee_id);

-- ----------------------------------------------------------------------------
-- 2. RLS
-- ----------------------------------------------------------------------------
-- owner/admin at every verb, matching 020's employees policies — a W-4 is not
-- an invoice, and the people who may read the employee record are the people
-- who may read their paperwork.
--
-- Delete IS allowed here, unlike employees: a misfiled or duplicate scan
-- should come back off, and deleting it destroys no history.
alter table employee_documents enable row level security;

create policy employee_documents_rw on employee_documents for all
  using (user_has_role(org_id, array['owner', 'admin']))
  with check (user_has_role(org_id, array['owner', 'admin']));

-- ----------------------------------------------------------------------------
-- 3. The bucket
-- ----------------------------------------------------------------------------
-- PRIVATE, and more obviously so than po-attachments: these are signed tax and
-- eligibility forms. Reads go through short-lived signed URLs minted
-- server-side.
insert into storage.buckets (id, name, public)
values ('employee-documents', 'employee-documents', false)
on conflict (id) do nothing;

-- `public.storage_folder_org()` comes from 018 — it returns null instead of
-- raising on a non-uuid first segment, and its grants (revoked from public and
-- anon, granted to authenticated) are already sorted there. Reuse, don't
-- redefine: a second `create or replace` here would silently become the
-- definition both migrations' policies depend on.
--
-- Note the difference from 018: READ is role-gated too. 018 lets any member of
-- the org read an invoice; here every verb asks for owner/admin, because the
-- object is the personnel file.
create policy employee_docs_object_read on storage.objects for select
  using (
    bucket_id = 'employee-documents'
    and user_has_role(
          public.storage_folder_org(name),
          array['owner', 'admin']
        )
  );

create policy employee_docs_object_insert on storage.objects for insert
  with check (
    bucket_id = 'employee-documents'
    and user_has_role(
          public.storage_folder_org(name),
          array['owner', 'admin']
        )
  );

create policy employee_docs_object_update on storage.objects for update
  using (
    bucket_id = 'employee-documents'
    and user_has_role(
          public.storage_folder_org(name),
          array['owner', 'admin']
        )
  );

create policy employee_docs_object_delete on storage.objects for delete
  using (
    bucket_id = 'employee-documents'
    and user_has_role(
          public.storage_folder_org(name),
          array['owner', 'admin']
        )
  );

-- ============================================================================
-- Verify (in the SQL editor, after running):
--
--   select count(*) from employee_documents;            -- 0, table exists
--   select id, public from storage.buckets
--    where id = 'employee-documents';                   -- public = f
--   select policyname from pg_policies
--    where schemaname = 'storage' and tablename = 'objects'
--      and policyname like 'employee_docs%';            -- four rows
-- ============================================================================
