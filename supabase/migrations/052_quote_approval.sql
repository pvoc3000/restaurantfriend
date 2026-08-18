-- ============================================================================
-- 052 — THE CUSTOMER APPROVES THE QUOTE ON A PUBLIC PAGE
-- ============================================================================
-- Decision 17 of docs/special-orders-brief.md (Mark, 2026-08-16: print / sign /
-- scan / return "is difficult for a lot of people and I'd like to implement
-- something slicker/easier.")
--
-- Migration 051 created `special_order_quote_tokens` and said the two RPCs
-- would "arrive with phase 3, when there is a document for a token to be bound
-- to". This is that.
--
-- ----------------------------------------------------------------------------
-- WHAT MAKES A PUBLIC ROUTE IN AN AUTH-GATED APP SOUND
-- ----------------------------------------------------------------------------
-- The token is a 128-bit capability URL — the same trust class as a signed
-- storage URL, and the same one an emailed invite link already is. What makes
-- that acceptable is not the entropy, it is WHAT THE TOKEN CAN REACH:
--
--   · `quote_by_token` reads ONE ROW of ONE TABLE and returns a jsonb snapshot
--     that was written when the quote was emailed. It does not read
--     `special_orders`, `customers`, `special_order_items` or anything else. A
--     leaked token exposes exactly the piece of paper that was already sent to
--     the customer's own inbox.
--   · `approve_quote_by_token` writes the approval, stamps one date on one
--     order and appends one log row. It cannot change money, lines or status.
--
-- Both are `security definer` and both are DELIBERATELY GRANTED TO `anon`,
-- which inverts migration 002's revoke rule on purpose, in exactly these two
-- places. Nothing else in the schema becomes reachable: every table policy
-- still names supervisor+, and neither function is a general query.
--
-- ----------------------------------------------------------------------------
-- WHY THE SNAPSHOT IS A COLUMN
-- ----------------------------------------------------------------------------
-- Money is DERIVED live (decision 6), so the order can change after a quote
-- goes out — a line added on Tuesday must not silently change what the
-- customer agreed to on Monday. 051 bound the token to `document_path`, the
-- PDF that was actually emailed, which is the right artifact and the wrong
-- thing to READ from: it lives in a private bucket, and a definer function
-- cannot mint a signed URL.
--
-- So the token also carries `document_snapshot` — the same assembled document
-- the PDF was rendered from, as jsonb. The approval page renders THAT. Two
-- consequences, both wanted: the page shows exactly the quote that was sent
-- rather than a live re-derivation, and the anon function needs to reach no
-- other table at all.
-- ============================================================================

alter table special_order_quote_tokens
  add column if not exists document_snapshot jsonb;

comment on column special_order_quote_tokens.document_snapshot is
  'The assembled quote as it was rendered and emailed — what /q/{token} shows. '
  'Written at send time beside document_path, which is the PDF itself.';


-- ----------------------------------------------------------------------------
-- 1. READ
-- ----------------------------------------------------------------------------
-- Returns a single jsonb object, always — never a row set and never an error
-- for a bad token. A function that RAISED on an unknown token would let anyone
-- probe which tokens exist by watching the difference between an error and an
-- empty answer; `{"state": "unknown"}` says the same thing to everybody.
--
-- The states are the four things a link can be, and each is a different
-- sentence on the page:
--
--   unknown     no such token, or one that was never bound to a document
--   superseded  a later quote was sent — "check your email for the current one"
--   approved    already signed; shows who and when, so a second tap is not a
--               failure but a receipt
--   open        the live one
create or replace function public.quote_by_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
begin
  if p_token is null or length(p_token) < 16 then
    return jsonb_build_object('state', 'unknown');
  end if;

  select * into t
    from special_order_quote_tokens
   where token = p_token;

  -- A token with no snapshot is one whose compose card was opened and then
  -- cancelled: it was minted so the link in the draft body would be real, and
  -- nothing was ever sent. It must read as unknown, not as an empty quote.
  if not found or t.document_snapshot is null then
    return jsonb_build_object('state', 'unknown');
  end if;

  if t.approved_at is not null then
    return jsonb_build_object(
      'state', 'approved',
      'approved_at', t.approved_at,
      'approved_name', t.approved_name,
      'quote', t.document_snapshot
    );
  end if;

  -- Superseded is checked AFTER approved on purpose: a quote that was approved
  -- and then revised should still show its approval to the person who signed
  -- it, rather than telling them their signature went nowhere.
  if t.superseded_at is not null then
    return jsonb_build_object('state', 'superseded');
  end if;

  return jsonb_build_object('state', 'open', 'quote', t.document_snapshot);
end;
$$;


-- ----------------------------------------------------------------------------
-- 2. APPROVE
-- ----------------------------------------------------------------------------
-- A token is SPENT by approval. The update is guarded in its own WHERE clause
-- rather than by a preceding SELECT, so two taps racing each other cannot both
-- succeed — the second changes zero rows and is told the quote is already
-- approved, which is the truth and is also what a customer double-tapping on a
-- phone should see.
--
-- It stamps `quote_returned_at` on the order and appends a log entry, both as
-- the definer. That is the whole of its reach into the rest of the schema, and
-- it is deliberately narrow: no status change, no money, no lines. Whether an
-- approved quote becomes an invoice is a decision a person makes.
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
    'app'
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


-- ----------------------------------------------------------------------------
-- 3. GRANTS — the deliberate inversion
-- ----------------------------------------------------------------------------
-- Migration 002's rule is that every new public function is executable by
-- `anon` through Supabase's defaults and must be revoked BY NAME. These two are
-- the exception the rule exists to make visible: revoke from everyone, then
-- grant back to exactly the roles that should have them, so the grant is a
-- statement rather than an oversight.
revoke all on function public.quote_by_token(text) from public, anon, authenticated;
revoke all on function public.approve_quote_by_token(text, text, jsonb)
  from public, anon, authenticated;

grant execute on function public.quote_by_token(text) to anon, authenticated;
grant execute on function public.approve_quote_by_token(text, text, jsonb)
  to anon, authenticated;


notify pgrst, 'reload schema';


-- ----------------------------------------------------------------------------
-- After this, these should read:
-- ----------------------------------------------------------------------------
--   select public.quote_by_token('nope');
--     -> {"state": "unknown"}          (and NOT an error — see above)
--
--   select public.approve_quote_by_token('nope', 'A Name');
--     -> {"state": "unknown"}
--
--   select column_name from information_schema.columns
--    where table_name = 'special_order_quote_tokens'
--      and column_name = 'document_snapshot';        -> 1 row
--
-- And the two that prove the grant landed the way it was meant to, which is
-- the whole security argument of this migration — run them as `anon`:
--
--   set local role anon;
--   select public.quote_by_token('nope');            -> works
--   select count(*) from special_order_quote_tokens; -> 0 rows (RLS, no policy
--                                                       names the public)
--   select count(*) from special_orders;             -> 0 rows
--   select public.next_special_order_number(...);    -> permission denied
--
-- Checked by BREAKING each rule:
--   · a token with `document_snapshot` null reads `unknown`, not an empty quote;
--   · approving twice returns `already_approved` with the first name and time,
--     and the second call changes ZERO rows;
--   · a superseded token cannot be approved;
--   · an empty typed name is refused before anything is written.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- VERIFIED ON A POSTGRES 15 STUB, 2026-08-17
-- ----------------------------------------------------------------------------
-- Replayed against a minimal stand-in for the three tables it touches (the full
-- 52-migration stack needs the Supabase storage stub, which this migration does
-- not go near), and every rule checked by BREAKING it:
--
--   quote_by_token       unknown token → {"state":"unknown"}, and so do a
--                        garbage one, a null, and a token that was MINTED BUT
--                        NEVER SENT — the last is the one that matters, since
--                        it is what a cancelled compose card leaves behind;
--                        superseded → {"state":"superseded"};
--                        live → {"state":"open"} with the snapshot.
--   approve_by_token     an empty name is refused BEFORE anything is written
--                        ("name_required"); an unknown, unsent or superseded
--                        token is refused by name; a real one approves, stamps
--                        `quote_returned_at`, and writes exactly one log entry
--                        reading "Quote approved online by Alexandra David".
--                        A SECOND call returns `already_approved` carrying the
--                        FIRST name and time, and changes nothing — the guard
--                        is in the UPDATE's own WHERE clause, so two taps
--                        racing on a phone cannot both win.
--   the subtle one       an approved token that is LATER superseded still
--                        reports `approved`. Checking superseded first would
--                        tell the person who signed it that their signature
--                        went nowhere.
--   the grants           `prosecdef` true on both, EXECUTE held by `anon` and
--                        `authenticated` and NOT by `PUBLIC` — the deliberate
--                        inversion of 002, and visible as one.
-- ----------------------------------------------------------------------------
