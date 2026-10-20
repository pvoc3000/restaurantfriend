-- ============================================================================
-- restaurantfriend — migration 207 · the start page layout, per person
-- ============================================================================
-- Mark, 2026-10-17: "It would be even cooler if [we could] choose which modules
-- to display and where to display them … A page edit mode could allow the user
-- to drag/move the widgets around, add, remove them." Asked where a person's
-- arrangement lives, he chose PER PERSON: saved in the database so it follows
-- you between machines, with one built-in default and no per-role defaults.
--
-- What changes:
-- 1. `org_members.start_layout jsonb` — the person's desk start page: which
--    widgets, in what order, how wide, what tint. NULL means the built-in
--    default, which lives in the app (`lib/startLayout.ts`), so a person who
--    never edits their page follows the default as it changes.
-- 2. `set_my_start_layout(p_layout)` — the one way to write it. RLS filters
--    rows, not columns, so a self-update policy on `org_members` would also let
--    staff set their own `role`; this definer names the one column, as
--    `set_my_member_profile` (002, 073) does for the working shop. NULL resets
--    to the default. The app reads the value tolerantly (unknown widgets are
--    dropped), so the database checks only that it is an object of sane size.
--
-- Why the database and not localStorage, which is where column layouts live
-- (conventions: "Nothing syncs; all of this is localStorage"): that rule's
-- reason is that a desk and an iPad want different columns. The widget page is
-- desk-only — the tablet keeps its tiles — so the reason does not apply here.
--
-- Order: apply this, THEN deploy the web change. `lib/session.ts` selects the
-- new column on every page load, so the web change before the column exists
-- fails every signed-in page. The old web code ignores the column.

begin;

alter table public.org_members
  add column if not exists start_layout jsonb;

comment on column public.org_members.start_layout is
  'The desk start page''s widgets for this person (lib/startLayout). Null = the built-in default. Written only by set_my_start_layout.';

create or replace function public.set_my_start_layout(p_layout jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
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

  if p_layout is not null then
    if jsonb_typeof(p_layout) <> 'object' then
      raise exception 'a start page layout must be an object';
    end if;
    -- Ten widgets with a span, a tint and an option come to well under 1 KB;
    -- the cap only stops the column being used as somewhere to put things.
    if octet_length(p_layout::text) > 8192 then
      raise exception 'a start page layout must be under 8 KB';
    end if;
  end if;

  update org_members
     set start_layout = p_layout
   where user_id = auth.uid()
     and org_id  = v_org_id;
end $$;

revoke all on function public.set_my_start_layout(jsonb) from public;
revoke all on function public.set_my_start_layout(jsonb) from anon;
grant execute on function public.set_my_start_layout(jsonb) to authenticated;

commit;
