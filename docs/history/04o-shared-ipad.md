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

