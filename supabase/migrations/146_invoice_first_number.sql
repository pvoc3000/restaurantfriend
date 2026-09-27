-- ============================================================================
-- 146 — INVOICE NUMBERS START WHERE THE ORG SAYS
-- ============================================================================
--
-- Mark, 2026-09-27, before going live on October 1: "Start the next invoice
-- at 10000."
--
-- An invoice's number was the org's highest so far plus one, from 1001 (124).
-- It is now never below `orgs.settings.customer_invoices.first_number` —
-- design rule 2, beside the terms and the prefix already read from there. So
-- the next invoice is the larger of the two: 10000 while the test invoices
-- stop at 1014, then 10001, 10002… Unset, it is 1001, as before. A revision
-- keeps its original's number ("10004-2") and is not affected.
--
-- Run in the Supabase SQL editor after 145. RERUNNABLE.
-- ============================================================================

create or replace function public.next_customer_invoice_number(p_org uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_first text;
  v int;
begin
  perform pg_advisory_xact_lock(hashtext('customer_invoice_number:' || p_org::text));
  select settings -> 'customer_invoices' ->> 'first_number' into v_first from orgs where id = p_org;
  select greatest(coalesce(max(number), 0) + 1,
                  case when v_first ~ '^[0-9]{1,9}$' then v_first::int else 1001 end)
    into v
    from customer_invoices
   where org_id = p_org;
  return v;
end;
$$;

revoke all on function public.next_customer_invoice_number(uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';

-- ----------------------------------------------------------------------------
-- After this runs (read-only):
--   select next_customer_invoice_number(id) from orgs;
--     → 1015 until `first_number` is set; 10000 once it is 10000
--   (it takes a lock and writes nothing)
-- ============================================================================
