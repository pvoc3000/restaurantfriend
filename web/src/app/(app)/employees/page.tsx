import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canReadHr, type Role } from "@/lib/roles";
import { serverTimeZone, todayInTimeZone } from "@/lib/today";
import { EmployeesList, type EmployeeRow } from "@/components/hr/EmployeesList";
import type { EmployeeSchedule, EmployeeStatus } from "@/lib/employees";
import { expiryRoll, type DocumentKind } from "@/lib/employeeDocuments";

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

  const [{ data, error }, { data: members }, { data: docRows, error: docError }] =
    await Promise.all([
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
      // What's on file that can lapse (migration 034). EVERY document, not only
      // the ones carrying a date: `expiryRoll` also has to know whether a food
      // handler CARD exists at all, since that is what decides whether the
      // employee row's legacy date still speaks. 42 rows today.
      //
      // Its error is NOT folded into the page's own — the benefits block's
      // reasoning on the employee record, one level up: a missing column must
      // not blank a roster that is otherwise perfectly readable. But it can't
      // be swallowed either, because an empty Expires column asserts that
      // nothing is lapsing, which is the one claim this screen exists to make.
      // So the column says what happened instead.
      supabase.from("employee_documents").select("employee_id, kind, expires_on"),
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

  const docsByEmployee = new Map<
    string,
    { kind: DocumentKind; expires_on: string | null }[]
  >();
  for (const d of docRows ?? []) {
    const key = d.employee_id as string;
    const doc = {
      kind: d.kind as DocumentKind,
      expires_on: (d.expires_on ?? null) as string | null,
    };
    const list = docsByEmployee.get(key);
    if (list) list.push(doc);
    else docsByEmployee.set(key, [doc]);
  }

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
    // Derived on the SERVER, where the documents already are — the row carries
    // one answer rather than a list the table has to reduce on every render.
    next_expiry:
      expiryRoll(
        docsByEmployee.get(e.id as string) ?? [],
        (e.food_handler_expires ?? null) as string | null
      )[0] ?? null,
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
  // ENUMERATED rather than looked up, so this one is activeLocations (design
  // rule 3): you don't hire someone into a shop that's closed. The filter above
  // still uses the full list, because an existing person's shop may have closed
  // under them.
  const locationOptions = session.activeLocations.map((l) => ({
    id: l.id,
    code: l.code,
    name: l.name,
  }));

  const today = todayInTimeZone(session.orgSettings.timezone ?? serverTimeZone());

  return (
    <div className="space-y-6">
      <EmployeesList
        rows={rows}
        locationCodes={locationCodes}
        locationOptions={locationOptions}
        positions={positions}
        today={today}
        expiryError={docError?.message ?? null}
        orgId={session.membership.org_id}
      />
    </div>
  );
}
