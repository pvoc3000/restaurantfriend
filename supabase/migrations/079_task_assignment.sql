-- 079 — a task can be somebody's.
--
-- Mark, 2026-08-31: "Tasks should be assignable to someone. Not mandatory, but
-- when assigned they only appear on that person's checklist."
--
-- ONE NULLABLE COLUMN. Null is the resting state and means what it has always
-- meant — the job is on whoever is walking tonight — so no existing row needs
-- touching and nothing changes for a shop that never assigns anything.
--
-- IT POINTS AT AN APP USER, NOT AT AN EMPLOYEE, and that is the decision to
-- understand before changing any of it. The effect Mark asked for is about
-- WHOSE CHECKLIST a task appears on, and a checklist is walked by somebody
-- signed in: `checklist_runs.started_by` is an auth user, and the carried-task
-- band is rendered for whoever is looking at it. Assigning to an `employees`
-- row would let a shop assign work to the overnight baker, who has an HR record
-- and no login (044's own distinction) — and the task would then appear on
-- NOBODY's checklist while looking assigned. An assignment must never be able
-- to make a job invisible.
--
-- The roster is therefore `org_members`, which 001's `members_read` already
-- shows to every member of the org, so this needs no definer function — unlike
-- 044's `production_operators` and 053's `special_order_takers`, both of which
-- exist only because `employees` READ is owner/admin (020).
--
-- NO `on delete` CLAUSE, matching `created_by` and `done_by` beside it, which
-- is 4c's rule: an auth user is BANNED when access is revoked, never deleted,
-- because 001's audit columns reference `auth.users` with no cascade and the
-- history should keep its author. So an assignment survives a revoke — and the
-- app is what handles that: `openTasksForRun` shows a task whose assignee is no
-- longer a member of the org to EVERYONE, because the alternative is a job that
-- silently stops appearing on any checklist the day somebody leaves. That is
-- the one rule here worth keeping if this is ever rewritten.
--
-- NO INDEX. The carry-forward query already fetches a shop's open tasks whole
-- (`location_tasks_open_idx`) and filters in TypeScript, which is where the
-- shift and carry-forward tests already live; a shop's open tasks are a handful
-- of rows, and an index nothing plans against is a write cost for nothing.
--
-- NO POLICY CHANGE. 075 is supervisor+ on every verb because a task is a
-- supervisor's own record end to end — a ROW rule, therefore a policy. This is
-- one more column on that row, not a column-scoped rule, so there is nothing
-- here for a definer function to do. Anybody who could edit a task can assign
-- it, including to somebody else, which is what "hand this to Karina" means.

alter table location_tasks
  add column assigned_to uuid references auth.users(id);

comment on column location_tasks.assigned_to is
  'Who this job is for, as an app user (org_members.user_id). NULL means '
  'anybody, which is the default. When set, the task appears on that person''s '
  'checklist and nobody else''s — EXCEPT when the assignee is no longer a '
  'member of the org, in which case the app shows it to everyone rather than '
  'letting an assignment silently hide a job. Deliberately not an employees '
  'reference: a checklist is walked by somebody signed in.';
