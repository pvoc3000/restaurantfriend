-- ============================================================================
-- restaurantfriend — migration 074 · a record of password-reset requests
--
-- Why (Mark, 2026-08-29): "add a forgot password link to the login page."
--
-- `/login` has never had one. That was fine while every account belonged to
-- Mark or Traci and stops being fine the moment eight supervisors have logins:
-- the first one who forgets is stuck until somebody runs the admin API by hand.
--
-- ---------------------------------------------------------------------------
-- WHY THERE IS A TABLE AT ALL
--
-- The reset endpoint is PUBLIC and it sends mail. Two things follow.
--
-- It shares the org's Gmail quota with purchase orders, quotes, invoices and
-- shift reports. A handful of scripted requests could exhaust it and the first
-- symptom would be a purchase order that silently failed to send — so the
-- endpoint has to be able to say "not again yet", and saying that needs
-- somewhere to count.
--
-- And a public send-mail endpoint can be pointed at somebody else's inbox. Only
-- REGISTERED addresses ever receive anything, so the blast radius is this
-- shop's own staff, but that is exactly who it would be most annoying for.
--
-- ---------------------------------------------------------------------------
-- IT RECORDS THE ATTEMPT, NOT THE OUTCOME OF THE LOOKUP
--
-- A row is written whether or not the address belongs to an account, and
-- `sent` says which. That ordering is deliberate: the throttle has to bite on
-- addresses that do NOT exist too, or the endpoint becomes an account
-- enumerator — try a thousand addresses, and the ones that answer slowly are
-- the real ones. The function's reply is identical either way (052 and 057's
-- rule: never reveal whether an email is known), and this table is what keeps
-- the TIMING from leaking it as well.
--
-- ---------------------------------------------------------------------------
-- NO WRITE POLICIES, DELIBERATELY
--
-- The only writer is the edge function under `service_role`, which bypasses
-- RLS — the same shape as 033's `timesheet_benefits`, whose sole writer is a
-- definer. There is nothing an authenticated user should ever insert here, and
-- an anon INSERT policy would be a way to fill the table without sending
-- anything.
--
-- SELECT is owner/admin: "did the reset actually go out?" is a real support
-- question, and the answer is here.
--
-- Depends on 001 (user_has_role). Run in the Supabase SQL editor BEFORE
-- deploying the function. NOT rerunnable.
-- ============================================================================

create table password_reset_requests (
  id uuid primary key default gen_random_uuid(),

  -- Lower-cased by the caller, because that is what the throttle groups on and
  -- "Mark@" and "mark@" are one mailbox.
  email text not null,

  -- Whether a link was actually minted and mailed. False for an address with
  -- no account, for a banned one — access revoked is not a password to reset —
  -- and for a request the throttle refused.
  sent boolean not null default false,
  detail text,

  -- Evidence rather than a key: 057 records the IP the same way. Nothing reads
  -- it to make a decision; it is here for the day somebody asks what happened.
  source_ip text,

  requested_at timestamptz not null default now()
);

-- The throttle's own query: recent rows for one address.
create index password_reset_requests_email_idx
  on password_reset_requests (email, requested_at desc);
-- And the global one.
create index password_reset_requests_recent_idx
  on password_reset_requests (requested_at desc);

alter table password_reset_requests enable row level security;

create policy password_reset_requests_select on password_reset_requests for select
  using (
    exists (
      select 1 from org_members
       where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

-- ----------------------------------------------------------------------------
-- After this runs:
--   select count(*) from password_reset_requests;                        → 0
--   select count(*) from pg_policy
--    where polrelid = 'public.password_reset_requests'::regclass;        → 1
--     (SELECT only — the edge function writes as service_role)
-- ============================================================================
