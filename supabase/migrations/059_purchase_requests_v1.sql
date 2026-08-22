-- ============================================================================
-- restaurantfriend — migration 059 · purchase requests get a writer
--
-- Why (Mark, 2026-08-21): "let's implement purchase requests."
--
-- `purchase_requests` is the last table 001 created that has never had one.
-- The spec has always wanted it — docs/purchasing-spec.md §4.7, added to v1
-- scope after FileMaker's Purchasing menu and the order guide's "N REQUESTS"
-- badge revealed requisitions as a live part of the ordering workflow — and
-- until today the only trace of it in the app was a dead nav stub.
--
-- Deliberately NOT migrated: FileMaker's PurchaseReq table (21 fields, 116
-- records, in DF-Locations.fmp12). Mark: "we don't need any history on this,
-- we can forgo importing FMP records. We'll roll this one from scratch." There
-- is no export of it and none is wanted, so this migration touches no data —
-- the table is empty, which is what makes the rename below free.
--
-- Four decisions of Mark's are in the shape of this file:
--
--   · PRIORITY comes back (FMP had RequestPriority as free text). Three levels,
--     because a fourth is one nobody uses.
--   · A request may NAME AN ITEM but never has to. "We need the good vanilla"
--     is most of what a request is, and half of them are for something the
--     catalog does not stock yet — so free text is the record and the link is
--     an annotation, usually added by the purchaser working the queue.
--   · RESOLUTION IS A NOTE, not a PO line. v1 does not couple.
--   · DISMISSING REQUIRES A REASON and marking ordered does not.
--
-- Depends on 001. Run in the Supabase SQL editor BEFORE deploying the app —
-- the new screen selects these columns, so the order is the opposite of 012's.
-- NOT rerunnable (the rename fails a second time, which is the signal it
-- already ran). All-or-nothing: a partial run dies on the rename before it
-- reaches the constraint or the index.
-- ============================================================================

alter table purchase_requests
  add column priority text not null default 'normal'
      check (priority in ('low', 'normal', 'high')),
  add column inventory_item_id uuid references inventory_items(id) on delete set null,
  add column resolved_at timestamptz;

comment on column purchase_requests.priority is
  'low | normal | high. NOTE this is TEXT, so SQL orders it high < low < '
  'normal — the app ranks it in TypeScript (lib/purchaseRequests.priorityRank) '
  'and an innocent .order("priority") here would be silently wrong.';

comment on column purchase_requests.inventory_item_id is
  'Optional. A request is free text first; this is the annotation that says '
  'which catalog item it turned out to be, and is usually set by the purchaser '
  'rather than the person who filed it.';

comment on column purchase_requests.resolved_at is
  'When the request was CLOSED. Distinct from updated_at, which 001''s trigger '
  'moves on any edit at all.';

-- ----------------------------------------------------------------------------
-- One note column, not two
-- ----------------------------------------------------------------------------
-- Both exits produce a sentence. FileMaker kept RequestStatus AND isFulfilled
-- AND FulfilledDate AND FulfilledText, which is precisely how they came to
-- disagree, and a column called `dismiss_reason` holding "ordered from Sysco
-- on Tuesday" is a name that lies — the same fault 015 fixed by relabelling
-- the discrepancy column "Receiving".
--
-- Renaming a 001 column is not something to do casually (005 explicitly
-- declined to rename columns, because they ripple through the loader, app
-- selects and view outputs). Every clause of that objection is absent here:
-- the table is EMPTY, `dismiss_reason` has zero readers in web/src, no view
-- depends on it, and migration/load.mjs never writes this table. It is a pure
-- relabel.

do $$
declare
  dependents text;
begin
  select string_agg(distinct c.relname, ', ')
    into dependents
    from pg_depend d
    join pg_rewrite r on r.oid = d.objid
    join pg_class   c on c.oid = r.ev_class
    join pg_attribute a
      on a.attrelid = d.refobjid
     and a.attnum   = d.refobjsubid
   where d.refobjid = 'purchase_requests'::regclass
     and a.attname  = 'dismiss_reason'
     and c.relkind  = 'v';

  if dependents is not null then
    raise exception 'still referenced by view(s): % — update them first', dependents;
  end if;
end $$;

alter table purchase_requests rename column dismiss_reason to resolution_note;

comment on column purchase_requests.resolution_note is
  'How the request was closed, whichever way it went — "ordered from Sysco '
  'Tuesday" or "duplicate of #12". Was dismiss_reason in 001; renamed by 059 '
  'because one exit is not the only exit.';

-- The requirement rides the DECISION, not the column — 032's shape, and its
-- reason: a dismissal is somebody being told no and has to say why, where
-- "ordered" is self-explanatory and demanding a sentence for it is how people
-- learn to stop reading the dialog. Named explicitly so a grep for one form of
-- this rule finds the other.
alter table purchase_requests
  add constraint purchase_requests_reason_when_dismissed
  check (
    status <> 'dismissed'
    or (resolution_note is not null and length(btrim(resolution_note)) > 0)
  );

