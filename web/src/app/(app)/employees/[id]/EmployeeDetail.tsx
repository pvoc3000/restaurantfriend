import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canReadHr, type Role } from "@/lib/roles";
import { crumbPath, parseTrail } from "@/lib/breadcrumbs";
import {
  EMPLOYEES_CRUMB,
  employeeName,
  foodHandlerState,
  SCHEDULE_OPTIONS,
  STATUS_OPTIONS,
  type Employee,
} from "@/lib/employees";
import {
  EMPLOYEE_DOCS_BUCKET,
  SIGNED_URL_TTL_SECONDS,
  type EmployeeDocument,
  type SignedEmployeeDocument,
} from "@/lib/employeeDocuments";
import { serverTimeZone, todayInTimeZone } from "@/lib/today";
import type { RawSearchParams } from "@/lib/itemFilters";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { RecordNav } from "@/components/ui/RecordNav";
import { InlineValue } from "@/components/catalog/InlineValue";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { EmployeeDocuments } from "@/components/hr/EmployeeDocuments";
import { AppAccess } from "@/components/hr/AppAccess";

const Heading = SectionHeading;

/**
 * One person's record.
 *
 * This replaces FMP's nine-tab employee layout, whose INFO tab carried an SSN
 * and whose ADMIN tab carried a plain-text password — both readable by anyone
 * who could open the record. Neither exists here: the SSN never migrated, and
 * access is a grant rather than a stored credential (see the App access block).
 */
