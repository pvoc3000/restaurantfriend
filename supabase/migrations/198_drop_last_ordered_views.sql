-- ============================================================================
-- 198 — DROP THE TWO OWNER-RUN VIEWS THAT 197's FUNCTIONS REPLACED
--
--   v_item_last_ordered    (004, 014)  →  item_last_ordered(p_location)
--   v_item_last_purchase   (048)       →  item_last_purchase(p_location)
--
-- Applied only after the app that calls the functions was deployed, so no
-- running screen read a view that had gone. Nothing else depends on either
-- (checked in pg_depend). A view holds no data; their definitions are in 014
-- and 048.
--
-- This is what clears Supabase's "Security Definer View" lint. Needs 197.
-- RERUNNABLE.
-- ============================================================================

begin;

drop view if exists public.v_item_last_ordered;
drop view if exists public.v_item_last_purchase;

commit;
