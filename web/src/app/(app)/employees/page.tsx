import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canReadHr, type Role } from "@/lib/roles";
import { serverTimeZone, todayInTimeZone } from "@/lib/today";
import { EmployeesList, type EmployeeRow } from "@/components/hr/EmployeesList";
import type { EmployeeSchedule, EmployeeStatus } from "@/lib/employees";

/**
 * The roster — everyone who has ever worked here, and who among them can sign
 * in to the app.
 *
 * ORG-scoped, not location-scoped: an employee has a MAIN location, but they
 * are a person in the org rather than a row belonging to one shop. So this
 * screen doesn't key on the working location and isn't behind the inactive-
 * location gate.
 */
export default async function EmployeesPage() {
  const session = await getAppSession();

  // Migration 020 gates employees at owner/admin — RLS would simply return no
  // rows below that, which renders as an empty table and reads like a broken
  // screen or an empty company. Say what's actually true instead.
  if (!canReadHr(session.membership.role)) {
    return (
      <div className="max-w-2xl space-y-2">
        <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
          Employees
        </h1>
        <p className="text-sm text-muted">
          The employee records are open to managers and the owner. Ask a manager
          if you need something from them.
        </p>
      </div>
    );
  }

  const supabase = await createClient();

  const [{ data, error }, { data: members }] = await Promise.all([
    supabase
      .from("employees")
      .select(
        "id, status, last_name, first_name, nickname, phone, email, position, schedule, start_date, food_handler_expires, main_location_id, user_id"
      )
      .order("last_name"),
    // Who has access, and as what. Separate from the employee row because the
    // link is deliberately one-directional: org_members is the access record
    // and knows nothing about HR.
    supabase.from("org_members").select("user_id, role"),
  ]);

  if (error) {
    return <p className="text-sm text-accent">Could not load employees: {error.message}</p>;
  }

  const roleByUser = new Map<string, Role>(
    (members ?? []).map((m) => [m.user_id as string, m.role as Role])
  );
  // The FULL location list, not activeLocations — someone's main shop may be
  // closed, and their row should still say DF03 rather than an em dash.
  const codeById = new Map(session.locations.map((l) => [l.id, l.code]));

  const rows: EmployeeRow[] = (data ?? []).map((e) => ({
    id: e.id as string,
    status: e.status as EmployeeStatus,
    last_name: e.last_name as string,
    first_name: e.first_name as string,
    nickname: (e.nickname ?? null) as string | null,
    phone: (e.phone ?? null) as string | null,
    email: (e.email ?? null) as string | null,
    position: (e.position ?? null) as string | null,
    schedule: (e.schedule ?? null) as EmployeeSchedule | null,
    start_date: (e.start_date ?? null) as string | null,
    food_handler_expires: (e.food_handler_expires ?? null) as string | null,
    location_code: e.main_location_id
      ? (codeById.get(e.main_location_id as string) ?? null)
      : null,
    role: e.user_id ? (roleByUser.get(e.user_id as string) ?? null) : null,
  }));

  // The vocabulary is whatever the data already uses — the item-category
  // pattern. Sorted so the filter reads alphabetically.
  const positions = [
    ...new Set(rows.map((r) => r.position).filter((p): p is string => !!p)),
  ].sort();
  const locationCodes = session.locations.map((l) => l.code);

  const today = todayInTimeZone(session.orgSettings.timezone ?? serverTimeZone());

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
          Employees
        </h1>
        <p className="max-w-[72ch] text-sm text-muted">
          Everyone who has worked here. Open a record to edit it, file their
          paperwork, or give them access to the app.
        </p>
      </div>

      <EmployeesList
        rows={rows}
        locationCodes={locationCodes}
        positions={positions}
        today={today}
      />
    </div>
  );
}
