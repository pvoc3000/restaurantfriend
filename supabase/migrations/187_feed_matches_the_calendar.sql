-- ============================================================================
-- 187 — THE PUBLISHED FEED SAYS WHAT THE CALENDAR PAGE SAYS
--
-- Mark, 2026-10-10: "make the iCal feed the same". Three things the page
-- changed after 185 was written, brought to `calendar_feed_by_token`:
--
--   * special orders are TWO layers, `orders_paid` (status 'order') and
--     `orders_unpaid` (every other live status). 185's single
--     `special_orders` key still means both;
--   * an order reads "<kitchen>: <title>" at its READY time, with the number,
--     the pickup/delivery and the event's own time in the description. The
--     customer's name is still there only on a link that carries names — and
--     an order with no title falls back to its NUMBER, not its customer, on a
--     link that does not;
--   * a delivery reads "Chefs Warehouse (DF01)".
--
-- The body is 185's with the lines marked "187" changed. Name and argument
-- are unchanged, so 185's grants stand. RERUNNABLE. Needs 185.
-- ============================================================================

create or replace function public.calendar_feed_by_token(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_link  calendar_feed_links%rowtype;
  v_tz    text;
  v_today date;
  v_from  date;
  v_to    date;
  v_items jsonb := '[]'::jsonb;
  v_part  jsonb;
  v_paid   boolean;   -- 187
  v_unpaid boolean;   -- 187
begin
  if p_token is null or length(p_token) < 22 then
    return null;
  end if;

  select * into v_link
    from calendar_feed_links l
   where l.token = p_token and l.revoked_at is null;
  if not found then
    return null;
  end if;

  select coalesce(nullif(o.settings ->> 'timezone', ''), 'UTC') into v_tz
    from orgs o where o.id = v_link.org_id;
  v_today := (now() at time zone v_tz)::date;
  v_from  := v_today - 60;
  v_to    := v_today + 365;

  if 'entries' = any(v_link.layers) then
    select coalesce(jsonb_agg(jsonb_build_object(
             'uid',      'entry-' || e.id,
             'layer',    'entries',
             'date',     e.starts_on,
             'end_date', e.ends_on,
             'time',     null,
             'title',    e.title,
             'detail',   nullif(concat_ws(E'\n',
                           nullif(concat_ws(' · ',
                             case when e.no_special_orders  then 'No special orders'  end,
                             case when e.no_standing_orders then 'No standing orders' end,
                             case when e.no_production      then 'No production'      end,
                             case when e.shop_closed        then 'Shop closed'        end), ''),
                           nullif(btrim(coalesce(e.note, '')), '')), ''),
             'path',     '/calendar?month=' || to_char(e.starts_on, 'YYYY-MM')
           ) order by e.starts_on, e.id), '[]'::jsonb)
      into v_part
      from calendar_entries e
     where e.org_id = v_link.org_id
       and e.ends_on >= v_from and e.starts_on <= v_to
       and (v_link.location_ids = '{}' or e.location_ids = '{}'
            or e.location_ids && v_link.location_ids);
    v_items := v_items || v_part;
  end if;

  -- 187: TWO LAYERS, as on the page — `orders_paid` is status 'order',
  -- `orders_unpaid` every other live status. `special_orders` (185's one key)
  -- still means both, so a link made before this keeps what it carried.
  v_paid   := 'orders_paid'   = any(v_link.layers) or 'special_orders' = any(v_link.layers);
  v_unpaid := 'orders_unpaid' = any(v_link.layers) or 'special_orders' = any(v_link.layers);
  if v_paid or v_unpaid then
    select coalesce(jsonb_agg(jsonb_build_object(
             'uid',      'order-' || s.id,
             'layer',    case when s.status = 'order' then 'orders_paid' else 'orders_unpaid' end,
             'date',     s.event_date,
             'end_date', s.event_date,
             -- 187: the READY time, as the page shows. Midnight is how an order
             -- with no real time was stored, so it is drawn all-day.
             'time',     case when s.ready_by_time is null or s.ready_by_time = time '00:00'
                              then null else to_char(s.ready_by_time, 'HH24:MI') end,
             -- 187: "<kitchen>: <title>" — the calendar app puts the time
             -- beside it. No title falls back to the customer ONLY on a link
             -- that carries names, and otherwise to the order's number.
             'title',    concat_ws(': ', k.code,
                           coalesce(
                             nullif(btrim(coalesce(s.title, '')), ''),
                             case when v_link.include_customer_names then
                               coalesce(
                                 nullif(btrim(coalesce(c.company, '')), ''),
                                 nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), ''))
                             end,
                             s.number)),
             'detail',   concat_ws(' · ',
                           s.number,
                           case when v_link.include_customer_names then
                             coalesce(
                               nullif(btrim(coalesce(c.company, '')), ''),
                               nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), ''))
                           end,
                           case when s.fulfillment = 'delivery' then 'Delivery' else 'Pickup' end,
                           case when s.event_time is not null and s.event_time <> time '00:00'
                                then 'event at ' || trim(to_char(s.event_time, 'FMHH12:MI AM')) end),
             'path',     '/special-orders/' || s.id
           ) order by s.event_date, s.id), '[]'::jsonb)
      into v_part
      from special_orders s
      left join customers c on c.id = s.customer_id
      left join locations k on k.id = s.kitchen_location_id
     where s.org_id = v_link.org_id
       and s.kind = 'order'
       and s.status <> 'cancelled'
       and ((s.status = 'order' and v_paid) or (s.status <> 'order' and v_unpaid))
       and s.event_date between v_from and v_to
       and (v_link.location_ids = '{}'
            or s.location_id = any(v_link.location_ids)
            or s.kitchen_location_id = any(v_link.location_ids));
    v_items := v_items || v_part;
  end if;

  if 'deliveries' = any(v_link.layers) then
    select coalesce(jsonb_agg(jsonb_build_object(
             'uid',      'po-' || p.id,
             'layer',    'deliveries',
             'date',     p.delivery_date,
             'end_date', p.delivery_date,
             'time',     null,
             -- 187: "Chefs Warehouse (DF01)", the vendor and the shop.
             'title',    coalesce(v.name, 'Vendor') || coalesce(' (' || dl.code || ')', ''),
             'detail',   nullif(concat_ws(' · ', 'PO ' || p.po_number, p.status), ''),
             'path',     '/purchase-orders/' || p.id
           ) order by p.delivery_date, p.id), '[]'::jsonb)
      into v_part
      from purchase_orders p
      left join vendors v on v.id = p.vendor_id
      left join locations dl on dl.id = p.location_id
     where p.org_id = v_link.org_id
       and p.status <> 'void'
       and p.delivery_date between v_from and v_to
       and (v_link.location_ids = '{}' or p.location_id = any(v_link.location_ids));
    v_items := v_items || v_part;
  end if;

  if 'tasks' = any(v_link.layers) then
    select coalesce(jsonb_agg(jsonb_build_object(
             'uid',      'task-' || t.id,
             'layer',    'tasks',
             'date',     t.due_on,
             'end_date', t.due_on,
             'time',     null,
             'title',    t.title,
             'detail',   case when t.kind = 'maintenance' then 'Maintenance due' else 'Task due' end,
             'path',     case when t.kind = 'maintenance' then '/maintenance-requests' else '/tasks' end
           ) order by t.due_on, t.id), '[]'::jsonb)
      into v_part
      from location_tasks t
     where t.org_id = v_link.org_id
       and t.status in ('open', 'in_progress')
       and t.due_on between v_from and v_to
       and (v_link.location_ids = '{}' or t.location_id = any(v_link.location_ids));
    v_items := v_items || v_part;
  end if;

  return jsonb_build_object('label', v_link.label, 'timezone', v_tz, 'items', v_items);
end;
$$;

revoke all on function public.calendar_feed_by_token(text) from public, anon, authenticated;
grant execute on function public.calendar_feed_by_token(text) to anon, authenticated;
