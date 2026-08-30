import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canEditChecklists } from "@/lib/roles";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { ActiveToggle } from "@/components/catalog/ActiveToggle";
import { WeekdayPicker } from "@/components/catalog/WeekdayPicker";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { BOXED_FIELD, BOXED_FIELDS } from "@/components/ui/fieldMetrics";
import { parseTrail } from "@/lib/breadcrumbs";
import type { RawSearchParams } from "@/lib/itemFilters";
import { SHIFT_SLOT_LABEL } from "@/lib/employeeEvents";
import {
  CHECKLIST_KIND_HINT,
  CHECKLIST_KIND_LABEL,
  shiftSetLabel,
  type ChecklistKind,
} from "@/lib/checklists";
import { TemplateShiftSet } from "@/components/checklists/TemplateShiftSet";
import { TemplateActions } from "@/components/checklists/TemplateActions";
import {
  TemplateItemsTable,
  type TemplateItemRow,
} from "@/components/checklists/TemplateItemsTable";

const CRUMB = { href: "/checklist-templates", label: "Master lists" };

/**
 * One master list: what it is, when it is asked for, and what it asks.
 *
 * The fields are BOXED (docs/detail-field-styling-brief.md) — the box is what
 * says "you can change this", so a read-only value never gets one, which is why
 * every cell below branches on `editable` rather than passing a `disabled`.
 */
