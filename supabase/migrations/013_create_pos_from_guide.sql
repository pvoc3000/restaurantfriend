-- ============================================================================
-- restaurantfriend — migration 013 · PO generation from the order guide
--
-- Spec §2 step 3: "Generate POs — one per vendor from will-order lines."
-- The whole batch is ONE function call and therefore ONE transaction: migration
-- 006 chose a sequence precisely because a mid-batch collision used to strand a
-- Monday's generation halfway; this closes the other half of that problem — if
-- any PO in the batch fails, none of them exist.
--
-- What a "will-order line" is: an order_guide_entries row for (location,
-- guide_date) with qty_to_order > 0. Zeroed (0) and untouched (null) entries
-- are decisions and non-decisions respectively — neither is an order (the
-- three-state rule). WHICH vendors get a PO is the caller's choice: the guide
-- UI preselects vendors at/above minimum and leaves under-minimum ones
-- unchecked (§4.2 — an under-minimum vendor simply gets no PO), but the human
-- can override either way. The function creates what it's told to and skips
-- vendors with no will-order lines rather than minting empty POs.
--
-- Lines SNAPSHOT the catalog (schema 001's po_items design): description,
-- brand, product_id, pack, and the effective price (location override →
-- vendor_items.price, same resolution as v_order_guide). package_desc gets the
-- composed pack label the guide displayed ("12 × 32 oz", migration 010) so the
-- printed PO reads the way the case is labelled, falling back to the vendor's
-- own pack text for rows without structure.
--
-- SECURITY INVOKER, deliberately: every insert flows through the existing RLS
-- policies (purchaser+ on purchase_orders / purchase_order_items), so this
-- function can't write anything its caller couldn't write directly. The
-- explicit role check up front just turns a bare RLS violation into a readable
-- error. next_po_number (006, security definer) does its own re-checking.
-- ============================================================================

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
       package_desc, qty_ordered, unit_price)
    select
      v_org_id, v_po_id, vi.id, vi.description, vi.brand, vi.product_id,
      case
        -- trim_scale: the columns are scaled numerics, and "12.000 × 32.000 oz"
        -- is not how anyone labels a case
        when vi.pack_size is not null then
          trim_scale(coalesce(vi.pack_count, 1))::text
            || ' × ' || trim_scale(vi.pack_size)::text
            || ' '   || coalesce(vi.pack_unit, ii.base_unit)
        else vi.package_desc
      end,
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
