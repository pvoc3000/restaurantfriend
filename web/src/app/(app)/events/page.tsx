import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canReadHr } from "@/lib/roles";
import { employeeName } from "@/lib/employees";
import { todayInTimeZone, serverTimeZone } from "@/lib/today";
import type { RawSearchParams } from "@/lib/filterMenus";
import {
  EVENT_SELECT,
  parseRatingWindow,
  ratingWindowFrom,
  type EventKind,
  type ShiftSlot,
} from "@/lib/employeeEvents";
import { EventsList, type TeamEventRow } from "@/components/hr/EventsList";

/**
 * EVERYTHING THAT HAS HAPPENED WITH ANYBODY, on one screen.
 *
 * `employee_events` (migration 035) merged FileMaker's Events and Ratings into
 * one table, and until now the only surface for it was the employee record —
 * one person at a time, every query scoped `.eq("employee_id", id)`. So "every
 * warning in the last 90 days", "who called out this month" and "what happened
 * at DF01 last week" all meant opening twenty-six records one after another.
 * 035 even created the index for this screen — `(org_id, occurred_on desc)` —
 * and nothing had ever read it.
 *
 * ORG-SCOPED, not location-scoped, for `/employees`' reason: a person belongs
 * to the org rather than to a shop, so the shop is a filter DIMENSION here
 * rather than a scope around the screen. Hence the `InactiveLocationGate`
 * exemption too — there is nothing here for a closed working location to empty.
 *
 * READ-ONLY (Mark, 2026-08-26). Every row links to that person's record, where
 * the Events tab already edits. One write path: a second editor would mean two
 * places to correct one row.
 */

/** PostgREST caps a select at 1,000 rows and says nothing about it. */
const PAGE = 1000;

type Row = Record<string, unknown>;

/**
 * Sweep a query past the cap.
 *
 * Inlined rather than reaching for `productionQueries`' own `fetchAll`, which is
 * module-private and takes `(supabase, table, select, orderBy)` — it has no
 * surface for the `.neq()` / `.gte()` these two waves need, so calling it would
 * mean growing a builder-callback parameter and touching its four existing call
 * sites. `/sales`, `/shop-sections` and `/special-orders` each inline their own
 * loop for the same reason.
 */