export default async function ChecklistTemplatePage({
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

  const [{ data: template, error }, { data: items }, { data: sections }, { data: equipment }] =
    await Promise.all([
      supabase
        .from("checklist_templates")
        .select("id, location_id, kind, name, weekdays, shifts, is_active, notes")
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("checklist_template_items")
        .select(
          "id, shop_section_id, sort, prompt, response_type, unit, min_value, max_value, choices, equipment_id, requires_photo, weekdays, is_active",
        )
        .eq("template_id", id)
        .order("sort"),
      supabase
        .from("shop_sections")
        .select("id, display_name, location_id, sort_order")
        .order("sort_order"),
      supabase
        .from("equipment")
        .select("id, name, location_id")
        .eq("is_active", true)
        .order("name"),
    ]);

  if (error) {
    return (
      <p className="max-w-[72ch] text-sm text-accent">
        Could not load this master list: {error.message}
        {error.message.includes("checklist_templates") &&
          " — migration 076 has not been applied yet."}
      </p>
    );
  }
  if (!template) notFound();

  const trail = parseTrail(rawParams, CRUMB);
  const kind = template.kind as ChecklistKind;
  const locationId = template.location_id as string;
  const locationCode =
    session.locations.find((l) => l.id === locationId)?.code ?? "this shop";

  // Sections and equipment are LOCATION-SCOPED, and offering another shop's
  // shelves here would write a section this template's walk can never group by
  // — the same care `ItemLocationRows` takes.
  const localSections = (sections ?? []).filter((s) => s.location_id === locationId);
  const localEquipment = (equipment ?? []).filter((e) => e.location_id === locationId);
  const sectionName = new Map(
    localSections.map((s) => [s.id as string, s.display_name as string]),
  );

  const rows: TemplateItemRow[] = (items ?? []).map((i) => ({
    id: i.id as string,
    shop_section_id: (i.shop_section_id as string | null) ?? null,
    section_name: i.shop_section_id
      ? (sectionName.get(i.shop_section_id as string) ?? "No section")
      : "No section",
    sort: Number(i.sort),
    prompt: i.prompt as string,
    response_type: i.response_type as TemplateItemRow["response_type"],
    unit: (i.unit as string | null) ?? null,
    min_value: i.min_value == null ? null : Number(i.min_value),
    max_value: i.max_value == null ? null : Number(i.max_value),
    choices: (i.choices as string[] | null) ?? null,
    equipment_id: (i.equipment_id as string | null) ?? null,
    requires_photo: i.requires_photo as boolean,
    weekdays: (i.weekdays as number[] | null) ?? null,
    is_active: i.is_active as boolean,
  }));

  const field = BOXED_FIELDS ? BOXED_FIELD : "";

  return (
    <div className="space-y-12">
      <Breadcrumbs trail={trail} current={template.name as string} />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
            {/* An editable h1 KEEPS ITS DOTTED UNDERLINE — the one exception to
                the boxed convention, because a title at 28px with nothing
                beside it can't be mistaken for a label. */}
            {editable ? (
              <InlineValue
                table="checklist_templates"
                id={id}
                column="name"
                value={template.name as string}
                nullable={false}
                ariaLabel="Name"
                className="uppercase"
              />
            ) : (
              (template.name as string)
            )}
          </h1>
          <p className="text-sm text-muted">
            {CHECKLIST_KIND_LABEL[kind]} at {locationCode} — {CHECKLIST_KIND_HINT[kind]}
            {!template.is_active && " · inactive"}
          </p>
        </div>
        <TemplateActions
          templateId={id}
          name={template.name as string}
          itemCount={rows.length}
          locationId={locationId}
          orgId={session.membership.org_id}
          locations={session.activeLocations.map((l) => ({ id: l.id, code: l.code }))}
          editable={editable}
        />
      </div>

      <section className="space-y-4">
        <SectionHeading>Details</SectionHeading>
        <dl className="grid max-w-[min(42rem,max(24rem,50%))] grid-cols-[8rem_1fr] items-center gap-x-4 gap-y-2 text-sm">
          <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
            Kind
          </dt>
          <dd>
            {editable ? (
              <InlineValue
                table="checklist_templates"
                id={id}
                column="kind"
                value={kind}
                kind="pick"
                nullable={false}
                boxed={BOXED_FIELDS}
                className={field}
                ariaLabel="Kind"
                options={(["checklist", "walkthrough", "inspection"] as const).map((k) => ({
                  value: k,
                  label: CHECKLIST_KIND_LABEL[k],
                  hint: CHECKLIST_KIND_HINT[k],
                }))}
              />
            ) : (
              <span className={READ_ONLY_VALUE}>{CHECKLIST_KIND_LABEL[kind]}</span>
            )}
          </dd>

          <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
            Active
          </dt>
          <dd>
            {/* `ActiveToggle`, not an `InlineValue` pick: the column is a
                BOOLEAN, and a pick would write the string "yes" into it. */}
            {editable ? (
              <ActiveToggle
                table="checklist_templates"
                id={id}
                active={template.is_active as boolean}
                label="Active"
              />
            ) : (
              <span className={READ_ONLY_VALUE}>
                {template.is_active ? "Active" : "Inactive"}
              </span>
            )}
          </dd>

          <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
            Days
          </dt>
          <dd>
            {editable ? (
              <WeekdayPicker
                table="checklist_templates"
                id={id}
                column="weekdays"
                value={(template.weekdays as number[] | null) ?? []}
                label="Days this list is asked for"
              />
            ) : (
              <span className={READ_ONLY_VALUE}>
                {((template.weekdays as number[] | null) ?? []).length
                  ? "scheduled"
                  : "Not scheduled"}
              </span>
            )}
          </dd>

          <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
            Shifts
          </dt>
          <dd>
            {editable ? (
              <TemplateShiftSet
                templateId={id}
                value={(template.shifts as string[] | null) ?? []}
              />
            ) : (
              <span className={READ_ONLY_VALUE}>
                {shiftSetLabel(
                  (template.shifts as string[] | null) ?? null,
                  (s) => SHIFT_SLOT_LABEL[s as never] ?? s,
                )}
              </span>
            )}
          </dd>

          <dt className="self-start pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
            Notes
          </dt>
          <dd>
            {editable ? (
              <InlineValue
                table="checklist_templates"
                id={id}
                column="notes"
                value={(template.notes as string | null) ?? null}
                multiline
                boxed={BOXED_FIELDS}
                ariaLabel="Notes"
              />
            ) : (
              <span className={READ_ONLY_VALUE}>{template.notes ?? ""}</span>
            )}
          </dd>
        </dl>
        <p className="max-w-[60ch] text-[12px] text-muted">
          A list with no days set is never offered automatically — that is what a
          walkthrough and an inspection are, started by hand when somebody walks.
        </p>
      </section>

      <TemplateItemsTable
        rows={rows}
        templateId={id}
        orgId={session.membership.org_id}
        editable={editable}
        sections={localSections.map((s) => ({
          id: s.id as string,
          display_name: s.display_name as string,
        }))}
        equipment={localEquipment.map((e) => ({
          id: e.id as string,
          name: e.name as string,
        }))}
      />
    </div>
  );
}
