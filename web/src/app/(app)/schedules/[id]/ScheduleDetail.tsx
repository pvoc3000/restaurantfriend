import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canWriteCatalog } from "@/lib/roles";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { RecordNav } from "@/components/ui/RecordNav";
import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { crumbPath, parseTrail } from "@/lib/breadcrumbs";
import { packetDate, rollUp, type ScheduleLine } from "@/lib/productionSchedule";
import type { BatchYield } from "@/lib/productionCost";
import { ScheduleLines, type ScheduleLineRow } from "@/components/production/ScheduleLines";
import { ScheduleActions } from "@/components/production/ScheduleActions";
import { AddScheduleItems, type AddableItem } from "@/components/production/AddScheduleItems";
import { PrintPacket } from "@/components/production/PrintPacket";

/**
 * One committed night.
 *
 * A SCHEDULE IS A WORKING DOCUMENT, NOT A FROZEN RECORD (Mark, 2026-08-07,
 * applying the 2026-07-28 purchase-order call to this module). Par, note, added
 * lines and struck lines are all editable in place. That does NOT make par
 * overrides redundant, and the split is worth stating because the two look
 * alike: an override is intent recorded BEFORE generation — the holiday three
 * weeks out, which generation picks up whenever it runs — while editing here is
 * correction AFTER, on a document that already exists.
 *
 * An edited par sets `par_source = 'manual'`, which the row then shows beside
 * the planned figure. That is the whole safeguard: the schedule and the plan may
 * legitimately disagree, and the only unacceptable version is disagreeing
 * silently.
 */
