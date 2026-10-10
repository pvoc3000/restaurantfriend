-- ============================================================================
-- 186 — OUTSIDE CALENDARS, SUBSCRIBED TO
--
-- Mark, 2026-10-09: "we could subscribe to and display google or ical
-- calendars". This is IN: a Google or iCloud calendar's iCal address, fetched
-- by the `calendar-sync` edge function and drawn on /calendar as a layer.
--
-- THREE TABLES, because three different people may see three different things.
--
--   calendar_subscriptions         what is subscribed to, when it was last
--                                  read and whether that worked. Every member
--                                  reads it; a manager or an owner writes it.
--
--   calendar_subscription_urls     THE ADDRESS. A private Google calendar's
--                                  iCal address is a secret — whoever has it
--                                  reads the calendar — so it is kept where no
--                                  member can read it back: RLS on, NO
--                                  policies, 081's `accounting_connections`
--                                  shape. Written by `set_calendar_
--                                  subscription_url`; read only by the edge
--                                  function, with the service role.
--
--   calendar_subscription_events   what the last read found, one row per
--                                  occurrence, already on the org's wall
--                                  clock. Every member reads it. Only the
--                                  service role writes it.
--
-- WHY A COPY IS KEPT rather than fetching on every page load: a browser cannot
-- fetch another site's calendar at all, repeating events have to be written
-- out to be drawn, and an outside calendar that is down should leave the last
-- good copy on screen. There is no cron in this app, so the copy is refreshed
-- the way standing orders are topped up — when somebody opens the calendar and
-- it is more than an hour old.
--
-- Only the title, the dates, the time and the place are kept. Descriptions and
-- attendees never leave the file.
--
-- A SUBSCRIBED EVENT IS DISPLAY ONLY. Nothing here is read by `blackout_name`:
-- an outside calendar saying "Closed" closes nothing.
--
-- RERUNNABLE. Needs 181.
-- ============================================================================

create table if not exists calendar_subscriptions (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references orgs(id) on delete cascade,
  name            text not null check (btrim(name) <> ''),
  location_ids    uuid[] not null default '{}',
  is_active       boolean not null default true,
  -- True once an address has been set. The address itself is not here.
  has_url         boolean not null default false,
  last_fetched_at timestamptz,
  last_error      text,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table calendar_subscriptions is
  'An outside iCal calendar drawn on /calendar (186). Its address is in '
  'calendar_subscription_urls, which no member can read.';
comment on column calendar_subscriptions.location_ids is
  'The shops this calendar is about, for the shop filter. EMPTY MEANS EVERY SHOP.';

drop trigger if exists trg_calendar_subscriptions_updated on calendar_subscriptions;
create trigger trg_calendar_subscriptions_updated before update on calendar_subscriptions
  for each row execute function set_updated_at();

alter table calendar_subscriptions enable row level security;

drop policy if exists calendar_subscriptions_select on calendar_subscriptions;
create policy calendar_subscriptions_select on calendar_subscriptions for select
  using (org_id in (select user_org_ids()));

drop policy if exists calendar_subscriptions_insert on calendar_subscriptions;
create policy calendar_subscriptions_insert on calendar_subscriptions for insert
  with check (user_has_role(org_id, array['owner', 'admin']));

drop policy if exists calendar_subscriptions_update on calendar_subscriptions;
create policy calendar_subscriptions_update on calendar_subscriptions for update
  using      (user_has_role(org_id, array['owner', 'admin']))
  with check (user_has_role(org_id, array['owner', 'admin']));

drop policy if exists calendar_subscriptions_delete on calendar_subscriptions;
create policy calendar_subscriptions_delete on calendar_subscriptions for delete
  using (user_has_role(org_id, array['owner', 'admin']));

revoke all on table calendar_subscriptions from anon;

-- ----------------------------------------------------------------------------
-- The address — readable by nobody
-- ----------------------------------------------------------------------------
create table if not exists calendar_subscription_urls (
  subscription_id uuid primary key references calendar_subscriptions(id) on delete cascade,
  org_id          uuid not null references orgs(id) on delete cascade,
  url             text not null,
  updated_at      timestamptz not null default now()
);

comment on table calendar_subscription_urls is
  'The iCal address of a subscription (186). A SECRET: RLS is on with no '
  'policies, so only the service role (the calendar-sync function) reads it.';

alter table calendar_subscription_urls enable row level security;
revoke all on table calendar_subscription_urls from anon, authenticated;

-- ----------------------------------------------------------------------------
-- What the last read found
-- ----------------------------------------------------------------------------
create table if not exists calendar_subscription_events (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references orgs(id) on delete cascade,
  subscription_id uuid not null references calendar_subscriptions(id) on delete cascade,
  uid             text not null,
  starts_on       date not null,
  ends_on         date not null,
  start_time      time,
  title           text not null,
  place           text,
  constraint calendar_subscription_events_range check (ends_on >= starts_on)
);

comment on table calendar_subscription_events is
  'One row per occurrence read from a subscribed calendar (186), on the org''s '
  'wall clock. Replaced whole on every read. Display only.';

create index if not exists calendar_subscription_events_range_idx
  on calendar_subscription_events (org_id, starts_on, ends_on);
create index if not exists calendar_subscription_events_subscription_idx
  on calendar_subscription_events (subscription_id);

alter table calendar_subscription_events enable row level security;

drop policy if exists calendar_subscription_events_select on calendar_subscription_events;
create policy calendar_subscription_events_select on calendar_subscription_events for select
  using (org_id in (select user_org_ids()));

-- No write policy: the service role is the only writer.
revoke all on table calendar_subscription_events from anon;
revoke insert, update, delete on table calendar_subscription_events from authenticated;

-- ----------------------------------------------------------------------------
-- Setting the address
-- ----------------------------------------------------------------------------
-- A manager or an owner hands the address in; nobody gets it back. `webcal://`
-- is what calendar apps copy and means https, so it is stored as https. The
-- edge function checks the address again before it fetches (`safeFeedUrl`) —
-- this check is the courtesy of an early, readable refusal.
--
-- Setting an address clears the last error and the last-read time, so the
-- calendar page reads it on its next load, and removes the old copy: a new
-- address is a different calendar.
create or replace function public.set_calendar_subscription_url(
  p_subscription_id uuid,
  p_url             text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_url text := regexp_replace(btrim(coalesce(p_url, '')), '^webcals?://', 'https://', 'i');
begin
  select s.org_id into v_org from calendar_subscriptions s where s.id = p_subscription_id;
  -- One sentence for "no such subscription" and "not yours" (068's rule).
  if v_org is null or not user_has_role(v_org, array['owner', 'admin']) then
    raise exception 'no such calendar subscription';
  end if;

  if v_url !~* '^https://[^/\s]+\.[^/\s]+' then
    raise exception 'That is not a calendar address. It should start with https:// or webcal://';
  end if;
  if length(v_url) > 2000 then
    raise exception 'That address is too long to be a calendar address.';
  end if;

  insert into calendar_subscription_urls (subscription_id, org_id, url)
  values (p_subscription_id, v_org, v_url)
  on conflict (subscription_id) do update set url = excluded.url, updated_at = now();

  delete from calendar_subscription_events where subscription_id = p_subscription_id;

  update calendar_subscriptions
     set has_url = true, last_error = null, last_fetched_at = null
   where id = p_subscription_id;
end;
$$;

revoke all on function public.set_calendar_subscription_url(uuid, text) from public, anon, authenticated;
grant execute on function public.set_calendar_subscription_url(uuid, text) to authenticated;
