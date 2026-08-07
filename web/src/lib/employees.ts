// The employee record: where it lives, and the vocabularies its closed sets use.
//
// `employeeDetailHref` is one function for the same reason `locationDetailHref`
// is — the string has to feed BOTH the row's link and the found set the list
// publishes for the record book, and if those disagree the book walks you
// somewhere the list wasn't pointing.

import { withFrom, type Crumb } from "./breadcrumbs";
import type { PickOption } from "@/components/ui/PickList";

export const EMPLOYEES_CRUMB: Crumb = { href: "/employees", label: "Employees" };

export function employeeDetailHref(id: string): string {
  return withFrom(`/employees/${id}`, EMPLOYEES_CRUMB);
}

/* -- the record's own sections --------------------------------------------- */

/**
 * The employee record is five screens, not one long page (Mark, 2026-08-06:
 * "the employee detail page is getting a little unwieldy", with Gusto's
 * employee sidebar as the reference).
 *
 * IN THE URL, not in client state, because a tab is VIEW STATE — the same rule
 * that puts filters and sort in the query string. It makes a tab linkable, it
 * makes the back button work through them, and it is what lets the page fetch
 * only the tab being looked at instead of all of it every time.
 *
 * `admin` is last and holds both the access record and the destructive
 * actions: revoking a sign-in and deleting the record are the same job, and
 * keeping Delete at the end of the LAST tab preserves where it sat before —
 * past everything else, which is where a destructive action belongs.
 */
export type EmployeeTab = "info" | "employment" | "events" | "documents" | "admin";

export const EMPLOYEE_TABS: EmployeeTab[] = [
  "info",
  "employment",
  "events",
  "documents",
  "admin",
];

export const EMPLOYEE_TAB_LABEL: Record<EmployeeTab, string> = {
  info: "Info",
  employment: "Employment",
  events: "Events",
  documents: "Documents",
  admin: "Admin",
};

/**
 * The tab a request is asking for. Anything unrecognised — a stale bookmark, a
 * typo, a missing parameter — falls back to `info` rather than throwing or
 * rendering an empty shell: a bad tab should show you the record, not an error.
 */
export function parseEmployeeTab(raw: string | string[] | undefined): EmployeeTab {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (EMPLOYEE_TABS as string[]).includes(value ?? "")
    ? (value as EmployeeTab)
    : "info";
}

/**
 * A link to one tab of the record you are already on.
 *
 * It carries the CURRENT params through — `from` and `fromLabel` above all, or
 * moving between tabs would quietly strip the breadcrumb trail that led here and
 * the record book would lose its found set.
 *
 * `info` writes no parameter at all, so the default tab's URL is the plain
 * record address. That keeps every link already stored elsewhere — the roster's
 * rows, the found set, a pasted URL — pointing at something canonical instead of
 * at `?tab=info`.
 */
export function employeeTabHref(
  id: string,
  tab: EmployeeTab,
  params: Record<string, string | string[] | undefined> = {}
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === "tab") continue;
    const single = Array.isArray(value) ? value[0] : value;
    if (single) search.set(key, single);
  }
  if (tab !== "info") search.set("tab", tab);
  const query = search.toString();
  return `/employees/${id}${query ? `?${query}` : ""}`;
}

/** Migration 020's check constraint. FMP: Active 26 · New Hire 2 · Inactive 417. */
export type EmployeeStatus = "active" | "new_hire" | "inactive";

export const STATUS_LABEL: Record<EmployeeStatus, string> = {
  active: "Active",
  new_hire: "New hire",
  inactive: "Inactive",
};

export const STATUS_OPTIONS: PickOption[] = [
  { value: "active", label: "Active" },
  { value: "new_hire", label: "New hire", hint: "started, not yet settled" },
  { value: "inactive", label: "Inactive", hint: "no longer works here" },
];

/** FMP's Full/Part Time. Null covers its "N-A" and its blanks. */
export type EmployeeSchedule =
  | "part_time"
  | "full_time"
  | "full_time_plus"
  | "part_time_plus";

export const SCHEDULE_LABEL: Record<EmployeeSchedule, string> = {
  part_time: "Part time",
  full_time: "Full time",
  full_time_plus: "Full time +",
  part_time_plus: "Part time +",
};

export const SCHEDULE_OPTIONS: PickOption[] = [
  { value: "part_time", label: "Part time" },
  { value: "part_time_plus", label: "Part time +" },
  { value: "full_time", label: "Full time" },
  { value: "full_time_plus", label: "Full time +" },
];

export type Employee = {
  id: string;
  org_id: string;
  user_id: string | null;
  legacy_id: number | null;
  status: EmployeeStatus;
  last_name: string;
  first_name: string;
  nickname: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  date_of_birth: string | null;
  main_location_id: string | null;
  schedule: EmployeeSchedule | null;
  employment_type: string | null;
  start_date: string | null;
  end_date: string | null;
  position: string | null;
  notes: string | null;
  food_handler_expires: string | null;
  /**
   * The payroll settings (028 and 031). Declared late because until the Payroll
   * block shipped, NONE of these four had a UI writer anywhere in the app —
   * `gusto_id` and `primary_wage_type` came only from 031's backfill,
   * `homebase_id` only from the timesheet importer's link action, and
   * `excludes_tips` only from SQL.
   */
  gusto_id: string | null;
  homebase_id: string | null;
  /** The bare job title. The export appends `(Primary)`; it is never stored. */
  primary_wage_type: string | null;
  excludes_tips: boolean;
};

