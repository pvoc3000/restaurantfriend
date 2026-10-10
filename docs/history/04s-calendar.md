# 04s — Calendar (blackout dates, layers, feeds in and out)

Built 2026-10-09. Migrations 181–186, all APPLIED 2026-10-09; edge function
`calendar-sync` deployed (v1, `verify_jwt: true`).

Mark, 2026-10-09: "blackout dates. The idea is to create a space where the user
can enter dates that do different things: refuse to accept any new special order
inquiries… turn off production", and then: "Can we morph this idea into a
calendar page for the app? We can add blackout dates there, but also we could
subscribe to and display google or ical calendars, put down notes, events, maybe
display special orders or other kinds of upcoming things."

## What it is

`/calendar`, first in Operations. Four things on one month grid:

1. **Entries** typed here (`calendar_entries`, 181) — a note, an event, or a
   blackout.
2. **Layers** from what the app already knows — special orders, deliveries,
   tasks, pay periods, HR.
3. **Subscribed calendars** — a Google or iCloud iCal address, read by
   `calendar-sync` (186).
4. **Published links** — the app's own calendar as an iCal feed (185).

## Decisions

**ONE TABLE FOR NOTES AND BLACKOUTS.** A blackout is an entry with one or more
of four switches on; a note has none. The switches are independent (Mark: "for
maximum flexibility, let's keep production, standing orders, and special orders
separate"):

| Switch | What it does | Where |
|---|---|---|
| `no_special_orders` | `/inquiry` greys the day and refuses it; staff are WARNED | 182, `InquiryForm`, `NewSpecialOrder`, order record |
| `no_standing_orders` | the top-up skips the day and lists it in `blackouts[]` | 183 |
| `no_production` | Generate Schedules skips the day, `reason:'blackout'` | 184 |
| `shop_closed` | no checklists asked; no closing report or sales expected | `lib/blackoutDates.closedDates` and its readers |

**`location_ids` EMPTY MEANS EVERY SHOP** — `ui/PickSet`'s convention.

**WHICH SHOP A BLACKOUT IS CHECKED AGAINST.** An order: its pickup shop OR its
kitchen. A schedule: the selling shop OR the kitchen that bakes for it (184 has
both branches; the kitchen one was proved with a DF01-only entry on a day DF02
is made at DF01). Closed: the shop itself.

**STAFF ARE WARNED, NEVER BLOCKED** (Mark: "I want to say blocked but I'll go
with your rec"). The warning is a yellow sentence under the date in New Order
and in the record's header.

**THE WARNING IS NOT ONE OF `needsAttention`'s REASONS**, though the plan said
it would be. That function also feeds the list's attention queue and the desk
start page, and an order taken on a blacked-out day ON PURPOSE would sit in both
until the day passed.

**A BLACKOUT NEVER CHANGES WHAT EXISTS.** An order or a schedule made before the
entry stays; the entry dialog counts them and says so. Deleting the entry lets
the next top-up or generate fill the day.

**WHO WRITES IS A ROW RULE** in 181's policies: a supervisor or a purchaser
writes an entry while every switch is off; only a manager or an owner writes
one with a switch on, or changes or deletes one that has. `canSetBlackouts`
decides whether the switches are offered. `/calendar` is `R W W W W`.

**THE LIST VIEW OPENS THE DIALOG; IT IS NOT EDITED CELL BY CELL**, though the
plan said inline. An entry's dates, shops and switches are one decision, the
dialog counts what is already on those dates, and the policies judge the row
whole.

**`/inquiry` REFUSES A DATE FOR THE FIRST TIME.** Brief decision 18 said the
form "never blocks a date"; that still holds for the rush cutoff. The shop asked
about is the one the inquiry would be MADE at — the pickup shop, the shop a
delivery was measured from, or `inquiry_price_location(org, null)` when neither
is known — and `inquiry_blackouts` returns that default shop so the form greys
out exactly the days `create_inquiry` refuses.

**183 TESTS `exists` BEFORE THE BLACKOUT**, the reverse of the plan: a day made
before the entry was written is an order that exists, and reporting it as
skipped would be untrue.

**184 REPORTS A SHOP-LEVEL SKIP ONLY WHEN THE DAY WOULD HAVE MADE SOMETHING**,
so a week generated across a holiday lists the shops left out, not every shop
with no plan. EVERY READER OF `skipped[]` MUST CHECK `reason`: a blackout entry
has `schedule_id: null`. `GenerateSchedules.readReceipt` lifts them out;
`ScheduleActions` and `PremadesPage` read `reason` themselves.

**LAYERS ARE GATED BY THE SCREEN THEY COME FROM** (`canReachPage`), and RLS is
the real gate. Pay periods and HR are managers and owners only.

**EMPLOYEE EVENTS ARE AN OPT-IN LAYER** (`OPT_IN_LAYERS`), without the `shift`
kind. They record what happened rather than what is coming, and shift ratings
are 44,000 of the 46,000 rows. The other HR layer is expiring documents and
food handler cards, for current employees only.

**AN ORDER AT MIDNIGHT IS DRAWN ALL-DAY.** `event_time = 00:00` is how an order
with no real time was stored; the calendar and the feed both treat it as none.

**A FEED LINK IS A CAPABILITY** (185), like the quote and pay links. Managers
and owners only, even to read the table. It can carry entries, special orders,
deliveries and tasks and NOTHING else — `calendar_feed_by_token` has no branch
for pay periods or HR. Customer names only when the link's tick is on. Revoked
by `revoked_at`, never deleted (there is no delete policy).

**THE FEED IS THE APP'S FIRST ROUTE HANDLER** —
`app/calendar-feed/[token]/route.ts`, exempted in `proxy.ts` by its prefix WITH
the trailing slash, so `/calendar` stays behind the login. It uses
`lib/supabase/anon`, a cookieless anon client. The UID host is a fixed string,
not the request's, so two domains serve the same events.

**A SUBSCRIPTION'S ADDRESS IS A SECRET** (186). `calendar_subscription_urls`
has RLS on and no policies — `accounting_connections`' shape — and is written
only through `set_calendar_subscription_url`. Nobody reads it back.

**THE COPY IS REFRESHED LAZILY**, because there is no cron: the calendar page
mounts `FeedRefresher` when a subscription is over an hour old, and the
function declines to re-read anything fetched in the last five minutes. A
failed read waits its hour too. Failures are written to `last_error` and shown
on the calendar by name.

**A SUBSCRIBED EVENT IS DISPLAY ONLY.** Nothing in 186 is read by
`blackout_name`.

**ONLY TITLE, DATES, TIME AND PLACE ARE KEPT** from an outside calendar.

**GOOGLE NEEDS NO SIGN-IN**: it is the calendar's "Secret address in iCal
format". Google re-reads a feed it subscribes to about twice a day, whatever the
feed asks for.

## Traps

- **`skipped[]` now has two meanings** (above). A reader that counts its length
  offers to regenerate a blacked-out day.
- **`standingMaterializationDates` is the TypeScript twin of 183.** It takes a
  `blackedOut` predicate; without it the record's "next N days" count is wrong.
- **`blackoutFor` is the TypeScript twin of `blackout_name`.** Same ordering
  (earliest start first), same null handling.
- **A `Set` is passed from a server page to `SalesScreen`** (`closedDates` on
  `SalesLocation`). React 19 serialises it; an older React would not.
- **`ical.js` is passed INTO `_shared/icsExpand`**, not imported there, so the
  file runs under Node for testing. There is no Deno on this Mac.
- **The fixture harness does not cover `icsExpand`.** It was tested with a
  Node script against `ical.js` 2.2.1 (all-day, multi-day, UTC and TZID times,
  a midnight end, RRULE with EXDATE and a moved RECURRENCE-ID, a daily rule
  begun in 2015, the cap, a cancelled event, a non-calendar) and against
  Google's public US holidays feed.
- **The U+FE0E marks in `MonthView.LAYER_MARK` are written as `︎`.** A
  pasted invisible character is one nobody can see to keep.

## Verified

- `npm run fixtures`: 2,320 cases. New: `blackoutDates`, `calendar`, `ics`,
  `calendarFeeds`; extended: `inquiry`, `specialOrders`, `shiftReports`,
  `sales`, `landingState`.
- **181–186 were dry-run against the LIVE database inside a transaction ended
  by a raised exception** (so nothing committed), as owner, supervisor and anon:
  the row rule, the range check, every `blackout_name` case, the inquiry
  refusal, the standing-order skip, the generator's shop and kitchen skips,
  `p_replace` not overriding, the feed's layers, shops, names and revocation,
  and the address being unreadable by an owner. Then applied.
- **One order number was consumed by the dry run.** A control inquiry returned
  `created`; the rows rolled back but `special_order_number_seq` did not, so
  SO-10122 will never be issued. Do not call `create_inquiry` or the
  materializer's creating path in a dry run again.
- `/inquiry`, signed out, in the browser: the notice, the greyed days per shop,
  and a typed date refused under the field.
- The feed, with curl: 200 `text/calendar`, 272 events, no line over 75 octets,
  parsed by `ical.js` with 272 unique UIDs; an unknown and a revoked token 404;
  `/calendar` still redirects to `/login`.

## NOT verified

- **Every signed-in screen in a browser** — the pane was not signed in. The
  calendar page, the entry dialog, the list, the Settings tab, the warnings on
  New Order and the order record, the Generate receipt, and the closed-shop
  readers have passed type-check, lint and fixtures only.
- **`calendar-sync` end to end.** It is deployed, and its two halves were
  tested apart, but it has not been called with a session.

## Not built

Week and day views, timed entries of our own, drag to move, delivery-only
blackouts, minimum notice, capacity caps, holidays in the rush business-day
count (`lib/specialOrders` stays Mon–Fri), writing back to Google, a tablet
tile, emailing a standing-order customer about a skipped day.
