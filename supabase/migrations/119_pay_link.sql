-- ============================================================================
-- 119 — THE CUSTOMER PAYS THE INVOICE ON A PUBLIC PAGE
--
-- SQL STARTS AT LINE 75. Everything above it is comment.
--
-- Mark, 2026-09-22: Square collects everything that is not a shop sale, on OUR
-- page, through Square's Web Payments SDK. Not a Square invoice: Square's own
-- docs say "You cannot use Square APIs such as PayOrder or CreatePayment to
-- process a payment for an order that is associated with an invoice", so an
-- invoice Square hosts can only be paid on Square's page. The invoice is ours,
-- so the page is. The decision is in CLAUDE.md's customer-invoices thread.
--
-- ----------------------------------------------------------------------------
-- THE SHAPE IS 052's, DELIBERATELY
-- ----------------------------------------------------------------------------
-- A 128-bit capability URL (`/pay/{token}`), minted when the invoice's compose
-- card opens, bound to a snapshot of the document at send, superseded when a
-- later invoice goes out. Read and claimed by `anon` through definer functions
-- that never raise on a bad token. Nothing else in the schema opens to the
-- public.
--
-- It reaches ONE step further than 052, and on purpose: `pay_by_token` reads
-- `special_order_payments` to sum what has been paid, and `special_orders` for
-- `status` and `ignore_balance`. It returns a number and a state, never a row.
--
-- ----------------------------------------------------------------------------
-- THE AMOUNT: SNAPSHOT TOTAL − LIVE PAYMENTS
-- ----------------------------------------------------------------------------
-- Money is derived live (decision 6) and in TypeScript (`orderTotals`), which
-- SQL cannot call. Re-deriving it here would be a second implementation of tax
-- and discount waiting to disagree with the first. So the TOTAL is snapshotted
-- at send, from the same `orderTotals` the PDF printed — the trust level
-- `push_invoice` already accepts — and the PAYMENTS are summed live:
--
--   · a deposit recorded by hand after the invoice went out shrinks what the
--     link charges, which is the case that matters;
--   · an order EDITED after sending is not reflected until the invoice is
--     re-sent, which supersedes this link — the same rule, and the same
--     sentence to the customer, as a revised quote.
--
-- The customer cannot choose the amount (Mark, 2026-09-22: the balance due).
--
-- ----------------------------------------------------------------------------
-- THE CLAIM: TWO TABS MUST NOT BOTH CHARGE
-- ----------------------------------------------------------------------------
-- Square's idempotency key stops ONE attempt being charged twice. It cannot
-- stop two different attempts — two tabs, a spouse on another phone — each
-- charging the full balance, because each sees the same balance before either
-- records. `claim_pay_token` takes the token for two minutes with a guarded
-- UPDATE (052's race pattern) and the edge function charges only after it
-- wins. `record_pay_link_payment` releases it. An abandoned claim expires on
-- its own; nothing has to clean it up.
--
-- ----------------------------------------------------------------------------
-- RECORDING IS service_role ONLY
-- ----------------------------------------------------------------------------
-- `record_pay_link_payment` writes MONEY, so unlike the two readers it is NOT
-- granted to anon: the only caller is `square-pay`, after Square has said the
-- payment completed. An anon caller could otherwise record a payment nobody
-- made. The unique index below makes the function's retry safe — one Square
-- payment id can be booked once.
--
-- It stamps `invoice_paid_at` when the balance reaches zero, and ONLY then —
-- the rule `OrderPayments` and the batch Record Payment already follow, so a
-- deposit never stamps it. It does NOT move `status` from invoice to order:
-- whether a paid invoice becomes a production order is a person's decision,
-- as 052 said of an approved quote.
--
-- The `special_order_payments` log trigger (054) writes the history line
-- ("Payment of $120.00 recorded · Square Online"), so this adds no event of
-- its own.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. THE TOKEN
-- ----------------------------------------------------------------------------
create table if not exists special_order_pay_tokens (
  id       uuid primary key default gen_random_uuid(),
  org_id   uuid not null references orgs(id) on delete cascade,
  order_id uuid not null references special_orders(id) on delete cascade,

  token text not null unique,

  -- Written at send, BEFORE the email goes (052's order): what /pay/{token}
  -- renders. Null means the compose card was opened and never sent, which
  -- reads as unknown.
  document_snapshot jsonb,
  -- The invoice total the snapshot printed. A column, not a jsonb path, so the
  -- functions below never parse a document to find money.
  total numeric(10,2),

  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),

  -- A later invoice was sent.
  superseded_at timestamptz,

  -- Held by `square-pay` while a charge is in flight. See the header.
  claimed_until timestamptz
);

create index if not exists special_order_pay_tokens_order_idx
  on special_order_pay_tokens (order_id, created_at desc);

alter table special_order_pay_tokens enable row level security;

-- Supervisor+, like the quote tokens (051). `anon` reaches this table only
-- through the definer functions below.
create policy special_order_pay_tokens_select on special_order_pay_tokens for select
  using (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']));

create policy special_order_pay_tokens_insert on special_order_pay_tokens for insert
  with check (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']));

create policy special_order_pay_tokens_update on special_order_pay_tokens for update
  using      (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']))
  with check (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']));

create policy special_order_pay_tokens_delete on special_order_pay_tokens for delete
  using (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']));


-- ----------------------------------------------------------------------------
-- 2. ONE SQUARE PAYMENT IS BOOKED ONCE
-- ----------------------------------------------------------------------------
-- Probed 2026-09-22: of 6,480 payments none carries an external_ref, so this
-- cannot fail on existing rows. Scoped to 'Square Online' so a future reference
-- of another kind (a QuickBooks payment id) is not held to it.
create unique index if not exists special_order_payments_square_ref
  on special_order_payments (org_id, external_ref)
  where payment_type = 'Square Online' and external_ref is not null;


-- ----------------------------------------------------------------------------
-- 3. THE STATE OF A LINK — shared by the reader and the claim
-- ----------------------------------------------------------------------------
-- Not granted to anyone: an internal helper, so the two public functions cannot
-- disagree about what "paid" means.
create or replace function public.pay_token_state(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  t   record;
  o   record;
  v_paid numeric(10,2);
begin
  if p_token is null or length(p_token) < 16 then
    return jsonb_build_object('state', 'unknown');
  end if;

  select * into t from special_order_pay_tokens where token = p_token;
  if not found or t.document_snapshot is null or t.total is null then
    return jsonb_build_object('state', 'unknown');
  end if;

  select status, ignore_balance into o from special_orders where id = t.order_id;
  if not found then
    return jsonb_build_object('state', 'unknown');
  end if;

  select coalesce(sum(amount), 0) into v_paid
    from special_order_payments where order_id = t.order_id;

  -- PAID is checked before superseded, 052's reasoning about approval: someone
  -- opening an old link to a settled order should read that it is settled.
  if o.ignore_balance or t.total - v_paid <= 0 then
    return jsonb_build_object(
      'state', 'paid',
      'invoice', t.document_snapshot,
      'total', t.total,
      'paid', v_paid
    );
  end if;

  if o.status = 'cancelled' then
    return jsonb_build_object('state', 'cancelled');
  end if;

  if t.superseded_at is not null then
    return jsonb_build_object('state', 'superseded');
  end if;

  return jsonb_build_object(
    'state', 'open',
    'invoice', t.document_snapshot,
    'total', t.total,
    'paid', v_paid,
    'balance', t.total - v_paid,
    'org_id', t.org_id,
    'order_id', t.order_id,
    'claimed_until', t.claimed_until
  );
end;
$$;


-- ----------------------------------------------------------------------------
-- 4. READ (anon)
-- ----------------------------------------------------------------------------
-- The state plus what Square's SDK needs in the browser: the application id,
-- the location id and which environment. These are PUBLIC by Square's own
-- design — they are in the page source of every Square-powered checkout — and
-- they are org configuration, so they live in `orgs.settings.square_payments`
-- (design rule 2). Missing configuration returns `square: null`, and the page
-- says online payment is unavailable rather than breaking.
create or replace function public.pay_by_token(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s jsonb := pay_token_state(p_token);
  v_cfg jsonb;
begin
  if s ->> 'state' <> 'open' then
    return s;
  end if;

  select settings -> 'square_payments' into v_cfg
    from orgs where id = (s ->> 'org_id')::uuid;

  -- The ids stay inside the function: the page has no use for them.
  return (s - 'org_id' - 'order_id' - 'claimed_until') || jsonb_build_object(
    'square',
    case
      when coalesce(v_cfg ->> 'application_id', '') = ''
        or coalesce(v_cfg ->> 'location_id', '') = '' then null
      else jsonb_build_object(
        'environment', coalesce(v_cfg ->> 'environment', 'production'),
        'application_id', v_cfg ->> 'application_id',
        'location_id', v_cfg ->> 'location_id'
      )
    end
  );
end;
$$;


-- ----------------------------------------------------------------------------
-- 5. CLAIM (anon — called by `square-pay` with the anon key)
-- ----------------------------------------------------------------------------
-- Returns `claimed` with the amount to charge, or the state that refused it,
-- or `busy` if another attempt holds the token. The balance is re-read AFTER
-- the claim is won, so a payment recorded between the page loading and the
-- button being pressed is not charged again.
create or replace function public.claim_pay_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s jsonb := pay_token_state(p_token);
  v_cfg jsonb;
begin
  if s ->> 'state' <> 'open' then
    return s;
  end if;

  update special_order_pay_tokens
     set claimed_until = now() + interval '2 minutes'
   where token = p_token
     and (claimed_until is null or claimed_until < now());
  if not found then
    return jsonb_build_object('state', 'busy');
  end if;

  s := pay_token_state(p_token);
  if s ->> 'state' <> 'open' then
    update special_order_pay_tokens set claimed_until = null where token = p_token;
    return s;
  end if;

  select settings -> 'square_payments' into v_cfg
    from orgs where id = (s ->> 'org_id')::uuid;

  return jsonb_build_object(
    'state', 'claimed',
    'org_id', s -> 'org_id',
    'order_id', s -> 'order_id',
    'number', s -> 'invoice' -> 'number',
    'balance', s -> 'balance',
    'location_id', v_cfg -> 'location_id'
  );
end;
$$;


-- ----------------------------------------------------------------------------
-- 6. RELEASE (anon) — a charge that Square declined gives the token back
-- ----------------------------------------------------------------------------
-- Only clears a claim; it cannot create one or touch money. Without it a
-- declined card would lock the customer out for two minutes.
create or replace function public.release_pay_token(p_token text)
returns void
language sql
security definer
set search_path = public
as $$
  update special_order_pay_tokens set claimed_until = null
   where token = p_token and length(p_token) >= 16;
$$;


-- ----------------------------------------------------------------------------
-- 7. RECORD (service_role only)
-- ----------------------------------------------------------------------------
create or replace function public.record_pay_link_payment(
  p_token             text,
  p_amount            numeric,
  p_square_payment_id text,
  p_note              text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
  v_today date;
  v_paid numeric(10,2);
  v_inserted int;
begin
  select * into t from special_order_pay_tokens where token = p_token;
  if not found then
    return jsonb_build_object('state', 'unknown');
  end if;
  if coalesce(p_amount, 0) <= 0 or coalesce(btrim(p_square_payment_id), '') = '' then
    return jsonb_build_object('state', 'invalid');
  end if;

  select (now() at time zone coalesce(settings ->> 'timezone', 'America/Los_Angeles'))::date
    into v_today from orgs where id = t.org_id;

  -- DESIGN RULE 1: org_id explicitly. The conflict target is the unique index
  -- above, so a retry of the same Square payment is a no-op and says so.
  insert into special_order_payments
    (org_id, order_id, paid_on, amount, payment_type, note, external_ref)
  values
    (t.org_id, t.order_id, v_today, p_amount, 'Square Online',
     nullif(btrim(coalesce(p_note, '')), ''), p_square_payment_id)
  on conflict (org_id, external_ref)
    where payment_type = 'Square Online' and external_ref is not null
  do nothing;
  get diagnostics v_inserted = row_count;

  update special_order_pay_tokens set claimed_until = null where id = t.id;

  select coalesce(sum(amount), 0) into v_paid
    from special_order_payments where order_id = t.order_id;

  if t.total - v_paid <= 0 then
    update special_orders
       set invoice_paid_at = coalesce(invoice_paid_at, v_today)
     where id = t.order_id;
  end if;

  return jsonb_build_object(
    'state', case when v_inserted = 1 then 'recorded' else 'already_recorded' end,
    'org_id', t.org_id,
    'order_id', t.order_id,
    'paid', v_paid,
    'balance', t.total - v_paid
  );
end;
$$;


-- ----------------------------------------------------------------------------
-- 8. GRANTS — 052's deliberate inversion, and 002's rule for the rest
-- ----------------------------------------------------------------------------
revoke all on function public.pay_token_state(text) from public, anon, authenticated;
revoke all on function public.pay_by_token(text) from public, anon, authenticated;
revoke all on function public.claim_pay_token(text) from public, anon, authenticated;
revoke all on function public.release_pay_token(text) from public, anon, authenticated;
revoke all on function public.record_pay_link_payment(text, numeric, text, text)
  from public, anon, authenticated;

grant execute on function public.pay_by_token(text) to anon, authenticated;
grant execute on function public.claim_pay_token(text) to anon, authenticated;
grant execute on function public.release_pay_token(text) to anon, authenticated;
grant execute on function public.record_pay_link_payment(text, numeric, text, text)
  to service_role;


notify pgrst, 'reload schema';


-- ----------------------------------------------------------------------------
-- After this, these should read:
-- ----------------------------------------------------------------------------
--   select public.pay_by_token('nope');                 -- {"state": "unknown"}
--   select public.pay_by_token('aaaaaaaaaaaaaaaaaaaaaa'); -- {"state": "unknown"}
--   as anon: select public.record_pay_link_payment('x', 1, 'y');  -- permission denied
