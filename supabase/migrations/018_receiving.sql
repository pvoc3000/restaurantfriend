-- ============================================================================
-- restaurantfriend — migration 018 · receiving gets the invoice
--
-- Spec §2 step 5 has always said receiving ends with "attach invoice/packing-slip
-- photo to the PO (camera → Supabase Storage)". `purchase_order_attachments` has
-- been in the schema since 001 and has never had a writer, so today receiving
-- records quantities with nothing to check them against — the piece of phase 4
-- that was still missing.
--
-- Three things here, none of which depends on migration 017 (the Location
-- record); 017 and 018 can be applied in either order.
--
--   1. metadata on purchase_order_attachments, so the app can tell an invoice
--      photo from a PDF without fetching it, and can name a download
--   2. a PRIVATE Storage bucket + its RLS, org-scoped the same way every table
--      in this schema is
--   3. an index for the order guide's due-reminder query (purchase_reminders is
--      the other table from 001 that never got a writer)
--
-- Run in the Supabase SQL editor. NOT rerunnable — `add column` fails a second
-- time, and the bucket insert would too.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. What the app needs to know about an attachment without opening it
-- ----------------------------------------------------------------------------
-- 001 stored a storage path and nothing else. `content_type` decides whether the
-- card draws a thumbnail or a document row, `file_name` is what a download is
-- called (the object key is a uuid, deliberately — see §2), and `byte_size` is
-- there so a 30 MB photo can say so rather than just being slow.
alter table purchase_order_attachments
  add column file_name    text,
  add column content_type text,
  add column byte_size    bigint;

-- Every read is "the attachments for THIS purchase order".
create index if not exists purchase_order_attachments_po_idx
  on purchase_order_attachments (po_id);

-- ----------------------------------------------------------------------------
-- 2. The bucket
-- ----------------------------------------------------------------------------
-- PRIVATE. An invoice carries prices, account numbers and a delivery address;
-- a public bucket would make every one of them readable by URL to anyone who
-- guessed a uuid. Reads go through short-lived signed URLs minted server-side.
insert into storage.buckets (id, name, public)
values ('po-attachments', 'po-attachments', false)
on conflict (id) do nothing;

-- The object key is `{org_id}/{po_id}/{uuid}.{ext}` — org first, so the policies
-- below can authorise from the path alone with no join, exactly like the
-- `org_id in (select user_org_ids())` on every table. The uuid rather than the
-- original filename keeps two invoices called "scan.pdf" apart; the real name
-- lives in `file_name` above.
--
-- Cast safety is the fiddly part. `(storage.foldername(name))[1]::uuid` RAISES
-- on any object whose first segment isn't a uuid, and Postgres gives no
-- guarantee that it evaluates the `bucket_id` test first — so a stray object in
-- some other bucket could make every policy on the table throw. This wrapper
-- returns null instead, which simply fails the check.
create or replace function public.storage_folder_org(p_name text)
returns uuid
language plpgsql
immutable
set search_path = public
as $$
begin
  return (storage.foldername(p_name))[1]::uuid;
exception
  when others then return null;
end
$$;

-- Both revokes, per 002: a new public-schema function is executable by PUBLIC,
-- AND Supabase's default privileges grant execute to `anon` explicitly — and an
-- explicit grant survives a revoke from PUBLIC, so anon has to be named too.
revoke all on function public.storage_folder_org(text) from public;
revoke all on function public.storage_folder_org(text) from anon;

-- ...but `authenticated` MUST keep it, because the policies below call it and a
-- policy is evaluated with the querying role's privileges. Without this every
-- read of the bucket fails with "permission denied for function" rather than
-- with a row count of zero. Granted explicitly instead of leaning on Supabase's
-- defaults, since the revokes above are there precisely because those defaults
-- are not something to depend on.
grant execute on function public.storage_folder_org(text) to authenticated;

-- Read: any member of the owning org, matching purchase_order_attachments_read.
create policy po_attachments_object_read on storage.objects for select
  using (
    bucket_id = 'po-attachments'
    and public.storage_folder_org(name) in (select user_org_ids())
  );

-- Write: purchaser+, matching the table's write policy and the role that can
-- receive an order in the first place.
create policy po_attachments_object_insert on storage.objects for insert
  with check (
    bucket_id = 'po-attachments'
    and user_has_role(
          public.storage_folder_org(name),
          array['owner', 'admin', 'purchaser']
        )
  );

create policy po_attachments_object_update on storage.objects for update
  using (
    bucket_id = 'po-attachments'
    and user_has_role(
          public.storage_folder_org(name),
          array['owner', 'admin', 'purchaser']
        )
  );

create policy po_attachments_object_delete on storage.objects for delete
  using (
    bucket_id = 'po-attachments'
    and user_has_role(
          public.storage_folder_org(name),
          array['owner', 'admin', 'purchaser']
        )
  );

-- ----------------------------------------------------------------------------
-- 3. Reminders on the order guide
-- ----------------------------------------------------------------------------
-- `purchase_reminders` (001, renamed by 005) needs no schema change — it already
-- has member-read / purchaser+-write from the generic RLS loop. What it needs is
-- this index: the guide asks "what's due at this location, not yet dismissed"
-- on EVERY load, and that page is already the app's heaviest route.
--
-- Partial on dismissed_at because a dismissed reminder is never queried again,
-- so it has no business making the index bigger.
create index if not exists purchase_reminders_due_idx
  on purchase_reminders (location_id, show_on_date)
  where dismissed_at is null;

-- ============================================================================
-- Verify (in the SQL editor, after running):
--
--   select file_name, content_type, byte_size
--     from purchase_order_attachments limit 1;          -- columns exist
--   select id, public from storage.buckets
--    where id = 'po-attachments';                       -- bucket, public = f
--   select policyname from pg_policies
--    where schemaname = 'storage' and tablename = 'objects'
--      and policyname like 'po_attachments%';           -- four rows
--   select public.storage_folder_org('not-a-uuid/x.pdf');-- null, not an error
-- ============================================================================
