-- 094 — the organisation's documents.
--
-- Mark, 2026-09-05: "It's just a place to store, retrieve, and print the
-- documents the organization uses." FileMaker's `Documents` table — 73 records:
-- a title, a version, a category, which shop (or ALL), a description, a note,
-- who submitted it, and the file in a container. The forms, checklists,
-- signs, cheat sheets, job descriptions and manuals a shop prints.
--
-- TWO TABLES: the record and its files. One file is the ordinary case, but a
-- record with none is a real state (nine of the 73 have no file on disk) and
-- a second file — the 4-up beside the single — is too. Files are NOT
-- `facility_photos`: that bucket is supervisor+ and holds evidence about the
-- building, where a cheat sheet is for EVERY member to read and print. Hence
-- a bucket of its own with membership READ and supervisor+ WRITE, which is
-- the Page Permissions sheet's own row for this screen.
--
-- `location_id` is NULLABLE and null means FMP's "ALL" — the document is the
-- org's. `category` is free text with `allowNew` (nine values today).
-- `version` is TEXT ("01", "2021", "2023-01"). The record is ORG-WIDE: the
-- screen is not scoped to the working shop, only labelled by it.
--
-- DELETE is owner/admin on the record (023's rule) and cascades the file rows;
-- the app removes the objects after the row, 018's order.
--
-- Rerunnable? NO — `create table` fails a second time. Run in the SQL editor.
-- ============================================================================

create table org_documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  location_id uuid references locations(id) on delete set null,

  title text not null,
  version text,
  category text,
  description text,
  notes text,
  submitted_by text,
  added_on date,

  legacy_id text,
  source_payload jsonb,

  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint org_documents_legacy_unique unique (org_id, legacy_id)
);

comment on table org_documents is
  'The forms, checklists, signs and manuals the organisation prints — one record per document, the file(s) in org_document_files. See 094.';

create index org_documents_org_category_idx on org_documents (org_id, category, title);

create trigger org_documents_touch
  before update on org_documents
  for each row execute function set_updated_at();

create table org_document_files (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  document_id uuid not null references org_documents(id) on delete cascade,
  storage_path text not null,
  file_name text,
  content_type text,
  byte_size bigint,
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index org_document_files_document_idx on org_document_files (document_id);

-- ----------------------------------------------------------------------------
-- The bucket. PRIVATE like every other; reads go through signed URLs. The key
-- is `{org_id}/{document_id}/{uuid}.{ext}` so 018's `storage_folder_org`
-- authorises from the first segment with no join.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('org-documents', 'org-documents', false)
on conflict (id) do nothing;

create policy org_documents_object_read on storage.objects for select
  using (
    bucket_id = 'org-documents'
    and public.storage_folder_org(name) in (select user_org_ids())
  );

create policy org_documents_object_insert on storage.objects for insert
  with check (
    bucket_id = 'org-documents'
    and user_has_role(public.storage_folder_org(name),
                      array['owner', 'admin', 'purchaser', 'supervisor'])
  );

create policy org_documents_object_update on storage.objects for update
  using (
    bucket_id = 'org-documents'
    and user_has_role(public.storage_folder_org(name),
                      array['owner', 'admin', 'purchaser', 'supervisor'])
  );

create policy org_documents_object_delete on storage.objects for delete
  using (
    bucket_id = 'org-documents'
    and user_has_role(public.storage_folder_org(name),
                      array['owner', 'admin', 'purchaser', 'supervisor'])
  );

-- ----------------------------------------------------------------------------
-- RLS: every member reads, supervisor+ writes, owner/admin deletes a record.
-- ----------------------------------------------------------------------------
alter table org_documents enable row level security;
alter table org_document_files enable row level security;

create policy org_documents_select on org_documents for select
  using (org_id in (select user_org_ids()));
create policy org_documents_insert on org_documents for insert
  with check (
    user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor'])
    and created_by = auth.uid()
  );
create policy org_documents_update on org_documents for update
  using (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']))
  with check (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']));
create policy org_documents_delete on org_documents for delete
  using (user_has_role(org_id, array['owner', 'admin']));

create policy org_document_files_select on org_document_files for select
  using (org_id in (select user_org_ids()));
create policy org_document_files_write on org_document_files for all
  using (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']))
  with check (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']));

-- ============================================================================
-- Probes:
--   select count(*) from org_documents;                          -- 73 after the load
--   select count(*) from org_document_files;                     -- 64 after the load
--   select id, public from storage.buckets where id = 'org-documents';  -- one row, false
--   select polname, polcmd from pg_policy where polrelid = 'public.org_documents'::regclass;  -- four
-- ============================================================================
