-- ============================================================================
-- restaurantfriend — migration 226 · A task's history, and notes on it
--
-- SQL STARTS AT LINE 53. Everything above it is comment.
--
-- Mark, 2026-11-23, on `/maintenance-requests`: "I would also like to be able
-- to track and update progress for requests, change status, make notes, etc."
-- A request is worked over days — a plumber called, a part ordered, a visit
-- rescheduled — and until now the row held only its CURRENT state. Nothing
-- said who changed it, or when, or what was tried.
--
-- THIS IS 054's SHAPE, deliberately. The special order's log is the house
-- pattern for "a record that writes its own history": one events table, a
-- definer writer that resolves the author's name once, and a trigger that
-- watches named columns and writes ONE sentence per statement. Read 054's
-- header for the reasoning (why a trigger and not app code, why a definer,
-- why execute is revoked); none of it is restated here.
--
-- WHAT DIFFERS FROM 054, and why:
--
--   · NOTES ARE PERMANENT. 051 gave the order log an UPDATE policy so a typed
--     note could be corrected. Mark chose otherwise here (2026-11-23): "notes
--     are permanent". So there is no update policy and no delete policy — a
--     wrong note is answered by another note, as in a paper log.
--
--   · A NOTE CANNOT PASS ITSELF OFF AS THE APP. The insert policy demands
--     `source = 'manual'` and `author_id = auth.uid()`. Entries the trigger
--     writes arrive through the definer, which RLS does not see, so `app`
--     means exactly "the database wrote this because a column changed".
--
--   · THE WATCH LIST IS SHORT ON PURPOSE (Mark, 2026-11-23): status,
--     priority, assignee, due date, the description, plus the vendor (new on
--     screen with this change) and the kind (moving between the two lists).
--     Section, equipment, shift and carry-forward are not watched. The
--     description is logged as "Description edited", never the old text — a
--     paragraph quoted twice per edit would bury the timeline.
--
--   · CREATION IS LOGGED TOO, which 054 did not need (an order's own log
--     started with FileMaker's history). A task flagged on a checklist says so.
--
--   · A RESOLUTION NOTE RIDES ITS STATUS SENTENCE: "Status changed from Open
--     to Done — replaced the gasket". ResolveTask writes status and note in
--     one statement, so they arrive together and read as one event.
--
-- BACKFILL: one "Created" entry per existing task, and one closing entry per
-- done or cancelled task, so the timeline does not start blank on rows that
-- have plainly lived. Guarded, so a rerun writes nothing twice.
--
-- Rerunnable.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. THE TABLE
-- ----------------------------------------------------------------------------
create table if not exists location_task_events (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  task_id     uuid not null references location_tasks(id) on delete cascade,
  happened_at timestamptz not null default now(),
  -- The display name at the time of writing, as 051 does: a name, so an entry
  -- still reads after its author's membership is gone.
  author      text,
  author_id   uuid references auth.users(id),
  message     text not null check (btrim(message) <> ''),
  -- 'app'    — the database wrote it because something changed.
  -- 'manual' — a person typed it.
  source      text not null default 'manual' check (source in ('app', 'manual')),
  created_at  timestamptz not null default now()
);

create index if not exists location_task_events_task_idx
  on location_task_events (task_id, happened_at desc);

alter table location_task_events enable row level security;

-- Reading follows the task: supervisor and up, 075's set.
drop policy if exists location_task_events_select on location_task_events;
create policy location_task_events_select on location_task_events for select
  using (user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor']));

-- Writing is a NOTE and nothing else. The task must be one the writer can see
-- in the same org — the subquery runs under location_tasks' own RLS.
drop policy if exists location_task_events_insert on location_task_events;
create policy location_task_events_insert on location_task_events for insert
  with check (
    user_has_role(org_id, array['owner', 'admin', 'purchaser', 'supervisor'])
    and source = 'manual'
    and author_id = auth.uid()
    and task_id in (select t.id from location_tasks t where t.org_id = location_task_events.org_id)
  );

-- NO UPDATE, NO DELETE. See the header. An update or delete from the app
-- touches zero rows and returns no error, so the screen must never offer one.

-- A NOTE'S NAME AND TIME ARE THE DATABASE'S, not the client's. The policy pins
-- `author_id`, but `author` is free text and `happened_at` has only a default,
-- so a note could otherwise be signed with somebody else's name or backdated
-- — which would make "permanent" mean little. Stamped here for typed notes;
-- the writer above already does both for the app's own entries.
create or replace function public.trg_stamp_location_task_note()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.source = 'manual' then
    new.happened_at := now();
    select nullif(btrim(m.display_name), '') into new.author
      from org_members m
     where m.org_id = new.org_id and m.user_id = new.author_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_location_task_events_stamp on location_task_events;
create trigger trg_location_task_events_stamp
  before insert on location_task_events
  for each row execute function trg_stamp_location_task_note();


-- ----------------------------------------------------------------------------
-- 2. THE WRITER
-- ----------------------------------------------------------------------------
create or replace function public.log_location_task_event(
  p_org_id uuid,
  p_task_id uuid,
  p_message text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_author text;
begin
  if p_message is null or btrim(p_message) = '' then
    return;
  end if;

  select m.display_name into v_author
    from org_members m
   where m.user_id = auth.uid() and m.org_id = p_org_id;

  insert into location_task_events (org_id, task_id, author, author_id, message, source)
  values (p_org_id, p_task_id, v_author, auth.uid(), p_message, 'app');
end;
$$;


-- ----------------------------------------------------------------------------
-- 3. WORDS FOR VALUES
-- ----------------------------------------------------------------------------
-- The labels the screens print (`lib/facilityTasks`), in American spelling:
-- the stored value stays 'cancelled', the sentence says Canceled.
create or replace function public.location_task_status_label(p text)
returns text language sql immutable set search_path = public as $$
  select case p
    when 'open'        then 'Open'
    when 'in_progress' then 'In Progress'
    when 'done'        then 'Done'
    when 'cancelled'   then 'Canceled'
    else p
  end
$$;

-- A member's name in this org, or a legible stand-in.
create or replace function public.location_task_member_name(p_org uuid, p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select nullif(btrim(m.display_name), '')
       from org_members m where m.org_id = p_org and m.user_id = p_user),
    'a former member'
  )
$$;


-- ----------------------------------------------------------------------------
-- 4. THE TRIGGER
-- ----------------------------------------------------------------------------
create or replace function public.trg_log_location_task()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parts text[] := '{}';
  v_phrase text;
  v_name text;
begin
  if tg_op = 'INSERT' then
    perform log_location_task_event(
      new.org_id, new.id,
      case when new.source_run_item_id is not null
           then 'Raised on a checklist'
           else 'Created' end
    );
    return null;
  end if;

  if new.kind is distinct from old.kind then
    v_parts := v_parts || case new.kind
      when 'maintenance' then 'Moved to maintenance requests'
      else 'Moved to tasks' end;
  end if;

  if new.status is distinct from old.status then
    v_phrase := format('Status changed from %s to %s',
      location_task_status_label(old.status), location_task_status_label(new.status));
    if new.status in ('done', 'cancelled')
       and new.resolution_note is not null and btrim(new.resolution_note) <> '' then
      v_phrase := v_phrase || ' — ' || btrim(new.resolution_note);
    end if;
    v_parts := v_parts || v_phrase;
  end if;

  if new.priority is distinct from old.priority then
    v_parts := v_parts || format('Priority changed from %s to %s',
      initcap(old.priority), initcap(new.priority));
  end if;

  if new.assigned_to is distinct from old.assigned_to then
    v_parts := v_parts || case
      when new.assigned_to is null then 'Unassigned'
      else 'Assigned to ' || location_task_member_name(new.org_id, new.assigned_to) end;
  end if;

  if new.due_on is distinct from old.due_on then
    v_parts := v_parts || case
      when new.due_on is null then 'Due date cleared'
      else 'Due date set to ' || to_char(new.due_on, 'Mon FMDD, YYYY') end;
  end if;

  if new.details is distinct from old.details then
    v_parts := v_parts || case
      when new.details is null or btrim(new.details) = '' then 'Description cleared'
      when old.details is null or btrim(old.details) = '' then 'Description added'
      else 'Description edited' end;
  end if;

  if new.vendor_id is distinct from old.vendor_id then
    if new.vendor_id is null then
      v_parts := v_parts || 'Vendor cleared'::text;
    else
      select v.name into v_name from vendors v where v.id = new.vendor_id;
      v_parts := v_parts || ('Vendor set to ' || coalesce(v_name, 'a vendor that no longer exists'));
    end if;
  end if;

  if array_length(v_parts, 1) is null then
    return null;
  end if;

  perform log_location_task_event(new.org_id, new.id, array_to_string(v_parts, '; '));
  return null;
end;
$$;

drop trigger if exists trg_location_tasks_log on location_tasks;
create trigger trg_location_tasks_log
  after insert or update on location_tasks
  for each row execute function trg_log_location_task();

-- Machinery, not an API — 054's revoke, by name (CLAUDE.md: revoking from
-- PUBLIC does not undo Supabase's default grant to anon).
revoke all on function public.log_location_task_event(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.location_task_member_name(uuid, uuid) from public, anon, authenticated;
revoke all on function public.trg_log_location_task() from public, anon, authenticated;
revoke all on function public.trg_stamp_location_task_note() from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- 5. BACKFILL
-- ----------------------------------------------------------------------------
insert into location_task_events (org_id, task_id, happened_at, author, author_id, message, source)
select t.org_id, t.id, t.created_at,
       (select nullif(btrim(m.display_name), '') from org_members m
         where m.org_id = t.org_id and m.user_id = t.created_by),
       t.created_by,
       case when t.source_run_item_id is not null then 'Raised on a checklist' else 'Created' end,
       'app'
  from location_tasks t
 where not exists (select 1 from location_task_events e where e.task_id = t.id);

insert into location_task_events (org_id, task_id, happened_at, author, author_id, message, source)
select t.org_id, t.id, coalesce(t.done_at, t.updated_at),
       (select nullif(btrim(m.display_name), '') from org_members m
         where m.org_id = t.org_id and m.user_id = t.done_by),
       t.done_by,
       'Marked ' || location_task_status_label(t.status)
         || coalesce(' — ' || nullif(btrim(t.resolution_note), ''), ''),
       'app'
  from location_tasks t
 where t.status in ('done', 'cancelled')
   and (select count(*) from location_task_events e where e.task_id = t.id) = 1;


-- ============================================================================
-- Probes:
--
--   select polname, polcmd from pg_policy
--    where polrelid = 'public.location_task_events'::regclass;
--     → TWO rows (select, insert). A third would make notes editable.
--
--   select count(*) from location_task_events;   -- ≥ count of location_tasks
--
--   select tgname from pg_trigger
--    where tgrelid = 'public.location_tasks'::regclass and not tgisinternal;
--     → includes trg_location_tasks_log
-- ============================================================================
