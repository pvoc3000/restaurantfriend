-- ============================================================================
-- restaurantfriend — migration 041 · the recipe sheet becomes a working document
--
-- Why (Mark, 2026-08-08, with FileMaker's RECIPES > RECIPE tab beside it): the
-- sheet 036 shipped is READ-ONLY, shows one scale column at a time, and drops
-- four things the old layout had — the sort field, the per-row AUTO switch, the
-- per-row HIDE-when-printed checkbox, and a picture on a procedure step.
--
-- Three of those are new columns. The fourth is the interesting one.
--
-- ----------------------------------------------------------------------------
-- THE AUTO SWITCH, AND WHAT IT DOES TO DECISION 3
-- ----------------------------------------------------------------------------
-- 036 made every scale column COMPUTED — one stored amount per line, multiplied
-- by the version's strip — on a measurement: 96.4% of FileMaker's stored
-- per-column amounts are within 2% of a strict multiple of the base. That
-- decision stands and is still the default. What it could not express was the
-- other 3.6%, and 036's own notes name the cost: "29 versions whose columns are
-- FORMULATION VARIANTS rather than scales … the one place this model loses
-- something FileMaker had".
--
-- FileMaker had an answer and we did not read it. `_recipelements.mer` carries
-- **`AutoUpdate_bool`**, one flag per line — set on 3,350 of the 5,260
-- ingredient lines, clear on 1,910 — and it says exactly this: computed, or
-- typed and left alone. A mixer size does not scale; a formulation variant is
-- not a multiple. So the flag comes across, `scale_auto` defaults TRUE, and
-- decision 3 becomes the default rather than the only option.
--
-- The stored strip is per-column QTY AND UNIT, because that is what a portion
-- size is — FMP's grid is two fields per cell and 170 g at ×10 is written
-- "1.7 kg", not "1700 g".
--
-- Parallel arrays, aligned with the version's `scale_labels`, for the same
-- reason that strip is arrays: a fixed-width ordered run read only with the
-- row and never queried across. SLOT 0 IS NEVER READ — the base column is
-- `qty`/`unit` and stays the one source of truth for costing, for the
-- percentage, and for every computed column. Storing it twice is how the two
-- start disagreeing.
--
-- ----------------------------------------------------------------------------
-- Depends on 036. Run in the Supabase SQL editor. NOT rerunnable — the bucket
-- insert is guarded, `alter table` and `create policy` are not.
--
-- The VALUES for `scale_auto` and the manual strip come from the raw export,
-- not from here: run `migration/backfill-recipe-scales.mjs` (dry run by
-- default, `--apply` to write) after this. `hide_on_print` is backfilled below,
-- because the transform already carried that flag into `source_payload`.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The ingredient line
-- ----------------------------------------------------------------------------

alter table production_recipe_lines
  -- TRUE = every column right of the base is computed from the version's
  -- multipliers (decision 3, the normal case). FALSE = the columns are typed
  -- and this row is left alone — a metadata row that does not scale, or a
  -- formulation variant that is not a multiple of anything.
  add column scale_auto boolean not null default true,

  -- The typed strip, read ONLY when `scale_auto` is false. Aligned with the
  -- version's `scale_labels`; slot 0 is the base column and is never read here.
  add column scale_amounts numeric(12,4)[],
  add column scale_units   text[],

  -- FMP's `shouldHide_bool` — a row kept in the recipe and left off the printed
  -- sheet. 304 lines carry it and none of them is a procedure step, which is
  -- why this is not on that table.
  add column hide_on_print boolean not null default false;

-- Same shape rule as the version's own strip: the two arrays step together, and
-- eight is FileMaker's repetition count.
alter table production_recipe_lines
  add constraint production_recipe_lines_scale_shape check (
    coalesce(array_length(scale_amounts, 1), 0)
      = coalesce(array_length(scale_units, 1), 0)
    and coalesce(array_length(scale_amounts, 1), 0) <= 8);

-- The hide flag was already in hand: `transform-production.mjs` wrote
-- `source_payload.hidden` at the 036 load and nothing has ever read it.
update production_recipe_lines
   set hide_on_print = true
 where (source_payload->>'hidden')::boolean is true;

-- ----------------------------------------------------------------------------
-- 2. The procedure step's picture
-- ----------------------------------------------------------------------------
-- FMP's step row ends in a container field. One picture per step, not a
-- gallery: the layout has one box and a step that needs two pictures is two
-- steps.
--
-- Columns rather than a child table, and columns rather than a row in
-- `purchase_order_attachments`: this is 1:1 with the step, replacing rather
-- than accumulating, and it should go when the step goes — which a column does
-- for free. 019's `extraction` rests on the same three sentences.

alter table production_recipe_steps
  add column image_path text,          -- {org_id}/{version_id}/{uuid}.{ext}
  add column image_name text,
  add column image_type text,
  add column image_size bigint;

-- ----------------------------------------------------------------------------
-- 3. The bucket
-- ----------------------------------------------------------------------------
-- PRIVATE, like every other bucket here; reads go through short-lived signed
-- URLs minted server-side.
--
-- Its own bucket rather than `po-attachments`, on 021's test: the audience is
-- different. 018's policies let any member of the org READ an invoice and
-- purchaser+ write one — which is the same shape production wants — but sharing
-- a bucket would mean a recipe photo and a signed invoice live under one set of
-- policies forever, and the next time either audience changes the other moves
-- with it.

insert into storage.buckets (id, name, public)
values ('recipe-images', 'recipe-images', false)
on conflict (id) do nothing;

-- `public.storage_folder_org()` comes from 018 — it returns null instead of
-- raising on a non-uuid first segment, and its grants (revoked from public and
-- anon, granted to authenticated) are already sorted there. Reuse, don't
-- redefine: a second `create or replace` here would silently become the
-- definition 018's and 021's policies depend on too.
--
-- Read is membership-only and write is purchaser+, which is exactly 036's
-- posture for the table this hangs off. A picture of how to knot a cruller is
-- for whoever is making crullers.
create policy recipe_images_object_read on storage.objects for select
  using (
    bucket_id = 'recipe-images'
    and public.storage_folder_org(name) in (select user_org_ids())
  );

create policy recipe_images_object_insert on storage.objects for insert
  with check (
    bucket_id = 'recipe-images'
    and user_has_role(
          public.storage_folder_org(name),
          array['owner', 'admin', 'purchaser']
        )
  );

create policy recipe_images_object_update on storage.objects for update
  using (
    bucket_id = 'recipe-images'
    and user_has_role(
          public.storage_folder_org(name),
          array['owner', 'admin', 'purchaser']
        )
  );

create policy recipe_images_object_delete on storage.objects for delete
  using (
    bucket_id = 'recipe-images'
    and user_has_role(
          public.storage_folder_org(name),
          array['owner', 'admin', 'purchaser']
        )
  );

-- ----------------------------------------------------------------------------
-- After this + the backfill, these should read:
-- ----------------------------------------------------------------------------
--   select count(*) from production_recipe_lines where hide_on_print;   → 202
--   select count(*) from production_recipe_lines where not scale_auto;  → 746
--   select count(*) from production_recipe_lines
--    where not scale_auto and scale_amounts is not null;                → 579
--
-- Those are smaller than the export's own 304 and 1,910 and that is right, not
-- a shortfall: the 036 load keeps 3,765 of the export's 5,260 ingredient rows.
-- The rest are FileMaker's separators and the three magic rows (mixer size,
-- expected yield, prep time) that became columns on the version.
--
-- The 167 typed rows with no strip are lines FileMaker marked "leave alone"
-- that only ever had a base amount. `scale_auto` is a statement about the row,
-- so it still goes false; there is simply nothing to remember.
--   select id from storage.buckets where id = 'recipe-images';          → 1 row, public = false
