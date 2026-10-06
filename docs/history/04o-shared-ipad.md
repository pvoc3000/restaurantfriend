<!-- Moved verbatim from CLAUDE.md on 2026-09-18 (Claude Code /doctor). Everything below line 2 is the original text. -->

4o. ✅ **THE SHARED iPAD — PIN SWITCHING ON A REGISTERED DEVICE (migration 097
   NEEDS APPLYING; edge function `device-session` NEEDS DEPLOYING).** Mark,
   2026-09-08, before inviting the first testers: staff share one iPad, and
   "unless we're proactive about it people will, unintentionally, do so using
   someone else's account." Three options were put to him and he chose the
   POS one: the iPad is REGISTERED to the org, opens on a name picker and a
   FOUR-digit PIN, and locks back to the picker after FIVE minutes idle. Read
   **`docs/shared-device-brief.md`** before touching any of it — the two
   properties, the cookies, the throttle and the probes are there.
   **IT MINTS A REAL SESSION.** `device-session` verifies the PIN and returns a
   magic-link token that `unlockWithPin` (a server action) spends with the
   SERVER client's `verifyOtp` — the token never reaches the browser — so
   `auth.uid()` and every audit column keep meaning what they say, with no
   change to any other table. `/welcome`'s mechanism, one door over.
   **A PIN IS NOT A PASSWORD.** A PIN-minted session carries an httpOnly
   `rf.pin_session` cookie, and /account, the Admin tab and /settings refuse a
   password change, a PIN change and a device registration while it is
   present — in words, pointing at /login. `session.pinSession` is how a
   screen asks. Without this a four-digit PIN is a route to everything.
   **NOTHING LEAVES POSTGRES.** `member_pins` is bcrypt with ZERO policies
   (081's shape); the compare and the throttle are ONE definer under an
   advisory lock (`attempt_pin_unlock`, service_role only — 074 counted in the
   function and for a 10,000-key space that is a race). Ten failures per device
   and five per person in fifteen minutes, twenty per person a day; a lockout
   is REPORTED with its seconds, an unknown id answers `wrong` like a wrong
   PIN, and the bcrypt work runs either way.
   **`signOut` IS `scope: "local"` NOW**, and so is `lockDevice`: the default
   `global` revokes every refresh token the user holds, so locking the iPad
   would have signed the manager out of their own phone. `clearSessionCookies`
   (`lib/sessionCookies`) is the ONE sweep — it also fixes `signOut` having
   missed `rf.invoice.view` since that cookie existed. Never `rf.device`.
   **THE LOCK SCREEN ENDS WITH A HARD NAVIGATION** (`window.location.assign`),
   which is what empties `scrollMemory` / `viewMemory` / `navMemoryStore`'s
   in-memory Maps; a soft one carries the previous person's state.
   localStorage survives on purpose — column widths are the device's.
   **`IdleLock` KEEPS A TIMESTAMP, NOT JUST A TIMER**, and checks it on
   `visibilitychange` and `focus`: an iPad suspends JS when the screen sleeps,
   so the WAKE is what locks. Mounted in BOTH layouts, only when
   `session.registeredDevice` — a desk browser never carries it.
   **THE THREE DECISIONS NOT TO REOPEN**: 4 digits; 5 minutes; a device is NOT
   bound to a shop (the picker lists every member holding a PIN; the working
   location stays whatever they last used). Self-service PIN on /account,
   owner/admin set-or-clear on the employee record's Admin tab, registration
   on `/settings › Shared devices` DONE ON THE iPAD (the secret is that
   browser's cookie). The masthead reads **Switch user** on a registered
   device; Sign out proper moved to /account.
   Verified on the Docker harness as real roles (all 100 files replay; every
   refusal by name; the fifth failure `locked` at 900s; revoke idempotent;
   the membership delete cascades the PIN) and the three screens in the
   browser pre-migration, each naming the missing table in a sentence.
   **WALKED LIVE 2026-09-09** once 097 was applied and the function deployed:
   the whole loop — register, Switch user, wrong PIN, right PIN, the three
   refusals on a PIN session, and the idle lock firing on WAKE.
   **THE WALK FOUND ONE BUG: NEVER `redirect()` FROM AN ACTION THAT SIGNS
   OUT.** Next re-renders the calling page inside the action, that page's
   `getAppSession` finds no user and throws ITS redirect, and the two race —
   the masthead landed on /lock, the idle lock on /login. `lockDevice` now
   returns and the client hard-navigates (`components/SwitchUser`,
   `IdleLock`). `signOut` keeps its redirect because it is a document form
   with no client to navigate, and has always landed where it says.
   **1678 fixtures pass**, 11 new.


**AN IDLE LOCK RETURNS YOU TO YOUR PAGE (Mark, 2026-09-30):** being timed
out, typing your PIN and landing on the home page "instead of where you were"
was annoying. `IdleLock` (now given `session.userId`) writes `{ userId, path }`
to localStorage under `RESUME_KEY` (`rf.lock.resume`) just before it locks;
`LockScreen` reads it once on a successful unlock and ALWAYS deletes it.
`resumePathFor` (`lib/sharedDevice`, fixtures) gives the path back only to the
SAME user, and only a same-origin page that is not /lock or /login — anyone
else lands on "/" as before, since the page is the previous person's. Path
includes the query string, so view state comes back too. Only the IDLE lock
writes it: Switch user is a deliberate goodbye. No expiry — "the next time"
the same person unlocks, however much later. Not walked live (needs a PIN on
the registered iPad).

**AND THE PAGE COMES BACK SET UP THE WAY IT WAS (Mark, 2026-10-06),** after a
complaint from the batch log: the unlock returned the page, but its pickers,
search, sort, selected batch and pane tab were reset. That state is
`lib/viewMemory`, in memory, and the lock is a full page load. `IdleLock` now
stores `snapshotViewMemory()` beside the path (`ResumePoint.view`);
`resumeViewFor` (fixtures) returns it only when `resumePathFor` is sending
that same person back to that page; `LockScreen` hands it over in
sessionStorage (`rf.view.handover`), which `viewMemory` reads once at load and
deletes. `useRememberedView` became `useSyncExternalStore` so a restored value
does not mismatch the server's fallback render at hydration. Newly remembered:
`/batch-logs`' Status, Group by, search and sort, and the record's selected
batch and pane tab — which also means they now survive leaving the screen and
coming back within a session. Any other screen gets this by using
`useRememberedView`.
**SCROLL AND SHOW SKIPPED TOO (Mark, same day).** `lib/scrollMemory` is handed
over the same way (`ResumePoint.scroll`, `resumeScrollFor`,
`rf.scroll.handover`), so it covers EVERY screen's window and DataTable pane,
not just the batch log; `snapshotScrollMemory` first flushes each live
scroller, because the 120ms throttle may be holding the last move. The batch
pane's own scrollers — Info, Ingredients, Instructions, History — were never
in scroll memory and now are, keyed per batch. Show skipped is a
`useRememberedView`.
Not walked live (needs a PIN on the registered iPad; the test pane was signed
out).

**A TAB SHOWING SOMEBODY ELSE'S PAGE LEAVES IT (Mark, 2026-10-01),** after
DF02's opening shift report was read as Karina's view of Abigail's report (see
04h). `SIGNED_IN_KEY` (`rf.device.user`, localStorage) holds who the device is
signed in as, as far as its tabs know. `IdleLock` writes its user on mount, and
the idle lock and `SwitchUser` write "" before locking. A tab whose rendered
user differs (`tabIsStale`, fixtures) hard-navigates to "/", and the server
then shows the current person's home or /lock. The check runs on the `storage`
event (instant in the other tabs) and on the existing visibility/focus/interval
checks (for a background tab that was suspended). An unknown value (null:
storage blocked or never written) never makes a tab leave. Consequence: locking
one tab sends the others to the lock screen too. Not walked live: needs the
registered iPad and two PINs.
**THE IDLE CLOCK IS THE DEVICE'S (Mark, same day).** It was per tab, so a
forgotten background tab could idle-lock the iPad while somebody worked in
another one. Every touch is now also written to `ACTIVE_KEY`
(`rf.device.active`, localStorage), still at most once a second, and a tab locks
only when `deviceLastActivity` (the later of its own touch and the recorded
one, fixtures) is five minutes old. Unreadable storage falls back to the tab's
own clock, which was the old behaviour.
