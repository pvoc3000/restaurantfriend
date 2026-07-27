-- ============================================================================
-- restaurantfriend — migration 002 · member self-service
--
-- Problem: org_members' write policy requires owner/admin, so a purchaser or
-- staff user cannot persist their own active location (spec §0 rule 3 — the
-- app remembers where you're working). The obvious fix — "let members update
-- their own row" — is unsafe: RLS policies filter ROWS, not COLUMNS, so a
-- self-update policy would also let staff set their own role to 'owner'.
--
-- Solution: one SECURITY DEFINER function that touches exactly two columns.
-- The allowed columns are the ones named in the body; nothing else is
-- reachable. The owner/admin policy from 001 is left untouched.
-- ============================================================================

create or replace function public.set_my_member_profile(
  p_location_id  uuid default null,   -- null = leave unchanged
  p_display_name text default null    -- null = leave unchanged, '' = clear
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  -- One org per user for years (spec §0). If a user ever belongs to several,
  -- this is where an "active org" session value would be consulted.
  select org_id into v_org_id
    from org_members
   where user_id = auth.uid()
   order by created_at
   limit 1;

  if v_org_id is null then
    raise exception 'not a member of any org';
  end if;

  -- SECURITY DEFINER bypasses RLS, so this function must re-check what RLS
  -- would have enforced: you may only point at a location in your own org.
  if p_location_id is not null and not exists (
    select 1 from locations
     where id = p_location_id and org_id = v_org_id
  ) then
    raise exception 'location % is not in your org', p_location_id;
  end if;

  update org_members
     set last_active_location_id = coalesce(p_location_id, last_active_location_id),
         display_name = case
                          when p_display_name is null then display_name
                          else nullif(btrim(p_display_name), '')
                        end
   where user_id = auth.uid()
     and org_id  = v_org_id;
end $$;

-- Signed-in users only; never anon.
--
-- `revoke ... from public` is NOT enough: Supabase's default privileges grant
-- EXECUTE on new public-schema functions to anon/authenticated/service_role
-- explicitly, and an explicit grant survives a revoke from PUBLIC. So revoke
-- from anon by name. (The body would reject anon anyway — auth.uid() is null —
-- but the door shouldn't be open in the first place.)
revoke all     on function public.set_my_member_profile(uuid, text) from public;
revoke all     on function public.set_my_member_profile(uuid, text) from anon;
grant  execute on function public.set_my_member_profile(uuid, text) to authenticated;
