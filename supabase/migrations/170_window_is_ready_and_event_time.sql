-- ============================================================================
-- 170 — THE DELIVERY WINDOW IS THE READY TIME AND THE EVENT TIME
--
-- Mark, 2026-10-02: "we have duplicated fields. These are the same fields. We
-- only need one of each: window opens = ready time; window closes = event
-- time. Keep Event Time and Ready Time, and use in place of Window Opens and
-- Window Closes." And: "For delivery orders, if ready time is blank and an
-- event time is entered, set the ready time to 2 hours before the event time.
-- For pickup orders, set it to the event time."
--
-- 1. MERGE. Measured first: 8,088 orders carry a window start and 8,197 an
--    end, and they agree with ready/event on all but ONE each (SO-10098, a
--    pickup at 8:00 with a 7:30–9:30 window — the kept fields win). Where the
--    kept field is blank the window's value fills it: 1 ready time (SO-8291),
--    2 event times (SO-7110, SO-9357). Every window value was saved first to
--    `FMP Export/pre170-delivery-windows-2026-10-02.json` (8,245 rows).
--
-- 2. DROP the two columns. No live function or view names them (checked
--    2026-10-02 through `pg_get_functiondef` and `pg_views`), and the change
--    log compares whole rows rather than naming columns.
--
-- 3. THE READY TIME FOLLOWS AN EVENT TIME ENTERED WITH NONE (a BEFORE
--    trigger, so the order record, New Order, `create_inquiry` and the
--    standing-order days all do it): a delivery is ready two hours before, a
--    pickup at the event time. Only when the event time is SET — on insert,
--    or when it changes — and only into a BLANK ready time, so a ready time
--    somebody typed is never moved, and one somebody clears stays clear until
--    the event time changes again. A delivery before 2 AM would wrap to the
--    previous evening, so it is held at midnight instead.
--
-- RERUNNABLE: the merge and the drop are guarded by the columns existing.
-- ============================================================================

do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'special_orders'
                and column_name = 'delivery_window_start') then
    update special_orders
       set ready_by_time = coalesce(ready_by_time, delivery_window_start),
           event_time    = coalesce(event_time, delivery_window_end)
     where (ready_by_time is null and delivery_window_start is not null)
        or (event_time is null and delivery_window_end is not null);

    alter table special_orders drop column delivery_window_start;
    alter table special_orders drop column delivery_window_end;
  end if;
end $$;

create or replace function public.trg_special_order_ready_from_event()
returns trigger
language plpgsql
as $$
begin
  if new.ready_by_time is null and new.event_time is not null then
    new.ready_by_time := case
      when new.fulfillment is distinct from 'delivery' then new.event_time
      when new.event_time >= time '02:00' then new.event_time - interval '2 hours'
      else time '00:00'
    end;
  end if;
  return new;
end;
$$;

revoke all on function public.trg_special_order_ready_from_event() from public;
revoke all on function public.trg_special_order_ready_from_event() from anon;

drop trigger if exists trg_special_orders_ready_from_event_insert on special_orders;
create trigger trg_special_orders_ready_from_event_insert
  before insert on special_orders
  for each row
  execute function public.trg_special_order_ready_from_event();

drop trigger if exists trg_special_orders_ready_from_event_update on special_orders;
create trigger trg_special_orders_ready_from_event_update
  before update of event_time on special_orders
  for each row
  when (old.event_time is distinct from new.event_time)
  execute function public.trg_special_order_ready_from_event();
