-- ============================================================================
-- restaurantfriend — migration 097 · PINs for a shared iPad
--
-- Why (Mark, 2026-09-08): "users will be sharing a device, an iPad, to access
-- the app and I can envision that unless we're proactive about it people
-- will, unintentionally, do so using someone else's account."
--
-- The iPad stays REGISTERED to the org; nobody is signed in as a person until
-- they pick their name and enter a 4-digit PIN, and after five minutes idle
-- the screen locks back to the picker. The PIN mints a REAL Supabase session
-- (the edge function `device-session` hands back a magic-link token that the
-- app spends exactly as /welcome spends an invitation), so `auth.uid()` and
-- every audit column keep working with no change to any other table.
--
-- Three of Mark's decisions, so nobody reopens them: FOUR digits (the POS
-- convention — safe here because a PIN only works from a registered device
-- and failures are throttled below); a person sets their OWN PIN on /account
-- and an owner/admin may reset it from the employee record; a device is NOT
-- bound to a shop — the picker lists every member holding a PIN, and the
-- working location stays whatever that person last used.
--
-- ---------------------------------------------------------------------------
-- NOTHING LEAVES POSTGRES
--
-- `member_pins` holds a bcrypt hash and has RLS with ZERO POLICIES — 081's
-- `accounting_connections` shape, for the same reason: the row is a
-- credential. It is written only through the two definers below and READ only
-- by `attempt_pin_unlock`, which compares INSIDE the database and returns a
-- word. The edge function never sees a hash. Do not add a SELECT policy.
--
-- ---------------------------------------------------------------------------
-- A PIN IS NOT A PASSWORD
--
-- A PIN-unlocked session is marked by the app (an httpOnly cookie) and may
-- not change a password, set a PIN or register a device. That is an APP rule
-- and this migration cannot enforce it — `set_my_pin` cannot tell how the
-- session was minted. Worth knowing before "simplifying" the cookie away.
--
-- ---------------------------------------------------------------------------
-- THE THROTTLE IS ATOMIC
--
-- 074 counts attempts in the edge function and that was fine for a mailer;
-- for a 4-digit space it is a race: two posts in flight both count four
-- failures and both proceed. `attempt_pin_unlock` takes a transaction-level
-- advisory lock on the user, then counts, records and compares in ONE
-- statement. Thresholds: ten failures on a DEVICE in fifteen minutes, five
-- for a PERSON in fifteen minutes, twenty for a person in a day (past which
-- somebody with the iPad in hand still gets ~480 guesses a day against
-- 10,000 — so the day cap is the one that matters). A lockout is REPORTED with
-- the seconds remaining: it is not a secret, and the screen should say "try
-- again in twelve minutes" rather than let somebody keep pressing.
--
-- An unknown user and a wrong PIN answer identically ("wrong"), and the hash
-- comparison runs either way so the timing does not differ.
--
-- ---------------------------------------------------------------------------
-- WHY THE DEVICE SECRET IS HASHED
--
-- `registered_devices.secret_hash` is the sha256 of a 32-byte random secret
-- the app keeps in an httpOnly cookie on the iPad. A read of this table (it
-- has a SELECT policy, for the Shared devices list) must not hand anybody the
-- credential, so it stores the hash and the function is given the hash.
--
-- pgcrypto: Supabase keeps it in the `extensions` schema; the Docker harness
-- has it in `public`. Every definer here sets `search_path = public,
-- extensions` so `crypt`/`gen_salt` resolve in both.
--
-- Depends on 001 (orgs, org_members, user_org_ids, user_has_role) and 020
-- (the supervisor role — irrelevant here but the check on org_members names
-- it). Run in the Supabase SQL editor BEFORE deploying `device-session`.
-- NOT rerunnable: `create table member_pins` fails a second time, which is the
-- signal it already ran.
-- ============================================================================

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ----------------------------------------------------------------------------
-- member_pins — the credential. Zero policies.
-- ----------------------------------------------------------------------------

