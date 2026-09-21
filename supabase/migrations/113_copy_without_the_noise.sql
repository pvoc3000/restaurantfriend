-- ============================================================================
-- 113 — A COPY CARRIES ONE LINE OF HISTORY, NOT A RE-ENACTMENT OF ONE
--
-- Mark, 2026-09-21:
--   1. "Do not copy the history when copying an order that will be converted
--      into a template. Just include a line on the new template specifying
--      which order the template came from."
--   2. "Do not copy the history when copying a template into a regular or
--      standing order. Just include a line in the new order history specifying
--      which template the order came from."
--   "That way history we care about is retained. No history is removed - it
--    just stays where it matters, and isn't duplicated anywhere."
--
-- ----------------------------------------------------------------------------
-- NOTHING WAS EVER COPIED. THE COPY WAS WRITING ITS OWN.
-- ----------------------------------------------------------------------------
-- `duplicateSpecialOrder` has never touched `special_order_events`. What a
-- converted template's log held was written FRESH, by 054's item trigger, one
-- "Added 12 × Glazed" per line the copy inserted, under 056's "Template
-- created". The same words as the source's log, generated independently — which
-- is why it reads as duplicated history and, for the purpose of the sentence
-- above, is exactly that.
--
-- So there is nothing to stop copying. There is something to stop WRITING, and
-- that is the whole of this migration. No log entry is ever deleted, no DELETE
-- policy is added, and 051's rule — "an entry removed is a thing that happened
-- with no trace" — stands untouched.
--
-- ----------------------------------------------------------------------------
-- HOW: ONE TRANSACTION THAT KNOWS IT IS A COPY
-- ----------------------------------------------------------------------------
-- The app did the copy as three separate calls — insert the row, insert the
-- lines, write the provenance — and the database saw three unrelated requests.
-- A trigger cannot tell "this INSERT is part of a copy" from any other insert,
-- and nothing in the row says so.
--
-- So the copy becomes one function, and it raises a flag the logger reads:
-- `set_config('rf.suppress_order_log', 'on', TRUE)` — the third argument is
-- what makes it TRANSACTION-LOCAL, so it cannot leak to the next request
-- sharing the pooled connection. `log_special_order_event` returns early while
-- it is set, and every one of 054's three triggers logs through that one
-- helper, so guarding it there covers the order, its items and its payments at
-- once.
--
-- THE PROVENANCE LINE IS NOT AFFECTED because it is a plain INSERT written by
-- this function rather than a call to the helper. One line, naming the source
-- and what kind of thing it was.
--
-- ----------------------------------------------------------------------------
-- THE COPY ITSELF IS `to_jsonb` MINUS SOME KEYS, which is the shape the app's
-- own version has always had — and it is deliberately not a column list: a
-- column added to `special_orders` next year travels automatically, where a
-- list would silently stop copying it. What does NOT travel is identity,
-- history, the stage dates, the schedule link and the recurrence; what is SET
-- is decided by the new kind (decision 3's biconditional as widened by 112).
--
-- Run in the Supabase SQL editor. RERUNNABLE (`create or replace`).
-- THE SQL STARTS ON THE LINE AFTER THIS ONE.
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
  -- 113: a copy writes its own single line and wants none of this. Transaction
  -- local, so it is set and gone inside `copy_special_order`.
  if coalesce(current_setting('rf.suppress_order_log', true), '') = 'on' then
    return;
  end if;

  if p_message is null or btrim(p_message) = '' then
    return;
  end if;

  select m.display_name into v_author
    from org_members m
   where m.user_id = auth.uid() and m.org_id = p_org_id;

  insert into special_order_events (org_id, order_id, author, author_id, message, source)
  values (p_org_id, p_order_id, v_author, auth.uid(), p_message, 'app');
end;
$$;


create or replace function public.copy_special_order(
  p_org_id   uuid,
  p_order_id uuid,
  -- What the COPY is: 'order' for Duplicate, 'template' or 'standing_order'
  -- for the two conversions.
  p_kind     text default 'order'
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row      jsonb;
  v_source   record;
  v_number   text;
  v_new_id   uuid;
  v_status   text;
  v_todo     text;
  v_label    text;
  v_message  text;
begin
  -- DEFINER, so it re-checks what RLS would have asked (CLAUDE.md's rule).
  if not user_has_role(p_org_id, array['owner', 'admin', 'purchaser']) then
    raise exception 'You do not have permission to copy this order.'
      using errcode = '42501';
  end if;

  if p_kind not in ('order', 'template', 'standing_order') then
    raise exception 'Unknown kind %', p_kind using errcode = '22023';
  end if;

  select * into v_source
    from special_orders
   where id = p_order_id and org_id = p_org_id;
  if not found then
    raise exception 'That order does not exist, or is not yours to see.'
      using errcode = 'P0002';
  end if;

  -- Decision 3's biconditional, widened by 112 — and the same answers
  -- `lib/createSpecialOrder`'s `startingState` gives, because a record made by
  -- two doors must not start in two states.
  if p_kind = 'order' then
    v_status := 'lead';       v_todo := 'Respond to Email/Call';
  elsif p_kind = 'standing_order' then
    v_status := 'invoice';    v_todo := 'Send Invoice';
  else
    v_status := null;         v_todo := null;
  end if;

  v_number := next_special_order_number(p_org_id);

  -- FROM HERE THE TRIGGERS ARE QUIET. Transaction-local; see the header.
  perform set_config('rf.suppress_order_log', 'on', true);

  v_row := to_jsonb(v_source);
  -- Identity and history do not travel.
  v_row := v_row
    - 'id' - 'number' - 'legacy_id' - 'legacy_seq'
    - 'created_at' - 'updated_at' - 'created_by' - 'updated_by'
    - 'date_initiated' - 'quote_sent_at' - 'quote_returned_at'
    - 'invoice_sent_at' - 'invoice_paid_at' - 'receipt_sent_at'
    - 'delivery_scheduled_at' - 'order_printed_at' - 'order_scheduled_at'
    - 'production_schedule_id' - 'standing_order_id'
    - 'inbound_subject' - 'inbound_message_id' - 'flag_reason'
    - 'source_payload' - 'external_ref';

  v_row := v_row || jsonb_build_object(
    'number', v_number,
    'kind',   p_kind,
    'status', v_status,
    'todo',   v_todo,
    -- A SHAPE HAS NO DAY: `inOrderRange` assumes it, and a template carrying
    -- last August's date would surface in a window it has nothing to do with.
    -- The event TIME stays — 099 copies it onto every day a standing order
    -- makes, so it is the usual hour rather than a fact about one event.
    'event_date', case when p_kind = 'order' then to_jsonb(v_source.event_date) else null end,
    -- Made with no weekdays, so it makes nothing until somebody sets them.
    'standing_days', null,
    'starts_on', null,
    'ends_on',   null,
    'paused',    false,
    'source',    'app',
    'created_by', to_jsonb(auth.uid())
  );

  insert into special_orders
  select * from jsonb_populate_record(null::special_orders, v_row)
  returning id into v_new_id;

  -- The lines travel; the payments emphatically do not.
  insert into special_order_items
  select * from jsonb_populate_recordset(
    null::special_order_items,
    coalesce(
      (select jsonb_agg(
                (to_jsonb(li) - 'id' - 'created_at' - 'updated_at' - 'legacy_key')
                || jsonb_build_object('order_id', to_jsonb(v_new_id)))
         from special_order_items li
        where li.order_id = p_order_id),
      '[]'::jsonb)
  );

  -- THE ONE LINE. A plain insert, not `log_special_order_event`, so the
  -- suppression above does not silence the thing this function exists to say.
  v_label := case v_source.kind
               when 'template'       then 'template'
               when 'standing_order' then 'standing order'
               else 'order'
             end;
  v_message := case
                 when v_source.kind = 'order' and p_kind = 'order'
                   then format('Duplicated from order %s', v_source.number)
                 else format('Created from %s %s', v_label, v_source.number)
               end;

  insert into special_order_events (org_id, order_id, author, author_id, message, source)
  values (
    p_org_id, v_new_id,
    (select m.display_name from org_members m
      where m.user_id = auth.uid() and m.org_id = p_org_id),
    auth.uid(), v_message, 'app');

  return v_new_id;
end;
$$;

comment on function public.copy_special_order(uuid, uuid, text) is
  'Copies an order, template or standing order into a record of the given '
  'kind, in ONE transaction with the log triggers suppressed - so the copy '
  'carries a single line naming where it came from instead of re-enacting the '
  'source''s history. Nothing is ever deleted from the log.';

-- 002's rule: a new public-schema function is executable by `anon` through
-- Supabase's default privileges, and revoking from PUBLIC does not undo that.
revoke all on function public.copy_special_order(uuid, uuid, text) from public;
revoke all on function public.copy_special_order(uuid, uuid, text) from anon;
grant execute on function public.copy_special_order(uuid, uuid, text) to authenticated;
