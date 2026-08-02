# HR + app access — strategy brief

Drafted 2026-08-01 in answer to: "It's time to add users to the app… Let's plan
on the best strategy for getting HR up and running," including the mechanism
for multi-user access with different permission sets.

**Status: SETTLED and BUILT, 2026-08-01** — the open decisions are answered
below and the code is in. What shipped, and where it differs from this draft:

- **Five roles, not four.** All supervisors will need the app eventually (shift
  reports, production schedules), and they don't order by default, so
  `supervisor` sits between `staff` and `purchaser`. Mark's ladder, from FMP's
  1–5 levels: staff · supervisor · purchaser · manager · owner. `admin`
  displays as "Manager" and is not renamed in the DB.
- **No SSN, ever.** It stays in FMP and Gusto. Likewise pay rates and
  everything payroll-adjacent — the payroll module's business.
- **Paperwork is derived from uploaded documents**, not a checklist
  (§3.5 below) — `employee_documents` + a private bucket, migration 021.
- **Per-location access is deferred**, and pinned in CLAUDE.md's open threads
  because Mark wants to revisit it.
- **Only Employees migrates.** Events, Ratings, Reviews, Timesheets and
  PayPeriods stay in FileMaker until their own modules; the export in
  `FMP Export/HR/` turned out to be a LAYOUT export and needs redoing (§4).

Schema is migrations **020** + **021**; screens are `/employees` and
`/employees/[id]`; access is the `invite-member` edge function and `/welcome`.
Details and the reasons behind each are in CLAUDE.md's build step 4c — this
file is the strategy, that one is the record.

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

## §1 Roles: five, from FMP's user levels

FMP's ADMIN tab carried a 1–5 radio: 1 staff · 2 supervisor (had app access) ·
3 manager (had the desktop) · 4 unused · 5 Mark. Mark's mapping puts purchasing
between supervisor and manager:

| FMP level | restaurantfriend | shown as | gets |
| --- | --- | --- | --- |
| 5 | `owner` | Owner | everything, incl. member management |
| 3 | `admin` | **Manager** | everything but org destruction; HR read/write; grants access |
| — | `purchaser` | Purchaser | catalog + PO writes (the gate the whole purchasing module enforces) |
| 2 | `supervisor` | Supervisor | staff, plus the shift tools when they're built |
| 1 | `staff` | Staff | guide entries, purchase requests |

`admin` is NOT renamed in the database — it is the value every existing policy
names, and renaming it would be a rewrite of the whole RLS surface to change a
label. The label lives in `web/src/lib/roles.ts`, the way `ORDER_TYPE_LABEL`
already labels the vendors' check constraint.

**Adding `supervisor` edited no existing policy**, which is the part worth
knowing. Every policy in the schema is one of two shapes: membership-only
(role-blind, so a supervisor inherits it — all reads, guide entries, purchase
requests, `set_my_member_profile`) or an explicit `['owner','admin','purchaser']`
array (so a supervisor is correctly excluded). So in v1 a supervisor is
DB-equivalent to staff, and the role exists so that shift reports and
production schedules have something to name when they arrive.

A supervisor who does the ordering is given `purchaser` individually — the role
is per person at grant time, so this was never a policy to settle in advance.
Per-location roles stay deferred as 001 planned (`location_members` later),
pinned in CLAUDE.md's open threads.

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
   transport POs use, at the ORG tier (no location is in scope for a member).
   Donut Friend rides its Gmail override, so no new email secret. We
   deliberately do NOT configure Supabase's built-in SMTP: `generateLink` hands
   back the action link so we can send it ourselves through mail that already
   works, with the template in `orgs.settings` per design rule 2. One new
   secret: `APP_URL`, so the link knows where `/welcome` lives.
4. The link lands on a small **`/welcome`** page: set password, say what to
   call you, in.

**`/welcome` spends the token on SUBMIT, never on load.** Mail scanners and
link previewers follow URLs in email as a matter of course, so verifying in an
effect would let a corporate spam filter burn the invitation before the person
ever clicked it. It also needed an exemption in `proxy.ts`, which bounces every
signed-out request to `/login` — without it the invite would land on a password
page for an account that has no password yet.

Existing-auth-user edge: if the email already has an auth user (a previous
revoke, or a second employee record), `generateLink({type:'invite'})` errors —
so the ban is lifted and a magic link does the same job. A re-send updates
`invited_at` and NOTHING else: it must never silently reset the role of someone
already using the app.

**Revoking** ("remove access"): delete the `org_members` row FIRST — it is what
every RLS policy in the schema reads, so the door is shut even if what follows
fails — then **ban** the auth user via the admin API, then null
`employees.user_id`. Never delete the auth user — the audit columns
(`price_history.changed_by` et al., 001) reference `auth.users` with no
cascade, so the delete would be refused for anyone who ever changed a price,
and the history should keep its author anyway.

## §3.5 Paperwork is derived, never stored

FMP tracked onboarding as EIGHT CHECKBOXES on the employee record —
Application, W4, I9, I9 Documents, Food Handlers Card, Employee Handbook,
Notice to Employee, Training Acknowledgement — with the documents themselves
nowhere in the system. Mark's call (2026-08-01): paperwork "should not be a
check list but flags that are set when those documents are uploaded."

A checkbox is a claim that a piece of paper exists in a drawer. It goes stale
the moment someone ticks it optimistically, and it can't be audited. So
`employee_documents` (migration 021) holds the files in a private bucket, and
`missingPaperwork()` asks which KINDS exist: upload the W-4 and the W-4 line
goes from missing to filed. "Complete" cannot be true without the files, and
there is no second thing to keep in sync.

This also gives HR the filing cabinet FMP never had — which it had already
started improvising, since its Events table grew a `Document` type in 2024 (81
rows, 73 of them flagged as having a paper original) purely because there was
nowhere else to put a signed form. Those rows land here at cutover.

`REQUIRED_ONBOARDING_KINDS` is a constant rather than `orgs.settings`: this is
federal and California employment paperwork, not org configuration. If a second
org ever needs a different set, that is the moment it moves — and design rule 2
will be why.

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

## §7 Decisions — answered 2026-08-01

1. **Export scope** — all of DF-Employees was exported; only Employees is
   transformed and loaded. The rest re-export at their own module's cutover, so
   nothing is loaded twice from a file that FileMaker is still writing to.
   ⚠️ The Employees export is a LAYOUT export (14 columns, no employee id, no
   separate names, none of the ADMIN tab) and **needs redoing** — see §4 and the
   field list in `migration/field-map.md`.
2. **Supervisor default role** — superseded: `supervisor` is now its own role,
   between staff and purchaser. Supervisors get the app for shift reports and
   production schedules; a supervisor who orders is given `purchaser`
   individually.
3. **What's on the FMP employee record** — SSN and pay rates are there, and
   neither migrates. The vestigial set (COVID vaccination, CalSavers, commuter
   benefit, POS PIN, payroll name overrides) is left in the export too. The one
   surprise worth recording: the ADMIN tab stored the password **in plain text
   and displayed it on the layout**, beside the SSN on the INFO tab of the same
   record — so anyone who could open an employee could read both.
4. **First invitees** — Mark and the managers.

## §8 Still open

- **`REQUIRED_ONBOARDING_KINDS`** (`web/src/lib/employeeDocuments.ts`) is read
  off FMP's eight checkboxes, with the meal-break waiver deliberately optional.
  Confirm with Mark before "Paperwork complete" is treated as a compliance
  statement.
- **Per-location access** — deferred, pinned in CLAUDE.md's open threads.
