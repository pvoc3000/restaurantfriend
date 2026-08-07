import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canReadHr, type Role } from "@/lib/roles";
import { crumbPath, parseTrail } from "@/lib/breadcrumbs";
import {
  EMPLOYEES_CRUMB,
  EMPLOYEE_TABS,
  EMPLOYEE_TAB_LABEL,
  employeeName,
  employeeTabHref,
  parseEmployeeTab,
  SCHEDULE_OPTIONS,
  STATUS_LABEL,
  STATUS_OPTIONS,
  type Employee,
  type EmployeeStatus,
} from "@/lib/employees";
import {
  expiryState,
  foodHandlerExpiry,
  EMPLOYEE_DOCS_BUCKET,
  SIGNED_URL_TTL_SECONDS,
  type EmployeeDocument,
  type SignedEmployeeDocument,
} from "@/lib/employeeDocuments";
import { serverTimeZone, todayInTimeZone } from "@/lib/today";
import type { RawSearchParams } from "@/lib/itemFilters";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { RecordNav } from "@/components/ui/RecordNav";
import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { SectionNav } from "@/components/ui/SectionNav";
import { EmployeeDocuments } from "@/components/hr/EmployeeDocuments";
import { AppAccess } from "@/components/hr/AppAccess";
import { EmployeeActions } from "@/components/hr/EmployeeActions";
import { EmployeePayroll } from "@/components/hr/EmployeePayroll";
import {
  EmployeeBenefits,
  type EmployeeBenefitRow,
} from "@/components/hr/EmployeeBenefits";
import {
  AddEmployeeBenefit,
  type BenefitOption,
} from "@/components/hr/AddEmployeeBenefit";
import {
  EmployeeEvents,
  type EmployeeEventRow,
} from "@/components/hr/EmployeeEvents";
import { NewEmployeeEvent } from "@/components/hr/NewEmployeeEvent";

const Heading = SectionHeading;

/**
 * How many events one record fetches. A long-serving person carries ~1,000 shift
 * ratings, and the block states the total beside what it shows rather than
 * pretending the cap is the whole history.
 */
const EVENT_PAGE = 500;

