-- ============================================================================
-- restaurantfriend — migration 078 · what a checklist item also says
--
-- Why: Mark's two real DF01 checklists (2026-08-30) print FOUR columns per row,
-- and 076 modelled two of them. The paper has a checkbox, the instruction, a
-- WHO, and a NOTE:
--
--     ☐  Fryer filtered and cleaned    Fryer             replace filter on
--                                                        Tue/Fri/Sun. Clean
--                                                        floors and interior
--     ☐  Proof box clean               Baker             water emptied
--     ☐  All stations cleaned                            including shelving above
--     ☐  Supervisor log completed      Supervisor        including employee comments
--
-- Both are OPTIONAL (Mark: "add both, but they are optional fields") — most
-- rows carry neither, which is why they are nullable and why neither gets a
-- default. Of the 105 items across the two lists, 21 name a position and 17
-- carry a note.
--
-- ── WHY NOT FOLD THEM INTO THE PROMPT ───────────────────────────────────────
--
-- "Fryer filtered and cleaned — Fryer — replace filter on Tue/Fri/Sun" is one
-- string that can never be filtered, grouped or counted on, and it reads badly
-- on a phone at 11pm. The paper keeps them in separate columns because they
-- answer different questions: WHAT to do, WHO does it, and HOW you know it is
-- done. Three questions, three fields.
--
-- ── `position`, NOT `role` ──────────────────────────────────────────────────
--
-- This is the ROSTER vocabulary — Baker, Fryer, Assistant Baker, Supervisor —
-- which is `employees.position` / `timesheets.position` / FMP's `ts_Position`,
-- not `org_members.role` (owner/admin/purchaser/supervisor/staff). The two
-- overlap on the word "Supervisor" and mean different things by it, which is
-- exactly how a confusion would start. Free text with a `PickList allowNew`,
-- like every other vocabulary the business owns (design rule 2) — NOT a check
-- constraint, because the next position somebody adds must not need a
-- migration.
--
-- It is a HINT, never a gate. Nothing reads it to decide who may tick a box:
-- 076's policies are the gate, and a checklist that refused a tick because the
-- closer is covering the baker's shift would be worse than useless.
--
-- ── THE RUN GETS ITS OWN COPIES ─────────────────────────────────────────────
--
-- Snapshotted like everything else on `checklist_run_items` — 076 decision 1,
-- 013's rule. Rewording guidance in September must not rewrite what August's
-- supervisor is recorded as having been told.
--
-- Depends on 076. Rows already written keep null in both, which is the honest
-- reading: nobody had said anything. NOT rerunnable (add column fails a second
-- time, which is how you know it already ran).
-- ============================================================================

alter table checklist_template_items
  add column guidance text,
  add column position text;

alter table checklist_run_items
  add column guidance text,
  add column position text;

comment on column checklist_template_items.guidance is
  'How you know it is done — the note column on the paper checklist. Optional.';
comment on column checklist_template_items.position is
  'Whose job it is, in the ROSTER vocabulary (employees.position), not org_members.role. A hint, never a gate. Optional.';
comment on column checklist_run_items.guidance is
  'Snapshotted from the template at the moment the walk started (076 decision 1).';
comment on column checklist_run_items.position is
  'Snapshotted from the template at the moment the walk started (076 decision 1).';

-- ============================================================================
-- Probe (run it, don't trust a note in CLAUDE.md):
--
--   select table_name, column_name, is_nullable
--     from information_schema.columns
--    where column_name in ('guidance', 'position')
--      and table_name in ('checklist_template_items', 'checklist_run_items')
--    order by table_name, column_name;
--     → FOUR rows, every one YES. A NOT NULL on either would refuse the
--       majority of real items, which carry neither.
-- ============================================================================
