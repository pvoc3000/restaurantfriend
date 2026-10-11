-- ============================================================================
-- 191 — THE PUBLIC FORM IS NOT TOLD WHY
--
-- Mark, 2026-10-10: the customer's message "should be: 'We're sorry, but we
-- are not taking special orders for <date>.' Do not include the title of the
-- blackout - it's for internal use only."
--
-- 181 sent each entry's TITLE to /inquiry, which printed it — on the reading
-- that a title like "Closed for Christmas" was written for customers. It is
-- written for staff ("Short-handed", "Staff retreat"), and this function is
-- callable by anyone on the internet. So the title no longer leaves the
-- database: `inquiry_blackouts` returns dates and shops, and nothing else.
--
--   { "default_location_id": uuid | null,
--     "entries": [{ "starts_on", "ends_on", "location_ids" }] }
--
-- The web app stopped reading `title` in the same change, and drops one if an
-- older function sends it. 181's comment on `calendar_entries.title` is
-- corrected below.
--
-- The body is 181's with that one line removed. Name and argument unchanged,
-- so 181's grants stand. RERUNNABLE.
-- ============================================================================

create or replace function public.inquiry_blackouts(p_org_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v       jsonb;
  v_today date;
begin
  if p_org_id is null then
    return jsonb_build_object('default_location_id', null, 'entries', '[]'::jsonb);
  end if;

  select (now() at time zone coalesce(nullif(o.settings ->> 'timezone', ''), 'UTC'))::date
    into v_today
    from orgs o
   where o.id = p_org_id;

  if v_today is null then
    return jsonb_build_object('default_location_id', null, 'entries', '[]'::jsonb);
  end if;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'starts_on',    e.starts_on,
               'ends_on',      e.ends_on,
               'location_ids', to_jsonb(e.location_ids)
             )
             order by e.starts_on, e.ends_on
           ),
           '[]'::jsonb
         )
    into v
    from calendar_entries e
   where e.org_id = p_org_id
     and e.no_special_orders
     and e.ends_on >= v_today;

  return jsonb_build_object(
    'default_location_id', inquiry_price_location(p_org_id, null),
    'entries', v);
end;
$$;

revoke all on function public.inquiry_blackouts(uuid) from public, anon, authenticated;
grant execute on function public.inquiry_blackouts(uuid) to anon, authenticated;

comment on column calendar_entries.title is
  'Shown on the calendar and to staff. INTERNAL: never sent to /inquiry (191).';
