import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canEditChecklists } from "@/lib/roles";
import { daysBefore, serverTimeZone, todayInTimeZone } from "@/lib/today";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { BOXED_FIELD, BOXED_FIELDS } from "@/components/ui/fieldMetrics";
import { parseTrail } from "@/lib/breadcrumbs";
import type { RawSearchParams } from "@/lib/itemFilters";
import { expiryState } from "@/lib/employeeDocuments";
import { assessReading } from "@/lib/checklists";
import { TASK_STATUS_LABEL, isTaskOpen, type TaskStatus } from "@/lib/facilityTasks";

const CRUMB = { href: "/equipment", label: "Equipment" };

/** How far back the reading history looks. */
const HISTORY_DAYS = 60;

export default async function EquipmentRecordPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const { id } = await params;
  const rawParams = await searchParams;
  const session = await getAppSession();
  const supabase = await createClient();
  const editable = canEditChecklists(session.membership.role);
  const today = todayInTimeZone(session.orgSettings.timezone ?? serverTimeZone());
  const since = daysBefore(today, HISTORY_DAYS);

  const [{ data: unit, error }, { data: sections }, { data: vendors }, { data: tasks }] =
    await Promise.all([
      supabase
        .from("equipment")
        .select(
          "id, location_id, name, kind, make, model, serial, installed_on, warranty_ends_on, service_vendor_id, shop_section_id, is_active, notes",
        )
        .eq("id", id)
        .maybeSingle(),
      supabase.from("shop_sections").select("id, display_name, location_id"),
      supabase.from("vendors").select("id, name").eq("is_active", true).order("name"),
      supabase
        .from("location_tasks")
        .select("id, kind, title, status, created_at, resolution_note")
        .eq("equipment_id", id)
        .order("created_at", { ascending: false }),
    ]);

  if (error) {
    return (
      <p className="max-w-[72ch] text-sm text-accent">
        Could not load this equipment: {error.message}
      </p>
    );
  }
  if (!unit) notFound();

  // The readings taken against this unit, newest first. Joined through the run
  // so each one carries the day it was taken rather than the row's own clock.
  const { data: readings } = await supabase
    .from("checklist_run_items")
    .select(
      "id, prompt, value_number, unit, min_value, max_value, status, checklist_runs!inner(business_date, title)",
    )
    .eq("equipment_id", id)
    .not("value_number", "is", null)
    .gte("checklist_runs.business_date", since)
    .order("id");

  const trail = parseTrail(rawParams, CRUMB);
  const localSections = (sections ?? []).filter(
    (s) => s.location_id === unit.location_id,
  );
  const openTasks = (tasks ?? []).filter((t) => isTaskOpen({ status: t.status as TaskStatus }));
  const warranty = expiryState(
    (unit.warranty_ends_on as string | null) ?? null,
    today,
  );
  const field = BOXED_FIELDS ? BOXED_FIELD : "";

  const rows = (readings ?? [])
    .map((r) => {
      const run = r.checklist_runs as unknown as { business_date: string; title: string };
      return {
        id: r.id as string,
        date: run?.business_date ?? "",
        prompt: r.prompt as string,
        value: r.value_number == null ? null : Number(r.value_number),
        unit: (r.unit as string | null) ?? null,
        min_value: r.min_value == null ? null : Number(r.min_value),
        max_value: r.max_value == null ? null : Number(r.max_value),
      };
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  return (
    <div className="space-y-12">
      <Breadcrumbs trail={trail} current={unit.name as string} />

      <div className="space-y-1">
        <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
          {editable ? (
            <InlineValue
              table="equipment"
              id={id}
              column="name"
              value={unit.name as string}
              nullable={false}
              ariaLabel="Name"
              className="uppercase"
            />
          ) : (
            (unit.name as string)
          )}
        </h1>
        <p className="text-sm text-muted">
          {(unit.kind as string | null) ?? "Equipment"}
          {!unit.is_active && " · inactive"}
          {openTasks.length > 0 &&
            ` · ${openTasks.length} open ${openTasks.length === 1 ? "job" : "jobs"}`}
        </p>
      </div>

      <section className="space-y-4">
        <SectionHeading>Details</SectionHeading>
        <dl className="grid max-w-[min(42rem,max(24rem,50%))] grid-cols-[8rem_1fr] items-center gap-x-4 gap-y-2 text-sm">
          {(
            [
              ["Kind", "kind", unit.kind],
              ["Make", "make", unit.make],
              ["Model", "model", unit.model],
              ["Serial", "serial", unit.serial],
            ] as const
          ).map(([label, column, value]) => (
            <div key={column} className="contents">
              <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                {label}
              </dt>
              <dd>
                {editable ? (
                  <InlineValue
                    table="equipment"
                    id={id}
                    column={column}
                    value={(value as string | null) ?? null}
                    boxed={BOXED_FIELDS}
                    className={field}
                    ariaLabel={label}
                  />
                ) : (
                  <span className={READ_ONLY_VALUE}>{(value as string | null) ?? ""}</span>
                )}
              </dd>
            </div>
          ))}

          <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
            Where
          </dt>
          <dd>
            {editable ? (
              <InlineValue
                table="equipment"
                id={id}
                column="shop_section_id"
                value={(unit.shop_section_id as string | null) ?? ""}
                kind="pick"
                boxed={BOXED_FIELDS}
                className={field}
                ariaLabel="Where it stands"
                options={[
                  { value: "", label: "No section" },
                  ...localSections.map((s) => ({
                    value: s.id as string,
                    label: s.display_name as string,
                  })),
                ]}
              />
            ) : (
              <span className={READ_ONLY_VALUE}>
                {localSections.find((s) => s.id === unit.shop_section_id)?.display_name ??
                  ""}
              </span>
            )}
          </dd>

          <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
            Installed
          </dt>
          <dd>
            {editable ? (
              <InlineValue
                table="equipment"
                id={id}
                column="installed_on"
                value={(unit.installed_on as string | null) ?? null}
                kind="date"
                boxed={BOXED_FIELDS}
                className={field}
                ariaLabel="Installed on"
              />
            ) : (
              <span className={READ_ONLY_VALUE}>
                {(unit.installed_on as string | null) ?? ""}
              </span>
            )}
          </dd>

          <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
            Warranty
          </dt>
          <dd className="flex items-center gap-2">
            {editable ? (
              <InlineValue
                table="equipment"
                id={id}
                column="warranty_ends_on"
                value={(unit.warranty_ends_on as string | null) ?? null}
                kind="date"
                boxed={BOXED_FIELDS}
                className={field}
                ariaLabel="Warranty ends on"
              />
            ) : (
              <span className={READ_ONLY_VALUE}>
                {(unit.warranty_ends_on as string | null) ?? ""}
              </span>
            )}
            {/* The LABEL carries the meaning of an empty box — 034's rule, and
                without it a blank reads as something nobody got round to. */}
            {warranty === "none" && (
              <span className="text-[12px] text-muted">Never lapses</span>
            )}
            {warranty === "expired" && (
              <span className="bg-accent px-1 text-[12px] text-white">Lapsed</span>
            )}
            {warranty === "soon" && (
              <span className="bg-mark-fill px-1 text-[12px]">Lapsing soon</span>
            )}
          </dd>

          <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
            Serviced by
          </dt>
          <dd>
            {editable ? (
              <InlineValue
                table="equipment"
                id={id}
                column="service_vendor_id"
                value={(unit.service_vendor_id as string | null) ?? ""}
                kind="pick"
                boxed={BOXED_FIELDS}
                className={field}
                ariaLabel="Serviced by"
                options={[
                  { value: "", label: "Nobody set" },
                  ...(vendors ?? []).map((v) => ({
                    value: v.id as string,
                    label: v.name as string,
                  })),
                ]}
              />
            ) : (
              <span className={READ_ONLY_VALUE}>
                {(vendors ?? []).find((v) => v.id === unit.service_vendor_id)?.name ?? ""}
              </span>
            )}
          </dd>

          <dt className="self-start pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
            Notes
          </dt>
          <dd>
            {editable ? (
              <InlineValue
                table="equipment"
                id={id}
                column="notes"
                value={(unit.notes as string | null) ?? null}
                multiline
                boxed={BOXED_FIELDS}
                ariaLabel="Notes"
              />
            ) : (
              <span className={READ_ONLY_VALUE}>{(unit.notes as string | null) ?? ""}</span>
            )}
          </dd>
        </dl>
      </section>

      <section className="space-y-3">
        <SectionHeading count={rows.length}>
          Readings — last {HISTORY_DAYS} days
        </SectionHeading>
        {rows.length === 0 ? (
          <p className="max-w-[72ch] text-sm text-muted">
            Nothing recorded against this yet. Point a checklist item at it and
            ask for a number — a reading outside its expected range then flags
            itself.
          </p>
        ) : (
          <ul className="max-w-[42rem] divide-y divide-hairline border border-hairline text-sm">
            {rows.map((r) => {
              const verdict = assessReading(r, r.value);
              const bad = verdict === "below" || verdict === "above";
              return (
                <li key={r.id} className="flex items-baseline justify-between gap-4 p-3">
                  <span className="tabular-nums text-muted">{r.date}</span>
                  <span className="min-w-0 flex-1">{r.prompt}</span>
                  <span
                    className={`tabular-nums ${bad ? "bg-accent px-1 text-white" : ""}`}
                  >
                    {r.value}
                    {r.unit ? ` ${r.unit}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <SectionHeading count={tasks?.length ?? 0}>Jobs</SectionHeading>
        {(tasks ?? []).length === 0 ? (
          <p className="text-sm text-muted">Nothing has ever been raised on this.</p>
        ) : (
          <ul className="max-w-[42rem] divide-y divide-hairline border border-hairline text-sm">
            {(tasks ?? []).map((t) => (
              <li key={t.id as string} className="flex items-baseline justify-between gap-4 p-3">
                <span className="tabular-nums text-muted">
                  {(t.created_at as string).slice(0, 10)}
                </span>
                <span className="min-w-0 flex-1">
                  <Link
                    href={
                      t.kind === "maintenance"
                        ? `/maintenance-requests?open=${t.id}`
                        : `/tasks?open=${t.id}`
                    }
                    className="hover:underline"
                  >
                    {t.title as string}
                  </Link>
                </span>
                <span className={isTaskOpen({ status: t.status as TaskStatus }) ? "" : "text-muted"}>
                  {TASK_STATUS_LABEL[t.status as TaskStatus]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
