import Link from "next/link";
import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canWriteCatalog, canEnterCounts } from "@/lib/roles";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { RecordNav } from "@/components/ui/RecordNav";
import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { BOXED_FIELDS } from "@/components/ui/fieldMetrics";
import { crumbPath, parseTrail } from "@/lib/breadcrumbs";
import { packetDate, plansInForce } from "@/lib/productionSchedule";
import { meansNoAllergy } from "@/lib/specialOrders";
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
  // Two gates, not one. Everything on this screen is purchaser+ EXCEPT the two
  // counting cells, which migration 044 opens to a supervisor through a
  // column-scoped definer function — see `ActualCell`.
  const countable = canEnterCounts(session.membership.role);

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

  /* ------------------------------------------------------------------------
   * THE ORDER BEHIND A SPECIAL-ORDER SCHEDULE
   * ------------------------------------------------------------------------
   * `source_ref` has been selected here since 040 and rendered nowhere. It is
   * the route back, plus the two facts a kitchen needs that a plan schedule has
   * no room for: when it is wanted, and what nobody may eat.
   *
   * ITS OWN QUERY, AND ITS EMPTY RESULT IS NOT AN ERROR. Reading
   * `production_schedules` is membership-wide (040), while `special_orders` is
   * supervisor+ (051) — so a staff member opening this page gets NO ROWS and NO
   * ERROR from the query below, which is RLS working. Folding it into the wave
   * as a required join would blank the whole screen for them instead.
   */
  const { data: sourceOrder } =
    schedule.source === "special_order" && schedule.source_ref
      ? await supabase
          .from("special_orders")
          .select("id, number, title, event_date, event_time, ready_by_time, allergen_info")
          .eq("id", schedule.source_ref as string)
          .maybeSingle()
      : { data: null };

  const [
    { data: lineRows, error: lineErr },
    { data: members },
    { data: catalog },
    { data: planRows },
  ] = await Promise.all([
      // THE VIEW, not the table. `sold` is defined once, in SQL
      // (v_production_schedule_lines), so there is no TypeScript twin to drift
      // from and one place for a POS feed to land later. It is
      // `security_invoker`, so the same RLS applies either way.
      supabase
        .from("v_production_schedule_lines")
        .select(
          `id, item_id, item_name, item_type, subtype, finish, size, tally_box_size,
           tray_capacity, tray_number, tray_band, par, planned_par, par_source, made, leftover,
           sold, counted_at, note, unit_cost, unit_price, cost_unresolved, costed_at, sort`
        )
        .eq("schedule_id", id)
        .order("sort"),
      supabase.from("org_members").select("user_id, display_name"),
      // Everything that could be ADDED by hand. Active only: a retired donut is
      // not something you reach for at 9pm.
      supabase
        .from("production_items")
        .select("id, name, item_type, subtype, finish, size, tally_box_size, tray_capacity")
        .eq("is_active", true)
        .order("name"),
      // So a plan schedule can NAME its plan rather than saying "the plans
      // active that day" and leaving you to work out which (Mark, 2026-08-27,
      // asking for the same thing on the list's From column).
      supabase
        .from("production_plans")
        .select("id, title, location_id, kitchen_location_id, is_active, starts_on, ends_on"),
    ]);

  // NOT folded into the page's own error, and not swallowed either. An empty
  // line table asserts that a night has nothing to make, which is the one claim
  // this screen exists to make — so a failure has to say so in words. 018's
  // pattern, and the reason it earns a branch here is that 044 adds a column to
  // the view this now selects.
  if (lineErr) {
    return (
      <p className="text-sm text-accent">
        Could not load this schedule&rsquo;s items: {lineErr.message}
        {/counted_at|sold|v_production_schedule_lines/.test(lineErr.message)
          ? " — migration 044 has not been applied yet."
          : ""}
      </p>
    );
  }

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
    sold: (l.sold ?? null) as number | null,
    counted_at: (l.counted_at ?? null) as string | null,
    note: (l.note ?? null) as string | null,
    unit_cost: (l.unit_cost ?? null) as number | null,
    unit_price: (l.unit_price ?? null) as number | null,
    cost_unresolved: (l.cost_unresolved ?? null) as number | null,
    costed_at: (l.costed_at ?? null) as string | null,
  }));

  const parTotal = rows.reduce((n, r) => n + r.par, 0);
  const manualCount = rows.filter((r) => r.par_source === "manual").length;
  const uncosted = rows.filter((r) => r.costed_at === null).length;
  const countedLines = rows.filter((r) => r.made !== null || r.leftover !== null).length;
  const soldTotal = rows.reduce((n, r) => n + (r.sold ?? 0), 0);

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

  // Derived, not snapshotted: nothing records which plans fed a generation, so
  // this is "which were in force for this shop, kitchen and day" — the claim
  // this sentence has always made, now with the names in it. See
  // `scheduleSourceLabel` for what that costs.
  const sourcePlans =
    (schedule.source ?? "plan") === "plan"
      ? plansInForce(
          {
            source: "plan",
            title: null,
            schedule_date: schedule.schedule_date as string,
            location_id: schedule.location_id as string,
            kitchen_location_id: schedule.kitchen_location_id as string,
          },
          (planRows ?? []).map((pl) => ({
            id: pl.id as string,
            title: (pl.title ?? "") as string,
            location_id: pl.location_id as string,
            kitchen_location_id: (pl.kitchen_location_id ?? null) as string | null,
            is_active: Boolean(pl.is_active),
            starts_on: pl.starts_on as string,
            ends_on: (pl.ends_on ?? null) as string | null,
          }))
        )
      : [];

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

      {/* COMMANDS LEVEL WITH THE TITLE (Mark, 2026-08-27), which is what every
          other record screen does. They sat under the field grid, so on a long
          night Print and Delete were a scroll away from the thing they act on.

          `items-start` so the buttons line up with the TOP of the heading
          rather than centring against a block whose height changes with the
          source line and the special-order backlink; right-aligned beside the
          title and left-aligned once they wrap under it, because right reads as
          one cluster against the page margin and wrong indented under a
          heading. */}
      <header className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
        <div className="min-w-0 space-y-3">
        <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
          {sellsCode} — {packetDate(schedule.schedule_date as string)}
        </h1>
        <p className="text-sm text-muted">
          {schedule.source === "plan" && sourcePlans.length > 0 ? (
            <>
              From{" "}
              {sourcePlans.map((pl, i) => (
                <span key={pl.id}>
                  {i > 0 ? " + " : ""}
                  <Link href={`/plans/${pl.id}`} className="text-ink underline hover:text-muted">
                    {pl.title}
                  </Link>
                </span>
              ))}
            </>
          ) : schedule.source === "plan" ? (
            "From the plans active that day"
          ) : (
            schedule.title ?? (schedule.source === "special_order" ? "Special order" : "Entered by hand")
          )}
          {" · "}made at <span className="font-medium text-ink">{kitchenCode}</span>
          {schedule.ignored_special_orders ? " · special orders ignored" : ""}
        </p>
        {sourceOrder ? (
          <p className="text-sm">
            <Link
              href={`/special-orders/${sourceOrder.id as string}`}
              className="underline hover:text-muted"
            >
              Order #{sourceOrder.number as string}
            </Link>
            {sourceOrder.event_date ? (
              <span className="text-muted">
                {" · wanted "}
                {sourceOrder.event_date as string}
                {sourceOrder.event_time ? ` at ${(sourceOrder.event_time as string).slice(0, 5)}` : ""}
              </span>
            ) : null}
            {/* ONLY WHEN IT SAYS SOMETHING. 53% of the real orders carrying an
                allergen note say some spelling of "no", and a yellow mark
                reading "none" is how the one reading "PEANUTS" stops being
                read. `meansNoAllergy` fails safe — see it. */}
            {meansNoAllergy(sourceOrder.allergen_info as string | null) ? null : (
              <span className="ml-2 bg-mark-fill px-1">
                {sourceOrder.allergen_info as string}
              </span>
            )}
          </p>
        ) : null}
        </div>

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
          print={<PrintPacket scheduleIds={[id]} stampable={countable} label="Print…" />}
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
        <Field label="Counted">
          {/* How far through the night's counting somebody is — the question a
              schedule from last week is opened to answer, and the one thing the
              lines below can only be scanned for. `sold` is the view's, never
              re-derived here. */}
          {countedLines === 0 ? (
            <span className={`${READ_ONLY_VALUE} text-faint`}>not counted</span>
          ) : (
            <span className={`${READ_ONLY_VALUE} tabular-nums text-muted`}>
              {countedLines} of {rows.length} · {soldTotal.toLocaleString()} sold
            </span>
          )}
        </Field>
        <Field label="Printed">
          {schedule.printed_at ? (
            <span className={`${READ_ONLY_VALUE} text-muted`}>
              {String(schedule.printed_at).slice(0, 10)}
            </span>
          ) : (
            <span className={`${READ_ONLY_VALUE}`}>
              <span className="bg-mark-fill px-1">not printed</span>
            </span>
          )}
        </Field>
        <Field label="Note" span>
          {editable ? (
            <InlineValue
              boxed={BOXED_FIELDS}
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

      <ScheduleLines rows={rows} editable={editable} countable={countable} />
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