create table member_pins (
  org_id   uuid not null,
  user_id  uuid not null,
  pin_hash text not null,
  set_at   timestamptz not null default now(),
  set_by   uuid references auth.users(id),
  primary key (org_id, user_id),
  -- Revoking access deletes the membership FIRST (4c), so the PIN goes with
  -- it and a revoked person cannot unlock a device.
  foreign key (org_id, user_id) references org_members(org_id, user_id) on delete cascade
);

alter table member_pins enable row level security;
-- No policies. See the header.

-- ----------------------------------------------------------------------------
-- registered_devices — an iPad the org has claimed.
-- ----------------------------------------------------------------------------

create table registered_devices (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id) on delete cascade,
  name          text not null check (btrim(name) <> ''),
  secret_hash   text not null unique,
  registered_by uuid references auth.users(id),
  registered_at timestamptz not null default now(),
  last_seen_at  timestamptz,
  revoked_at    timestamptz
);

alter table registered_devices enable row level security;

create policy registered_devices_select on registered_devices
  for select using (user_has_role(org_id, array['owner','admin']));
-- No write policies: `register_device` and `revoke_registered_device` below
-- are the only writers, and `last_seen_at` is stamped by `attempt_pin_unlock`.

-- ----------------------------------------------------------------------------
-- pin_attempts — every unlock attempt, right or wrong. 074's shape.
-- ----------------------------------------------------------------------------

create table pin_attempts (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references orgs(id) on delete cascade,
  device_id    uuid not null references registered_devices(id) on delete cascade,
  -- Null when the picked id matched nobody; the throttle still counts it
  -- against the device.
  user_id      uuid,
  succeeded    boolean not null,
  attempted_at timestamptz not null default now(),
  source_ip    text
);

create index pin_attempts_user_idx   on pin_attempts (user_id, attempted_at desc);
create index pin_attempts_device_idx on pin_attempts (device_id, attempted_at desc);

alter table pin_attempts enable row level security;

create policy pin_attempts_select on pin_attempts
  for select using (user_has_role(org_id, array['owner','admin']));
-- No write policies: `attempt_pin_unlock` is the only writer.

-- ----------------------------------------------------------------------------
-- set_my_pin — the member's own PIN.
-- ----------------------------------------------------------------------------

