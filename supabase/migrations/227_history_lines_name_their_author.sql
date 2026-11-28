-- ============================================================================
-- 227 — a History line that knows WHO wrote it also says their name
-- ============================================================================
-- Mark, 2026-11-27, after the print stamp's History fix: "Yes, fix it".
--
-- `special_order_events` carries the author twice: `author_id` (the user) and
-- `author` (their display name, the column History shows, because FileMaker's
-- 106,465 rows carry names rather than ids). `log_special_order_event` (054)
-- fills both. `schedule_special_order` and `unschedule_special_order` (069)
-- insert directly and fill only `author_id`, so 160 lines since 2026-08-28 (157
-- "Production scheduled for …", 3 "Production unscheduled — …") read as
-- unattributed, while the database knew exactly who wrote each one.
--
-- DRY-RUN 2026-11-27 on the hosted DB, in a transaction that raised instead of
-- committing: 0 unnamed lines left, an insert naming a user and no name came
-- back "Mark", an insert supplying "Website" kept it.
--
-- FIXED ON THE TABLE, NOT IN THE FUNCTION. A BEFORE INSERT trigger fills
-- `author` from `org_members.display_name` whenever an insert names a user and
-- no name. That repairs this writer without restating 069's long function, and
-- it covers the next direct insert that makes the same omission. A writer that
-- supplies a name keeps it; a line with no user (the customer's own approvals,
-- the system) stays nameless, as it should.
--
-- Rerunnable.
-- ============================================================================

create or replace function public.trg_special_order_event_author()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.author is null and new.author_id is not null then
    select m.display_name into new.author
      from org_members m
     where m.user_id = new.author_id and m.org_id = new.org_id;
  end if;
  return new;
end;
$$;
revoke all on function public.trg_special_order_event_author() from public, anon, authenticated;

drop trigger if exists trg_special_order_events_author on special_order_events;
create trigger trg_special_order_events_author
  before insert on special_order_events
  for each row execute function trg_special_order_event_author();

-- The 160 lines already written. Only where a name is missing and the member
-- still exists; a departed member's line stays as it is rather than guessing.
update special_order_events e
   set author = m.display_name
  from org_members m
 where e.author is null
   and e.author_id is not null
   and m.user_id = e.author_id
   and m.org_id = e.org_id
   and m.display_name is not null;
