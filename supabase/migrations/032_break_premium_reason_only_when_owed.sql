-- 032 — a reason is required only when the premium is OWED.
--
-- 029 declared `reason text not null check (length(btrim(reason)) > 0)` on the
-- reasoning that "a decision without a reason is one nobody can audit". That is
-- true of a decision that PAYS somebody. It is not true of the other two, and
-- making it universal turned the cheap decisions expensive: a fortnight can
-- carry ninety findings, most of them a shift that was six hours long and needed
-- no meal at all, and typing a sentence into each is how a reviewer learns to
-- stop reviewing (Mark, 2026-08-05: "don't make it required to enter a 'why'
-- when waiving or declaring not owed for a break violation").
--
-- So the requirement moves onto the decision it belongs to. `owed` still has to
-- argue its case — that is an hour of pay, and the row is the only record of why
-- it was granted. `waived` and `not_owed` may be recorded bare, and a reason
-- stays available for the ones that want one.
--
-- Note this DROPS a NOT NULL. Nothing in the app reads `reason` expecting a
-- string — the worksheet renders it only when present — and every existing row
-- keeps the reason it was created with, so this widens what is accepted and
-- invalidates nothing already stored.

alter table break_premiums alter column reason drop not null;

-- The unnamed inline check from 029. Named defensively: an inline `check` gets
-- `<table>_<column>_check` from Postgres, but a hand-applied migration may have
-- been edited, so this does not fail the whole file if the name differs.
do $$
begin
  alter table break_premiums drop constraint break_premiums_reason_check;
exception
  when undefined_object then
    raise notice '029 reason check not found under its default name — check by hand';
end;
$$;

alter table break_premiums
  add constraint break_premiums_reason_when_owed
  check (
    decision <> 'owed'
    or (reason is not null and length(btrim(reason)) > 0)
  );

-- ----------------------------------------------------------------------------
-- Verify (run as a signed-in admin, not service_role — these are RLS paths):
--
--   -- a bare waiver is now accepted
--   insert into break_premiums (org_id, employee_id, location_id, workday, kind, decision, hours)
--   values (:org, :employee, :location, '2026-07-23', 'meal', 'waived', 0)
--   returning id;
--
--   -- and an owed one without a reason is still refused
--   insert into break_premiums (org_id, employee_id, location_id, workday, kind, decision, hours)
--   values (:org, :employee, :location, '2026-07-24', 'meal', 'owed', 1);
--   -- ERROR: new row violates check constraint "break_premiums_reason_when_owed"
--
--   delete from break_premiums where workday in ('2026-07-23','2026-07-24');
-- ----------------------------------------------------------------------------
