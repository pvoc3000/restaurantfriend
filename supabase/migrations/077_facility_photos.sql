-- ============================================================================
-- restaurantfriend — migration 077 · photographs of what was found
--
-- Why (Mark, 2026-08-29): "they check off items that are done or complete. They
-- can take pics of the thing."
--
-- The third of three (075 → 076 → 077). SPLIT OFF DELIBERATELY, which is 021's
-- precedent: a Storage problem — a bucket that already exists, a policy name
-- that collides — must not hold the DATA MODEL hostage. 075 and 076 stand
-- without this; the app simply cannot attach a photo until it runs.
--
-- ONE BUCKET AND ONE TABLE FOR BOTH OWNERS. A photo hangs off a checklist
-- answer ("this is what the fryer looks like") or off a task ("here is what
-- needs doing"), and both are the same act with the same audience. So
-- `facility_photos` carries a nullable `run_item_id` AND a nullable `task_id`
-- with a check that exactly one is set — 026's precedent, where
-- `purchase_order_attachments` gained a nullable `invoice_id` so one file could
-- belong to a PO and a bill.
--
-- 021 has the other precedent and it does NOT apply here: employee documents
-- needed their own bucket because they have a DIFFERENT AUDIENCE (owner/admin
-- only). These have the same audience as each other, and the deciding test is
-- always RLS rather than tidiness.
--
-- Depends on 018 (the `public.storage_folder_org()` helper and its grants — NOT
-- recreated here, see below), 075 (location_tasks) and 076 (checklist_run_items).
--
-- Run in the Supabase SQL editor AFTER 076. NOT rerunnable (create table fails
-- a second time). The bucket insert IS idempotent, so a partial run that got as
-- far as the bucket and no further can be finished by hand.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The bucket
-- ----------------------------------------------------------------------------
-- PRIVATE, for 018's reason restated: a photograph of a shop's back room, its
-- paperwork or an inspector's report is not something to make readable by URL
-- to anyone who guesses a uuid. Reads go through short-lived signed URLs minted
-- SERVER-SIDE in one `createSignedUrls` batch — one round trip instead of one
-- per card, and a URL built to expire should not outlive the page.
insert into storage.buckets (id, name, public)
values ('facility-photos', 'facility-photos', false)
on conflict (id) do nothing;

-- The object key is `{org_id}/{run_id|task_id}/{uuid}.{ext}` — ORG FIRST, so
-- the policies below authorise from the path alone with no join, exactly like
-- the `org_id in (select user_org_ids())` on every table. 018's four policies
-- test the first segment and nothing else, which is what makes this shape
-- reusable rather than a new design.
--
-- `public.storage_folder_org()` IS NOT RECREATED HERE. It is 018's, it is
-- already revoked from `public` and `anon` and granted to `authenticated`, and
-- re-running those grants would be a second place where that decision lives. If
-- this migration is ever replayed on a database that lacks 018, it fails loudly
-- on the first policy — which is the correct failure.

-- Read: any member of the owning org. Matching `facility_photos`' own select
-- policy below, which is supervisor+ — the OBJECT policy is deliberately the
-- looser of the two, because a signed URL is minted server-side against a row
-- the caller has already been allowed to read. Tightening this to supervisor+
-- as well would be belt and braces; leaving it at membership matches 018 and
-- keeps one shape across every bucket in the schema.
create policy facility_photos_object_read on storage.objects for select
  using (
    bucket_id = 'facility-photos'
    and public.storage_folder_org(name) in (select user_org_ids())
  );

-- Write: supervisor+, matching who may walk a checklist and work a task. This
-- is where 041's own test applies — a supervisor may photograph a batch and may
-- NOT upload a recipe image, so each bucket names its own set rather than
-- inheriting one.
create policy facility_photos_object_insert on storage.objects for insert
  with check (
    bucket_id = 'facility-photos'
    and user_has_role(
          public.storage_folder_org(name),
          array['owner', 'admin', 'purchaser', 'supervisor']
        )
  );

create policy facility_photos_object_update on storage.objects for update
  using (
    bucket_id = 'facility-photos'
    and user_has_role(
          public.storage_folder_org(name),
          array['owner', 'admin', 'purchaser', 'supervisor']
        )
  );

create policy facility_photos_object_delete on storage.objects for delete
  using (
    bucket_id = 'facility-photos'
    and user_has_role(
          public.storage_folder_org(name),
          array['owner', 'admin', 'purchaser', 'supervisor']
        )
  );

-- ----------------------------------------------------------------------------
-- 2. facility_photos — the row that points at the object
-- ----------------------------------------------------------------------------
create table facility_photos (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,

  -- Exactly one of these. Both cascade: deleting the answer or the task should
  -- take its evidence with it, and 018's own delete ORDER is what keeps Storage
  -- in step — row first, then object, because an orphaned OBJECT is invisible
  -- and harmless where a row pointing at nothing renders broken. (Upload is the
  -- opposite order, for the same reason read the other way round.)
  run_item_id uuid references checklist_run_items(id) on delete cascade,
  task_id uuid references location_tasks(id) on delete cascade,

  storage_path text not null,
  file_name text,
  content_type text,
  byte_size bigint,
  caption text,

  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now(),

  constraint facility_photos_one_owner
    check ((run_item_id is not null)::int + (task_id is not null)::int = 1)
);

create index facility_photos_run_item_idx on facility_photos (run_item_id)
  where run_item_id is not null;
create index facility_photos_task_idx on facility_photos (task_id)
  where task_id is not null;

-- ----------------------------------------------------------------------------
-- 3. RLS
-- ----------------------------------------------------------------------------
-- The row follows its owner's audience: both `checklist_run_items` and
-- `location_tasks` are supervisor+ to read and supervisor+ to write, so this is
-- stated once rather than joined through two different parents. Simpler, and it
-- cannot drift out of step with a parent whose own rule changes — which it
-- would if it were an `exists` against two tables.
alter table facility_photos enable row level security;

create policy facility_photos_select on facility_photos for select
  using (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']));

create policy facility_photos_write on facility_photos for all
  using (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']))
  with check (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']));

-- ============================================================================
-- Probes (run these, don't trust a note in CLAUDE.md):
--
--   select id, public from storage.buckets where id = 'facility-photos';
--     → one row, public = FALSE. A public bucket here is a data leak.
--
--   select count(*) from pg_policy where polrelid = 'storage.objects'::regclass
--     and polname like 'facility_photos_object_%';                     -- 4
--
--   select count(*) from facility_photos;                              -- 0 today
--
-- And the check that would be silent if it broke — a photo must belong to
-- exactly one thing, never to both and never to neither:
--
--   insert into facility_photos (org_id, storage_path)
--   select id, 'x' from orgs limit 1;
--     → ERROR: violates check constraint "facility_photos_one_owner"
-- ============================================================================
