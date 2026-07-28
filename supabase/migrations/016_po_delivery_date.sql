-- ============================================================================
-- restaurantfriend — migration 016 · a generated PO knows when it arrives
--
-- Mark, 2026-07-28: "the delivery date should be the date of the next delivery
-- day set in the vendor record. For instance, if we generate a Unified PO on
-- Monday, 7/28, the next delivery day would be the following Friday, so the app
-- should set the delivery date 7/31."
--
-- Until now generation left delivery_date null and the human filled it in on
-- the Process card, where a suggestion chip offered exactly this date. That's
-- the wrong division of labour: the answer is already in the data
-- (vendor_locations.delivery_days), so the PO should be born knowing it — and
-- the vendor-facing PDF prints "Delivery: —" until someone remembers.
--
-- STRICTLY AFTER the order date, matching the suggestion chip this replaces
-- (lib/poProcessing.ts nextDeliveryDate, which starts counting at +1 day): a
-- vendor who delivers Tuesdays and gets a Tuesday order delivers NEXT Tuesday,
-- not the same afternoon. A vendor with no delivery days recorded (13 of DF01's
-- 56 vendor-locations) still gets null, and the Process card's date input is
-- still there for anything the calendar can't know — a holiday, a special run.
-- ============================================================================

-- The next delivery date on or after tomorrow. Null when the vendor has no
-- delivery days, which is why the caller can use it unconditionally.
--
-- The offset arithmetic: ((day - isodow + 6) % 7) + 1 lands in 1..7, so an
-- order placed ON a delivery day rolls to the following week. day - isodow is
-- never below -6 (ISO weekdays are 1..7), so the +6 keeps the modulo away from
-- Postgres's negative-remainder behaviour.
create or replace function next_delivery_date(p_from date, p_days smallint[])
returns date
language sql
immutable
set search_path = public
as $$
  select p_from + (
    select min(((d - extract(isodow from p_from)::int + 6) % 7) + 1)
      from unnest(coalesce(p_days, '{}'::smallint[])) as d
  )
$$;

revoke all on function next_delivery_date(date, smallint[]) from public;
revoke all on function next_delivery_date(date, smallint[]) from anon;
grant execute on function next_delivery_date(date, smallint[]) to authenticated;

-- Existing DRAFTS get one too, same rule against their own order_date — they're
-- about to be sent and would otherwise print "Delivery: —". History is left
-- alone: a sent PO's delivery date is a fact about what happened, not something
-- to recompute (same reasoning as 015's backfill).
update purchase_orders po
   set delivery_date = next_delivery_date(po.order_date, vl.delivery_days)
  from vendor_locations vl
 where vl.vendor_id   = po.vendor_id
   and vl.location_id = po.location_id
   and po.status      = 'draft'
   and po.delivery_date is null
   and next_delivery_date(po.order_date, vl.delivery_days) is not null;

-- ---------------------------------------------------------------------------
-- Regenerate the generation function. Identical to 015's copy except that the
-- purchase_orders insert now carries delivery_date — see 013 for the reasoning
-- about transactions, sequence numbers, the pack label and SECURITY INVOKER,
-- and 015 for the line-notes snapshot.
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
  v_delivery  date;
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

    -- Null when this vendor-location has no delivery days, or no row at all.
    select next_delivery_date(p_guide_date, vl.delivery_days)
      into v_delivery
      from vendor_locations vl
     where vl.vendor_id   = v_vendor_id
       and vl.location_id = p_location_id;

    v_po_number := next_po_number(v_vendor_id, p_location_id);

    insert into purchase_orders
      (org_id, po_number, vendor_id, location_id, status, order_date,
       delivery_date, created_by)
    values
      (v_org_id, v_po_number, v_vendor_id, p_location_id, 'draft', p_guide_date,
       v_delivery, auth.uid())
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
