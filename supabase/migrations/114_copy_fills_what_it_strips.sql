-- ============================================================================
-- 114 — THE COPY FILLS WHAT IT STRIPS
--
-- 113's `copy_special_order` NEVER RAN. Mark, 2026-09-21, having applied it and
-- made a template: "adding item log entries are still being recorded between
-- 'Created from Order N' and 'Template Created'." Three entries where there
-- should be one — which is the app's CLIENT-SIDE fallback, exactly, and
-- therefore proof that the function had failed and the fallback had swallowed
-- it.
--
-- ----------------------------------------------------------------------------
-- WHAT WENT WRONG: A STRIPPED KEY IS AN EXPLICIT NULL
-- ----------------------------------------------------------------------------
-- 113 built the copy as `to_jsonb(source)` minus the keys that must not travel,
-- then `insert into special_orders select * from jsonb_populate_record(...)`.
-- A key REMOVED from the jsonb comes back out of `jsonb_populate_record` as
-- NULL — and a NULL in an INSERT is not an absent column, it is an explicit
-- NULL, which OVERRIDES the column's DEFAULT. So the first insert hit
--
--     null value in column "id" violates not-null constraint
--
-- and the same was waiting for `legacy_seq integer not null default 1`,
-- `created_at` and `updated_at`. The four columns 113 most wanted to leave
-- behind are precisely the four that cannot be left behind.
--
-- NOTHING IS WRONG WITH THE `to_jsonb` APPROACH — a column added next year
-- still travels on its own, which a column list could never do. What was wrong
-- is that "do not copy this" and "this may be null" were treated as one idea.
-- They are two: identity and timestamps must be REPLACED, everything else may
-- simply be dropped. This sets all four explicitly and drops the rest, so the
-- class of bug is gone rather than the instance of it.
--
-- The same applies to `special_order_items`, whose own `id`, `created_at` and
-- `updated_at` were stripped the same way — and `gen_random_uuid()` is volatile
-- so it is evaluated per row inside the aggregate, giving each line its own.
--
-- THE LIST WAS TAKEN FROM THE DATABASE, NOT FROM READING. `information_schema`
-- was asked which columns on both tables are NOT NULL, and every one of them is
-- either carried through untouched or replaced here. Doing it the other way —
-- reading the DDL and deciding — is what produced 113, and then produced the
-- SECOND instance of the same bug (`external_ref jsonb not null default '{}'`)
-- in the first draft of this file. A throwaway Postgres running the real DDL
-- found it in a second; nothing else had, in two passes of careful reading.
--
-- EVERYTHING ELSE IS 113 VERBATIM: the transaction-local suppression, the one
-- provenance line, the kind rules. Read the diff against 113, not this file.
--
-- Run in the Supabase SQL editor. RERUNNABLE (`create or replace`).
-- THE SQL STARTS ON THE LINE AFTER THIS ONE.
-- ============================================================================

create or replace function public.copy_special_order(
  p_org_id   uuid,
  p_order_id uuid,
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
  v_new_id   uuid := gen_random_uuid();
  v_now      timestamptz := now();
  v_status   text;
  v_todo     text;
  v_label    text;
  v_message  text;
  v_author   text;
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

  -- Decision 3's biconditional, widened by 112 — the same answers
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

  -- FROM HERE THE TRIGGERS ARE QUIET. Transaction-local, so it cannot leak to
  -- the next request sharing the pooled connection.
  perform set_config('rf.suppress_order_log', 'on', true);

  v_row := to_jsonb(v_source);

  -- DROPPED: history, the stage dates, the schedule link, the recurrence's
  -- parent, the inbound provenance. Every one of these is NULLABLE, which is
  -- what makes dropping them safe — see the header.
  v_row := v_row
    - 'legacy_id'
    - 'created_by' - 'updated_by'
    - 'date_initiated' - 'quote_sent_at' - 'quote_returned_at'
    - 'invoice_sent_at' - 'invoice_paid_at' - 'receipt_sent_at'
    - 'delivery_scheduled_at' - 'order_printed_at' - 'order_scheduled_at'
    - 'production_schedule_id' - 'standing_order_id'
    - 'inbound_subject' - 'inbound_message_id' - 'flag_reason'
    - 'source_payload';

  -- REPLACED: the four NOT NULL columns that carry a DEFAULT, plus everything
  -- the new kind decides. A stripped key would arrive as an explicit NULL and
  -- take the default with it.
  v_row := v_row || jsonb_build_object(
    'id',           to_jsonb(v_new_id),
    'legacy_seq',   1,
    'created_at',   to_jsonb(v_now),
    'updated_at',   to_jsonb(v_now),
    'created_by',   to_jsonb(auth.uid()),
    -- NOT NULL with a default, like the four above, and so it must be REPLACED
    -- rather than dropped. It is the QuickBooks mapping and belongs to the
    -- document that was pushed, not to a copy of it.
    'external_ref', '{}'::jsonb,
    'number',     v_number,
    'kind',       p_kind,
    'status',     v_status,
    'todo',       v_todo,
    -- A SHAPE HAS NO DAY: `inOrderRange` assumes it, and a template carrying
    -- last August's date would surface in a window it has nothing to do with.
    -- The event TIME stays — 099 copies it onto every day a standing order
    -- makes, so it is the usual hour rather than a fact about one event.
    'event_date', case when p_kind = 'order' then to_jsonb(v_source.event_date) else null end,
    -- Made with no weekdays, so it makes nothing until somebody sets them.
    'standing_days', null,
    'starts_on',     null,
    'ends_on',       null,
    'paused',        false,
    'source',        'app'
  );

  insert into special_orders
  select * from jsonb_populate_record(null::special_orders, v_row);

  -- The lines travel; the payments emphatically do not. `gen_random_uuid()` is
  -- volatile, so each row inside the aggregate gets its own.
  insert into special_order_items
  select * from jsonb_populate_recordset(
    null::special_order_items,
    coalesce(
      (select jsonb_agg(
                (to_jsonb(li) - 'legacy_key')
                || jsonb_build_object(
                     'id',         to_jsonb(gen_random_uuid()),
                     'created_at', to_jsonb(v_now),
                     'updated_at', to_jsonb(v_now),
                     'order_id',   to_jsonb(v_new_id)))
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

  -- `select into`, not a scalar subquery: it takes the first row where a
  -- subquery RAISES on a second one, which is how `log_special_order_event`
  -- has always read the same name. A membership table with two rows for one
  -- person is not supposed to happen, and a copy failing outright is not the
  -- way to find out that it has.
  select m.display_name into v_author
    from org_members m
   where m.user_id = auth.uid() and m.org_id = p_org_id;

  insert into special_order_events (org_id, order_id, author, author_id, message, source)
  values (p_org_id, v_new_id, v_author, auth.uid(), v_message, 'app');

  return v_new_id;
end;
$$;

comment on function public.copy_special_order(uuid, uuid, text) is
  'Copies an order, template or standing order into a record of the given '
  'kind, in ONE transaction with the log triggers suppressed - so the copy '
  'carries a single line naming where it came from. 114 fixes 113, which '
  'stripped four NOT NULL columns and so never ran.';

revoke all on function public.copy_special_order(uuid, uuid, text) from public;
revoke all on function public.copy_special_order(uuid, uuid, text) from anon;
grant execute on function public.copy_special_order(uuid, uuid, text) to authenticated;
