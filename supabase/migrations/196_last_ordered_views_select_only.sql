-- ============================================================================
-- 196 — THE TWO "LAST ORDERED" VIEWS ARE GRANTED SELECT AND NOTHING ELSE
--
-- Mark, 2026-10-12, after Supabase's "Security Definer View" lint.
--
-- v_item_last_ordered (014) and v_item_last_purchase (048) run as their owner
-- on purpose — 014 has the measurement — and re-check the org in their own
-- body. That stands. What this trims is Supabase's default privileges, which
-- had handed `authenticated` INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES and
-- TRIGGER on both as well.
--
-- None of those could be used: one view aggregates and the other is DISTINCT
-- ON, so neither is updatable. But a view that skips RLS should hold exactly
-- the grant it needs, so a later rewrite into an updatable shape cannot turn
-- an unused grant into a way to write past the tables' policies.
--
-- In one transaction, so there is no moment when the app cannot read them.
-- RERUNNABLE.
-- ============================================================================

begin;

revoke all on public.v_item_last_ordered  from anon, authenticated;
revoke all on public.v_item_last_purchase from anon, authenticated;

grant select on public.v_item_last_ordered  to authenticated;
grant select on public.v_item_last_purchase to authenticated;

commit;
