-- ============================================================================
-- 169 — A NOTE FROM AN /INQUIRY IS FLAGGED UNTIL SOMEBODY READS IT
--
-- Mark, 2026-10-02: "if an inquiry comes in with a note, add some sort of
-- alert on the label for the Notes tab. A '!' with a yellow background", and
-- "the alert can be removed once the user has viewed the tab."
--
-- The customer's words land in `special_orders.notes_general` (`create_inquiry`
-- writes the interest and the description there, `source = 'inquiry'`). The
-- order shows the "!" while that note is there and nobody has opened the Notes
-- tab; opening it inserts a row here and the mark is gone — for everybody,
-- because the question is whether the customer's note has been read, not who
-- has read it.
--
-- ITS OWN TABLE, not a column on the order: writing the order would run its
-- update triggers and move `updated_at` every time somebody merely looked at a
-- note, and a staff member who may read an order may not necessarily write it.
-- Membership-only policies, like the order's own reads.
--
-- Existing inquiry orders with a note: those past the lead stage are marked
-- read (somebody quoted or cancelled them); the open leads keep the mark.
-- RERUNNABLE.
-- ============================================================================

create table if not exists special_order_note_reads (
  order_id uuid primary key references special_orders(id) on delete cascade,
  org_id   uuid not null references orgs(id) on delete cascade,
  read_at  timestamptz not null default now(),
  read_by  uuid references auth.users(id) on delete set null
);

comment on table special_order_note_reads is
  'An order whose /inquiry note somebody has read, so the Notes tab stops '
  'showing its "!" (169). One row per order.';

alter table special_order_note_reads enable row level security;

drop policy if exists special_order_note_reads_select on special_order_note_reads;
create policy special_order_note_reads_select on special_order_note_reads for select
  using (org_id in (select user_org_ids()));

drop policy if exists special_order_note_reads_insert on special_order_note_reads;
create policy special_order_note_reads_insert on special_order_note_reads for insert
  with check (org_id in (select user_org_ids()));

revoke all on table special_order_note_reads from anon;

insert into special_order_note_reads (order_id, org_id)
select id, org_id
  from special_orders
 where source = 'inquiry'
   and coalesce(status, '') <> 'lead'
on conflict (order_id) do nothing;
