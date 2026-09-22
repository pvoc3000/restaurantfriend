-- ============================================================================
-- 117 — A FINISHED STAGE CLEARS THE NOTE IT WAS ABOUT
--
-- SQL STARTS AT LINE 97. Everything above it is comment.
--
-- Mark, 2026-09-21, on the question 116 left open: "'Respond to Email/Call'
-- should be cleared (along with any flag) if we send a quote, invoice, receipt,
-- print or schedule the order."
--
-- ----------------------------------------------------------------------------
-- WHY 116 COULD NOT DO THIS, AND WHY THIS IS A DIFFERENT RULE
-- ----------------------------------------------------------------------------
-- 116 clears a system FLAG on any activity, and deliberately left `todo` alone:
-- an edit is not proof a customer was answered, so wiping "Respond to
-- Email/Call" because somebody corrected a phone number would be a lie about
-- what had happened.
--
-- The five acts named here are not edits. Each is a STAGE OF THE LADDER
-- completing, and each is the answer to the note: you cannot send a quote
-- without having dealt with the enquiry that asked for one. So this is the
-- narrower, stronger signal — 116's rule is "somebody is here", this one is
-- "the thing the note asked for is DONE".
--
-- ----------------------------------------------------------------------------
-- THE FIVE COLUMNS, AND THE ONE THAT IS DELIBERATELY NOT HERE
-- ----------------------------------------------------------------------------
--   quote_sent_at · invoice_sent_at · receipt_sent_at · order_printed_at ·
--   order_scheduled_at
--
-- `delivery_scheduled_at` is NOT in the list. "Schedule the order" is
-- `order_scheduled_at`, the production schedule; booking a courier is a
-- different act that Mark did not name, and a stage that clears a note it had
-- nothing to do with is the bug this file is otherwise avoiding. One line to
-- add if he wants it.
--
-- `quote_returned_at` is not here either, and cannot be: that is the CUSTOMER
-- approving, which since 116 RAISES a flag rather than clearing one.
--
-- ONLY THE FIRST STAMP FIRES IT (`old is null and new is not null`).
-- Correcting the date a quote went out is bookkeeping about a thing that
-- already happened, and it must not clear a note somebody has written since.
--
-- ----------------------------------------------------------------------------
-- THE TO-DO IS CLEARED ONLY WHERE THE STAGE ANSWERS IT
-- ----------------------------------------------------------------------------
-- The first draft of this file cleared `todo` WHATEVER IT SAID, on the argument
-- that decision 4 lets a stale to-do override the suggestion that would be
-- right. That was wrong, and `lib/orderWorkflow` already said so in as many
-- words about this exact act:
--
--     CLEARED ONLY IF IT IS STILL THE PRINT TO-DO. Somebody who has typed
--     "call about the balloons" in there is not asking for it to be thrown
--     away because a sheet came off the printer.
--
-- And the column really does hold sentences like that. `TODO_OPTIONS` is a
-- pick list with `allowNew` BECAUSE the measured export carries "ON HOLD",
-- "HOLIDAY", "*" and "Adjust time to 9am or later" — a closed vocabulary would
-- refuse a quarter of the real data, and a trigger that blanks the field would
-- quietly delete the same quarter.
--
-- So each stage clears the to-do IT ANSWERS, and nothing else:
--
--   quote_sent_at      → 'Respond to Email/Call', 'Send Quote'
--   invoice_sent_at    → 'Respond to Email/Call', 'Send Invoice'
--   receipt_sent_at    → 'Respond to Email/Call', 'Send Receipt'
--   order_printed_at   → 'Respond to Email/Call', 'Print Order'
--   order_scheduled_at → 'Respond to Email/Call', 'Schedule Production'
--
-- 'Respond to Email/Call' on all five is Mark's sentence exactly; the second
-- entry on each line is the to-do that names the very thing that just
-- happened, which cannot be a note about anything else. 'Post Event Followup'
-- is deliberately absent: it is an instruction for AFTER the receipt, so the
-- receipt going out is not an answer to it.
--
-- THE FLAG, by contrast, clears on any of the five regardless of the to-do —
-- and only if the APP raised it. Asked, 2026-09-21, because "any flag" could
-- have meant either and one reading destroys something. Mark chose SYSTEM
-- ONLY, consistent with 116: printing an order does not resolve "customer
-- disputes the flavour", and that flag keeps its own Resolve command.
--
-- Nothing is lost either way: 054 logs "To-do cleared (was …)".
--
-- ----------------------------------------------------------------------------
-- IT KEEPS 116's PAIRING BY CLEARING BOTH COLUMNS
-- ----------------------------------------------------------------------------
-- Two BEFORE triggers now watch this table and Postgres fires them in NAME
-- order, so `trg_special_orders_flag_source` runs before
-- `trg_special_orders_stage_clears`. If this one nulled `flag_reason` alone,
-- the other would already have run and `flag_source` would survive it —
-- tripping 116's `special_orders_flag_source_paired` check on a statement that
-- looks completely unrelated to flags.
--
-- So it nulls BOTH, which is also the more honest line to read.
-- ============================================================================


