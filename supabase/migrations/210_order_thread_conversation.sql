-- ============================================================================
-- 210 — AN ORDER'S EMAILS ARE FILED IN ONE GMAIL CONVERSATION
--
-- Mark, 2026-10-21: "Ideally, from the inquiry email forward, all emails to
-- this customer regarding their order should be together in a single thread,
-- including the notification emails when they approve or pay."
--
-- 167 threaded by headers alone and threaded nothing, for two reasons found in
-- the specialorders@ mailbox:
--
--   1. GMAIL REPLACES A SUPPLIED Message-ID. 167 generated
--      `<rf-…@donutfriend.com>`, sent it and stored it as the order's root;
--      the email went out as `<CA…@mail.gmail.com>`. Every later email
--      answered an id no message anywhere carries. The send functions now
--      read the real one back after sending; `thread_message_id` stores THAT.
--   2. IN THE SENDING MAILBOX, AN API SEND JOINS A CONVERSATION ONLY WHEN IT
--      NAMES IT. Gmail's rule is the threadId, the reply headers AND the same
--      subject; with no threadId every send started a conversation of its own.
--      This column is that threadId.
--
--   thread_conversation_id — the sending mailbox's own conversation id for the
--     order (Gmail's threadId), set by the first email sent about it and
--     passed by every later one, the shop's notices included. Null for an
--     order nothing has been sent about, and for any provider without one.
--
-- The existing generated roots are repaired separately, from the mailbox
-- (see docs/history/04g-special-orders.md), because only the mailbox knows
-- which Message-ID each first email really carried.
-- RERUNNABLE.
-- ============================================================================

begin;

alter table special_orders
  add column if not exists thread_conversation_id text;

comment on column special_orders.thread_conversation_id is
  'The sending mailbox''s conversation for this order''s emails (Gmail threadId), '
  'set by the first email and passed by every later one, so they file together (210).';

commit;

notify pgrst, 'reload schema';

-- ----------------------------------------------------------------------------
-- After this runs (read-only):
--   select count(*) from special_orders where thread_conversation_id is not null;  → 0
-- ============================================================================