create or replace function public.set_my_pin(p_pin text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_org_id uuid;
begin
  select org_id into v_org_id
    from org_members
   where user_id = auth.uid()
   order by created_at
   limit 1;

  if v_org_id is null then
    raise exception 'not a member of any org';
  end if;

  if p_pin is null or p_pin !~ '^[0-9]{4}$' then
    raise exception 'a PIN is exactly four digits';
  end if;

  insert into member_pins (org_id, user_id, pin_hash, set_at, set_by)
  values (v_org_id, auth.uid(), crypt(p_pin, gen_salt('bf', 10)), now(), auth.uid())
  on conflict (org_id, user_id) do update
    set pin_hash = excluded.pin_hash,
        set_at   = excluded.set_at,
        set_by   = excluded.set_by;
end $$;

revoke all on function public.set_my_pin(text) from public;
revoke all on function public.set_my_pin(text) from anon;
grant execute on function public.set_my_pin(text) to authenticated;

-- ----------------------------------------------------------------------------
-- set_member_pin — an owner/admin sets or CLEARS (null) somebody's PIN.
-- ----------------------------------------------------------------------------

create or replace function public.set_member_pin(p_user uuid, p_pin text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_org_id uuid;
begin
  select org_id into v_org_id
    from org_members
   where user_id = p_user
     and org_id in (select user_org_ids())
   limit 1;

  if v_org_id is null then
    raise exception 'no such member';
  end if;

  if not user_has_role(v_org_id, array['owner','admin']) then
    raise exception 'only an owner or manager may set another member''s PIN';
  end if;

  if p_pin is null then
    delete from member_pins where org_id = v_org_id and user_id = p_user;
    return;
  end if;

  if p_pin !~ '^[0-9]{4}$' then
    raise exception 'a PIN is exactly four digits';
  end if;

  insert into member_pins (org_id, user_id, pin_hash, set_at, set_by)
  values (v_org_id, p_user, crypt(p_pin, gen_salt('bf', 10)), now(), auth.uid())
  on conflict (org_id, user_id) do update
    set pin_hash = excluded.pin_hash,
        set_at   = excluded.set_at,
        set_by   = excluded.set_by;
end $$;

revoke all on function public.set_member_pin(uuid, text) from public;
revoke all on function public.set_member_pin(uuid, text) from anon;
grant execute on function public.set_member_pin(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- member_pin_set_at — whether a PIN exists, and since when. Never the hash.
-- ----------------------------------------------------------------------------

create or replace function public.member_pin_set_at(p_user uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_org_id uuid;
  v_set_at timestamptz;
begin
  select org_id into v_org_id
    from org_members
   where user_id = p_user
     and org_id in (select user_org_ids())
   limit 1;

  if v_org_id is null then
    raise exception 'no such member';
  end if;

  if p_user <> auth.uid() and not user_has_role(v_org_id, array['owner','admin']) then
    raise exception 'only an owner or manager may read another member''s PIN status';
  end if;

  select set_at into v_set_at
    from member_pins
   where org_id = v_org_id and user_id = p_user;

  return v_set_at;
end $$;

revoke all on function public.member_pin_set_at(uuid) from public;
revoke all on function public.member_pin_set_at(uuid) from anon;
grant execute on function public.member_pin_set_at(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- register_device — claim this iPad for the caller's org. The app mints the
-- secret and hands over its hash.
-- ----------------------------------------------------------------------------

create or replace function public.register_device(p_name text, p_secret_hash text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_org_id uuid;
  v_id     uuid;
begin
  select org_id into v_org_id
    from org_members
   where user_id = auth.uid()
   order by created_at
   limit 1;

  if v_org_id is null then
    raise exception 'not a member of any org';
  end if;

  if not user_has_role(v_org_id, array['owner','admin']) then
    raise exception 'only an owner or manager may register a device';
  end if;

  if p_secret_hash is null or p_secret_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'malformed device secret';
  end if;

  insert into registered_devices (org_id, name, secret_hash, registered_by)
  values (v_org_id, btrim(p_name), p_secret_hash, auth.uid())
  returning id into v_id;

  return v_id;
end $$;

revoke all on function public.register_device(text, text) from public;
revoke all on function public.register_device(text, text) from anon;
grant execute on function public.register_device(text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- revoke_registered_device — forget an iPad. Returns the row count, so the
-- app can tell "not yours" from "done".
-- ----------------------------------------------------------------------------

create or replace function public.revoke_registered_device(p_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_count integer;
begin
  update registered_devices
     set revoked_at = coalesce(revoked_at, now())
   where id = p_id
     and user_has_role(org_id, array['owner','admin']);

  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function public.revoke_registered_device(uuid) from public;
revoke all on function public.revoke_registered_device(uuid) from anon;
grant execute on function public.revoke_registered_device(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- device_members — who the lock screen may offer. SERVICE ROLE ONLY: the
-- caller is an iPad with no session, reaching this through the edge function.
-- ----------------------------------------------------------------------------

create or replace function public.device_members(p_secret_hash text)
returns table (user_id uuid, name text)
language sql
security definer
set search_path = public, extensions
as $$
  select m.user_id, coalesce(m.display_name, 'Member') as name
    from registered_devices d
    join member_pins p on p.org_id = d.org_id
    join org_members m on m.org_id = p.org_id and m.user_id = p.user_id
   where d.secret_hash = p_secret_hash
     and d.revoked_at is null
   order by coalesce(m.display_name, 'Member'), m.user_id
$$;

revoke all on function public.device_members(text) from public;
revoke all on function public.device_members(text) from anon;
revoke all on function public.device_members(text) from authenticated;
grant execute on function public.device_members(text) to service_role;

-- ----------------------------------------------------------------------------
-- attempt_pin_unlock — the gate. SERVICE ROLE ONLY.
--
-- result: bad_device | locked | wrong | ok. `retry_after_seconds` is set only
-- for `locked`.
-- ----------------------------------------------------------------------------

create or replace function public.attempt_pin_unlock(
  p_secret_hash text,
  p_user        uuid,
  p_pin         text,
  p_ip          text default null
)
returns table (result text, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_device        registered_devices%rowtype;
  v_hash          text;
  v_device_fails  integer;
  v_user_fails    integer;
  v_day_fails     integer;
  v_oldest        timestamptz;
  v_retry         integer;
  v_ok            boolean;
begin
  select * into v_device
    from registered_devices
   where secret_hash = p_secret_hash
     and revoked_at is null;

  if v_device.id is null then
    result := 'bad_device'; retry_after_seconds := null;
    return next; return;
  end if;

  -- One unlock at a time per person, so two posts cannot both see four
  -- failures and both go on to compare.
  if p_user is not null then
    perform pg_advisory_xact_lock(hashtext(p_user::text));
  end if;

  select count(*) into v_device_fails
    from pin_attempts
   where device_id = v_device.id
     and not succeeded
     and attempted_at > now() - interval '15 minutes';

  select count(*) into v_user_fails
    from pin_attempts
   where user_id = p_user
     and not succeeded
     and attempted_at > now() - interval '15 minutes';

  select count(*) into v_day_fails
    from pin_attempts
   where user_id = p_user
     and not succeeded
     and attempted_at > now() - interval '24 hours';

  if v_device_fails >= 10 or v_user_fails >= 5 or v_day_fails >= 20 then
    -- Seconds until the window that tripped has one fewer failure in it.
    if v_day_fails >= 20 then
      select min(attempted_at) into v_oldest
        from pin_attempts
       where user_id = p_user and not succeeded
         and attempted_at > now() - interval '24 hours';
      v_retry := ceil(extract(epoch from (v_oldest + interval '24 hours' - now())));
    elsif v_user_fails >= 5 then
      select min(attempted_at) into v_oldest
        from pin_attempts
       where user_id = p_user and not succeeded
         and attempted_at > now() - interval '15 minutes';
      v_retry := ceil(extract(epoch from (v_oldest + interval '15 minutes' - now())));
    else
      select min(attempted_at) into v_oldest
        from pin_attempts
       where device_id = v_device.id and not succeeded
         and attempted_at > now() - interval '15 minutes';
      v_retry := ceil(extract(epoch from (v_oldest + interval '15 minutes' - now())));
    end if;

    -- Recorded, so a lockout cannot be worn down by pressing through it.
    insert into pin_attempts (org_id, device_id, user_id, succeeded, source_ip)
    values (v_device.org_id, v_device.id, p_user, false, p_ip);

    result := 'locked'; retry_after_seconds := greatest(v_retry, 1);
    return next; return;
  end if;

  select pin_hash into v_hash
    from member_pins
   where org_id = v_device.org_id and user_id = p_user;

  if v_hash is null then
    -- Same work as a real comparison, so an unknown id is not faster.
    perform crypt(coalesce(p_pin, ''), gen_salt('bf', 10));
    v_ok := false;
  else
    v_ok := crypt(coalesce(p_pin, ''), v_hash) = v_hash;
  end if;

  insert into pin_attempts (org_id, device_id, user_id, succeeded, source_ip)
  values (v_device.org_id, v_device.id, p_user, v_ok, p_ip);

  if not v_ok then
    result := 'wrong'; retry_after_seconds := null;
    return next; return;
  end if;

  update registered_devices set last_seen_at = now() where id = v_device.id;

  result := 'ok'; retry_after_seconds := null;
  return next; return;
end $$;

revoke all on function public.attempt_pin_unlock(text, uuid, text, text) from public;
revoke all on function public.attempt_pin_unlock(text, uuid, text, text) from anon;
revoke all on function public.attempt_pin_unlock(text, uuid, text, text) from authenticated;
grant execute on function public.attempt_pin_unlock(text, uuid, text, text) to service_role;

-- ============================================================================
-- Probes (SQL editor):
--   select count(*) from pg_policy where polrelid = 'public.member_pins'::regclass;         -- 0
--   select count(*) from pg_policy where polrelid = 'public.registered_devices'::regclass;  -- 1
--   select count(*) from pg_policy where polrelid = 'public.pin_attempts'::regclass;        -- 1
--   select proname, proacl from pg_proc
--    where proname in ('device_members','attempt_pin_unlock');
--     -- no authenticated= or anon= entry in either acl
--   select public.set_my_pin('123');   -- raises "exactly four digits"
-- ============================================================================
