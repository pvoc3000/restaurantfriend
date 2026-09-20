-- ============================================================================
-- restaurantfriend — migration 110 · bills, not invoices
--
-- Mark, 2026-09-20: "Invoices as currently implemented should really be called
-- Bills. Bills are documents we have to pay. An invoice, by contrast, is a
-- document our customers have to pay." The rename frees the word for a
-- customer-facing Invoices feature on the Special Orders side — weekly
-- wholesale billing, where seven standing orders become one invoice — which
-- cannot be named at all while `vendor_invoices` holds the word.
--
-- The vocabulary was already half here before this migration: 088 is
-- `bill_payment_state`, `lib/invoices` exports `billStage` / `billPaymentNote`
-- / `billsFromReadings`, the edge modes are `push_bill` and `find_bills`, the
-- list menu already offers "New Bill", and the thing on the other end of the
-- QuickBooks wire is a Bill. This finishes a rename that started without being
-- decided.
--
-- 025:47 warned this day would come: "Renaming a table with RLS policies and
-- app queries is migration 005's whole ceremony; this is the one name here that
-- is expensive to change afterwards." 026:72 said the same about
-- `purchase_order_attachments.invoice_id` and asked for it "later as its own
-- content-free migration (005's precedent)". This is that migration.
--
-- ---------------------------------------------------------------------------
-- WHAT IS DELIBERATELY *NOT* RENAMED
--
-- `invoice_number`, `invoice_date` and `terms` KEEP their names. They are
-- transcriptions of what is printed on the VENDOR'S paper, and their paper says
-- Invoice at the top. QuickBooks draws the same line: a Bill carries the
-- vendor's own `DocNumber`. Renaming them would make the column lie about what
-- it holds, and would ripple into `extract-invoice`'s stored extraction jsonb,
-- which is a backfill rather than a rename.
--
-- `purchase_order_attachments.kind = 'invoice'` keeps its VALUE for the same
-- reason — it names the scanned paper — and because it is a behavioural
-- trigger: auto-read on attach fires on `kind = 'invoice'` only.
--
-- The storage key `{org_id}/invoices/{id}/{uuid}` keeps its second segment.
-- 018's policies read only segment 1, so the word is inert there, and changing
-- it would orphan every document already uploaded.
--
-- The edge function `extract-invoice` keeps its name: it is a deployed URL, and
-- it reads a document that says Invoice on it.
--
-- ---------------------------------------------------------------------------
-- WHAT POSTGRES HANDLES ON RENAME, AND WHAT IT DOES NOT
--
-- Handled: foreign keys, triggers and RLS policies keep WORKING — they bind by
-- OID, not by name. A function's `returns setof vendor_invoices` follows the
-- table, because that is the composite type.
--
-- NOT handled, so this migration does it by hand:
--   · constraint, index, trigger and policy NAMES (005's do-loop, §1–§4)
--   · a renamed COLUMN's constraint and index names (§3) — 005 renamed no
--     columns at all, so this part has no precedent to copy
--   · **plpgsql function BODIES** (§5, §6). This is the one that bites: a body
--     naming `vendor_invoices` still COMPILES after the rename and fails at
--     runtime, because plpgsql resolves table names when it executes. Five
--     functions are affected and 005 had none.
--
-- ---------------------------------------------------------------------------
-- THE THREE TRIGGER FUNCTIONS ARE RENAMED, NOT DROPPED.
--
-- `alter function … rename to` preserves the OID, so the triggers stay bound
-- and their comments survive; the body is then updated with `create or
-- replace`. The two SECURITY DEFINER functions cannot take that route —
-- `create or replace` is forbidden from changing an input parameter's name, and
-- `p_invoice` becomes `p_bill` — so they are dropped and recreated, which means
-- re-issuing the full revoke/revoke/grant trio. Dropping by SIGNATURE, never
-- `create or replace` under a new name: a changed argument list would leave the
-- old body live beside the new one (081:398, the 033 `freeze_pay_period` trap).
--
-- ---------------------------------------------------------------------------
-- `enforce_vendor_bill_financials_lock` REPRODUCES 109'S BODY EXACTLY,
-- including its omission of `discount`. 091 added that column to the locked
-- set and 109 — written from 090's body while adding `is_credit` — silently
-- dropped it again, so an approved bill's discount is editable today. That is a
-- real bug and it is NOT fixed here, because this migration has to be
-- reviewable as a pure rename. Migration 111 restores it, on its own, with its
-- own header.
--
-- Depends on 025, 026, 075, 081, 088, 089, 090, 091, 109.
-- NOT rerunnable (a second run fails on "relation does not exist" — which is
-- how you know it already ran).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tables, their constraints and their policies, driven by one rename map
--    (005's do-block, unchanged in shape)
-- ----------------------------------------------------------------------------

do $$
declare
  m constant text[][] := array[
    ['vendor_invoices',      'vendor_bills'],
    ['vendor_invoice_lines', 'vendor_bill_lines']
  ];
  pair text[];
  r record;
begin
  -- tables first
  foreach pair slice 1 in array m loop
    execute format('alter table %I rename to %I', pair[1], pair[2]);
  end loop;

  -- then every constraint whose name still carries the old prefix
  -- (renaming a constraint renames its underlying index too)
  foreach pair slice 1 in array m loop
    for r in
      select conname
        from pg_constraint
       where conrelid = pair[2]::regclass
         and (conname like pair[1] || '\_%' or conname = pair[1] || '_pkey')
    loop
      execute format('alter table %I rename constraint %I to %I',
                     pair[2], r.conname,
                     pair[2] || substr(r.conname, length(pair[1]) + 1));
    end loop;
  end loop;

  -- RLS policies whose names carry the old table name
  foreach pair slice 1 in array m loop
    for r in
      select policyname
        from pg_policies
       where schemaname = 'public'
         and tablename = pair[2]
         and policyname like pair[1] || '\_%'
    loop
      execute format('alter policy %I on %I rename to %I',
                     r.policyname, pair[2],
                     pair[2] || substr(r.policyname, length(pair[1]) + 1));
    end loop;
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 2. Standalone indexes — the loop above only reaches the ones a constraint
--    owns. These five were created with `create index`.
-- ----------------------------------------------------------------------------

alter index vendor_invoices_location_idx       rename to vendor_bills_location_idx;
alter index vendor_invoices_vendor_idx         rename to vendor_bills_vendor_idx;
alter index vendor_invoices_qbo_unsettled_idx  rename to vendor_bills_qbo_unsettled_idx;
alter index vendor_invoice_lines_po_idx        rename to vendor_bill_lines_po_idx;
-- Renamed for its COLUMN as well as its table — see §3.
alter index vendor_invoice_lines_invoice_idx   rename to vendor_bill_lines_bill_idx;

-- ----------------------------------------------------------------------------
-- 3. Columns. 005 renamed none, so nothing here follows a precedent.
--
--    A column rename does NOT rename the constraint or index that references
--    it, so each is followed by its own rename. The index DEFINITIONS track the
--    column automatically (the partial predicate below keeps working).
-- ----------------------------------------------------------------------------

alter table vendor_bill_lines rename column invoice_id to bill_id;
alter table vendor_bill_lines
  rename constraint vendor_bill_lines_invoice_id_fkey to vendor_bill_lines_bill_id_fkey;

alter table purchase_order_attachments rename column invoice_id to bill_id;
alter table purchase_order_attachments
  rename constraint purchase_order_attachments_invoice_id_fkey
                 to purchase_order_attachments_bill_id_fkey;
alter index purchase_order_attachments_invoice_idx
  rename to purchase_order_attachments_bill_idx;

-- 075's equipment/tasks seam — the only FK to this table from outside the
-- purchasing module, and the one a grep of the invoice module never finds.
-- It has no index, so there is none to rename.
alter table location_tasks rename column vendor_invoice_id to vendor_bill_id;
alter table location_tasks
  rename constraint location_tasks_vendor_invoice_id_fkey
                 to location_tasks_vendor_bill_id_fkey;

-- ----------------------------------------------------------------------------
-- 4. Triggers. `set_updated_at()` is shared and unchanged; the three financials
--    triggers keep pointing at the same functions, which §5 renames in place.
-- ----------------------------------------------------------------------------

alter trigger trg_vendor_invoices_updated on vendor_bills
  rename to trg_vendor_bills_updated;
alter trigger trg_vendor_invoices_financials_lock on vendor_bills
  rename to trg_vendor_bills_financials_lock;

alter trigger trg_vendor_invoice_lines_updated on vendor_bill_lines
  rename to trg_vendor_bill_lines_updated;
alter trigger trg_vendor_invoice_lines_financials_lock on vendor_bill_lines
  rename to trg_vendor_bill_lines_financials_lock;
alter trigger trg_vendor_invoice_lines_financials_touch on vendor_bill_lines
  rename to trg_vendor_bill_lines_financials_touch;

-- ----------------------------------------------------------------------------
-- 5. The three trigger functions: rename in place (keeps the OID, so the
--    triggers above stay bound), then replace the body.
-- ----------------------------------------------------------------------------

alter function public.enforce_vendor_invoice_financials_lock()
  rename to enforce_vendor_bill_financials_lock;
alter function public.enforce_vendor_invoice_line_financials_lock()
  rename to enforce_vendor_bill_line_financials_lock;
alter function public.touch_vendor_invoice_financials_from_line()
  rename to touch_vendor_bill_financials_from_line;

-- 109's body, verbatim but for the noun. `discount` is absent on purpose —
-- see the header, and 111.
create or replace function public.enforce_vendor_bill_financials_lock()
returns trigger
language plpgsql
as $$
declare
  v_changed boolean;
begin
  v_changed := (
    new.invoice_number is distinct from old.invoice_number or
    new.invoice_date   is distinct from old.invoice_date or
    new.due_date       is distinct from old.due_date or
    new.terms          is distinct from old.terms or
    new.vendor_id      is distinct from old.vendor_id or
    new.location_id    is distinct from old.location_id or
    new.tax            is distinct from old.tax or
    new.freight        is distinct from old.freight or
    new.other_charges  is distinct from old.other_charges or
    new.subtotal       is distinct from old.subtotal or
    new.total          is distinct from old.total or
    new.is_credit      is distinct from old.is_credit
  );

  if v_changed and old.status <> 'open' then
    raise exception
      'This bill is % — % before editing its figures.',
      old.status,
      case old.status when 'void' then 'reopen it' else 'withdraw approval' end;
  end if;

  if v_changed then
    new.financials_touched_at := now();
  end if;

  return new;
end;
$$;

comment on function public.enforce_vendor_bill_financials_lock() is
  'BEFORE UPDATE on vendor_bills. Refuses a change to a locked column '
  'unless status is open; on a real change, stamps financials_touched_at. '
  'Not role-scoped — applies to owner/admin exactly as to purchaser. '
  'terms joined the locked set in 090, is_credit in 109. discount is MISSING '
  'here and 111 puts it back — see 110''s header. '
  'Renamed from enforce_vendor_invoice_financials_lock in 110. '
  'See 089, 090, 109, 110.';

create or replace function public.enforce_vendor_bill_line_financials_lock()
returns trigger
language plpgsql
as $$
declare
  v_changed boolean;
  v_status  text;
begin
  v_changed := (
    new.qty                   is distinct from old.qty or
    new.unit_price             is distinct from old.unit_price or
    new.extended                is distinct from old.extended or
    new.kind                    is distinct from old.kind or
    new.purchase_order_id       is distinct from old.purchase_order_id or
    new.purchase_order_item_id  is distinct from old.purchase_order_item_id
  );

  if not v_changed then
    return new;
  end if;

  select status into v_status from vendor_bills where id = old.bill_id;

  if v_status <> 'open' then
    raise exception
      'This bill is % — % before editing its lines.',
      v_status,
      case v_status when 'void' then 'reopen it' else 'withdraw approval' end;
  end if;

  return new;
end;
$$;

comment on function public.enforce_vendor_bill_line_financials_lock() is
  'BEFORE UPDATE on vendor_bill_lines. Same rule as the header trigger, '
  'read off the parent bill''s status. Renamed in 110. See 089, 110.';

create or replace function public.touch_vendor_bill_financials_from_line()
returns trigger
language plpgsql
as $$
begin
  if (
    new.qty                   is distinct from old.qty or
    new.unit_price             is distinct from old.unit_price or
    new.extended                is distinct from old.extended or
    new.kind                    is distinct from old.kind or
    new.purchase_order_id       is distinct from old.purchase_order_id or
    new.purchase_order_item_id  is distinct from old.purchase_order_item_id
  ) then
    update vendor_bills
       set financials_touched_at = now()
     where id = new.bill_id;
  end if;
  return new;
end;
$$;

comment on function public.touch_vendor_bill_financials_from_line() is
  'AFTER UPDATE on vendor_bill_lines. Stamps the parent bill''s '
  'financials_touched_at when a locked line column actually changed. Runs '
  'only after enforce_vendor_bill_line_financials_lock() has already let '
  'the write through, so the parent is guaranteed open at this point. '
  'Renamed in 110. See 089, 110.';

-- ----------------------------------------------------------------------------
-- 6. The two SECURITY DEFINER functions. Dropped and recreated rather than
--    renamed, because `p_invoice` becomes `p_bill` and CREATE OR REPLACE may
--    not change an input parameter's name. Dropped BY SIGNATURE so no old body
--    survives as an overload (081:398).
--
--    Both bodies are otherwise unchanged. Both return rows so the caller can
--    count them: a refusal here is zero rows, never an error.
-- ----------------------------------------------------------------------------

drop function if exists public.set_vendor_invoice_approval(uuid, boolean);
drop function if exists public.record_accounting_push(uuid, jsonb);

create or replace function public.set_vendor_bill_approval(
  p_bill     uuid,
  p_approved boolean
)
returns setof vendor_bills
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org    uuid;
  v_status text;
begin
  select org_id, status into v_org, v_status
    from vendor_bills where id = p_bill;

  -- No such bill, not your org, or a bill that has been voided: return NO ROWS
  -- rather than raising. The caller checks the count.
  if v_org is null then return; end if;
  if not user_has_role(v_org, array['owner', 'admin']) then return; end if;
  if v_status = 'void' then return; end if;

  return query
    update vendor_bills set
      status      = case when p_approved then 'approved' else 'open' end,
      -- Never from the client. Approval is a claim about who said so.
      approved_at = case when p_approved then now() else null end,
      approved_by = case when p_approved then auth.uid() else null end
    where id = p_bill
    returning *;
end $$;

-- BOTH revokes, per 002: a new public-schema function is executable by PUBLIC,
-- and Supabase's default privileges ALSO grant execute to `anon` explicitly —
-- an explicit grant survives a revoke from PUBLIC, so anon has to be named.
revoke all on function public.set_vendor_bill_approval(uuid, boolean) from public;
revoke all on function public.set_vendor_bill_approval(uuid, boolean) from anon;
grant execute on function public.set_vendor_bill_approval(uuid, boolean) to authenticated;

create or replace function public.record_accounting_push(
  p_bill uuid,
  p_ref  jsonb
)
returns setof vendor_bills
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org    uuid;
  v_status text;
begin
  if jsonb_typeof(p_ref) is distinct from 'object' then
    raise exception 'The accounting reference must be a JSON object';
  end if;

  select org_id, status into v_org, v_status
    from vendor_bills where id = p_bill;

  -- No such bill, not your role, or not approved: NO ROWS rather than a raise,
  -- so the caller's row-count check is the one place refusal is read.
  if v_org is null then return; end if;
  if not user_has_role(v_org, array['owner', 'admin', 'purchaser']) then return; end if;
  if v_status <> 'approved' then return; end if;

  return query
    update vendor_bills set
      -- Top-level merge, so {"qbo": {...}} replaces the qbo branch whole and
      -- an id can never outlive the sync token it was stored with.
      external_ref = external_ref || p_ref,
      synced_at    = now()
    where id = p_bill
    returning *;
end $$;

revoke all on function public.record_accounting_push(uuid, jsonb) from public;
revoke all on function public.record_accounting_push(uuid, jsonb) from anon;
grant execute on function public.record_accounting_push(uuid, jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- 7. Column comments. These carry the old noun in their TEXT, which a rename
--    cannot reach.
-- ----------------------------------------------------------------------------

comment on column vendor_bills.financials_touched_at is
  'When a locked financial column last actually changed. Set by '
  'enforce_vendor_bill_financials_lock, never by the app. Null means the '
  'figures are as first entered. See 089.';

comment on column vendor_bills.qbo_balance is
  'What QuickBooks last said is still owed on this bill. A CACHE of their '
  'fact, never ours — this app records no vendor payment. Null means nobody '
  'has asked, or QuickBooks no longer has it; zero means paid. Always read '
  'with qbo_checked_at. See 088.';

comment on column vendor_bills.qbo_checked_at is
  'When qbo_balance was read. Without it no claim about payment may be '
  'rendered at all — billPaymentNote returns nothing. See 088.';

comment on column vendor_bills.discount is
  'A discount printed on the bill, stored POSITIVE and subtracted by the '
  'app''s arithmetic. See 091.';

comment on column purchase_order_attachments.bill_id is
  'The vendor bill this document belongs to, when it was filed against one. '
  'Renamed from invoice_id in 110. Independent of po_id: a document may have '
  'either, both or neither. The storage key still reads '
  '{org_id}/invoices/{bill_id}/{uuid} for bill-born documents — 018''s '
  'policies read only the first segment, so that word is inert, and moving '
  'the objects would orphan every file already uploaded. See 026, 110.';

-- ----------------------------------------------------------------------------
-- 8. Tell PostgREST to pick up the new names now.
-- ----------------------------------------------------------------------------

notify pgrst, 'reload schema';

-- ============================================================================
-- Verify (in the SQL editor, after running):
--
--   -- The tables moved and nothing kept the old name:
--   select tablename from pg_tables
--    where schemaname = 'public' and tablename like '%vendor_%'
--    order by 1;                       -- vendor_bill_lines, vendor_bills,
--                                      -- vendor_items, vendor_locations
--
--   -- No named object on either table still says "invoice":
--   select conname from pg_constraint
--    where conrelid in ('public.vendor_bills'::regclass,
--                       'public.vendor_bill_lines'::regclass)
--      and conname like '%invoice%';                                    -- 0 rows
--   select indexname from pg_indexes
--    where schemaname = 'public'
--      and tablename in ('vendor_bills','vendor_bill_lines',
--                        'purchase_order_attachments','location_tasks')
--      and indexname like '%invoice%';                                  -- 0 rows
--   select polname from pg_policy
--    where polrelid in ('public.vendor_bills'::regclass,
--                       'public.vendor_bill_lines'::regclass)
--      and polname like '%invoice%';                                    -- 0 rows
--   select tgname from pg_trigger
--    where tgrelid in ('public.vendor_bills'::regclass,
--                      'public.vendor_bill_lines'::regclass)
--      and not tgisinternal;           -- five rows, all trg_vendor_bill*
--
--   -- Four policies per table, as 025 left them:
--   select polname, polcmd from pg_policy
--    where polrelid = 'public.vendor_bills'::regclass;                   -- 4 rows
--   select polname, polcmd from pg_policy
--    where polrelid = 'public.vendor_bill_lines'::regclass;              -- 4 rows
--
--   -- The three renamed columns exist and the old names do not:
--   select table_name, column_name from information_schema.columns
--    where table_schema = 'public'
--      and column_name in ('bill_id','vendor_bill_id',
--                          'invoice_id','vendor_invoice_id')
--    order by 1, 2;   -- purchase_order_attachments.bill_id,
--                     -- vendor_bill_lines.bill_id, location_tasks.vendor_bill_id
--
--   -- Five functions under the new names, none under the old:
--   select proname from pg_proc
--    where proname like '%vendor_invoice%'
--       or proname = 'set_vendor_invoice_approval';                     -- 0 rows
--   select proname from pg_proc
--    where proname in ('set_vendor_bill_approval','record_accounting_push',
--                      'enforce_vendor_bill_financials_lock',
--                      'enforce_vendor_bill_line_financials_lock',
--                      'touch_vendor_bill_financials_from_line');       -- 5 rows
--                     -- five, never more: an overload leaves the old body live.
--
--   -- A FUNCTION'S OUT PARAMETERS ARE NOT IN information_schema.columns, so
--   -- ask pg_proc for the result type instead:
--   select proname, pg_get_function_result(oid) from pg_proc
--    where proname in ('set_vendor_bill_approval','record_accounting_push');
--                                      -- both: SETOF vendor_bills
--
--   -- The definer functions are still closed to anon:
--   select has_function_privilege('anon',
--     'public.set_vendor_bill_approval(uuid, boolean)', 'execute'),
--          has_function_privilege('anon',
--     'public.record_accounting_push(uuid, jsonb)', 'execute');   -- false, false
--
--   -- Raises nothing and does no work, but proves the body resolves:
--   select * from set_vendor_bill_approval(
--     '00000000-0000-0000-0000-000000000000'::uuid, true);              -- 0 rows
--
--   -- Row counts are unchanged by a rename. Compare against what you noted
--   -- BEFORE running this:
--   select count(*) from vendor_bills;
--   select count(*) from vendor_bill_lines;
--   select count(*) from purchase_order_attachments where bill_id is not null;
-- ============================================================================