async function sweep(
  build: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: { message: string } | null }>,
): Promise<{ data: Row[]; error: { message: string } | null }> {
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) return { data: [], error };
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return { data: out, error: null };
}

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const session = await getAppSession();

  // Migration 035's RLS is owner/admin on all four verbs — the same set
  // `canReadHr` names. Below it every query returns no rows, which renders as an
  // empty table and reads like a broken screen or a company where nothing has
  // ever happened. Say what is actually true instead, before querying anything.
  if (!canReadHr(session.membership.role)) {
    return (
      <div className="max-w-2xl space-y-2">
        <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">Events</h1>
        <p className="text-sm text-muted">
          Employee events are open to managers and the owner. Ask a manager if you need
          something from them.
        </p>
      </div>
    );
  }

  const supabase = await createClient();
  const params = await searchParams;

  const timeZone = (session.orgSettings.timezone as string | undefined) ?? serverTimeZone();
  const today = todayInTimeZone(timeZone);
  const windowKey = parseRatingWindow(params.window);
  const from = ratingWindowFrom(windowKey, today);
  const orgId = session.membership.org_id;

  // Three sweeps started together. A Supabase builder is a lazy thenable, but a
  // sweep is a loop of awaits, so these have to be three calls in flight rather
  // than three loops in sequence.
  //
  // `.order("id")` after the date is load-bearing rather than tidy: `occurred_on`
  // is a DATE and ties are everywhere, and a ranged sweep on a non-unique sort
  // key returns overlapping pages — the bug that fabricated 112,338 double-time
  // hours in the 2026-08-05 audit.
  //
  // `org_id` is redundant under RLS and is there for 035's own index,
  // `employee_events_org_date_idx (org_id, occurred_on desc)`.
  const [narrative, shifts, roster] = await Promise.all([
    // NOTES AND WARNINGS, WHOLE, ALL TIME — 2,635 rows across twelve years, so
    // three pages. They are fetched complete because the alternative is the
    // failure the record screen documents: bound them and the recent ratings
    // crowd out every older warning while the count says everything is fine.
    sweep((a, b) =>
      supabase
        .from("employee_events")
        .select(EVENT_SELECT)
        .eq("org_id", orgId)
        .neq("kind", "shift")
        .order("occurred_on", { ascending: false })
        .order("id")
        .range(a, b),
    ),
    // SHIFT RATINGS, BOUNDED BY THE WINDOW. 43,918 exist; 520 fall in the
    // default 90 days and 2,996 in a year.
    //
    // A lower bound and nothing else, deliberately. `ratingSummary` ignores a
    // future-dated shift so a typo cannot move a mean; a LIST is the opposite
    // case — a rating dated 2027 is a typo somebody has to find, and an upper
    // bound is the one place it would be invisible.
    sweep((a, b) =>
      supabase
        .from("employee_events")
        .select(EVENT_SELECT)
        .eq("org_id", orgId)
        .eq("kind", "shift")
        .gte("occurred_on", from)
        .order("occurred_on", { ascending: false })
        .order("id")
        .range(a, b),
    ),
    // THE ROSTER, once, for BOTH name columns. The record screen scatter/gathers
    // `.in("id", authorIds)` because it holds 500 rows about one person; here the
    // subject ids alone are ~445 distinct, so an IN list would be longer than the
    // whole table. Two columns over 445 rows.
    sweep((a, b) =>
      supabase.from("employees").select("id, first_name, last_name").order("id").range(a, b),
    ),
  ]);

  const eventError = narrative.error ?? shifts.error;
  if (eventError) {
    return (
      <div className="max-w-2xl space-y-2">
        <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">Events</h1>
        <p className="max-w-[72ch] border border-accent px-4 py-3 text-sm text-accent">
          {eventError.message}
          {/employee_events/.test(eventError.message)
            ? " — migration 035 has not been applied yet."
            : ""}
        </p>
      </div>
    );
  }

  const nameById = new Map(
    roster.data.map((e) => [
      e.id as string,
      employeeName(e as { first_name: string; last_name: string }),
    ]),
  );

  // The FULL location list, not `activeLocations` (design rule 3): this is a
  // look-up, not an enumeration. DF03 is closed and carries 2,946 ratings, every
  // one of which would otherwise render as an em dash.
  const codeById = new Map(session.locations.map((l) => [l.id, l.code]));

  const rows: TeamEventRow[] = [...narrative.data, ...shifts.data].map((e) => ({
    id: e.id as string,
    employee_id: e.employee_id as string,
    employeeName: nameById.get(e.employee_id as string) ?? null,
    occurred_on: e.occurred_on as string,
    kind: e.kind as EventKind,
    score: e.score === null || e.score === undefined ? null : Number(e.score),
    shift: (e.shift ?? null) as ShiftSlot | null,
    position: (e.position ?? null) as string | null,
    headline: (e.headline ?? null) as string | null,
    detail: (e.detail ?? null) as string | null,
    outcome: (e.outcome ?? null) as string | null,
    author:
      nameById.get((e.author_employee_id ?? "") as string) ?? ((e.author_name ?? null) as string | null),
    locationCode: codeById.get((e.location_id ?? "") as string) ?? null,
  }));

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">Events</h1>
        <p className="max-w-[72ch] text-sm text-muted">
          Notes, warnings, incidents and call-outs across the whole team, and the shift
          ratings supervisors write at the end of a night.
        </p>
      </div>
      <EventsList
        rows={rows}
        windowKey={windowKey}
        initialSearch={typeof params.q === "string" ? params.q : ""}
        initialFilters={params}
        // The roster is a decoration: a missing name must not blank a table that
        // is otherwise perfectly readable, and it must not be swallowed either,
        // because an empty Who column asserts that nobody is named.
        nameError={roster.error?.message ?? null}
      />
    </div>
  );
}