/** "Prentice, Ada" — the sort order and the way a roster reads. */
export function employeeName(
  e: Pick<Employee, "first_name" | "last_name">
): string {
  return `${e.last_name}, ${e.first_name}`;
}

/**
 * People already on the roster who might BE the person being added.
 *
 * Restaurants rehire, and 417 of the 445 rows are former employees — so the
 * likeliest duplicate is someone the roster's default Active tab isn't even
 * showing. Pass the FULL set, not the filtered one.
 *
 * Surname is the anchor because it's the stable half of a name: a Daniel who
 * comes back as Danny is the same Kim. An exact first-name or nickname match
 * ranks above a surname-only one, since "another Kim" and "the Kim who worked
 * here" deserve different amounts of attention.
 *
 * This WARNS and never blocks — two unrelated people really can share a
 * surname, and the form has to let you say so.
 */
export function findPossibleRehires<
  T extends Pick<Employee, "first_name" | "last_name" | "nickname">,
>(rows: T[], firstName: string, lastName: string, limit = 5): T[] {
  const surname = lastName.trim().toLowerCase();
  // An early-out, not a rule: `last_name` is NOT NULL and the transform skips
  // blanks, so an empty query would return nothing anyway. It's here because
  // this runs on every keystroke — including every keystroke of the FIRST name,
  // while the surname is still empty — and scanning 445 rows to produce [] is
  // work worth not doing.
  //
  // Deliberately NOT a minimum LENGTH. The match is exact equality rather than
  // a prefix, so a short query can only ever hit an equally short surname, and
  // a floor would silently suppress the warning for anyone actually called O.
  if (surname === "") return [];

  const given = firstName.trim().toLowerCase();

  const matches = rows
    .filter((r) => r.last_name.trim().toLowerCase() === surname)
    .map((r) => {
      const first = r.first_name.trim().toLowerCase();
      const nick = (r.nickname ?? "").trim().toLowerCase();
      // 0 sorts first: the same first name, or the nickname they went by.
      const rank = given && (first === given || (nick !== "" && nick === given)) ? 0 : 1;
      return { row: r, rank };
    });

  return matches
    .sort((a, b) => a.rank - b.rank || employeeName(a.row).localeCompare(employeeName(b.row)))
    .slice(0, limit)
    .map((m) => m.row);
}

/**
 * What deleting this employee would cost, counted before the choice is offered.
 *
 * `employees` had NO delete policy until migration 023, deliberately — an
 * employee is terminated, not deleted. 023 opens it for owner and manager, so
 * the guard that used to live in the schema now has to live here, in the words
 * on the dialog. Three signals, each a different kind of loss:
 *
 * - `migrated` — `legacy_id` is FileMaker's employee id, and `field-map.md`
 *   calls it "the join key every child table uses". Reviews and timesheets
 *   still reference it, so deleting can break records elsewhere.
 * - `hasAccess` — deleting revokes their sign-in. Worth saying out loud.
 * - `documents` — the I-9s and food handler cards go with the row (021
 *   cascades), and those are the records you're required to keep.
 * - `events` — migration 035 cascades too, and this is the number that grows
 *   without anyone noticing: a long-serving person carries ~1,000 shift ratings
 *   and a decade of warnings and incident reports. A cascade nobody is warned
 *   about is the actual danger, not the cascade.
 *
 * None of the four is a veto; `EmployeeActions` shows them and lets you
 * through, defaulting to Deactivate. The `closeReadiness` posture: a confirm
 * that names something you can't act on teaches you to stop reading confirms.
 */
export type DeleteWarnings = {
  migrated: number | null;
  hasAccess: boolean;
  documents: number;
  events: number;
  /** True when any of them fired — i.e. this is more than a typo. */
  any: boolean;
};

export function deleteWarnings(
  employee: Pick<Employee, "legacy_id" | "user_id">,
  documentCount: number,
  eventCount = 0
): DeleteWarnings {
  const migrated = employee.legacy_id ?? null;
  const hasAccess = employee.user_id !== null;
  return {
    migrated,
    hasAccess,
    documents: documentCount,
    events: eventCount,
    any: migrated !== null || hasAccess || documentCount > 0 || eventCount > 0,
  };
}

/**
 * Whether this record is the person doing the deleting.
 *
 * The one guard that is NOT passable. Deleting your own employee record
 * revokes your own access, and revoke deletes the `org_members` row that every
 * policy in the schema reads — so you would be locked out of the app with no
 * screen anywhere able to restore you. Deactivate is still offered; Delete
 * simply isn't.
 */
export function isSelf(
  employee: Pick<Employee, "user_id">,
  currentUserId: string
): boolean {
  return employee.user_id !== null && employee.user_id === currentUserId;
}

// `foodHandlerState` used to live here, when a food handler card was the only
// thing in the app that could lapse and it lapsed on a column of THIS table.
// Migration 034 put an expiry on every document, so the rule moved to
// `lib/employeeDocuments` as `expiryState` — one window, one comparison, asked
// of a card, a certificate or anything else somebody has to renew.
