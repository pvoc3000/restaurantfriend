-- 215 — CHECK THE SPECIAL-ORDERS MAILBOX EVERY FIVE MINUTES (214 is what it fills).
--
-- APPLY LAST: after `order-mail` is deployed (--no-verify-jwt), the
-- specialorders@ credential has been re-minted with `gmail.readonly`, and both
-- secrets below exist. A firing before then fails at Gmail and writes the
-- reason to `special_order_mail_sync.last_error`, which the Emails tab shows —
-- harmless, but noisy.
--
-- pg_net posts and does not wait: the function answers at once and carries
-- on in the background, so the 10 s timeout is only the answer's.
--
-- TWO VAULT SECRETS, created by hand in the SQL editor, never in a migration:
--   select vault.create_secret('https://kltxioacvneshbyhxtaj.supabase.co/functions/v1/order-mail', 'order_mail_url');
--   select vault.create_secret('<the same value as the ORDER_MAIL_SECRET edge secret>', 'order_mail_secret');

begin;

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Rescheduling replaces a job of the same name, so re-applying is safe.
select cron.schedule(
  'order-mail-every-5-min',
  '*/5 * * * *',
  $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'order_mail_url'),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-order-mail-secret',
        (select decrypted_secret from vault.decrypted_secrets where name = 'order_mail_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 10000
    );
  $job$
);

commit;
