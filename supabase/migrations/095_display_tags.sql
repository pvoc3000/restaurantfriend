-- 095 — display tags: the case signs, with the price overlaid at print time.
--
-- Mark, 2026-09-06: "Tags are the display signs we use in different parts of
-- the shop. They are linked to production items so they are aware of price.
-- … we use a custom font and they require special kerning and line breaks, so
-- chose instead to make the tags outside of FMP, and overlay the price on top
-- when printing. There are three sizes: 2x3.5", 2x8" and 2x10"."
--
-- FileMaker's `DisplaySigns` table (DF-Premade-Production): 86 records — a
-- title, an optional description, a donut id, and three container fields
-- (BackgroundImage4x3 / 2x8 / 2x10). The app's job is the same as FMP's:
-- keep the artwork, and at print time cover the price baked into it with the
-- CURRENT price of the linked production item, resolved at the working shop
-- (`lib/productionPrice`). There is deliberately NO price column here — a
-- stored price is exactly the stale figure the overlay exists to replace.
--
-- TWO TABLES: the tag and its backgrounds, one row per SIZE (`unique (tag_id,
-- size)`), because a slot is either filled or empty and the printer prints
-- one size at a time. The 2x10 slot holds the 2x8 artwork in every case on
-- disk (2400x600 px); the renderer centres it on a 10" black label.
--
-- `production_item_id` is NULLABLE and `on delete set null`: five FileMaker
-- records carry a donut id that resolves to nothing, two tags legitimately
-- share one donut, and a tag outlives the item it was drawn for.
--
-- Access is the Page Permissions sheet's row for Tags — staff hidden,
-- supervisor Read, purchaser+ Write — so the write policies are 037's
-- production-catalog array, and the bucket is its own (PRIVATE, signed URLs)
-- rather than `org-documents`, whose writes are supervisor+.
--
-- Rerunnable? NO — `create table` fails a second time. Run in the SQL editor.
-- ============================================================================

create table display_tags (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  production_item_id uuid references production_items(id) on delete set null,

  title text not null,
  description text,
  is_active boolean not null default true,

  legacy_id text,
  source text not null default 'app' check (source in ('app', 'filemaker')),
  source_payload jsonb,

  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint display_tags_legacy_unique unique (org_id, legacy_id)
);

comment on table display_tags is
  'A display sign for the case, linked to the production item whose CURRENT price is overlaid on its artwork at print time. No price is stored here. Backgrounds in display_tag_images, one per size. See 095.';

create index display_tags_org_title_idx on display_tags (org_id, title);
create index display_tags_item_idx on display_tags (production_item_id);

create trigger display_tags_touch
  before update on display_tags
  for each row execute function set_updated_at();

create table display_tag_images (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  tag_id uuid not null references display_tags(id) on delete cascade,
  size text not null check (size in ('2x3.5', '2x8', '2x10')),
  storage_path text not null,
  file_name text,
  content_type text,
  byte_size bigint,
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now(),

  constraint display_tag_images_one_per_size unique (tag_id, size)
);

comment on table display_tag_images is
  'One background per (tag, size). The 2x10 slot holds 8-inch artwork that the renderer centres on a 10-inch black label. See 095.';

-- ----------------------------------------------------------------------------
-- The bucket. PRIVATE; reads go through signed URLs. The key is
-- `{org_id}/{tag_id}/{uuid}.{ext}` so 018's `storage_folder_org` authorises
-- from the first segment with no join.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('display-tags', 'display-tags', false)
on conflict (id) do nothing;

create policy display_tags_object_read on storage.objects for select
  using (
    bucket_id = 'display-tags'
    and public.storage_folder_org(name) in (select user_org_ids())
  );

create policy display_tags_object_insert on storage.objects for insert
  with check (
    bucket_id = 'display-tags'
    and user_has_role(public.storage_folder_org(name), array['owner', 'admin', 'purchaser'])
  );

create policy display_tags_object_update on storage.objects for update
  using (
    bucket_id = 'display-tags'
    and user_has_role(public.storage_folder_org(name), array['owner', 'admin', 'purchaser'])
  );

create policy display_tags_object_delete on storage.objects for delete
  using (
    bucket_id = 'display-tags'
    and user_has_role(public.storage_folder_org(name), array['owner', 'admin', 'purchaser'])
  );

-- ----------------------------------------------------------------------------
-- RLS: every member reads, purchaser+ writes — 037's loop, verbatim.
-- ----------------------------------------------------------------------------
alter table display_tags enable row level security;
alter table display_tag_images enable row level security;

do $$
declare t text;
begin
  foreach t in array array['display_tags', 'display_tag_images'] loop
    execute format(
      'create policy %I_select on %I for select
         using (org_id in (select user_org_ids()))', t, t);
    execute format(
      'create policy %I_insert on %I for insert
         with check (user_has_role(org_id, array[''owner'',''admin'',''purchaser'']))', t, t);
    execute format(
      'create policy %I_update on %I for update
         using (user_has_role(org_id, array[''owner'',''admin'',''purchaser'']))
         with check (user_has_role(org_id, array[''owner'',''admin'',''purchaser'']))', t, t);
    execute format(
      'create policy %I_delete on %I for delete
         using (user_has_role(org_id, array[''owner'',''admin'',''purchaser'']))', t, t);
  end loop;
end $$;

-- ============================================================================
-- Probes:
--   select count(*) from display_tags;                          -- 86 after the load
--   select count(*) from display_tag_images;                    -- 249 after the load
--   select count(*) from display_tags where production_item_id is null;  -- 5 (named by the loader)
--   select id, public from storage.buckets where id = 'display-tags';    -- one row, false
--   select polname from pg_policy where polrelid = 'public.display_tags'::regclass;  -- four
-- ============================================================================
