-- ============================================================================
-- 167 — EVERY EMAIL ABOUT A SPECIAL ORDER IS ONE CONVERSATION
--
-- Mark, 2026-10-02: "something we lost from FMP that would be nice to have
-- again: threaded emails … This is really only applicable to special orders.
-- There are so many emails back and forth that it becomes unwieldy." And:
-- "keep the subject the same even if the title changes", shaped
-- "Donut Friend SO-10098: Smith Wedding".
--
-- Until now only an order that began as an /inquiry had a thread (051's
-- `inbound_message_id`, decision 12), and each email still had its own subject
-- ("Your quote …", "Your receipt …"), which Gmail splits a conversation on
-- even when the headers match. Two columns fix both:
--
--   thread_message_id — the RFC 822 Message-ID every later email answers
--     (In-Reply-To / References). The inquiry confirmation's, for an inquiry;
--     otherwise generated for the FIRST customer email sent about the order.
--   thread_subject — the subject every customer email about the order goes
--     under, set by that same first email and never rewritten, so renaming
--     the order does not split the conversation.
--
-- `inbound_message_id` / `inbound_subject` stay as the record of the inquiry
-- itself. Written by the send functions through the CALLER's client (a
-- supervisor+ can already update the order), and by `submit-inquiry`,
-- `approve-quote` and `square-pay` with the service role.
--
-- An inquiry order's existing thread is kept: its subject becomes "Re: " the
-- confirmation's, which is the conversation the customer already has.
-- RERUNNABLE.
-- ============================================================================

alter table special_orders
  add column if not exists thread_message_id text,
  add column if not exists thread_subject    text;

comment on column special_orders.thread_message_id is
  'The Message-ID every customer email about this order answers, so they thread '
  '(167). The inquiry confirmation''s, else the first customer email''s.';
comment on column special_orders.thread_subject is
  'The subject every customer email about this order goes under, fixed by the '
  'first one and never rewritten, so renaming the order keeps the thread (167).';

update special_orders
   set thread_message_id = inbound_message_id,
       thread_subject = case
         when inbound_subject is null or btrim(inbound_subject) = '' then null
         when inbound_subject ~* '^re:' then inbound_subject
         else 'Re: ' || inbound_subject
       end
 where inbound_message_id is not null
   and btrim(inbound_message_id) <> ''
   and thread_message_id is null;