export async function EmployeeDetail({
  id,
  rawParams,
}: {
  id: string;
  rawParams: RawSearchParams;
}) {
  const session = await getAppSession();

  if (!canReadHr(session.membership.role)) {
    return (
      <p className="text-sm text-muted">
        Employee records are open to managers and the owner.
      </p>
    );
  }

  const supabase = await createClient();

  const [{ data: employee, error }, { data: documentRows }] = await Promise.all([
    supabase
      .from("employees")
      .select(
        "id, org_id, user_id, legacy_id, status, last_name, first_name, nickname, phone, email, address, date_of_birth, main_location_id, schedule, employment_type, start_date, end_date, position, notes, food_handler_expires"
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("employee_documents")
      .select("id, employee_id, storage_path, kind, file_name, content_type, byte_size, created_at")
      .eq("employee_id", id)
      .order("created_at"),
  ]);

  if (error) {
    return <p className="text-sm text-accent">Could not load this employee: {error.message}</p>;
  }
  if (!employee) {
    return <p className="text-sm text-muted">This employee no longer exists.</p>;
  }

  const person = employee as unknown as Employee;

  // The access record, if they have one. A second query rather than an embed:
  // org_members has no FK from employees (the link points the other way), and
  // most people have no row here at all.
  const { data: membership } = person.user_id
    ? await supabase
        .from("org_members")
        .select("role, display_name, invited_at")
        .eq("user_id", person.user_id)
        .maybeSingle()
    : { data: null };

  // Sign every document in ONE batch on the server — not a round trip per card,
  // and a URL built to expire doesn't outlive the page.
  const docs = (documentRows ?? []) as unknown as EmployeeDocument[];
  const { data: signed } = docs.length
    ? await supabase.storage
        .from(EMPLOYEE_DOCS_BUCKET)
        .createSignedUrls(
          docs.map((d) => d.storage_path),
          SIGNED_URL_TTL_SECONDS
        )
    : { data: null };
  const documents: SignedEmployeeDocument[] = docs.map((d, i) => ({
    ...d,
    url: signed?.[i]?.signedUrl ?? null,
  }));

  // Every position already in use — the vocabulary to pick from, the same
  // derive-then-allowNew shape as the inventory category picker.
  const { data: positionRows } = await supabase
    .from("employees")
    .select("position")
    .not("position", "is", null);
  const positions = [
    ...new Set(
      (positionRows ?? [])
        .map((r) => r.position as string | null)
        .filter((p): p is string => !!p)
    ),
  ].sort();

  const { data: typeRows } = await supabase
    .from("employees")
    .select("employment_type")
    .not("employment_type", "is", null);
  const employmentTypes = [
    ...new Set(
      (typeRows ?? [])
        .map((r) => r.employment_type as string | null)
        .filter((t): t is string => !!t)
    ),
  ].sort();

  const trail = parseTrail(rawParams, EMPLOYEES_CRUMB);
  const today = todayInTimeZone(session.orgSettings.timezone ?? serverTimeZone());
  const fhc = foodHandlerState(person.food_handler_expires, today);

  // No role gate on the editors: this whole screen is already owner/admin, and
  // that is exactly what migration 020's write policies allow.
  const table = "employees";

  return (
    <div className="space-y-8">
      <Breadcrumbs
        trail={trail}
        current={employeeName(person)}
        trailing={<RecordNav listKey={crumbPath(trail[trail.length - 1])} id={id} />}
      />

      {/* ---- who this is ---------------------------------------------- */}
      <div className="space-y-3">
        {/* The name is READ-ONLY here and editable in the rows below. Two
            InlineValues side by side don't work: the trigger is `w-full` of
            its parent, so first and last each claim a line and the heading
            wraps. Editing a name is rare enough that it belongs with the other
            fields — which is also where FMP kept it. */}
        <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
          {employeeName(person)}
        </h1>

        <dl className="grid max-w-md grid-cols-[8rem_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="py-0.5 text-subtle">First name</dt>
          <dd>
            <InlineValue
              table={table}
              id={person.id}
              column="first_name"
              value={person.first_name}
              nullable={false}
              placeholder="First"
            />
          </dd>
          <dt className="py-0.5 text-subtle">Last name</dt>
          <dd>
            <InlineValue
              table={table}
              id={person.id}
              column="last_name"
              value={person.last_name}
              nullable={false}
              placeholder="Last"
            />
          </dd>
          <dt className="py-0.5 text-subtle">Status</dt>
          <dd>
            <InlineValue
              table={table}
              id={person.id}
              column="status"
              value={person.status}
              kind="pick"
              nullable={false}
              options={STATUS_OPTIONS}
            />
          </dd>
          <dt className="py-0.5 text-subtle">Goes by</dt>
          <dd>
            <InlineValue
              table={table}
              id={person.id}
              column="nickname"
              value={person.nickname}
              placeholder="none"
            />
          </dd>
        </dl>
      </div>

      {/* ---- contact --------------------------------------------------- */}
      <section className="space-y-2">
        <Heading>Personal</Heading>
        <dl className="grid max-w-md grid-cols-[8rem_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="py-0.5 text-subtle">Phone</dt>
          <dd>
            <InlineValue
              table={table}
              id={person.id}
              column="phone"
              value={person.phone}
              placeholder="none"
            />
          </dd>
          <dt className="py-0.5 text-subtle">Email</dt>
          <dd>
            <InlineValue
              table={table}
              id={person.id}
              column="email"
              value={person.email}
              placeholder="none"
            />
          </dd>
          <dt className="py-0.5 text-subtle">Address</dt>
          <dd>
            <InlineValue
              table={table}
              id={person.id}
              column="address"
              value={person.address}
              placeholder="none"
            />
          </dd>
          <dt className="py-0.5 text-subtle">Born</dt>
          <dd>
            <InlineValue
              table={table}
              id={person.id}
              column="date_of_birth"
              value={person.date_of_birth}
              kind="date"
              placeholder="unknown"
            />
          </dd>
        </dl>
      </section>

      {/* ---- the job --------------------------------------------------- */}
      <section className="space-y-2">
        <Heading>Employment</Heading>
        <dl className="grid max-w-md grid-cols-[8rem_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="py-0.5 text-subtle">Location</dt>
          <dd>
            {/* The shop they mostly work at, not a restriction on where they
                may work — nothing in the app scopes a person to a location. */}
            <InlineValue
              table={table}
              id={person.id}
              column="main_location_id"
              value={person.main_location_id}
              kind="pick"
              placeholder="none"
              options={session.locations.map((l) => ({
                value: l.id,
                label: l.code,
                hint: l.name,
              }))}
            />
          </dd>
          <dt className="py-0.5 text-subtle">Position</dt>
          <dd>
            {/* Donut Friend's own vocabulary — Donut Friend, Supervisor, Baker,
                Fryer, AB — so it's picked from what's already in use and grows
                by typing, the inventory-category pattern. */}
            <InlineValue
              table={table}
              id={person.id}
              column="position"
              value={person.position}
              kind="pick"
              allowNew
              placeholder="none"
              options={positions.map((p) => ({ value: p, label: p }))}
            />
          </dd>
          <dt className="py-0.5 text-subtle">Schedule</dt>
          <dd>
            <InlineValue
              table={table}
              id={person.id}
              column="schedule"
              value={person.schedule}
              kind="pick"
              placeholder="none"
              options={SCHEDULE_OPTIONS}
            />
          </dd>
          <dt className="py-0.5 text-subtle">Type</dt>
          <dd>
            <InlineValue
              table={table}
              id={person.id}
              column="employment_type"
              value={person.employment_type}
              kind="pick"
              allowNew
              placeholder="none"
              options={employmentTypes.map((t) => ({ value: t, label: t }))}
            />
          </dd>
          <dt className="py-0.5 text-subtle">Started</dt>
          <dd>
            <InlineValue
              table={table}
              id={person.id}
              column="start_date"
              value={person.start_date}
              kind="date"
              placeholder="unknown"
            />
          </dd>
          <dt className="py-0.5 text-subtle">Ended</dt>
          <dd>
            {/* FMP had no termination date at all — 417 former employees and no
                record of when any of them left. Filled going forward. */}
            <InlineValue
              table={table}
              id={person.id}
              column="end_date"
              value={person.end_date}
              kind="date"
              placeholder="still here"
            />
          </dd>
          <dt className="py-0.5 text-subtle">Food card</dt>
          <dd className="flex items-baseline gap-2">
            <InlineValue
              table={table}
              id={person.id}
              column="food_handler_expires"
              value={person.food_handler_expires}
              kind="date"
              placeholder="none on file"
            />
            {person.status !== "inactive" && fhc === "expired" && (
              <span className="text-[11px] uppercase tracking-[0.12em] text-accent">
                expired
              </span>
            )}
            {person.status !== "inactive" && fhc === "soon" && (
              <span className="text-[11px] uppercase tracking-[0.12em] text-[var(--rf-yellow-600)]">
                expiring
              </span>
            )}
          </dd>
        </dl>
      </section>

      {/* ---- notes ----------------------------------------------------- */}
      <section className="space-y-2">
        <Heading>Notes</Heading>
        <div className="max-w-2xl text-sm">
          <InlineValue
            table={table}
            id={person.id}
            column="notes"
            value={person.notes}
            placeholder="none"
          />
        </div>
      </section>

      {/* ---- paperwork ------------------------------------------------- */}
      <section className="space-y-2">
        <Heading>Paperwork</Heading>
        <EmployeeDocuments
          employeeId={person.id}
          orgId={person.org_id}
          documents={documents}
          canEdit
        />
      </section>

      {/* ---- access ---------------------------------------------------- */}
      <section className="space-y-2">
        <Heading>App access</Heading>
        <AppAccess
          employeeId={person.id}
          employeeName={employeeName(person)}
          employeeEmail={person.email}
          orgId={person.org_id}
          userId={person.user_id}
          role={(membership?.role ?? null) as Role | null}
          displayName={(membership?.display_name ?? null) as string | null}
          invitedAt={(membership?.invited_at ?? null) as string | null}
        />
      </section>
    </div>
  );
}
