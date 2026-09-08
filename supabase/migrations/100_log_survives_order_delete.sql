-- ============================================================================
-- 100 — AN ORDER WITH LINES COULD NOT BE DELETED
--
-- SQL STARTS AT LINE 66. Everything above it is comment.
-- ============================================================================
--
-- Found on the harness 2026-09-08 while proving 099's "a deleted day is made
-- again" rule, which is a thing that could not happen because THE DELETE
-- ITSELF FAILED. Reproduced in isolation as a real authenticated supervisor:
--
--   delete from special_orders where number = 'DEL-2';
--   ERROR: insert or update on table "special_order_events" violates foreign
--          key constraint "special_order_events_order_id_fkey"
--   CONTEXT: PL/pgSQL function trg_log_special_order_item() line 36
--
-- The chain is entirely 054's, and it is deterministic:
--
--   1. `delete from special_orders` removes the row;
--   2. the FK's `on delete cascade` — itself an AFTER trigger — removes the
--      order's `special_order_items` and `special_order_payments`;
--   3. each of those fires 054's own AFTER DELETE log trigger, which writes
--      "Removed 12 × Donut" into `special_order_events`;
--   4. `special_order_events.order_id` references the order that step 1 just
--      deleted, so the insert is refused and the whole statement rolls back.
--
-- So the order survives, and `OrderActions.remove()` reports the Postgres text
-- verbatim beside the button. **Every special order carrying a line or a
-- payment has been undeletable since 054 shipped on 2026-08-20**, which is
-- every real order — the app's Delete has only ever worked on an empty one.
--
-- WHY NOBODY HIT IT, and it is worth knowing because it is how a live walk can
-- pass over a broken feature: the 2026-08-20 verification created an order,
-- added a line, edited it, REMOVED THE LINE (to prove the "Removed 24 ×" log
-- entry), and only then deleted the order — by which point it was empty. The
-- 2026-08-27 walk's delete was refused earlier, by the scheduled-order guard.
-- The one path never walked is the ordinary one.
--
-- ----------------------------------------------------------------------------
-- THE GUARD GOES IN `log_special_order_event`, NOT IN THE TWO TRIGGERS
-- ----------------------------------------------------------------------------
-- Both triggers could be reproduced whole with a `where exists` in their DELETE
-- branch, and that would be two ~90-line reproductions of functions this
-- migration otherwise has no business touching (055's rule cuts both ways: a
-- migration that restates a function it does not mean to change is how one gets
-- silently reverted). The writer is eleven lines and is the one thing both
-- paths go through — the payments trigger has the identical bug and is fixed by
-- the same clause, and so is any log entry a future trigger writes.
--
-- IT IS ALSO THE HONEST PLACE FOR IT. This function already returns quietly on
-- an empty message: "there is nothing to record" is a state it knows how to
-- handle, and "there is no longer an order to record it against" is the same
-- kind of answer. Nothing is lost by the silence, because
-- `special_order_events` cascades with the order too — an entry written a
-- microsecond before the parent goes is an entry nobody could ever read.
--
-- The `exists` sees the deletion: the cascade runs as an AFTER trigger of the
-- same command, so the parent row is already gone from this statement's
-- snapshot by the time a child's trigger asks. The function is `security
-- definer`, so the check reads the table rather than the caller's RLS view —
-- which matters, since a supervisor deleting their own org's order must not get
-- a different answer from a purchaser.
--
-- Run in the Supabase SQL editor. RERUNNABLE.
-- ============================================================================

create or replace function public.log_special_order_event(
  p_org_id uuid,
  p_order_id uuid,
  p_message text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_author text;
begin
  if p_message is null or btrim(p_message) = '' then
    return;
  end if;

  -- THE ORDER IS BEING DELETED. See the header: without this, deleting an
  -- order with a single line fails the whole statement on a log entry that
  -- would have been cascaded away in the same breath.
  if not exists (select 1 from special_orders o where o.id = p_order_id) then
    return;
  end if;

  select m.display_name into v_author
    from org_members m
   where m.user_id = auth.uid() and m.org_id = p_org_id;

  insert into special_order_events (org_id, order_id, author, author_id, message, source)
  values (p_org_id, p_order_id, v_author, auth.uid(), p_message, 'app');
end;
$$;

-- 054's own grant discipline, restated because a `create or replace` keeps the
-- old privileges and a future `drop`/`create` would not: this is machinery for
-- the triggers, and a direct call is what a definer must not offer.
revoke all on function public.log_special_order_event(uuid, uuid, text) from public, anon, authenticated;
