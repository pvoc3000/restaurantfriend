-- ============================================================================
-- 214 — AN ORDER'S EMAILS, AND WHETHER ANYBODY HAS ANSWERED THEM
--
-- Mark, 2026-10-29: "Traci keeps missing incoming special order emails …
-- is it possible to have a tab on the special order detail page for reading
-- and responding to emails? could the app flag when a message comes in about
-- an order?" Then: "Build the tab."
--
-- Measured first, on the specialorders@ inbox over the 14 days to 2026-10-29:
-- about 117 conversations carried mail the app sent itself (the CC of every
-- quote and invoice, and the shop notices) against about 26 from customers and
-- carriers. Traci reads that inbox in Mail.app, so a customer's reply arrives
-- among four of our own. This gives each order its own copy of its mail and a
-- state Mail.app cannot keep: WAITING FOR A REPLY.
--
-- `special_order_messages` MIRRORS THE MAILBOX. Gmail stays the record; the
-- `order-mail` function copies in every message it can tie to an order (by
-- the order's Gmail conversation, then its number in the subject, then the
-- sender's address against one open order) and sends the replies typed on the
-- tab. It alone writes rows, with service_role: there is no insert or delete
-- policy. Supervisor and above read them, like the order's log (051), since
-- they are the customer's own words.
--
-- WAITING IS NOT UNREAD. A message from outside is waiting until something
-- answers it: an email to the customer sent after it (from the tab, from the
-- app's documents, or from Mail.app — the mirror sees all three in Sent), or
-- somebody pressing No reply needed. Opening the tab clears nothing, because
-- reading a question is not answering it. `handled_at` is that answer's time;
-- `handled_by` is set only when a person dismissed it.
--
-- RERUNNABLE.
-- ============================================================================

begin;

create table if not exists special_order_messages (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references orgs(id) on delete cascade,
  order_id         uuid not null references special_orders(id) on delete cascade,
  -- Gmail's own handles in the module mailbox, for fetching a body or an
  -- attachment again and for putting a reply in the same conversation.
  gmail_message_id text not null,
  gmail_thread_id  text not null,
  -- The RFC 822 Message-ID, which a reply's In-Reply-To names.
  rfc_message_id   text,
  -- `in` is from anybody but the mailbox; `out` is from the mailbox itself.
  direction        text not null check (direction in ('in', 'out')),
  from_address     text not null,
  from_name        text,
  to_addresses     text,
  cc_addresses     text,
  subject          text,
  sent_at          timestamptz not null,
  snippet          text,
  -- The text/plain part, or the HTML part reduced to text. Quoted history is
  -- kept; the tab folds it (`lib/orderEmail`).
  body_text        text,
  -- [{filename, mime_type, size, attachment_id}] — Gmail's attachment id,
  -- fetched through `order-mail` when somebody opens one.
  attachments      jsonb not null default '[]'::jsonb,
  -- How the message was tied to the order: thread · subject · address · sent
  -- (a reply sent from the tab, recorded as it went).
  matched_by       text not null check (matched_by in ('thread', 'subject', 'address', 'sent')),
  handled_at       timestamptz,
  handled_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint special_order_messages_one_copy unique (org_id, gmail_message_id),
  constraint special_order_messages_only_inbound_waits
    check (direction = 'in' or handled_at is null)
);

comment on table special_order_messages is
  'The order''s email, copied from the special-orders mailbox by order-mail (214). '
  'An inbound row with no handled_at is waiting for a reply.';

create index if not exists special_order_messages_order_idx
  on special_order_messages (order_id, sent_at);

-- The Orders list's Waiting column and every order's tab mark read only this.
create index if not exists special_order_messages_waiting_idx
  on special_order_messages (org_id, order_id, sent_at)
  where direction = 'in' and handled_at is null;

alter table special_order_messages enable row level security;

drop policy if exists special_order_messages_select on special_order_messages;
create policy special_order_messages_select on special_order_messages for select
  using (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']));


-- Where the mirror has got to, per org. Written by `order-mail` only; read by
-- the tab to say when the mailbox was last checked and why it could not be.
create table if not exists special_order_mail_sync (
  org_id      uuid primary key references orgs(id) on delete cascade,
  -- Messages Gmail received after this were looked at. The next check starts
  -- an hour before it, so a message Gmail dates late is not skipped.
  checked_to  timestamptz,
  checked_at  timestamptz,
  last_error  text
);

comment on table special_order_mail_sync is
  'When order-mail last read the special-orders mailbox, and the last problem it hit (214).';

alter table special_order_mail_sync enable row level security;

drop policy if exists special_order_mail_sync_select on special_order_mail_sync;
create policy special_order_mail_sync_select on special_order_mail_sync for select
  using (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']));


-- ANSWERED BY WHAT CAME AFTER. Every waiting message on these orders that an
-- email to the customer followed takes that email's time. Called by
-- `order-mail` after each batch, so a backfill of a month of mail does not
-- arrive with every answered question flagged.
create or replace function public.settle_special_order_messages(p_orders uuid[])
returns integer
language sql
security definer
set search_path = public
as $$
  with settled as (
    update special_order_messages m
       set handled_at = (
             select min(o.sent_at) from special_order_messages o
              where o.order_id = m.order_id and o.direction = 'out' and o.sent_at > m.sent_at
           )
     where m.order_id = any(p_orders)
       and m.direction = 'in'
       and m.handled_at is null
       and exists (
             select 1 from special_order_messages o
              where o.order_id = m.order_id and o.direction = 'out' and o.sent_at > m.sent_at
           )
    returning 1
  )
  select count(*)::integer from settled;
$$;

revoke all on function public.settle_special_order_messages(uuid[]) from public;
revoke all on function public.settle_special_order_messages(uuid[]) from anon;
revoke all on function public.settle_special_order_messages(uuid[]) from authenticated;


-- NO REPLY NEEDED. A person says the order's waiting mail needs no answer (a
-- "thanks!", a delivery confirmation). RLS filters rows, not columns, so this
-- is the only way a signed-in member changes a message — and it writes the
-- log line saying who did.
create or replace function public.dismiss_special_order_messages(p_order uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org     uuid;
  v_count   integer;
  v_author  text;
begin
  select org_id into v_org from special_orders where id = p_order;
  if v_org is null then
    raise exception 'No such order';
  end if;
  if not user_has_role(v_org, array['owner', 'admin', 'purchaser', 'supervisor']) then
    raise exception 'insufficient role to clear an order''s email';
  end if;

  update special_order_messages
     set handled_at = now(), handled_by = auth.uid()
   where order_id = p_order and direction = 'in' and handled_at is null;
  get diagnostics v_count = row_count;

  if v_count > 0 then
    select coalesce(display_name, '') into v_author
      from org_members where org_id = v_org and user_id = auth.uid();
    insert into special_order_events (org_id, order_id, message, author, author_id, source)
    values (
      v_org, p_order,
      case when v_count = 1 then 'Email marked No reply needed'
           else format('%s emails marked No reply needed', v_count) end,
      nullif(v_author, ''), auth.uid(), 'app'
    );
  end if;
  return v_count;
end;
$$;

revoke all on function public.dismiss_special_order_messages(uuid) from public;
revoke all on function public.dismiss_special_order_messages(uuid) from anon;
grant execute on function public.dismiss_special_order_messages(uuid) to authenticated;

commit;
