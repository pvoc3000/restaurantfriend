-- ============================================================================
-- 115 — `log_special_order_event` KEEPS BOTH ITS GUARDS
--
-- SQL STARTS AT LINE 51. Everything above it is comment.
--
-- Mark, 2026-09-21, deleting the template he had just made: "insert or update
-- on table "special_order_events" violates foreign key constraint
-- "special_order_events_order_id_fkey"". Word for word the error 100 was
-- written to kill.
--
-- ----------------------------------------------------------------------------
-- 113 REVERTED 100, AND 100 SAID IN ADVANCE THAT THIS IS HOW IT HAPPENS
-- ----------------------------------------------------------------------------
-- 100 put a `where exists` guard inside this function: when an order is
-- deleted, the cascade removes its lines, each line's AFTER DELETE trigger
-- tries to log "Removed 12 × Donut", and the insert references an order that is
-- already gone — so the whole statement rolls back and the delete fails. Every
-- special order carrying a line was undeletable between 054 and 100.
--
-- 113 needed a second guard in the same function (a copy suppresses the log for
-- one transaction) and restated the function to add it — FROM 054's TEXT, which
-- predates 100. The `exists` check went with it. 100's own header names this
-- exactly: "a migration that restates a function it does not mean to change is
-- how one gets silently reverted". It was written about the two triggers 100
-- chose not to touch, and it applies to 100 itself.
--
-- WHAT IT COST: deleting any special order carrying a line, again, from the
-- moment 113 was applied. Templates most visibly, because a converted one
-- arrives with every line of the order it came from.
--
-- ----------------------------------------------------------------------------
-- BOTH GUARDS, AND THE ORDER THEY ARE IN
-- ----------------------------------------------------------------------------
--   1. SUPPRESSED — a copy in flight wants nothing written at all, so this is
--      first and cheapest (113).
--   2. NOTHING TO SAY — an empty message (054).
--   3. NO ORDER TO SAY IT ABOUT — the parent is being deleted (100).
--
-- Each is "a state this function knows how to handle", which is 100's argument
-- for putting the check here rather than in the triggers, and it is why a third
-- one fits without the shape changing.
--
-- THE REVOKE IS RESTATED, as 100 restated it: `create or replace` keeps the old
-- privileges, so it is not strictly needed — and that is exactly why it is
-- written down, because the next person to restate this function will copy what
-- is in front of them.
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
  -- 113: a copy writes its own single line and wants none of this.
  -- Transaction-local, so it is set and gone inside `copy_special_order`.
  if coalesce(current_setting('rf.suppress_order_log', true), '') = 'on' then
    return;
  end if;

  if p_message is null or btrim(p_message) = '' then
    return;
  end if;

  -- 100: THE ORDER IS BEING DELETED. Without this, deleting an order with a
  -- single line fails the whole statement on a log entry that would have been
  -- cascaded away in the same breath.
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

-- 054's grant discipline, restated for the reason 100 restated it.
revoke all on function public.log_special_order_event(uuid, uuid, text) from public, anon, authenticated;