export async function ScheduleDetail({
  id,
  rawParams,
}: {
  id: string;
  rawParams: Record<string, string | string[] | undefined>;
}) {
  const session = await getAppSession();
  const supabase = await createClient();
  const editable = canWriteCatalog(session.membership.role);

  const { data: schedule, error } = await supabase
    .from("production_schedules")
    .select(
      `id, schedule_date, location_id, kitchen_location_id, source, source_ref, title,
       generated_at, generated_by, regenerated_at, regeneration_count,
       printed_at, ignored_special_orders, note`
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return (
      <p className="text-sm text-accent">
        Could not load this schedule: {error.message}
        {/production_schedule/.test(error.message)
          ? " — migration 040 has not been applied yet."
          : ""}
      </p>
    );
  }
  if (!schedule) notFound();

  const [{ data: lineRows }, { data: yieldRows }, { data: members }, { data: catalog }] =
    await Promise.all([
      supabase
        .from("production_schedule_items")
        .select(
          `id, item_id, item_name, item_type, subtype, finish, size, tally_box_size,
           tray_capacity, tray_number, tray_band, par, planned_par, par_source, made, leftover,
           note, unit_cost, unit_price, cost_unresolved, costed_at, sort`
        )
        .eq("schedule_id", id)
        .order("sort"),
      supabase
        .from("production_batch_yields")
        .select("item_type, subtype, size, portion_of_batch, size_factor"),
      supabase.from("org_members").select("user_id, display_name"),
      // Everything that could be ADDED by hand. Active only: a retired donut is
      // not something you reach for at 9pm.
      supabase
        .from("production_items")
        .select("id, name, item_type, subtype, finish, size, tally_box_size, tray_capacity")
        .eq("is_active", true)
        .order("name"),
    ]);

  const codeById = new Map(session.locations.map((l) => [l.id, l.code]));
  const nameByUser = new Map(
    (members ?? []).map((m) => [m.user_id as string, (m.display_name ?? null) as string | null])
  );

  const sellsCode = codeById.get(schedule.location_id as string) ?? "—";
  const kitchenCode = codeById.get(schedule.kitchen_location_id as string) ?? "—";

  const rows: ScheduleLineRow[] = (lineRows ?? []).map((l) => ({
    id: l.id as string,
    item_id: l.item_id as string,
    item_name: l.item_name as string,
    item_type: (l.item_type ?? null) as string | null,
    subtype: (l.subtype ?? null) as string | null,
    finish: (l.finish ?? null) as string | null,
    size: (l.size ?? null) as string | null,
    tally_box_size: Number(l.tally_box_size ?? 6),
    tray_capacity: Number(l.tray_capacity ?? 24),
    tray_number: (l.tray_number ?? null) as string | null,
    tray_band: (l.tray_band ?? null) as string | null,
    par: Number(l.par) || 0,
    planned_par: (l.planned_par ?? null) as number | null,
    par_source: (l.par_source ?? "plan") as string,
    made: (l.made ?? null) as number | null,
    leftover: (l.leftover ?? null) as number | null,
    note: (l.note ?? null) as string | null,
    unit_cost: (l.unit_cost ?? null) as number | null,
    unit_price: (l.unit_price ?? null) as number | null,
    cost_unresolved: (l.cost_unresolved ?? null) as number | null,
    costed_at: (l.costed_at ?? null) as string | null,
  }));

  const yields = (yieldRows ?? []) as BatchYield[];
  const lines: ScheduleLine[] = rows;
  const rolled = rollUp(lines, "item", yields);
  const parTotal = rows.reduce((n, r) => n + r.par, 0);
  const manualCount = rows.filter((r) => r.par_source === "manual").length;
  const uncosted = rows.filter((r) => r.costed_at === null).length;

  const onSchedule = new Set(rows.map((r) => r.item_id));
  const addable: AddableItem[] = (catalog ?? [])
    .filter((i) => !onSchedule.has(i.id as string))
    .map((i) => ({
      id: i.id as string,
      name: i.name as string,
      item_type: (i.item_type ?? null) as string | null,
      subtype: (i.subtype ?? null) as string | null,
      finish: (i.finish ?? null) as string | null,
      size: (i.size ?? null) as string | null,
      tally_box_size: Number(i.tally_box_size ?? 6),
      tray_capacity: Number(i.tray_capacity ?? 24),
    }));

  const trail = parseTrail(rawParams, { href: "/schedules", label: "Schedules" });
  const generatedBy = schedule.generated_by
    ? nameByUser.get(schedule.generated_by as string) ?? null
    : null;

  return (
    <div className="space-y-8">
      <Breadcrumbs
        trail={trail}
        current={`${packetDate(schedule.schedule_date as string)} · ${sellsCode}`}
        trailing={<RecordNav listKey={crumbPath(trail[trail.length - 1])} id={id} />}
      />

      <header className="space-y-3">
        <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
          {sellsCode} — {packetDate(schedule.schedule_date as string)}
        </h1>
        <p className="text-sm text-muted">
          {schedule.source === "plan"
            ? "From the plans active that day"
            : schedule.title ?? (schedule.source === "special_order" ? "Special order" : "Entered by hand")}
          {" · "}made at <span className="font-medium text-ink">{kitchenCode}</span>
          {schedule.ignored_special_orders ? " · special orders ignored" : ""}
        </p>
      </header>

      <dl className="grid gap-x-10 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <Field label="To make">
          <span className={`${READ_ONLY_VALUE} tabular-nums font-medium`}>
            {parTotal.toLocaleString()} across {rows.length} {rows.length === 1 ? "item" : "items"}
          </span>
        </Field>
        <Field label="Generated">
          <span className={`${READ_ONLY_VALUE} text-muted`}>
            {schedule.generated_at
              ? `${String(schedule.generated_at).slice(0, 10)}${generatedBy ? ` by ${generatedBy}` : ""}`
              : "—"}
            {Number(schedule.regeneration_count) > 0
              ? ` · regenerated ${schedule.regeneration_count}×`
              : ""}
          </span>
        </Field>
        <Field label="Printed">
          {schedule.printed_at ? (
            <span className={`${READ_ONLY_VALUE} text-muted`}>
              {String(schedule.printed_at).slice(0, 10)}
            </span>
          ) : (
            <span className={`${READ_ONLY_VALUE} text-mark`}>not printed</span>
          )}
        </Field>
        <Field label="Note" span>
          {editable ? (
            <InlineValue
              table="production_schedules"
              id={id}
              column="note"
              value={(schedule.note ?? null) as string | null}
            />
          ) : (
            <span className={`${READ_ONLY_VALUE} text-muted`}>{schedule.note ?? "—"}</span>
          )}
        </Field>
      </dl>

      {/* What the night is, before you read a single row. Both of these are
          things a printed sheet cannot tell you and a screen can. */}
      {(manualCount > 0 || uncosted > 0) && (
        <div className="flex flex-wrap gap-2 text-xs">
          {manualCount > 0 ? (
            <span className="border border-ink bg-[var(--rf-yellow-200)] px-2 py-1 text-ink">
              {manualCount} {manualCount === 1 ? "line differs" : "lines differ"} from the plan
            </span>
          ) : null}
          {uncosted > 0 && uncosted < rows.length ? (
            <span className="border border-hairline px-2 py-1 text-muted">
              {uncosted} of {rows.length} lines not costed
            </span>
          ) : null}
        </div>
      )}

      <ScheduleActions
        scheduleId={id}
        scheduleDate={schedule.schedule_date as string}
        locationId={schedule.location_id as string}
        sellsCode={sellsCode}
        kitchenCode={kitchenCode}
        source={(schedule.source ?? "plan") as string}
        hasActuals={rows.some((r) => r.made !== null || r.leftover !== null)}
        lineCount={rows.length}
        editable={editable}
        print={<PrintPacket scheduleIds={[id]} editable={editable} label="Print…" />}
      />

      <ScheduleLines
        rows={rows}
        rolled={rolled}
        editable={editable}
        add={
          editable ? (
            <AddScheduleItems
              scheduleId={id}
              orgId={session.membership.org_id}
              items={addable}
            />
          ) : null
        }
      />
    </div>
  );
}

function Field({
  label,
  span = false,
  children,
}: {
  label: string;
  span?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={span ? "sm:col-span-2 lg:col-span-3" : undefined}>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}
