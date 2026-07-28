-- ============================================================================
-- restaurantfriend — migration 015 · the PO line carries its OWN note
--
-- Spec §4.9 prints an ordering note on each line of the vendor-facing PO
-- ("only order when 1/4 full", "$8.25 ea in lots of 48"). Until now that note
-- was read LIVE from vendor_items.notes at render time — the one field on a PO
-- line that wasn't a snapshot. Everything else (description, brand, product_id,
-- package_desc, unit_price) is frozen at generation precisely so a reprint
-- reproduces the document that was sent; the note floated, so editing the
-- catalog silently rewrote orders sent months ago, and deleting a vendor item
-- erased the note from its own history.
--
-- Mark, 2026-07-28: "let's snapshot it. Call the new field notes… There should
-- be one per line in the purchase order and it should be editable. For example,
-- in this particular instance I will want to delete the note before sending."
-- That last sentence is the point of the whole change: a note you can strike
-- off THIS order without touching the catalog entry every future order inherits.
--
-- Naming: `notes`, matching vendor_items.notes and inventory_items.note — the
-- column is the same idea at a different grain. It is NOT discrepancy_note,
-- which is receiving's ("short 2 cases") and stays exactly as it is.
-- ============================================================================

alter table purchase_order_items add column if not exists notes text;

comment on column purchase_order_items.notes is
  'Ordering note printed on the vendor-facing PO line (spec §4.9). Snapshot of '
  'vendor_items.notes at generation; editable per line thereafter.';

-- Backfill DRAFTS only. Every existing PO currently prints the live catalog
-- note, so leaving drafts null would silently drop notes from orders that are
-- about to be sent. History is deliberately left alone (Mark, 2026-07-28:
-- "ignore historical purchase orders… just change the behavior going forward")
-- — a sent PO's document is whatever was sent, and backfilling it with today's
-- catalog text would be inventing a record, not preserving one.
update purchase_order_items poi
   set notes = vi.notes
  from vendor_items vi, purchase_orders po
 where vi.id  = poi.vendor_item_id
   and po.id  = poi.po_id
   and po.status = 'draft'
   and poi.notes is null
   and vi.notes is not null;

-- ---------------------------------------------------------------------------
-- Regenerate migration 013's function so newly generated lines carry the
-- snapshot. Identical to 013 except for the two `notes` additions — see 013 for
-- the reasoning about transactions, sequence numbers, the pack label and
-- SECURITY INVOKER, all of which are unchanged.
-- ---------------------------------------------------------------------------

create or replace function create_purchase_orders_from_guide(
  p_location_id uuid,
  p_guide_date  date,
  p_vendor_ids  uuid[]
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_org_id    uuid;
  v_vendor_id uuid;
  v_po_id     uuid;
  v_po_number text;
  v_created   jsonb := '[]'::jsonb;
  v_lines     integer;
  v_total     numeric;
  v_name      text;
begin
  select org_id into v_org_id from locations where id = p_location_id;
  if v_org_id is null then
    raise exception 'unknown location %', p_location_id;
  end if;

  if not user_has_role(v_org_id, array['owner','admin','purchaser']) then
    raise exception 'insufficient role to generate purchase orders';
  end if;

  foreach v_vendor_id in array p_vendor_ids loop
    -- No will-order lines → no PO, and no sequence number burned.
    if not exists (
      select 1
        from order_guide_entries e
        join vendor_items vi on vi.id = e.vendor_item_id
       where e.location_id = p_location_id
         and e.guide_date  = p_guide_date
         and e.qty_to_order > 0
         and vi.vendor_id  = v_vendor_id
    ) then
      continue;
    end if;

    v_po_number := next_po_number(v_vendor_id, p_location_id);

    insert into purchase_orders
      (org_id, po_number, vendor_id, location_id, status, order_date, created_by)
    values
      (v_org_id, v_po_number, v_vendor_id, p_location_id, 'draft', p_guide_date, auth.uid())
    returning id into v_po_id;

    insert into purchase_order_items
      (org_id, po_id, vendor_item_id, description, brand, product_id,
       package_desc, notes, qty_ordered, unit_price)
    select
      v_org_id, v_po_id, vi.id, vi.description, vi.brand, vi.product_id,
      case
        when vi.pack_size is not null then
          trim_scale(coalesce(vi.pack_count, 1))::text
            || ' × ' || trim_scale(vi.pack_size)::text
            || ' '   || coalesce(vi.pack_unit, ii.base_unit)
        else vi.package_desc
      end,
      vi.notes,
      e.qty_to_order,
      coalesce(vilp.price, vi.price)
    from order_guide_entries e
    join vendor_items vi    on vi.id = e.vendor_item_id
    join inventory_items ii on ii.id = vi.inventory_item_id
    left join vendor_item_location_prices vilp
           on vilp.vendor_item_id = vi.id
          and vilp.location_id    = p_location_id
    where e.location_id = p_location_id
      and e.guide_date  = p_guide_date
      and e.qty_to_order > 0
      and vi.vendor_id  = v_vendor_id;

    select count(*), coalesce(sum(qty_ordered * coalesce(unit_price, 0)), 0)
      into v_lines, v_total
      from purchase_order_items
     where po_id = v_po_id;

    select name into v_name from vendors where id = v_vendor_id;

    v_created := v_created || jsonb_build_object(
      'id',         v_po_id,
      'po_number',  v_po_number,
      'vendor_id',  v_vendor_id,
      'vendor_name', v_name,
      'line_count', v_lines,
      'total',      v_total
    );
  end loop;

  return v_created;
end $$;

-- Every public-schema function is executable by anon via Supabase's default
-- privileges, and revoking from PUBLIC does NOT undo that (CLAUDE.md).
revoke all on function create_purchase_orders_from_guide(uuid, date, uuid[]) from public;
revoke all on function create_purchase_orders_from_guide(uuid, date, uuid[]) from anon;
grant execute on function create_purchase_orders_from_guide(uuid, date, uuid[]) to authenticated;
