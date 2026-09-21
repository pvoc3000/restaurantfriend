-- ============================================================================
-- 113 — A SHAPE'S LOG CAN BE CLEARED
--
-- Mark, 2026-09-21: "when converting a special order to an order template,
-- log/history should be cleared as well."
--
-- WHY THIS NEEDS A MIGRATION AT ALL. 051 gave `special_order_events` a select,
-- an insert and an update policy and DELIBERATELY NO DELETE: "the log is the
-- record of what was done, and an entry removed is a thing that happened with
-- no trace." That rule is right and this does not repeal it.
--
-- WHAT A CONVERTED TEMPLATE'S LOG ACTUALLY HOLDS is the argument for the
-- exception. Nothing is copied from the source — `duplicateSpecialOrder` has
-- never carried events across — so every line in it was written seconds ago by
-- a TRIGGER describing the copy mechanism: 056's "Template created", and one
-- entry per line the copy inserted. For a twenty-line order that is twenty-one
-- entries recording that a computer copied some rows. It is not history; it is
-- the noise history would have to be read through.
--
-- ----------------------------------------------------------------------------
-- THE GUARD IS THE KIND, AND IT IS THE WHOLE SAFETY ARGUMENT
-- ----------------------------------------------------------------------------
-- The function REFUSES on `kind = 'order'`. A real order's log is exactly what
-- 051 was protecting — who quoted it, when it was sent, what was changed — and
-- none of it may be removed by anybody. A template and a standing order are
-- PROTOTYPES: they are not a thing that happened.
--
-- What that still allows, stated plainly rather than hidden: somebody at
-- purchaser+ can clear a STANDING ORDER's log later, and a standing order's log
-- does record real edits — a price change, a weekday change — which affect days
-- not yet made. That is the cost of not building a one-shot token, and it is
-- accepted rather than overlooked. The days themselves are untouched: each
-- carries its own log and its own "Made from standing order N".
--
-- DEFINER, so it must re-check what RLS would have (CLAUDE.md's rule for every
-- definer in this schema): membership at purchaser+, the org matching the row,
-- and the kind. It returns a COUNT rather than raising, so a caller that runs
-- it against an order simply learns that nothing was cleared.
--
-- Run in the Supabase SQL editor. RERUNNABLE (`create or replace`).
-- THE SQL STARTS ON THE LINE AFTER THIS ONE.
-- ============================================================================

create or replace function public.clear_special_order_log(
  p_org_id   uuid,
  p_order_id uuid
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind    text;
  v_deleted integer;
begin
  -- What RLS would have asked. `user_has_role` is 002's own helper, so this
  -- says the same thing the table's other three policies say.
  if not user_has_role(p_org_id, array['owner', 'admin', 'purchaser']) then
    return 0;
  end if;

  select kind into v_kind
    from special_orders
   where id = p_order_id
     and org_id = p_org_id;

  -- No such order in this org, or a real one: nothing is cleared, and the
  -- caller is told so by the count rather than by an exception.
  if v_kind is null or v_kind = 'order' then
    return 0;
  end if;

  delete from special_order_events
   where order_id = p_order_id
     and org_id = p_org_id;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

comment on function public.clear_special_order_log(uuid, uuid) is
  'Empties a TEMPLATE or STANDING ORDER''s log - the trigger-written noise a '
  'conversion leaves behind. Refuses on kind = ''order'': 051''s no-delete rule '
  'protects the record of what was done, and only a shape has none.';

-- 002's rule: a new public-schema function is executable by `anon` through
-- Supabase's default privileges, and revoking from PUBLIC does not undo that.
revoke all on function public.clear_special_order_log(uuid, uuid) from public;
revoke all on function public.clear_special_order_log(uuid, uuid) from anon;
grant execute on function public.clear_special_order_log(uuid, uuid) to authenticated;
