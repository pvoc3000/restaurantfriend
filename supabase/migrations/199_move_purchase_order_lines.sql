-- ============================================================================
-- 199 — MOVE LINES FROM ONE DRAFT PURCHASE ORDER TO ANOTHER
--
-- Mark, 2026-10-12: splitting an order that will arrive on two days meant
-- either duplicating it and deleting from both copies (risking an item left on
-- both, ordered twice) or making a second order and re-adding lines by hand
-- (risking an item left off both). A MOVE is neither: the line's `po_id`
-- changes, so it is on exactly one order before and after, and it keeps its
-- id — its price, note, snapshot fields and any purchase request resolved to
-- it go with it.
--
--   move_purchase_order_lines(p_lines, p_target, p_delivery_date)
--
-- `p_target` null means "a new purchase order": same vendor, shop and order
-- date as the source, numbered by next_po_number (006), delivery on
-- `p_delivery_date`. Returns the order the lines landed on.
--
-- ONE FUNCTION, so the new order and the move commit together or not at all,
-- and so the checks run beside the write rather than in the browser:
--   · every line is on ONE order, and that order is a DRAFT;
--   · the target is a different DRAFT of the same vendor at the same shop,
--     both rows locked so neither can be sent mid-move;
--   · no line has a received quantity;
--   · no line is on a bill.
--
-- THAT LAST CHECK REPLACES AN INVARIANT 025 RELIED ON. vendor_bill_lines
-- carries BOTH purchase_order_id and purchase_order_item_id, and 025's comment
-- says the pair cannot drift because "a PO item cannot move between orders".
-- From here it can — but never a billed one, so the pair still cannot drift.
-- Anything else that ever copies a line's order beside the line's id needs
-- the same refusal here.
--
-- SECURITY INVOKER, like 013: every write goes through the tables' own
-- purchaser+ policies, so this can do nothing its caller could not do with
-- two plain statements. The role check up front only turns a bare RLS
-- violation into a readable error.
--
-- DRAFTS ONLY, for now (Mark, same day): a split after sending changes what
-- the vendor was told, and is a different feature if it ever comes up.
--
-- Emptying the source is allowed and leaves it in place — you may be about to
-- move other lines into it; deleting it is the screen's Delete PO….
--
-- RERUNNABLE.
-- ============================================================================

begin;

create or replace function move_purchase_order_lines(
  p_lines         uuid[],
  p_target        uuid,
  p_delivery_date date default null
) returns table (id uuid, po_number text)
language plpgsql
set search_path = public
as $$
declare
  v_wanted  integer;
  v_found   integer;
  v_orders  integer;
  v_source  purchase_orders%rowtype;
  v_target  purchase_orders%rowtype;
  v_moved   integer;
begin
  -- Distinct, so a line named twice is not counted as two.
  select count(distinct l) into v_wanted from unnest(p_lines) as l;
  if coalesce(v_wanted, 0) = 0 then
    raise exception 'No lines were chosen to move.';
  end if;

  select count(*), count(distinct poi.po_id)
    into v_found, v_orders
    from purchase_order_items poi
   where poi.id = any(p_lines);
  if v_found <> v_wanted then
    raise exception 'Some of those lines no longer exist. Reload the order and try again.';
  end if;
  if v_orders <> 1 then
    raise exception 'Lines can only be moved from one purchase order at a time.';
  end if;

  -- Locked: a send that lands between this check and the update would
  -- otherwise move lines off an order the vendor already has.
  select po.* into v_source
    from purchase_orders po
   where po.id = (select poi.po_id from purchase_order_items poi
                   where poi.id = any(p_lines) limit 1)
     for update;

  if not user_has_role(v_source.org_id, array['owner','admin','purchaser']) then
    raise exception 'insufficient role to move purchase order lines';
  end if;
  if v_source.status <> 'draft' then
    raise exception 'Lines can only be moved off a draft order, and % is %.',
      v_source.po_number, v_source.status;
  end if;

  if exists (
    select 1 from purchase_order_items poi
     where poi.id = any(p_lines) and poi.qty_received is not null
  ) then
    raise exception 'A line with a received quantity cannot be moved.';
  end if;
  -- See the header: this is what keeps vendor_bill_lines' two order columns
  -- telling one story.
  if exists (
    select 1 from vendor_bill_lines bl
     where bl.purchase_order_item_id = any(p_lines)
  ) then
    raise exception 'A line that is on a bill cannot be moved.';
  end if;

  if p_target is null then
    insert into purchase_orders (
      org_id, location_id, vendor_id, po_number, status,
      order_date, delivery_date, created_by
    ) values (
      v_source.org_id, v_source.location_id, v_source.vendor_id,
      next_po_number(v_source.vendor_id, v_source.location_id), 'draft',
      v_source.order_date, p_delivery_date, auth.uid()
    )
    returning * into v_target;
  else
    if p_target = v_source.id then
      raise exception 'Those lines are already on %.', v_source.po_number;
    end if;
    select po.* into v_target
      from purchase_orders po
     where po.id = p_target
       for update;
    if v_target.id is null then
      raise exception 'That purchase order no longer exists.';
    end if;
    if v_target.status <> 'draft' then
      raise exception 'Lines can only be moved to a draft order, and % is %.',
        v_target.po_number, v_target.status;
    end if;
    if v_target.org_id      <> v_source.org_id
       or v_target.vendor_id   <> v_source.vendor_id
       or v_target.location_id <> v_source.location_id then
      raise exception '% is not an order for the same vendor at the same shop.',
        v_target.po_number;
    end if;
  end if;

  update purchase_order_items poi
     set po_id = v_target.id
   where poi.id = any(p_lines);
  get diagnostics v_moved = row_count;
  -- An update no policy allows changes zero rows and raises nothing.
  if v_moved <> v_wanted then
    raise exception 'Only % of % lines could be moved; nothing was changed.',
      v_moved, v_wanted;
  end if;

  return query select v_target.id, v_target.po_number;
end $$;

-- Supabase's default privileges make a new function executable by anon, and
-- revoking from PUBLIC does not undo that: by name.
revoke all on function move_purchase_order_lines(uuid[], uuid, date) from public, anon;
grant execute on function move_purchase_order_lines(uuid[], uuid, date) to authenticated;

commit;
