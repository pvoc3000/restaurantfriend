-- ============================================================================
-- 224 — THE FIRST PERSON TO CHANGE AN ORDER TAKES IT
--
-- Mark, 2026-11-05: "the 'taken by' field is pretty much not getting used when
-- it should be. Can we automatically assign it to the first person to interact
-- with the order? Not the first person to view it, but the first person to
-- modify it in some way. Unless the field is already assigned to someone."
--
-- WHERE THE GAP IS (measured before writing this, orders made since
-- 2026-09-01): web inquiries 27 of 28 have no taker — `create_inquiry` runs
-- signed out, so there is nobody to name — and 24 of 51 other orders. Standing
-- order days have one (they copy their template's). An order made in the app
-- has named its maker since 2026-09-21 (`createSpecialOrder`).
--
-- ----------------------------------------------------------------------------
-- WHAT COUNTS AS CHANGING AN ORDER
-- ----------------------------------------------------------------------------
-- A write, by a SIGNED-IN person who has an employee record, to the order row
-- itself or to what hangs off it: its items, attachments, emails, payment
-- applications, invoice lines, credit memos and their lines. Triggers rather
-- than app code, so every door counts — the record, the list's batch commands,
-- every RPC.
--
-- WHAT DOES NOT:
--   · VIEWING. Read receipts (`special_order_note_reads`) are not watched, and
--     neither is the history log (`special_order_events`), which only ever
--     follows another write.
--   · NOBODY SIGNED IN — `auth.uid()` is null for the mailbox check
--     (`order-mail`), the morning run, QuickBooks' webhook and the public
--     inquiry form, which all write as the service role or anonymously.
--   · A ROW MADE IN THE SAME TRANSACTION. The Orders list tops up standing
--     orders AS WHOEVER IS LOOKING AT IT (`ensure_standing_orders_materialized`,
--     a definer called with their session), inserting days and their items;
--     that is not a person touching those days. Told apart by the order row's
--     `xmin`, the transaction that last wrote it: equal to the current one
--     means this transaction made it (or already changed it, which is when the
--     claim would already have happened).
--   · ANYTHING BUT AN ORDER. A template or standing order is named by whoever
--     makes it; a top-up updating a standing order is not taking it.
--   · ALREADY TAKEN — by the employee link or FileMaker's text `taken_by`. A
--     legacy "Traci" counts as assigned.
--
-- The claim writes `taken_by_employee_id`, so 054's log records it in the
-- order's history like any other change: "Taken by set to …".
--
-- Run after 223. Wrap in begin/commit. RERUNNABLE.
-- THE SQL STARTS ON THE LINE AFTER THIS ONE.
-- ============================================================================

-- Which employee the signed-in person is in the order's organization. A
-- definer, because `employees` is readable by owner/admin only (020) and a
-- supervisor's edit must still be able to claim. Null when nobody is signed in
-- or they have no employee record.
create or replace function public.order_taker_for_me(p_org uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select e.id
    from employees e
   where e.org_id = p_org
     and e.user_id = auth.uid()
     and auth.uid() is not null
$$;

revoke all on function public.order_taker_for_me(uuid) from public, anon, authenticated;

-- THE ORDER ROW: an UPDATE claims it, before it is written, so the claim lands
-- in the same row version and 054's log reports it with the edit.
create or replace function public.trg_special_order_claim_taker()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_xmin xid;
begin
  if auth.uid() is null
     or new.kind <> 'order'
     or new.taken_by_employee_id is not null
     or old.taken_by_employee_id is not null
     or coalesce(btrim(new.taken_by), '') <> ''
     or coalesce(btrim(old.taken_by), '') <> '' then
    return new;
  end if;

  -- Made (or already changed) in this transaction: see the header.
  select so.xmin into v_xmin from special_orders so where so.id = old.id;
  if v_xmin = pg_current_xact_id()::xid then
    return new;
  end if;

  new.taken_by_employee_id := order_taker_for_me(new.org_id);
  return new;
end;
$$;

revoke all on function public.trg_special_order_claim_taker() from public, anon, authenticated;

drop trigger if exists trg_special_orders_claim_taker on special_orders;
create trigger trg_special_orders_claim_taker
  before update on special_orders
  for each row execute function trg_special_order_claim_taker();

-- WHAT HANGS OFF IT: a write to a child row claims its order. The column that
-- names the order differs by table, so the trigger is told it.
create or replace function public.trg_special_order_child_claims_taker()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order uuid;
begin
  -- NEW is null on a delete, so the row is chosen by the operation.
  if tg_op = 'DELETE' then
    v_order := nullif(to_jsonb(old) ->> tg_argv[0], '')::uuid;
  else
    v_order := nullif(to_jsonb(new) ->> tg_argv[0], '')::uuid;
  end if;

  if auth.uid() is null or v_order is null then
    return null;
  end if;

  update special_orders so
     set taken_by_employee_id = e.id
    from employees e
   where so.id = v_order
     and so.kind = 'order'
     and so.taken_by_employee_id is null
     and coalesce(btrim(so.taken_by), '') = ''
     and so.xmin <> pg_current_xact_id()::xid
     and e.org_id = so.org_id
     and e.user_id = auth.uid();

  return null;
end;
$$;

revoke all on function public.trg_special_order_child_claims_taker() from public, anon, authenticated;

drop trigger if exists trg_special_order_items_claim_taker on special_order_items;
create trigger trg_special_order_items_claim_taker
  after insert or update or delete on special_order_items
  for each row execute function trg_special_order_child_claims_taker('order_id');

drop trigger if exists trg_special_order_attachments_claim_taker on special_order_attachments;
create trigger trg_special_order_attachments_claim_taker
  after insert or update or delete on special_order_attachments
  for each row execute function trg_special_order_child_claims_taker('order_id');

drop trigger if exists trg_special_order_messages_claim_taker on special_order_messages;
create trigger trg_special_order_messages_claim_taker
  after insert or update or delete on special_order_messages
  for each row execute function trg_special_order_child_claims_taker('order_id');

drop trigger if exists trg_payment_applications_claim_taker on payment_applications;
create trigger trg_payment_applications_claim_taker
  after insert or update or delete on payment_applications
  for each row execute function trg_special_order_child_claims_taker('special_order_id');

drop trigger if exists trg_customer_invoice_lines_claim_taker on customer_invoice_lines;
create trigger trg_customer_invoice_lines_claim_taker
  after insert or update or delete on customer_invoice_lines
  for each row execute function trg_special_order_child_claims_taker('special_order_id');

drop trigger if exists trg_customer_credit_memos_claim_taker on customer_credit_memos;
create trigger trg_customer_credit_memos_claim_taker
  after insert or update or delete on customer_credit_memos
  for each row execute function trg_special_order_child_claims_taker('special_order_id');

drop trigger if exists trg_customer_credit_memo_lines_claim_taker on customer_credit_memo_lines;
create trigger trg_customer_credit_memo_lines_claim_taker
  after insert or update or delete on customer_credit_memo_lines
  for each row execute function trg_special_order_child_claims_taker('special_order_id');
