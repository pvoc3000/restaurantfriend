# Shared iPad — PIN switching on a registered device

Mark, 2026-09-08: "users will be sharing a device, an iPad, to access the app
and I can envision that unless we're proactive about it people will,
unintentionally, do so using someone else's account."

Migration **097**, edge function **`device-session`**, server actions in
`web/src/app/deviceActions.ts`, the pure rules in `web/src/lib/sharedDevice.ts`.

## The shape

The iPad is REGISTERED to the org (an owner/admin on `/settings › Shared
devices`, done on the iPad itself). From then on it opens on `/lock`: a name
picker, then a four-digit PIN. The PIN mints a REAL Supabase session for that
person — the edge function verifies it and hands back a magic-link token that a
server action spends the way `/welcome` spends an invitation — so `auth.uid()`
and every audit column keep meaning what they say. Five minutes idle and the
screen locks back to the picker. From any browser without the device cookie,
nothing changes: email and password.

Decisions locked: **4 digits** · **5 minutes** · a person sets their own PIN on
`/account`, an owner/admin can set or clear it from the employee record's
Admin tab · a device is **not bound to a shop** — the picker lists every member
holding a PIN, and the working location stays whatever they last used.

## Two properties everything turns on

**A PIN is not a password.** A PIN-minted session carries an httpOnly
`rf.pin_session` cookie, and while it is present `/account` refuses a password
or PIN change, the Admin tab refuses to set anybody's PIN, and `/settings`
refuses to register or forget a device — each in words, pointing at `/login`.
Otherwise a four-digit PIN is a route to everything.

**Nothing leaves Postgres.** `member_pins` holds a bcrypt hash and has RLS with
ZERO policies (081's shape). It is written only by `set_my_pin` /
`set_member_pin` and read only by `attempt_pin_unlock`, which compares inside
the database under an advisory lock on the user and returns one word:
`bad_device | locked | wrong | ok`. The edge function never sees a hash and the
throttle cannot be raced.

## The throttle

Ten failures on a device in fifteen minutes, five for a person in fifteen
minutes, twenty for a person in a day. Every attempt is a `pin_attempts` row,
lockouts included, so pressing through one does not wear it down. A lockout is
REPORTED with the seconds remaining — it is not a secret, and the screen says
"try again in twelve minutes" rather than letting somebody keep pressing. An
unknown id and a wrong PIN both answer `wrong`, and the bcrypt work runs either
way so the timing matches.

## The cookies

| cookie | set by | lifetime | meaning |
| --- | --- | --- | --- |
| `rf.device` | `registerThisDevice` | a year, httpOnly | `${id}.${secret}`; the secret's sha256 is what the database holds |
| `rf.pin_session` | `unlockWithPin` | session, httpOnly | this session came from a PIN |

`clearSessionCookies` (`lib/sessionCookies.ts`) is the one sweep — the guide,
PO and invoice views, the menu memory, the PIN mark — used by `signOut`,
`lockDevice` and `unlockWithPin`. Never `rf.device`; a device survives a
sign-out. Both sign-outs are `scope: "local"`: the default `global` revokes
every refresh token the user holds, and locking the iPad must not sign the
manager out of their own phone.

The lock screen finishes with a HARD navigation (`window.location.assign`),
which is what empties the client-side Maps in `scrollMemory`, `viewMemory` and
`navMemoryStore`. localStorage (column widths, layouts) is device-level and
survives on purpose.

## Routing

`proxy.ts` exempts `/lock`; a signed-out request carrying `rf.device` goes to
`/lock` instead of `/login` (which stays reachable from the picker as the
escape hatch); signed in on `/lock` goes home. `getAppSession` makes the same
choice for a session that expires between the proxy and the page.
`components/IdleLock` mounts in both layouts only when the session sees the
cookie; it keeps a last-activity timestamp and checks it on `visibilitychange`
and `focus` as well as on a timer, because an iPad suspends JavaScript when the
screen sleeps and the wake is what should lock.

## Deploy

1. Apply `supabase/migrations/097_shared_device_pins.sql` in the SQL editor.
2. `npx supabase functions deploy device-session --project-ref kltxioacvneshbyhxtaj`
   (default JWT verification — the calls carry the anon key, like
   `request-password-reset`). No new secrets.
3. Deploy the web app.

## Probes

```sql
select count(*) from pg_policy where polrelid = 'public.member_pins'::regclass;        -- 0
select count(*) from pg_policy where polrelid = 'public.registered_devices'::regclass; -- 1
select proname, proacl from pg_proc where proname in ('device_members','attempt_pin_unlock');
  -- no authenticated= or anon= entry in either
select public.set_my_pin('123');  -- raises "a PIN is exactly four digits"
```

## Verified on the Docker harness (2026-09-08)

All 100 migration files replay. As real roles: staff `set_my_pin('123')` and
`'abcd'` raise, `'0420'` writes a `$2a$` hash; staff and the owner both select
0 rows of `member_pins`; staff cannot read another's status or set another's
PIN; the owner sets, reads and clears a colleague's; the owner registers a
device, a malformed hash is refused, staff cannot register and see 0 devices
and 0 attempts; `device_members` and `attempt_pin_unlock` are permission-denied
to `authenticated` and `anon`; as `service_role` a bad secret is `bad_device`,
a wrong PIN and an unknown id are both `wrong`, the right PIN is `ok` and
stamps `last_seen_at`, the fifth failure is `locked` with 900 seconds and the
right PIN is refused while locked; revoking is idempotent and a revoked device
is `bad_device`; staff's revoke changes 0 rows; deleting the membership
cascades the PIN.

Harness note: the stub's `service_role` has no `BYPASSRLS`, so its plain
selects on the new tables return 0 rows — check counts as `postgres`.

## Walked live (2026-09-09, after 097 was applied and the function deployed)

In the browser pane against the real database: a PIN set through `/account`;
the pane registered on `/settings › Shared devices` (row marked "this one",
the Register button withdrawn, the cookie invisible to script); Switch user →
`/lock` straight onto the keypad under the one name holding a PIN, the device
named beneath; four 9s → "Wrong PIN."; the right PIN → `/` by a hard
navigation as that person, `amr: otp` on the token; `/account`, the Admin
tab's PIN row and the devices tab all refusing in words on the PIN session;
and, with the pane hidden for five minutes, the WAKE locking it back to
`/lock` — the timer does not run in a hidden pane, which is the iPad-asleep
case the `visibilitychange` check exists for.

**One bug the walk found, fixed the same hour.** `lockDevice` used to
`redirect("/lock")` from inside the action. A server action that signs out
and redirects also makes Next re-render the page it was called from, whose
`getAppSession` then throws its own redirect — two navigations from one
router state, and whichever lands last wins. The masthead's form happened to
land on `/lock`; the idle lock happened to land on `/login`. The action now
returns and the CLIENT does `window.location.assign("/lock")`
(`components/SwitchUser`, `IdleLock`). The same shape as the unlock's
ending, and for the same reason it is a hard navigation.
