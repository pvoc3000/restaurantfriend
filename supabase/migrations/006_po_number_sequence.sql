-- ============================================================================
-- restaurantfriend — migration 006 · purchase order numbering
--
-- PO numbers follow FileMaker's format (spec §4.8):
--     {vendorLegacyId}-{globalSeq}-{locNum}     e.g. 112-18008-01
-- a GLOBAL sequence with vendor and location context — not per-vendor counters.
-- The format itself stays configurable in orgs.settings.po_number_format
-- (design rule 2, zero business hardcoding); this migration only supplies the
-- sequence the {seq} placeholder consumes.
--
-- Decided with Mark 2026-07-22: use a real Postgres sequence rather than
-- max(po_number)+1 at insert time. max()+1 needs no migration but two
-- concurrent generations read the same max and collide — and the unique index
-- on (org_id, po_number) would fail the second one MID-BATCH, halfway through
-- generating a Monday's POs. A sequence hands out distinct values under
-- concurrency by design.
--
-- Seeded past the highest number the FileMaker history carries, so new POs
-- continue the existing run instead of colliding with 13 years of archive.
-- ============================================================================

-- The seed is computed from live data, not hardcoded: the middle segment of
-- every existing po_number, maximum, plus one.
do $$
declare
  next_seq bigint;
begin
  select coalesce(max((regexp_match(po_number, '^[^-]+-(\d+)-'))[1]::bigint), 0) + 1
    into next_seq
    from purchase_orders
   where po_number ~ '^[^-]+-\d+-';

  execute format('create sequence if not exists po_number_seq start with %s', next_seq);
end $$;

/**
 * Next PO number for a vendor at a location.
 *
 * security definer so it can advance the sequence, which RLS doesn't cover —
 * and because of that it re-checks what RLS would have (CLAUDE.md: such a
 * function must re-check membership itself). Callers must be purchaser+ in the
 * org that owns the vendor and location, matching the vendors/purchase_orders
 * write policies.
 */
create or replace function next_po_number(p_vendor_id uuid, p_location_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id     uuid;
  v_vendor_leg integer;
  v_loc_leg    text;
  v_seq        bigint;
begin
  select org_id, legacy_id into v_org_id, v_vendor_leg
    from vendors where id = p_vendor_id;

  if v_org_id is null then
    raise exception 'unknown vendor %', p_vendor_id;
  end if;

  if not user_has_role(v_org_id, array['owner','admin','purchaser']) then
    raise exception 'insufficient role to number a purchase order';
  end if;

  -- The location must belong to the same org, or a caller could mint numbers
  -- against another tenant's location.
  if not exists (
    select 1 from locations
     where id = p_location_id and org_id = v_org_id
  ) then
    raise exception 'location % is not in this org', p_location_id;
  end if;

  select code into v_loc_leg from locations where id = p_location_id;
  v_seq := nextval('po_number_seq');

  -- Location segment is the trailing digits of the code (DF01 → 01); falls back
  -- to 00 for codes without digits (EVENT).
  return format(
    '%s-%s-%s',
    coalesce(v_vendor_leg::text, 'X'),
    v_seq,
    coalesce(nullif(regexp_replace(v_loc_leg, '\D', '', 'g'), ''), '00')
  );
end $$;

-- Every public-schema function is executable by anon via Supabase's default
-- privileges, and revoking from PUBLIC does NOT undo that (CLAUDE.md).
revoke all on function next_po_number(uuid, uuid) from public;
revoke all on function next_po_number(uuid, uuid) from anon;
grant execute on function next_po_number(uuid, uuid) to authenticated;
