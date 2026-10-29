-- 212 — THE MORNING SALES RUN'S LOG.
--
-- Mark, 2026-10-29: weeks of pressing Sync from Square and Post to QuickBooks
-- every morning went without a hitch, so `sales-nightly` now does both at
-- 7 AM and emails a summary — yesterday's sales beside the same weekday 52
-- weeks earlier, the deposits, and every problem named with its fix. One row
-- here per run is what the Sales screen's banner reads, and how the run knows
-- it has already happened today.
--
-- Written only by the function, with service_role: there is no insert or
-- update policy, so no signed-in client can write a row. A purchaser and
-- above can read them, matching who can open /sales (lib/pageAccess).
--
-- The run's settings are `orgs.settings.sales_automation` — `enabled` and
-- `bot_user_id` (the purchaser member it signs in as) — written by the
-- Settings screen, not here. Absent means off. The email goes to the owner
-- and managers, by role, as the shift report's management version does.
--
-- The schedule itself is 213, applied after the function is deployed.

begin;

create table if not exists sales_automation_runs (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id) on delete cascade,
  -- `cron` is the 7 AM run; `manual` is Run Now on the Sales screen.
  trigger       text not null check (trigger in ('cron', 'manual')),
  dry_run       boolean not null default false,
  -- The org's own date when it ran: one cron run per org per date.
  local_date    date not null,
  window_from   date not null,
  window_to     date not null,
  started_at    timestamptz not null default now(),
  started_by    uuid references auth.users(id) on delete set null,
  finished_at   timestamptz,
  -- `running` until it finishes; `ok` with no problems, `attention` with
  -- some, `failed` when it stopped partway.
  status        text not null default 'running'
                check (status in ('running', 'ok', 'attention', 'failed')),
  -- [{kind, shop?, date?, message, fix, href?, hrefLabel?}] — `RunProblem`
  -- in supabase/functions/_shared/salesAutomation.ts.
  problems      jsonb not null default '[]'::jsonb,
  -- `RunSummary` there: yesterday's sales, last year's, the deposits, counts.
  summary       jsonb,
  emailed_to    text,
  emailed_at    timestamptz,
  email_error   text
);

comment on table sales_automation_runs is
  'One row per morning sales run (sales-nightly): sync from Square, post to QuickBooks, email the summary. Written by the function only.';

-- The claim. Pg_cron fires at 14:00 AND 15:00 UTC so that one of them is
-- 7 AM Pacific whatever the clocks say; the function checks the hour, and
-- this makes a second real run on one date impossible rather than unlikely.
create unique index if not exists sales_automation_runs_one_cron_per_day
  on sales_automation_runs (org_id, local_date)
  where trigger = 'cron' and not dry_run;

create index if not exists sales_automation_runs_latest
  on sales_automation_runs (org_id, started_at desc);

alter table sales_automation_runs enable row level security;

create policy sales_automation_runs_select on sales_automation_runs for select
  using (user_has_role(org_id, array['owner', 'admin', 'purchaser']));

commit;
