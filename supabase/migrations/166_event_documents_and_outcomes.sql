-- ============================================================================
-- 166 — AN EVENT CAN CARRY A DOCUMENT, AND "ACTION TAKEN" HAS A VOCABULARY
--
-- Mark, 2026-10-02, on the New event dialog:
--
--   "There are no options available for 'action taken' and no way to add one.
--    I would like to be able to pick or enter 'Verbal Warning', 'Write Up',
--    'Check In', 'Documented' etc."
--
--   "I would also like to be able to attach or link a document to the event…
--    it can be filed in the employee's documents, and there could be a link
--    between the document and the event for easy viewing."
--
-- 1. `employee_events.document_id` — ONE document per event, and the document
--    is an ordinary `employee_documents` row: it is filed in the person's
--    paperwork like any other, and the event points at it. Not a join table:
--    a write-up is one piece of paper, and a second one is a second event.
--    `on delete set null`, because removing the scan from the paperwork must
--    not delete the record of what happened (the same reasoning the Remove
--    dialog gives for events themselves).
--
-- 2. `orgs.settings.hr.event_outcomes` — the list "Action taken" offers.
--    In settings, not in code (design rule 2). The picker used to offer the
--    outcomes already on THIS person's events, which for nearly everybody is
--    none — and FileMaker's 2,398 events left ~300 free-text spellings ("Verbal
--    given", "verbal warning given", "Verbally Warned"…), so an org-wide list
--    of those would be noise, not a vocabulary. A new answer typed into the
--    dialog is appended here by `add_event_outcome`, so the list grows by use.
--    Seeded only if the key is absent, so a rerun keeps any edits.
--
-- 3. `add_event_outcome(org, outcome)` — appends one entry ATOMICALLY. A
--    client read-modify-write of the whole `settings` document would overwrite
--    anything written to another key between the read and the write. SECURITY
--    INVOKER, so `org_update` (owner/admin) is the gate and nothing is
--    re-checked here; anon is revoked by name all the same.
--
-- THE APP SELECTS `document_id` on the Events tab and on /events, so apply this
-- BEFORE the web change ships. RERUNNABLE.
-- ============================================================================

alter table employee_events
  add column if not exists document_id uuid
    references employee_documents(id) on delete set null;

create index if not exists employee_events_document_idx
  on employee_events (document_id) where document_id is not null;

update orgs
   set settings = jsonb_set(
         coalesce(settings, '{}'::jsonb),
         '{hr}',
         coalesce(settings->'hr', '{}'::jsonb)
           || jsonb_build_object(
                'event_outcomes',
                '["Verbal Warning", "Write Up", "Check In", "Documented"]'::jsonb))
 where settings #> '{hr,event_outcomes}' is null;

create or replace function public.add_event_outcome(p_org uuid, p_outcome text)
returns void
language sql
security invoker
set search_path = public
as $$
  update orgs
     set settings = jsonb_set(
           coalesce(settings, '{}'::jsonb),
           '{hr}',
           coalesce(settings->'hr', '{}'::jsonb)
             || jsonb_build_object(
                  'event_outcomes',
                  coalesce(settings #> '{hr,event_outcomes}', '[]'::jsonb)
                    || to_jsonb(btrim(p_outcome))))
   where id = p_org
     and btrim(coalesce(p_outcome, '')) <> ''
     -- Already listed, in any capitalisation: nothing to add.
     and not exists (
           select 1
             from jsonb_array_elements_text(
                    coalesce(settings #> '{hr,event_outcomes}', '[]'::jsonb)) as o(v)
            where lower(o.v) = lower(btrim(p_outcome)));
$$;

revoke all on function public.add_event_outcome(uuid, text) from public, anon;
grant execute on function public.add_event_outcome(uuid, text) to authenticated;

notify pgrst, 'reload schema';
