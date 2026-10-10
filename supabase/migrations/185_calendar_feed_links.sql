-- ============================================================================
-- 185 — THE CALENDAR, PUBLISHED AS A FEED
--
-- Mark, 2026-10-09: "subscribe to and display google or ical calendars" — both
-- directions. This is OUT: the app's own calendar as an iCal feed, so blackout
-- dates and special orders show in the calendar on a phone.
--
-- A FEED LINK IS A CAPABILITY, like the quote link (052) and the pay link
-- (119): whoever holds the URL reads the feed, signed out, because a calendar
-- app cannot sign in. So:
--
--   * only a manager or an owner can make, see or revoke one — even READING
--     this table shows the tokens, so every policy names owner/admin;
--   * the link says which LAYERS it carries and for which SHOPS, and the
--     function hands out nothing else;
--   * it can carry calendar entries, special orders, deliveries and tasks.
--     NEVER pay periods or anything from HR, whatever `layers` says — the
--     function has no branch for them;
--   * a special order is named by its number and title. The CUSTOMER'S NAME is
--     in the feed only when `include_customer_names` is on for that link,
--     because a URL that has been pasted into a calendar app is a URL that has
--     left the building;
--   * revoking is `revoked_at`, never a delete, so a dead link stays explained.
--
-- The window is 60 days back to a year ahead of the org's today.
--
-- The page that serves it is web/src/app/calendar-feed/[token]/route.ts, which
-- turns this function's jsonb into text/calendar (`lib/ics`).
--
-- RERUNNABLE. Needs 181.
-- ============================================================================

create table if not exists calendar_feed_links (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null references orgs(id) on delete cascade,
  token                  text not null unique check (length(token) >= 22),
  label                  text not null check (btrim(label) <> ''),
  layers                 text[] not null default '{entries}',
  location_ids           uuid[] not null default '{}',
  include_customer_names boolean not null default false,
  created_by             uuid references auth.users(id) on delete set null,
  created_at             timestamptz not null default now(),
  revoked_at             timestamptz
);

comment on table calendar_feed_links is
  'A published iCal feed of /calendar (185). The token IS the capability: '
  'whoever holds the URL reads the feed. Revoked by revoked_at, never deleted.';
comment on column calendar_feed_links.layers is
  'Which layers the feed carries: entries, special_orders, deliveries, tasks. '
  'Anything else is ignored by calendar_feed_by_token.';
comment on column calendar_feed_links.location_ids is
  'The shops the feed is for. EMPTY MEANS EVERY SHOP.';

alter table calendar_feed_links enable row level security;

drop policy if exists calendar_feed_links_select on calendar_feed_links;
create policy calendar_feed_links_select on calendar_feed_links for select
  using (user_has_role(org_id, array['owner', 'admin']));

drop policy if exists calendar_feed_links_insert on calendar_feed_links;
create policy calendar_feed_links_insert on calendar_feed_links for insert
  with check (user_has_role(org_id, array['owner', 'admin']));

drop policy if exists calendar_feed_links_update on calendar_feed_links;
create policy calendar_feed_links_update on calendar_feed_links for update
  using      (user_has_role(org_id, array['owner', 'admin']))
  with check (user_has_role(org_id, array['owner', 'admin']));

-- No delete policy: a link is revoked, not removed.

revoke all on table calendar_feed_links from anon;

-- ----------------------------------------------------------------------------
-- The feed, by token
-- ----------------------------------------------------------------------------
-- Returns NULL for a token that is missing, too short, unknown or revoked —
-- one answer for all four, so the page can say 404 without saying which.
--
--   { "label", "timezone",
--     "items": [{ "uid", "layer", "date", "end_date", "time",
--                 "title", "detail", "path" }] }
--
-- `end_date` is INCLUSIVE and only an entry has one that differs from `date`.
-- `time` is a wall-clock `HH:MM` in the org's timezone, or null for all-day.
-- `path` is the record's route in the app, or null.
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

  if 'special_orders' = any(v_link.layers) then
    select coalesce(jsonb_agg(jsonb_build_object(
             'uid',      'order-' || s.id,
             'layer',    'special_orders',
             'date',     s.event_date,
             'end_date', s.event_date,
             -- Midnight is how an order with no real time was stored (the
             -- FileMaker history is full of them), so it is drawn all-day
             -- rather than as a 12 AM appointment.
             'time',     case when s.event_time is null or s.event_time = time '00:00'
                              then null else to_char(s.event_time, 'HH24:MI') end,
             'title',    concat_ws(' ', s.number,
                           case
                             when v_link.include_customer_names then
                               coalesce(
                                 nullif(btrim(coalesce(c.company, '')), ''),
                                 nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), ''),
                                 nullif(btrim(coalesce(s.title, '')), ''))
                             else nullif(btrim(coalesce(s.title, '')), '')
                           end),
             'detail',   case when s.fulfillment = 'delivery' then 'Delivery' else 'Pickup' end,
             'path',     '/special-orders/' || s.id
           ) order by s.event_date, s.id), '[]'::jsonb)
      into v_part
      from special_orders s
      left join customers c on c.id = s.customer_id
     where s.org_id = v_link.org_id
       and s.kind = 'order'
       and s.status <> 'cancelled'
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
             'title',    coalesce(v.name, 'Vendor') || ' delivery',
             'detail',   nullif(concat_ws(' · ', 'PO ' || p.po_number, p.status), ''),
             'path',     '/purchase-orders/' || p.id
           ) order by p.delivery_date, p.id), '[]'::jsonb)
      into v_part
      from purchase_orders p
      left join vendors v on v.id = p.vendor_id
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
