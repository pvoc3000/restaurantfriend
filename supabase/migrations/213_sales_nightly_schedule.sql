-- 213 — THE 7 AM SCHEDULE for `sales-nightly` (212 is its log).
--
-- APPLY LAST: after `sales-nightly` is deployed and both secrets below exist.
-- Until `orgs.settings.sales_automation.enabled` is true the function answers
-- every firing with "not enabled" and does nothing, so applying this early is
-- harmless — but the secrets must exist or every firing fails quietly.
--
-- THE FIRST CRON IN THIS APP (040 and 186 both say there is none). pg_cron
-- runs in UTC, and 7 AM Pacific is 14:00 UTC in summer and 15:00 in winter,
-- so it fires at BOTH and the function goes ahead only when it is 7 AM in the
-- org's own timezone (`orgs.settings.timezone`); 212's unique index makes a
-- second run on one date impossible.
--
-- pg_net posts and does not wait for the run: the function answers at once
-- and carries on in the background, so the 10 s timeout here is only the
-- answer's, not the run's.
--
-- TWO VAULT SECRETS, created by hand in the SQL editor, never in a migration:
--   select vault.create_secret('https://kltxioacvneshbyhxtaj.supabase.co/functions/v1/sales-nightly', 'sales_nightly_url');
--   select vault.create_secret('<the same value as the SALES_AUTOMATION_SECRET edge secret>', 'sales_automation_secret');

begin;

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Rescheduling replaces a job of the same name, so re-applying is safe.
select cron.schedule(
  'sales-nightly-14utc',
  '0 14 * * *',
  $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'sales_nightly_url'),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-sales-automation-secret',
        (select decrypted_secret from vault.decrypted_secrets where name = 'sales_automation_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 10000
    );
  $job$
);

select cron.schedule(
  'sales-nightly-15utc',
  '0 15 * * *',
  $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'sales_nightly_url'),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-sales-automation-secret',
        (select decrypted_secret from vault.decrypted_secrets where name = 'sales_automation_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 10000
    );
  $job$
);

commit;
