-- ============================================================================
-- 116 — THE FLAG SAYS WHO RAISED IT, AND CLEARS ITSELF WHEN THE TEAM ARRIVES
--
-- SQL STARTS AT LINE 102. Everything above it is comment.
--
-- Mark, 2026-09-21: "when an order is submitted through the website, it's set
-- to a lead and flagged needs attention… However, it needs to be cleared by
-- hand, which isn't intuitive. Any activity on the record, especially
-- responding to it, adding items, sending quotes, should really clear the flag
-- automatically… Also, when a customer approves a quote, it would be nice if it
-- were flagged again as needing attention… Anything that happens to a record
-- that isn't done by a member of the team should be highlighted in some way -
-- currently that's by setting a flag."
--
-- ----------------------------------------------------------------------------
-- WHAT THE FLAG NOW MEANS
-- ----------------------------------------------------------------------------
-- It has always been one column doing two jobs, and 058 made that visible
-- without naming it. A person raising a flag by hand is recording a PROBLEM —
-- "Resolve Issue" is the to-do that goes with it, and clearing it is a decision
-- somebody makes. A flag the app raises is a NOTICE: something happened from
-- outside and nobody here has seen it yet.
--
-- The two want opposite lifecycles. A notice should die the moment a human
-- engages with the record; a problem should outlive an unrelated edit. So the
-- column gains `flag_source`, and Mark chose (asked, 2026-09-21) that only
-- SYSTEM flags clear themselves.
--
-- ----------------------------------------------------------------------------
-- `flag_source` IS DERIVED, NOT TYPED — AND `auth.uid()` IS THE WHOLE TEST
-- ----------------------------------------------------------------------------
-- A flag written while nobody is signed in came from outside: the inquiry form
-- calls `create_inquiry` as `anon`, the approval page calls
-- `approve_quote_by_token` as `anon`, and both reach this table through a
-- definer where `auth.uid()` is null. A flag written while somebody IS signed
-- in was typed by them.
--
-- So a BEFORE trigger derives it, and NO WRITER HAS TO REMEMBER. That is the
-- design rule 1 lesson applied on purpose: `NewPayPeriod` shipped without
-- `org_id` because every insert had to remember something, and nothing said so
-- when it forgot. Here, `OrderActions.flag` keeps its two-column update
-- untouched and still gets 'person'; `create_inquiry` — 200 lines that would
-- otherwise have to be reproduced in full to add one literal — is not touched
-- at all and still gets 'system'.
--
-- A writer that DOES set `flag_source` in the same statement is believed. That
-- is how the event trigger below says 'system' about an order it is flagging on
-- a customer's behalf, and it is the escape hatch for anything later.
--
-- ----------------------------------------------------------------------------
-- WHAT COUNTS AS THE TEAM ARRIVING: A LOG ENTRY WITH AN AUTHOR
-- ----------------------------------------------------------------------------
-- 054 already writes the order's history from triggers — every watched field on
-- the order, every line added or removed, every payment — and 115's
-- `log_special_order_event` stamps each one with `auth.uid()`. So "any activity
-- on the record" is a row that already exists, and the three things Mark named
-- are all of them: responding writes a note, adding items fires the items
-- trigger, sending a quote inserts its own entry from the edge function.
--
-- Putting the rule on `special_order_events` rather than in the app is the same
-- choice CLAUDE.md already made for price and par logging: one place, and a
-- writer added next month inherits it. An event with no `author_id` — the
-- website's own "Inquiry received", the confirmation `approve-quote` files, a
-- service_role script — is NOT the team arriving and clears nothing.
--
-- ----------------------------------------------------------------------------
-- WHY THIS CANNOT LOOP, WHICH IS THE REAL RISK IN A TRIGGER THAT WRITES
-- ----------------------------------------------------------------------------
-- Both branches update `special_orders.flag_reason`, which is on 054's watch
-- list, so each writes a further event and re-enters this trigger. It settles
-- because the two branches cannot answer each other:
--
--   · CLEARING is `where flag_source = 'system'`. Once cleared the column is
--     null, so the second pass updates no row and writes no event.
--   · SETTING logs "Flag set to …" through `log_special_order_event`, which
--     stamps `auth.uid()` — null on both anon paths. The second pass therefore
--     matches neither branch: not 'customer', and no author.
--
-- And the branches are mutually exclusive by construction: `auth.uid() is null`
-- on one side, `author_id is not null` on the other. A signed-in member who
-- somehow wrote a 'customer' event would fall through to the clear branch,
-- which is harmless rather than a loop.
--
-- ----------------------------------------------------------------------------
-- WHAT IS DELIBERATELY NOT DONE
-- ----------------------------------------------------------------------------
-- · A customer event does NOT overwrite a flag a person raised. The row is
--   already red for the human's own reason, the approval is in the history, and
--   overwriting would replace "deposit never arrived" with "quote approved" and
--   then let the next edit clear it. Highlighted is the requirement; louder is
--   not.
-- · The website's "Inquiry received from the website" event keeps `source =
--   'app'`. Relabelling it 'customer' would mean reproducing `create_inquiry`
--   in full to change one literal, and it would change nothing: the order is
--   already flagged 'New Inquiry' by its own insert.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. THE COLUMN
-- ----------------------------------------------------------------------------
alter table special_orders
  add column if not exists flag_source text;

alter table special_orders
  drop constraint if exists special_orders_flag_source_check;
alter table special_orders
  add constraint special_orders_flag_source_check
  check (flag_source is null or flag_source in ('system', 'person'));

comment on column special_orders.flag_source is
  'Who raised the flag: system (arrived from outside — a new inquiry, a '
  'customer approval) or person (typed by a member). DERIVED by '
  'trg_special_orders_flag_source from auth.uid(); do not write it by hand '
  'unless you mean to override that.';


-- ----------------------------------------------------------------------------
-- 2. THE BACKFILL
-- ----------------------------------------------------------------------------
-- Measured 2026-09-21 before writing this: 2 flagged orders out of 8,362, both
-- 'New Inquiry'. The `case` is written for the general shape anyway, because a
-- backfill that only handles the rows you happened to look at is the one that
-- surprises somebody later.
update special_orders
   set flag_source = case when flag_reason = 'New Inquiry' then 'system' else 'person' end
 where flag_reason is not null
   and flag_source is null;

-- THE INVARIANT, STATED SO IT CANNOT DRIFT — and added AFTER the backfill
-- rather than beside the column, because a CHECK validates the rows already
-- there: declared first it would have refused the two flagged orders for the
-- very gap the line above exists to fill.
--
-- It is a backstop rather than a gate: the BEFORE trigger below runs first, so
-- this can only ever fail if that trigger is dropped.
alter table special_orders
  drop constraint if exists special_orders_flag_source_paired;
alter table special_orders
  add constraint special_orders_flag_source_paired
  check ((flag_reason is null) = (flag_source is null));


-- ----------------------------------------------------------------------------
-- 3. DERIVING IT
-- ----------------------------------------------------------------------------
create or replace function public.trg_special_order_flag_source()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.flag_reason is null then
    -- No flag, no source. This is also what makes clearing safe from any
    -- writer: the batch action's `update … set flag_reason = null` needs to
    -- know nothing about this column.
    new.flag_source := null;

  elsif tg_op = 'INSERT' then
    if new.flag_source is null then
      new.flag_source := case when auth.uid() is null then 'system' else 'person' end;
    end if;

  elsif new.flag_reason is distinct from old.flag_reason
        and new.flag_source is not distinct from old.flag_source then
    -- The flag changed and the writer said nothing about its source, so the
    -- session answers for it.
    new.flag_source := case when auth.uid() is null then 'system' else 'person' end;
  end if;

  return new;
end;
$$;

revoke all on function public.trg_special_order_flag_source() from public, anon, authenticated;

drop trigger if exists trg_special_orders_flag_source on special_orders;
create trigger trg_special_orders_flag_source
  before insert or update on special_orders
  for each row execute function trg_special_order_flag_source();


-- ----------------------------------------------------------------------------
-- 4. AN EVENT MAY COME FROM THE CUSTOMER
-- ----------------------------------------------------------------------------
-- 051 allowed 'filemaker', 'app' and 'manual'. None of them says "this happened
-- to us", which is the distinction the whole change rests on.
--
-- DROPPED BY WHAT IT SAYS, NOT BY WHAT IT IS PROBABLY CALLED. 051 wrote the
-- check INLINE on the column, so its name is Postgres's own invention. It is
-- almost certainly `special_order_events_source_check` — but "almost
-- certainly" fails SILENTLY here in the worst way: a `drop … if exists` on a
-- name that does not match drops nothing, the `add` below succeeds beside the
-- original, and the OLD constraint still refuses 'customer'. The first thing
-- anyone would learn is a customer failing to approve a quote.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'special_order_events'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%source%'
  loop
    execute format('alter table special_order_events drop constraint %I', c.conname);
  end loop;
end $$;

alter table special_order_events
  add constraint special_order_events_source_check
  check (source in ('filemaker', 'app', 'manual', 'customer'));

-- And PROVE it, rather than assuming the loop found the right thing. A failure
-- here rolls the statement back with a sentence instead of leaving a schema
-- that looks migrated and refuses approvals.
do $$
begin
  if (select count(*) from pg_constraint
       where conrelid = 'special_order_events'::regclass
         and contype = 'c'
         and pg_get_constraintdef(oid) ilike '%source%'
         and pg_get_constraintdef(oid) not ilike '%customer%') > 0 then
    raise exception
      'a check constraint on special_order_events.source still refuses ''customer''';
  end if;
end $$;


-- ----------------------------------------------------------------------------
-- 5. THE APPROVAL SAYS SO
-- ----------------------------------------------------------------------------
-- 052's function reproduced IN FULL — 055's rule, because 052 is APPLIED and a
-- file that no longer describes what was run is how the harness and production
-- quietly stop being the same database. Changed in EXACTLY ONE PLACE: the
-- event's `source`, 'app' -> 'customer', marked below.
create or replace function public.approve_quote_by_token(
  p_token text,
  p_name  text,
  p_meta  jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
begin
  if p_token is null or length(p_token) < 16 then
    return jsonb_build_object('state', 'unknown');
  end if;

  -- The typed name IS the signature (ESIGN/UETA clickwrap), so an empty one is
  -- refused rather than recorded as an anonymous approval.
  if v_name is null then
    return jsonb_build_object('state', 'name_required');
  end if;

  update special_order_quote_tokens
     set approved_at   = now(),
         approved_name = v_name,
         approved_meta = coalesce(p_meta, '{}'::jsonb)
   where token = p_token
     and approved_at is null
     and superseded_at is null
     and document_snapshot is not null
   returning * into t;

  if not found then
    -- Say WHICH of the three it was, by reading the row back. A single "this
    -- link is no longer valid" reads as a broken app to somebody who has just
    -- signed something.
    select * into t from special_order_quote_tokens where token = p_token;
    if not found or t.document_snapshot is null then
      return jsonb_build_object('state', 'unknown');
    elsif t.approved_at is not null then
      return jsonb_build_object(
        'state', 'already_approved',
        'approved_at', t.approved_at,
        'approved_name', t.approved_name
      );
    else
      return jsonb_build_object('state', 'superseded');
    end if;
  end if;

  update special_orders
     set quote_returned_at = coalesce(quote_returned_at, current_date)
   where id = t.order_id;

  insert into special_order_events (org_id, order_id, message, author, source)
  values (
    t.org_id,
    t.order_id,
    format('Quote approved online by %s', v_name),
    v_name,
    'customer'   -- <<< 116: was 'app'. This is what raises the flag.
  );

  return jsonb_build_object(
    'state', 'approved',
    'order_id', t.order_id,
    'org_id', t.org_id,
    'approved_at', t.approved_at,
    'approved_name', t.approved_name
  );
end;
$$;

-- 052's grants are preserved by `create or replace` and the argument list is
-- unchanged, so nothing here re-states them — changing the arguments would
-- create an OVERLOAD and leave 052's version live beside this one, which is
-- 033's lesson about `freeze_pay_period`.


-- ----------------------------------------------------------------------------
-- 6. THE RULE ITSELF
-- ----------------------------------------------------------------------------
create or replace function public.trg_special_order_event_flag()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.source = 'customer' and auth.uid() is null then
    -- SOMETHING HAPPENED FROM OUTSIDE. The event's own sentence is the flag,
    -- so the red row says what it was rather than "Resolve Issue".
    --
    -- `flag_source is distinct from 'person'` is the deliberate refusal at the
    -- head of this file: a human's flag is not overwritten, and the row is
    -- already red either way.
    update special_orders
       set flag_reason = new.message,
           flag_source = 'system'
     where id = new.order_id
       and flag_source is distinct from 'person'
       and (flag_reason is distinct from new.message or flag_source is distinct from 'system');

  elsif new.author_id is not null then
    -- THE TEAM ARRIVED. Only a notice clears; a problem somebody recorded by
    -- hand keeps its own Resolve command.
    update special_orders
       set flag_reason = null,
           flag_source = null
     where id = new.order_id
       and flag_source = 'system';
  end if;

  return null;
end;
$$;

revoke all on function public.trg_special_order_event_flag() from public, anon, authenticated;

drop trigger if exists trg_special_order_events_flag on special_order_events;
create trigger trg_special_order_events_flag
  after insert on special_order_events
  for each row execute function trg_special_order_event_flag();


notify pgrst, 'reload schema';


-- ----------------------------------------------------------------------------
-- After this, these should read:
-- ----------------------------------------------------------------------------
--   select flag_reason, flag_source, count(*)
--     from special_orders where flag_reason is not null
--    group by 1, 2;
--     -> every row has a source, and the two 'New Inquiry' ones say 'system'
--
--   select count(*) from special_orders
--    where (flag_reason is null) <> (flag_source is null);
--     -> 0
--
--   select conname from pg_constraint
--    where conrelid = 'special_order_events'::regclass and conname like '%source%';
--     -> special_order_events_source_check  (now allowing 'customer')
--
--   select public.approve_quote_by_token('nope', 'A Name');
--     -> {"state": "unknown"}               (unchanged, and proves the replace)
--
-- And the behaviour, on a scratch order — each step one statement:
--   update special_orders set flag_reason = 'Test' where id = :id;
--     -> flag_source = 'person'             (you are signed in)
--   insert into special_order_events (org_id, order_id, message, author_id, source)
--        values (:org, :id, 'poke', auth.uid(), 'app');
--     -> flag SURVIVES                      (a person's flag is not auto-cleared)
--   update special_orders set flag_reason = null where id = :id;
--   insert into special_order_events (org_id, order_id, message, source)
--        values (:org, :id, 'Quote approved online by Test', 'customer');
--     -> flag_reason = 'Quote approved online by Test', flag_source = 'system'
--   insert into special_order_events (org_id, order_id, message, author_id, source)
--        values (:org, :id, 'poke', auth.uid(), 'app');
--     -> flag CLEARED, and exactly one further event was written
-- ----------------------------------------------------------------------------
