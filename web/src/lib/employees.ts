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
};

/** "Prentice, Ada" — the sort order and the way a roster reads. */
export function employeeName(
  e: Pick<Employee, "first_name" | "last_name">
): string {
  return `${e.last_name}, ${e.first_name}`;
}

/**
 * How close a food handler card is to lapsing, for the mark colour on the
 * detail screen and the list.
 *
 * California cards run three years and a lapsed one is a health-inspection
 * finding, so "soon" is generous: 60 days is time to book the course.
 */
export type ExpiryState = "none" | "expired" | "soon" | "ok";

export function foodHandlerState(
  expires: string | null,
  today: string
): ExpiryState {
  if (!expires) return "none";
  if (expires < today) return "expired";
  const soon = new Date(`${today}T00:00:00`);
  soon.setDate(soon.getDate() + 60);
  return expires <= soon.toISOString().slice(0, 10) ? "soon" : "ok";
}
