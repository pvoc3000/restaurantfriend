# HR + app access — strategy brief

Drafted 2026-08-01 in answer to: "It's time to add users to the app… Let's plan
on the best strategy for getting HR up and running," including the mechanism
for multi-user access with different permission sets. Status: PROPOSED — the
open decisions at the bottom need Mark's answers before schema work starts.

## §0 The one structural decision everything else follows from

**An employee and a user are two different records, linked, never the same
thing.** FMP conflated them — login credentials lived on the employee detail,
and access was implied by category (supervisor/manager). That's the part that
"was obviously not great," and the fix is separation:

- **`employees`** — the HR record. Everyone who ever worked here (~445 rows),
  almost all terminated. Exists whether or not the person can sign in. This is
  the table Reviews, Events, Ratings, Timesheets and Policy Signers will all
  hang off later, which is why the master plan sequences Employees first.
- **`org_members`** — app access. Already exists (001), already carries the
  role vocabulary, already drives every RLS policy. A row here exists ONLY for
  people who can sign in.
- **The link: `employees.user_id uuid unique null references auth.users(id)`.**
  Nullable because most employees never get access; unique because one person
  is one login. Granting access is an ACTION taken on an employee record by an
  admin — not a side effect of a category field.

Consequence: "who has access" stops being a hiring category and becomes a
grant you can give to exactly the people who need it, including (say) a staff
member who does ordering, without reclassifying their job.

## §1 Roles: keep the four we have

`owner / admin / purchaser / staff` (001) map onto FMP's ~3 privilege sets
with room to spare:

| FMP | restaurantfriend | gets |
| --- | --- | --- |
| (Mark) | `owner` | everything, incl. member management |
| managers | `admin` | everything but org destruction; HR read/write; grant access |
| — | `purchaser` | catalog + PO writes (the gate the whole purchasing module already enforces) |
| supervisors | `staff` | guide entries, purchase requests; later shift logs + checklists |

Supervisors default to `staff` and individuals get bumped to `purchaser` where
they actually order — the role is per-person at grant time, so this isn't a
policy to settle in advance. Per-location roles stay deferred exactly as 001
planned (`location_members` can be added later without disturbing this).

## §2 HR data gets STRICTER RLS than everything else

Every table so far uses the generic org policy: any member reads, purchaser+
writes. That is wrong for `employees` — phone numbers, addresses, hire/term
history, eventually write-ups — and this will be the first table where READ is
role-gated:

- select / insert / update: `owner`,`admin` only.
- No delete policy (the Clear-guide lesson: absence of a policy is the
  enforcement). Employees are never deleted; they're terminated.
- A self-read ("my own record") and a supervisor-facing phone list are real
  future needs (master plan: rosters, phone lists) — both are column-scoped,
  so they arrive as definer functions or views naming exactly the safe
  columns, the `set_my_member_profile` pattern. Not built now.
- The transformed export JSON stays OUTSIDE the repo, same as the vendor
  account numbers already do — HR data is the most sensitive thing the system
  will hold.

## §3 Onboarding: invite links through the mail we already send

No more setting someone's password for them. The flow:

1. Admin opens the employee's record → **App access block** → "Invite to
   app…" — email prefilled from the employee record, role chosen from a
   `PickList`.
2. A new **`invite-member` edge function** (the `send-po-email` pattern:
   caller's JWT verified, explicit admin+ check for a readable error) uses the
   service-role admin API to `generateLink({type: 'invite'})`, creates the
   `org_members` row, stamps `employees.user_id`.
3. The invite email goes out **through the existing provider layer** — the
   same three-tier transport POs use (location → org → app default; Donut
   Friend = the org-level Gmail override). We deliberately do NOT configure
   Supabase's built-in SMTP: `generateLink` hands back the action link so we
   can send it ourselves through mail that already works, with the template in
   `orgs.settings` per design rule 2.
4. The link lands on a small **`/welcome`** page: set password, confirm
   display name, in. (Supabase's invite link authenticates the visit; the page
   calls `updateUser` to set the password.)

Existing-auth-user edge: if the email already has an auth user, skip creation
and just link + add membership.

**Revoking** ("remove access", and offered as a prompt when an employee is
terminated): delete the `org_members` row, **ban** the auth user via the admin
API, null `employees.user_id`. Never delete the auth user — the audit columns
(`price_history.changed_by` et al., 001) reference `auth.users` with no
cascade, so the delete would be refused for anyone who ever changed a price,
and the history should keep its author anyway.

## §4 Migration: Employees only, but export everything

- **Mark exports the whole DF-Employees file in one sitting** (Employees,
  Events, Reviews, Uniforms, Policies, Policy Signers as .mer) — going back
  into FMP per-table is the expensive part, not the export.
- **Only Employees gets transformed and loaded now.** Events/Reviews/etc. are
  phase-2 slices onto an `employees` table that already exists; Time & Payroll
  (75k timesheets, Homebase, Gusto) is its own module and explicitly not this.
- Pipeline mirrors purchasing: field map (`migration/field-map.md` grows an
  Employees section), transform outside the repo, `load-hr.mjs` beside
  `load.mjs`. All 445 rows load — terminated employees are the referents of
  future reviews/timesheets — and the list defaults to active.
- Column list waits for the real export; expected shape: `legacy_id`, names
  (+ preferred), contact, home `location_id`, position(s), FOH/BOH, category,
  hire/term dates, status, notes. Anything payroll-ish that turns up stays in
  the export until the payroll module wants it.
- Mark's own employee record gets linked to his existing auth user during
  load, so the model is true from day one.

## §5 Screens (all existing parts, no new controls expected)

- **`/employees`** — `DataTable` (group by status or location, `ListFilters`,
  column chooser, sticky labels, record-set publish), nav stub `hr/employees`
  flips to built. Visible to admin+ only; below that the RLS returns no rows,
  so the nav item hides for staff rather than opening an empty table.
- **`/employees/[id]`** — the locations-record pattern: blocks for identity,
  contact, employment (hire/term, position, FOH/BOH, category), and the **App
  access block** — no access → invite; pending → resend; active → role
  (`InlineValue kind="pick"` writing `org_members` under the existing
  owner/admin policy) and Remove access. Breadcrumbs, `RecordNav`, own
  `loading.tsx`, body keyed by id.
- No separate "users" screen: access is a facet of the employee record, and
  "who has access" is a filter on the list.

## §6 Sequence

1. Mark: export DF-Employees (all tables) → `../../FMP Export/`.
2. Field map + transform script (outside-repo output).
3. Migration 020: `employees` + strict RLS + `user_id` link.
4. `load-hr.mjs`; verify counts against the export.
5. `/employees` list + detail; flip the nav stub.
6. `invite-member` edge function + `/welcome`; invite templates in
   `orgs.settings`; wire the App access block.
7. First real invites (pilot: 1–2 managers) before any wider rollout.

Later, in rough order of pull: Events, Reviews (+ printing), Policies +
signatures, Uniforms; supervisor phone-list view; per-location roles when a
screen actually needs them; floor-app auth story (shared iPad, maybe PIN) when
phase 5 starts.

## §7 Open decisions (Mark)

1. **Export scope** — all six DF-Employees tables now, or just Employees?
   (Recommended: all, load one.)
2. **Supervisor default role** — `staff` (recommended) with per-person bumps
   to `purchaser`, or all supervisors as `purchaser`?
3. **What's actually on the FMP employee record** — any pay/SSN-class fields
   change nothing structurally but confirm the §2 posture. The field map will
   surface this; flag anything surprising.
4. **First invitees** — who pilots the invite flow after Mark?