-- ----------------------------------------------------------------------------
-- An author may correct or withdraw their own request
-- ----------------------------------------------------------------------------
-- 001 gave this table membership read + membership insert + purchaser-and-up
-- update, and NO delete policy at all. That is right about who RESOLVES a
-- request and wrong about the person who filed it: with those three policies
-- alone, filing a request is the only irreversible act a staff member has
-- anywhere in this app — a typo, a duplicate or a change of mind can only be
-- cleared by somebody else. (Mark, 2026-08-21, choosing this over leaving 001
-- untouched.)
--
-- Permissive policies OR together, so preq_resolve keeps every power it had.
--
-- USING says WHICH ROWS you may touch: your own, and only while nobody has
-- acted on it. WITH CHECK says WHAT IT MAY BECOME, and that is where the care
-- is — a policy is a ROW rule, so without the value tests an author-scoped
-- policy would hand the author every column on the row, including the verdict
-- itself. `status in ('open','dismissed')` is what keeps "ordered" the
-- purchaser's word: an author may fix or withdraw, never mark their own
-- request bought. Withdrawing is a dismissal (there is no delete policy and
-- there should not be one), so the CHECK above makes them say why, which is
-- what leaves a legible record of a request that vanished.
create policy preq_author_update on purchase_requests for update
  using (
    requested_by = auth.uid()
    and status = 'open'
  )
  with check (
    requested_by = auth.uid()
    and status in ('open', 'dismissed')
    and (resolved_by is null or resolved_by = auth.uid())
  );

-- ----------------------------------------------------------------------------
-- One index, for one reader
-- ----------------------------------------------------------------------------
-- The order guide asks "how many are open here?" on every load, which is the
-- app's heaviest route. That is the whole of this index's job: the Requests
-- LIST cannot use it, because its status tabs need the unfiltered population
-- to count, so that query carries no status predicate at all. 001 created no
-- index on this table whatsoever.
create index purchase_requests_open_idx
  on purchase_requests (location_id, created_at)
  where status = 'open';

-- ----------------------------------------------------------------------------
-- What this does NOT do
-- ----------------------------------------------------------------------------
-- `photo_path` keeps its seat, unwritten. Mark, 2026-08-21: "photos aren't
-- needed, I don't think. At least not now." Dropping it would spend a
-- migration to remove an option he deliberately left open; the app simply
-- never writes it, and 018's bucket-and-policies work is what it would cost to
-- start.
--
-- `resolved_po_item_id` likewise. Spec §4.7 imagined resolving a request BY
-- converting it into a PO line, and v1 deliberately does not couple — the
-- purchaser buys the thing however they buy it and says so in a sentence. The
-- column is the seat for that coupling when it comes, and its FK survived
-- 005's rename by OID, so it points at purchase_order_items today.
--
-- No delete policy is added. Two exits are enough, and the absence of the
-- policy IS the enforcement (the Clear-guide lesson: a delete matching no
-- policy removes zero rows and PostgREST reports success).

notify pgrst, 'reload schema';

-- ============================================================================
-- Verify (run as a SIGNED-IN user, not service_role — these are RLS paths):
--
--   -- 1. The shape.
--   select column_name from information_schema.columns
--    where table_name = 'purchase_requests' order by ordinal_position;
--     -- includes priority, inventory_item_id, resolved_at, resolution_note
--     -- and NO dismiss_reason
--
--   select polname from pg_policy
--    where polrelid = 'public.purchase_requests'::regclass;
--     -- four rows now: preq_read, preq_insert, preq_resolve, preq_author_update
--
--   -- 2. A dismissal has to say why.
--   insert into purchase_requests (org_id, location_id, requested_by, request_text)
--   values (:org, :location, auth.uid(), 'verify 059') returning id;
--
--   update purchase_requests set status = 'dismissed' where id = :id;
--     -- ERROR: violates check constraint "purchase_requests_reason_when_dismissed"
--
--   update purchase_requests
--      set status = 'dismissed', resolution_note = 'duplicate',
--          resolved_at = now(), resolved_by = auth.uid()
--    where id = :id;                                    -- UPDATE 1
--
--   -- 3. Marking ordered needs no note (as a purchaser+).
--   update purchase_requests set status = 'ordered', resolved_at = now(),
--          resolved_by = auth.uid()
--    where id = :id;                                    -- UPDATE 1
--
--   -- 4. As a STAFF member, on your own open row: the text may be fixed and
--   --    the verdict may not.
--   update purchase_requests set request_text = 'fixed' where id = :mine;
--     -- UPDATE 1
--   update purchase_requests set status = 'ordered' where id = :mine;
--     -- UPDATE 0, and NO error — the WITH CHECK is what refuses it, so the
--     -- app must not offer the command rather than relying on a message.
--   delete from purchase_requests where id = :mine;
--     -- DELETE 0, no error. There is no delete policy, deliberately.
--
--   delete from purchase_requests where request_text in ('verify 059','fixed');
--     -- (as service_role — the app cannot, by design)
-- ============================================================================