const EVENT_COLUMNS =
  "id, occurred_on, kind, score, shift, position, headline, detail, outcome, author_employee_id, author_name, location_id";

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

  // WHICH TAB, and therefore WHAT TO FETCH. Splitting the record into five
  // screens is what makes this worth doing twice over: it is not only shorter to
  // read, it stops every visit paying for the parts you aren't looking at — the
  // Info tab now runs one query where the whole record ran eleven, and only the
  // Documents tab signs a Storage URL.
  //
  // `SKIP` stands in for a query that isn't wanted, so the destructuring below
  // keeps its shape. Promise.all takes plain values happily.
  const tab = parseEmployeeTab(rawParams.tab);
  const SKIP = { data: null, error: null, count: null };
  const wantsEmployment = tab === "employment";
  const wantsEvents = tab === "events";
  // The Employment tab reads the documents to work out the food handler card's
  // state; only the Documents tab needs them SIGNED, which is the expensive half.
  const wantsDocumentRows = tab === "documents" || tab === "employment";

  const [
    { data: employee, error },
    { data: documentRows, error: documentError },
    { data: benefitRows, error: benefitError },
    { data: entitlementRows },
    { data: wageTypeRows },
    { data: narrativeRows, error: narrativeError },
    { data: shiftRows, error: shiftError, count: shiftTotal },
  ] = await Promise.all([
    supabase
      .from("employees")
      .select(
        "id, org_id, user_id, legacy_id, status, last_name, first_name, nickname, phone, email, address, date_of_birth, main_location_id, schedule, employment_type, start_date, end_date, position, notes, food_handler_expires, gusto_id, homebase_id, primary_wage_type, excludes_tips"
      )
      .eq("id", id)
      .maybeSingle(),
    wantsDocumentRows
      ? supabase
          .from("employee_documents")
          .select(
            "id, employee_id, storage_path, kind, file_name, content_type, byte_size, expires_on, created_at"
          )
          .eq("employee_id", id)
          .order("created_at")
      : SKIP,
    // 033. Errors are NOT folded into the page's own — a missing benefits table
    // must not blank an employee record that is otherwise perfectly readable.
    // The block below says so in its own words instead.
    wantsEmployment
      ? supabase
          .from("payroll_benefits")
          .select("id, name, unit, default_amount")
          .eq("is_active", true)
          .order("sort_order")
          .order("name")
      : SKIP,
    wantsEmployment
      ? supabase
          .from("employee_benefits")
          .select("id, benefit_id, location_id, amount, starts_on, ends_on, notes")
          .eq("employee_id", id)
      : SKIP,
    // Every job title already in use, so Primary job OFFERS rather than asks
    // someone to remember the exact spelling. Same move as the item category
    // picker.
    wantsEmployment
      ? supabase.from("employees").select("primary_wage_type").not("primary_wage_type", "is", null)
      : SKIP,
    // 035. Like the benefits above, this error is NOT folded into the page's
    // own — a missing events table must not blank a readable employee record.
    //
    // TWO QUERIES, AND THE SPLIT IS THE POINT. Measured on real data
    // (2026-08-06): Ruby Mares has 1,590 events, of which 84 are notes and
    // warnings. Capping the whole set at 500 and letting the client filter would
    // have shown 500 recent SHIFTS and silently cut off every warning older than
    // them — hiding exactly what the default tier exists to surface, while the
    // tab's own count said everything was fine.
    //
    // So the narrative kinds are fetched WHOLE (they are rare — 2,635 across all
    // 445 people) and only the shift ratings are capped.
    wantsEvents
      ? supabase
          .from("employee_events")
          .select(EVENT_COLUMNS)
          .eq("employee_id", id)
          .neq("kind", "shift")
          .order("occurred_on", { ascending: false })
          .order("id")
      : SKIP,
    // The second `.order("id")` is load-bearing rather than tidy — `occurred_on`
    // is a DATE and ties are everywhere, and a ranged sweep on a non-unique sort
    // key returns overlapping pages, which is what fabricated 112,338
    // double-time hours in the 2026-08-05 audit.
    wantsEvents
      ? supabase
          .from("employee_events")
          .select(EVENT_COLUMNS, { count: "exact" })
          .eq("employee_id", id)
          .eq("kind", "shift")
          .order("occurred_on", { ascending: false })
          .order("id")
          .range(0, EVENT_PAGE - 1)
      : SKIP,
  ]);

  const eventRows = [...(narrativeRows ?? []), ...(shiftRows ?? [])];
  const eventError = narrativeError ?? shiftError;

  if (error) {
    return <p className="text-sm text-accent">Could not load this employee: {error.message}</p>;
  }
  if (!employee) {
    return <p className="text-sm text-muted">This employee no longer exists.</p>;
  }

  const person = employee as unknown as Employee;

  // ---- payroll ------------------------------------------------------------
  const benefitOptions: BenefitOption[] = (benefitRows ?? []).map((b) => ({
    id: b.id as string,
    name: b.name as string,
    unit: b.unit as BenefitOption["unit"],
    default_amount: b.default_amount === null ? null : Number(b.default_amount),
  }));
  const benefitById = new Map(benefitOptions.map((b) => [b.id, b]));
  // The FULL location list, not activeLocations — an entitlement at a shop that
  // has since closed still has to render its code rather than an em dash.
  // Design rule 3: a LOOK-UP, not an enumeration.
  const codeById = new Map(session.locations.map((l) => [l.id, l.code]));

  const benefitRowsForTable: EmployeeBenefitRow[] = (entitlementRows ?? []).map((e) => {
    const b = benefitById.get(e.benefit_id as string);
    return {
      id: e.id as string,
      benefit_id: e.benefit_id as string,
      benefitName: b?.name ?? "(retired benefit)",
      benefitUnit: b?.unit ?? "per_shift",
      benefitDefault: b?.default_amount ?? null,
      location_id: e.location_id as string,
      locationCode: codeById.get(e.location_id as string) ?? "—",
      amount: e.amount === null ? null : Number(e.amount),
      starts_on: (e.starts_on ?? null) as string | null,
      ends_on: (e.ends_on ?? null) as string | null,
      notes: (e.notes ?? null) as string | null,
    };
  });

  const wageTypes = [
    ...new Set((wageTypeRows ?? []).map((r) => r.primary_wage_type as string).filter(Boolean)),
  ].sort();

  // The access record, if they have one. A second query rather than an embed:
  // org_members has no FK from employees (the link points the other way), and
  // most people have no row here at all.
  // The Admin tab needs it for the access block; every other tab needs it for
  // nothing at all.
  const { data: membership } = person.user_id && tab === "admin"
    ? await supabase
        .from("org_members")
        .select("role, display_name, invited_at")
        .eq("user_id", person.user_id)
        .maybeSingle()
    : { data: null };

  // Sign every document in ONE batch on the server — not a round trip per card,
  // and a URL built to expire doesn't outlive the page.
  const docs = (documentRows ?? []) as unknown as EmployeeDocument[];
  const { data: signed } = docs.length && tab === "documents"
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
  const { data: positionRows } = wantsEmployment
    ? await supabase.from("employees").select("position").not("position", "is", null)
    : { data: null };
  const positions = [
    ...new Set(
      (positionRows ?? [])
        .map((r) => r.position as string | null)
        .filter((p): p is string => !!p)
    ),
  ].sort();

  // ---- events (035) -------------------------------------------------------
  // Who wrote each one. A second query rather than a PostgREST embed: there are
  // TWO foreign keys from employee_events to employees (the subject and the
  // author), so an embed has to be disambiguated by constraint name, and one
  // author writes hundreds of these — the embed would send their row hundreds
  // of times. FMP's own `author_name` string is the fallback for a supervisor
  // who has no employee record any more.
  const authorIds = [
    ...new Set(
      eventRows.map((e) => e.author_employee_id as string | null).filter((v): v is string => !!v)
    ),
  ];
  const { data: authorRows } = authorIds.length
    ? await supabase.from("employees").select("id, first_name, last_name").in("id", authorIds)
    : { data: null };
  const authorById = new Map(
    (authorRows ?? []).map((a) => [a.id as string, employeeName(a as Pick<Employee, "first_name" | "last_name">)])
  );

  const events: EmployeeEventRow[] = eventRows.map((e) => ({
    id: e.id as string,
    occurred_on: e.occurred_on as string,
    kind: e.kind as EmployeeEventRow["kind"],
    score: e.score === null ? null : Number(e.score),
    shift: (e.shift ?? null) as EmployeeEventRow["shift"],
    position: (e.position ?? null) as string | null,
    headline: (e.headline ?? null) as string | null,
    detail: (e.detail ?? null) as string | null,
    outcome: (e.outcome ?? null) as string | null,
    author:
      authorById.get((e.author_employee_id ?? "") as string) ?? ((e.author_name ?? null) as string | null),
    locationCode: codeById.get((e.location_id ?? "") as string) ?? null,
  }));

  // The outcomes already in use, so "Action taken" offers rather than asking
  // anyone to remember how they phrased it last time.
  const outcomes = [...new Set(events.map((e) => e.outcome).filter((o): o is string => !!o))]
    .sort()
    .slice(0, 40);

  // The signed-in person's own employee row, so a new event records who wrote
  // it without the dialog having to query for itself.
  const { data: selfRow } = wantsEvents
    ? await supabase.from("employees").select("id").eq("user_id", session.userId).maybeSingle()
    : { data: null };

  const { data: typeRows } = wantsEmployment
    ? await supabase.from("employees").select("employment_type").not("employment_type", "is", null)
    : { data: null };
  const employmentTypes = [
    ...new Set(
      (typeRows ?? [])
        .map((r) => r.employment_type as string | null)
        .filter((t): t is string => !!t)
    ),
  ].sort();

  const trail = parseTrail(rawParams, EMPLOYEES_CRUMB);
  const today = todayInTimeZone(session.orgSettings.timezone ?? serverTimeZone());
  // The card on file wins over the column; see `foodHandlerExpiry`.
  const foodCard = foodHandlerExpiry(documents, person.food_handler_expires);
  const fhc = expiryState(foodCard.on, today);

  // No role gate on the editors: this whole screen is already owner/admin, and
  // that is exactly what migration 020's write policies allow.
  const table = "employees";

  // Built once and rendered twice — see the two navs below.
  const tabOptions = EMPLOYEE_TABS.map((t) => ({
    key: t,
    label: EMPLOYEE_TAB_LABEL[t],
    href: employeeTabHref(id, t, rawParams),
  }));

  return (
    <div className="space-y-8">
      {/* The record book sits at the FAR right of the crumb row (Mark,
          2026-08-02). It comes OUT of the Breadcrumbs `trailing` slot to get
          there: as a flex item the crumb row is only as wide as its text, so
          "the row's right-hand end" was three inches from the left margin. */}
      <div className="flex items-start justify-between gap-4">
        <Breadcrumbs trail={trail} current={employeeName(person)} />
        <RecordNav listKey={crumbPath(trail[trail.length - 1])} id={id} />
      </div>

      {/* ---- who this is, ABOVE the split ------------------------------ */}
      {/* Gusto's shape, and the right one: the name is the record's identity, so
          it stays put while the sections change under it. The line beneath is
          the three facts you would otherwise change tabs to check.

          INDENTED TO THE CONTENT COLUMN (Mark, 2026-08-06), not to the page
          margin: `lg:ml-48` is exactly the sidebar's `lg:w-40` plus the row's
          `lg:gap-8` (10rem + 2rem), so the name starts on the same left edge as
          everything under it. THOSE THREE VALUES ARE COUPLED — change the
          sidebar's width and this has to move with it, or the heading drifts off
          the content it belongs to. Below `lg` there is no sidebar to clear. */}
      <div className="space-y-1 lg:ml-48">
        {/* The name is READ-ONLY here and editable on the Info tab. Two
            InlineValues side by side don't work: the trigger is `w-full` of
            its parent, so first and last each claim a line and the heading
            wraps. Editing a name is rare enough that it belongs with the other
            fields — which is also where FMP kept it. */}
        <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
          {employeeName(person)}
        </h1>
        <p className="text-sm text-muted">
          {[
            STATUS_LABEL[person.status as EmployeeStatus],
            person.position,
            person.main_location_id ? codeById.get(person.main_location_id) : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>

      {/* ---- the record's five sections -------------------------------- */}
      {/* Below `lg` it STACKS, bar above content: a 192px column beside a table
          at iPad-portrait width leaves neither enough room, and a horizontal bar
          is what this control is anyway. */}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
        {/* TWO renderings of one control, wrapped rather than switched with a
            responsive `display` utility on the control itself: Tailwind resolves
            competing utilities by STYLESHEET order, not class-string order, so a
            `hidden` passed in `className` would not reliably beat the component's
            own `flex` (the trap that put the ⋯ menu's hints beside their labels).
            A wrapper div has no such argument to lose. */}
        <div
          className="hidden lg:sticky lg:block lg:w-40 lg:shrink-0"
          // Under the masthead, which MEASURES itself — it wraps to two or three
          // rows at iPad widths, so any constant here would be wrong at some width.
          style={{ top: "calc(var(--rf-header-h) + 1.5rem)" }}
        >
          <SectionNav ariaLabel="Which part of this record" value={tab} items={tabOptions} />
        </div>
        <div className="lg:hidden">
          <SectionNav
            orientation="horizontal"
            ariaLabel="Which part of this record"
            value={tab}
            items={tabOptions}
          />
        </div>

        <div className="min-w-0 flex-1 space-y-8">

      {tab === "info" && (
        <>
      <div className="space-y-3">
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
        </>
      )}

      {tab === "employment" && (
        <>
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
          <dd className="space-y-0.5">
            <div className="flex items-baseline gap-2">
              {foodCard.source === "document" ? (
                /* The card ITSELF is on file, so its own expiry is the record
                   and this row only reports it. Editing it here as well would
                   be two boxes for one date, and the one on the chip is the one
                   sitting next to the photograph of the card. */
                <span className={`${READ_ONLY_VALUE} tabular-nums`}>
                  {foodCard.on ?? <span className="text-faint">no expiry on the card</span>}
                </span>
              ) : (
                <InlineValue
                  table={table}
                  id={person.id}
                  column="food_handler_expires"
                  value={person.food_handler_expires}
                  kind="date"
                  placeholder="none on file"
                />
              )}
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
            </div>
            {/* Said ONLY when the date comes from a filed card, because then it
                is not editable here and the reader needs sending somewhere.
                The other case — the legacy `employees.food_handler_expires`
                column, which is what the 16 current staff with no photographed
                card still read from — says nothing (Mark, 2026-08-06): the box
                beside it is editable, which is the whole answer. That column is
                retired by a follow-up migration once every card is filed; 034
                names the probe. */}
            {foodCard.source === "document" && (
              <p className="text-[11px] text-faint">
                From the card on file — edit it under Paperwork.
              </p>
            )}
          </dd>
        </dl>
      </section>

      {/* ---- payroll ---------------------------------------------------- */}
      <section className="space-y-2">
        <Heading>Payroll</Heading>
        <EmployeePayroll
          employeeId={person.id}
          legacyId={person.legacy_id}
          gustoId={person.gusto_id}
          homebaseId={person.homebase_id}
          primaryWageType={person.primary_wage_type}
          excludesTips={person.excludes_tips}
          wageTypes={wageTypes}
          editable
        />

        <div className="space-y-2 pt-4">
          <h3 className="text-[11px] uppercase tracking-[0.12em] text-subtle">Benefits</h3>
          {benefitError ? (
            <p className="max-w-[72ch] border border-accent px-4 py-3 text-sm text-accent">
              {benefitError.message}
              {/payroll_benefits|employee_benefits/.test(benefitError.message)
                ? " — migration 033 has not been applied yet."
                : ""}
            </p>
          ) : (
            <>
              <EmployeeBenefits rows={benefitRowsForTable} editable />
              <div className="pt-2">
                <AddEmployeeBenefit
                  employeeId={person.id}
                  orgId={person.org_id}
                  benefits={benefitOptions}
                  locations={session.activeLocations.map((l) => ({ id: l.id, code: l.code }))}
                />
              </div>
            </>
          )}
        </div>
      </section>

        </>
      )}

      {tab === "events" && (
      /* ---- events (035) ---------------------------------------------- */
      <section className="space-y-2">
        {/* The heading and the command share a line, and the row spans the
            table's FULL width so the button lands flush with its right edge
            (Mark, 2026-08-06). That is why this sits above the strip rather than
            inside `leading`: `leading` is a `min-w-0 flex-1` box with the eye's
            cell beside it, so anything right-aligned in there stops ~48px short —
            the gap plus the eye. The usual "a heading over a DataTable goes in
            `leading`" rule is about an otherwise EMPTY 32px band opening a 44px
            hole under the heading; this strip carries the tier filters, so there
            is no empty band to close.
            `items-center`: a 16px heading and a 36px button share a centre line,
            not a baseline. */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <Heading count={eventError ? undefined : (shiftTotal ?? 0) + (narrativeRows ?? []).length}>
            Events
          </Heading>
          {!eventError && (
            <NewEmployeeEvent
              employeeId={person.id}
              orgId={person.org_id}
              userId={session.userId}
              authorEmployeeId={(selfRow?.id ?? null) as string | null}
              locations={session.activeLocations.map((l) => ({ id: l.id, code: l.code }))}
              today={today}
              outcomes={outcomes}
            />
          )}
        </div>
        {eventError ? (
          <p className="max-w-[72ch] border border-accent px-4 py-3 text-sm text-accent">
            {eventError.message}
            {/employee_events/.test(eventError.message)
              ? " — migration 035 has not been applied yet."
              : ""}
          </p>
        ) : (
          <EmployeeEvents rows={events} shiftTotal={shiftTotal ?? 0} editable />
        )}
      </section>
      )}

      {tab === "admin" && (
        <>
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

      {/* ---- the end of the record ------------------------------------- */}
      {/* Bottom LEFT, after everything (Mark, 2026-08-02, having tried it
          beside the name, then under the record book, then bottom right).
          Still the end — now the end of the LAST tab, which is the same
          argument one level up: you pass whether they can sign in before you
          reach the one control that destroys the thing. Left is where it lines
          up with every other block.
          A plain button rather than a `ui/ActionBar`: the bar is a fixed black
          band that would follow you up the whole record for the sake of one
          command used a few times a year, and it costs every screen carrying
          it 88px of bottom clearance. */}
      <div className="flex justify-start pt-4">
        <EmployeeActions
          employee={{
            id: person.id,
            legacy_id: person.legacy_id,
            user_id: person.user_id,
            status: person.status,
          }}
          name={employeeName(person)}
          role={(membership?.role ?? null) as Role | null}
          currentUserId={session.userId}
          afterDelete={{ href: "/employees" }}
        />
      </div>

        </>
      )}

      {tab === "documents" && (
        /* ---- paperwork, on a screen of its own ------------------------ */
        /* It used to be pinned to the foot of the window and revealed on hover
           (PO detail's treatment, Mark 2026-08-06), because a grid of documents
           you consult occasionally was spending a third of the record on itself.
           A tab of its own settles that better than hiding did: the reason to
           hide was crowding, and there is no crowding here. So `variant="page"`
           — the same card, the same drop zone, body open and in flow. */
        <section className="space-y-2">
          <Heading count={documents.length}>Paperwork</Heading>
          {documentError ? (
            /* 018's pattern: say what happened rather than render an empty card,
               which reads as "nothing filed yet" — the one thing this block must
               never claim by accident. Before migration 034 this is what a
               missing `expires_on` column looks like. */
            <p className="border border-ink bg-white px-4 py-3 text-sm text-accent">
              Could not read this personnel file: {documentError.message}
            </p>
          ) : (
            <EmployeeDocuments
              employeeId={person.id}
              orgId={person.org_id}
              documents={documents}
              legacyFoodHandlerExpires={person.food_handler_expires}
              today={today}
              canEdit
              variant="page"
            />
          )}
        </section>
      )}

        </div>
      </div>
    </div>
  );
}
