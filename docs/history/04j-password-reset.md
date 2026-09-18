<!-- Moved verbatim from CLAUDE.md on 2026-09-18 (Claude Code /doctor). Everything below line 2 is the original text. -->

4j. ✅ **A WAY BACK INTO THE APP — migration 074 + `request-password-reset`,
   APPLIED, DEPLOYED and tested 2026-08-29.** `/login` never had a forgot-
   password link. Fine while every account belonged to Mark or Traci; not fine
   the moment eight supervisors have logins, when the first to forget is stuck
   until somebody runs the admin API by hand.
   **`supabase.auth.resetPasswordForEmail` WOULD HAVE BEEN ONE LINE AND IS THE
   WRONG LINE.** It sends through Supabase's own mailer, from a supabase.co
   address, on a handful-per-hour quota — where every other message this app
   sends goes out as the org through `_shared/email.ts`. A password reset is the
   LAST message you want arriving from an address the recipient does not
   recognise.
   **THE ANSWER IS ALWAYS THE SAME** — 052 and 057's rule, and the whole
   security property. Not in the body, not in the status, and **not in the
   timing either**, which is why 074 records attempts against addresses that do
   NOT exist: throttling only the real ones would turn the endpoint into an
   account enumerator, because the unthrottled replies would be the fakes.
   Verified live — known and unknown addresses returned byte-identical
   responses, and the throttle bit on an unknown address on the fourth try.
   **A BANNED ACCOUNT GETS NOTHING**, silently: revoking access bans the auth
   user (4c) rather than deleting it, and access removed is not a password to
   reset.
   074 exists because the endpoint is PUBLIC and spends the org's Gmail quota,
   **which is shared with purchase orders** — the first symptom of abuse would be
   a PO that silently failed to send. Three per address per hour, thirty
   overall. SELECT is owner/admin ("did it actually go out?" is a real support
   question); there are **NO write policies at all**, so the service_role
   function is the only writer (033's `timesheet_benefits` shape). Verified on
   the harness: the owner reads it, a supervisor sees zero rows, and both
   authenticated and anon inserts are refused.
   **`/welcome` takes a THIRD link type.** All three — `invite`, `magiclink`,
   `recovery` — end the same way, but the copy no longer calls a password reset
   an "invitation". Its "nothing is verified on load" property is what let the
   page be checked with a real token without spending it.
   The link reuses the login form's OWN email field rather than opening a dialog
   with a second one, sits BELOW the commit (the way out of a dead end, not a
   second thing to choose between), and is `type="button"` or it would submit
   the form it lives in.
   **Known and not chased:** the reset mail goes out as `info@donutfriend.com`,
   the same mailbox POs use. A `shift_report`-style provider key would move it.

