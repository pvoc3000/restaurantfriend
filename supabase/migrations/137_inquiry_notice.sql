-- ============================================================================
-- 137 — WHERE THE NEW-INQUIRY NOTICE GOES
-- ============================================================================
-- Mark, 2026-09-24: "When a customer submits an inquiry, can you create a nice
-- html email that includes all the submitted info and send it to
-- specialorders@donutfriend.com so we know?"
--
-- `submit-inquiry` sends it (see `_shared/inquiryNotice.ts`); this is only the
-- ADDRESS, as `orgs.settings.special_orders.inquiry_notify` — design rule 2:
-- a business's mailbox is configuration, never a literal in code. One address
-- or several, comma-separated; empty turns the notice off. Editable in
-- Settings ▸ Messages.
--
-- SEEDED FROM THE MODULE'S OWN `email_cc`, which is where every special-order
-- email is already copied (specialorders@ today), so this migration names no
-- mailbox either. Only written when absent, 051's idiom, so a re-run cannot
-- stomp an address somebody changed. An org with no `email_cc` gets nothing,
-- and so no notice until one is set.
--
-- No function change. RERUNNABLE.
-- ============================================================================

update orgs
   set settings = jsonb_set(
         settings,
         '{special_orders,inquiry_notify}',
         to_jsonb(settings -> 'special_orders' ->> 'email_cc')
       )
 where not (coalesce(settings -> 'special_orders', '{}'::jsonb) ? 'inquiry_notify')
   and nullif(btrim(coalesce(settings -> 'special_orders' ->> 'email_cc', '')), '') is not null;


-- ----------------------------------------------------------------------------
-- After this:
--   select settings -> 'special_orders' ->> 'inquiry_notify' from orgs;
--     -> specialorders@donutfriend.com
-- ----------------------------------------------------------------------------
