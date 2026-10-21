-- ============================================================================
-- restaurantfriend — migration 208 · the tablet Start's pinned tiles, per person
-- ============================================================================
-- Mark, 2026-10-20: "for the tablet, I would love to have an area at the top
-- to display 'Pinned' actions that the user uses often. For instance, I would
-- love to have the 'run the order guide' action at the top since I use it a
-- lot." Pinned with an Edit switch; a pinned tile moves up out of its group;
-- the desk's Actions widget keeps a SEPARATE list (it lives in `start_layout`,
-- 207), so this column is the tablet's alone.
--
-- PER PERSON, not per iPad: on the shared iPad each person unlocks with their
-- PIN, so the pins that appear are the person's, not the device's.
--
-- What changes:
-- 1. `org_members.tablet_pins text[]` — tile keys (`lib/tablet/landing`), in
--    the order they were pinned. Empty = nothing pinned, no Pinned row. The app
--    reads it tolerantly (an unknown key is dropped), so a tile renamed or
--    retired costs its pin, not the page.
-- 2. `set_my_tablet_pins(p_pins)` — the one way to write it, naming the one
--    column, as `set_my_start_layout` (207) and `set_my_member_profile` (002)
--    do: RLS filters rows, not columns, so a self-update policy would also let
--    staff set their own `role`. It checks only shape: at most 32 keys, each a
--    short snake_case word.
--
-- Order: apply this, THEN deploy the web change. `lib/session.ts` selects the
-- new column on every page load.

begin;

alter table public.org_members
  add column if not exists tablet_pins text[] not null default '{}';

comment on column public.org_members.tablet_pins is
  'The tablet Start''s pinned tiles for this person, in order (lib/tablet/landing keys). Written only by set_my_tablet_pins.';

create or replace function public.set_my_tablet_pins(p_pins text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_pins text[] := coalesce(p_pins, '{}');
begin
  -- The same membership rule as set_my_member_profile.
  select org_id into v_org_id
    from org_members
   where user_id = auth.uid()
   order by created_at
   limit 1;

  if v_org_id is null then
    raise exception 'not a member of any org';
  end if;

  if cardinality(v_pins) > 32 then
    raise exception 'too many pinned tiles';
  end if;

  if exists (select 1 from unnest(v_pins) k where k is null or k !~ '^[a-z_]{1,40}$') then
    raise exception 'a pinned tile must be a tile key';
  end if;

  update org_members
     set tablet_pins = v_pins
   where user_id = auth.uid()
     and org_id  = v_org_id;
end $$;

revoke all on function public.set_my_tablet_pins(text[]) from public;
revoke all on function public.set_my_tablet_pins(text[]) from anon;
grant execute on function public.set_my_tablet_pins(text[]) to authenticated;

commit;