create or replace function public.trg_special_order_stage_clears()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- The to-dos this update's stages ANSWER. Empty means no stage finished.
  v_answered text[] := '{}';
begin
  if old.quote_sent_at is null and new.quote_sent_at is not null then
    v_answered := v_answered || array['Respond to Email/Call', 'Send Quote'];
  end if;
  if old.invoice_sent_at is null and new.invoice_sent_at is not null then
    v_answered := v_answered || array['Respond to Email/Call', 'Send Invoice'];
  end if;
  if old.receipt_sent_at is null and new.receipt_sent_at is not null then
    v_answered := v_answered || array['Respond to Email/Call', 'Send Receipt'];
  end if;
  if old.order_printed_at is null and new.order_printed_at is not null then
    v_answered := v_answered || array['Respond to Email/Call', 'Print Order'];
  end if;
  if old.order_scheduled_at is null and new.order_scheduled_at is not null then
    v_answered := v_answered || array['Respond to Email/Call', 'Schedule Production'];
  end if;

  if array_length(v_answered, 1) is null then
    return new;
  end if;

  -- ONLY IF THE STAGE ANSWERS IT. "Adjust time to 9am or later" is a real
  -- value in the real data and is nobody's idea of something a printer settles.
  if new.todo = any (v_answered) then
    new.todo := null;
  end if;

  -- The notice goes whatever the to-do said, and only if the app raised it.
  if new.flag_source = 'system' then
    new.flag_reason := null;
    new.flag_source := null;
  end if;

  return new;
end;
$$;

revoke all on function public.trg_special_order_stage_clears() from public, anon, authenticated;

drop trigger if exists trg_special_orders_stage_clears on special_orders;
create trigger trg_special_orders_stage_clears
  before update on special_orders
  for each row execute function trg_special_order_stage_clears();


notify pgrst, 'reload schema';


-- ----------------------------------------------------------------------------
-- After this, these should read:
-- ----------------------------------------------------------------------------
--   select tgname from pg_trigger
--    where tgrelid = 'special_orders'::regclass and not tgisinternal order by tgname;
--     -> …_flag_source before …_stage_clears, which is the order that matters
--
-- On a scratch order, one statement each:
--   update special_orders set quote_sent_at = current_date where id = :id;
--     -> todo null, flag_reason null, flag_source null   (a system flag)
--     -> and ONE log entry naming all three
--   update special_orders set quote_sent_at = current_date - 1 where id = :id;
--     -> a CORRECTION: a to-do written since is left alone
--   -- with todo = 'Adjust time to 9am or later':
--   update special_orders set order_printed_at = current_date where id = :id;
--     -> the to-do SURVIVES; only the flag goes
--   -- with a hand-raised flag:
--   update special_orders set invoice_sent_at = current_date where id = :id;
--     -> todo null, flag_reason UNCHANGED, flag_source still 'person'
-- ----------------------------------------------------------------------------
