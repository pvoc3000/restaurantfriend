<!-- Moved verbatim from CLAUDE.md on 2026-09-18 (Claude Code /doctor). Everything below line 2 is the original text. -->

4i. ✅ **WHICH SHOPS A MEMBER MAY WORK AT — migration 073, APPLIED and
   verified live 2026-08-29.** Mark: "in my FMP version of the app, I could give
   users I granted access to the app to a permission setting, a default
   location, and set which locations they had access to in the app."
   001 predicted `location_members` BY NAME and this file carried it as an open
   thread from 2026-08-01, with a note to settle one question first. That
   question is now answered.
   **IT IS "MAY WORK AT", NOT "MAY SEE"** (Mark's choice). It restricts which
   shops you can SWITCH to — the masthead picker and the Locations list's Work
   here — and therefore which shop's guide, POs, receiving and shift reports you
   meet, because all of those follow the working location. It is **NOT a data
   boundary**: DF02's rows stay readable to a DF01 member who goes looking, and
   `/special-orders`, `/customers`, `/employees`, `/events` and `/sales` are all
   deliberately ORG-WIDE. Making it a security rule means every location-scoped
   policy in the schema AND rethinking those screens — a different and much
   larger decision, and this table is what it would read.
   **NO ROWS MEANS EVERY LOCATION.** The single most important rule here: an
   empty table is what exists the moment the migration runs, so reading it as
   "no shops" would log the company out of everywhere at once. It is per-MEMBER,
   not table-wide — proved live, where restricting one account left the other
   two unrestricted. `ui/PickSet` happens to have exactly those semantics, so
   the control says "All shops" without being taught to.
   **NO DEFAULT LOCATION COLUMN** (Mark: "it's redundant — we can get that from
   the location already assigned to them"). `employees.main_location_id` is that
   assignment and `last_active_location_id` carries every session after it; a
   third column would be a second answer to a question that has one.
   **`set_my_member_profile` NOW REFUSES a shop you may not work at.** Without
   it the grid would be advisory — the picker hiding a shop while a hand-rolled
   POST still switched to it. 002's body is reproduced whole (055's rule) and
   gains one check.
   **THE HARNESS FOUND A REAL BUG.** `may_work_at(p_org, p_user, p_location)`
   took `p_user` but the owner/admin exemption used `user_has_role`, which is
   hardcoded to `auth.uid()` — so asking "may Karina work at DF02?" answered
   with the CALLER's role, and the shift report's recipient query asks exactly
   that about every member on the list. It asks about `p_user` now, and returns
   the same answer as superuser and from inside a session.
   **A THIRD SESSION LIST, and picking the wrong one is a silent bug:**
   `locations` to LOOK UP a code, `activeLocations` to ENUMERATE shops (**never**
   narrowed by the grid — an item's per-location rows must not vanish for a
   restricted member), `workableLocations` to offer a SWITCH.
   Screens: the grid is on the employee record's **Admin tab as "Works at"**,
   beside Role, because the two together are what app access means. Owner/admin
   show as unrestricted rather than being offered a choice the database would
   ignore. `WorkingHere` shows NOTHING on a shop you may not work at — the same
   nothing a closed shop shows, since in both the answer is no.
   **The shift report's supervisor email follows the grid** (Mark's answer to
   the shop-scoping question). **Management never is**: a manager sees every
   shop, and Mark's own employee record has no main location, so a scoped rule
   would silently drop the OWNER off DF01's report.

