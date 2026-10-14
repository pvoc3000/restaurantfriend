"use client";

import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BUTTON_CLASS, PRIMARY_BUTTON_CLASS } from "@/components/ui/buttons";
import { STICKY_HEAD_ROW_UNDER_RUNNER } from "@/lib/tableHead";
import { CountField, TextField } from "./fields";
import { useOptimisticRows } from "@/lib/useOptimisticRows";
import { TimePicker } from "@/components/ui/TimePicker";
import { premadeGroups } from "@/lib/shiftReports";

export type PremadeRow = {
  scheduleItemId: string;
  /** Which of the day's schedules the line is on — one page each. */
  scheduleId: string;
  itemType: string | null;
  size: string | null;
  subtype: string | null;
  name: string;
  par: number | null;
  made: number | null;
  leftover: number | null;
  /**
   * Packed into Too Good To Go boxes before close — migration 203. Not sold:
   * the view's `sold` is made − left − rescued. The boxes go out in the last
   * hour, before anybody counts, so without this every boxed donut read as a
   * sale and production never came down.
   */
  rescued: number | null;
  /**
   * The time of day the last one sold — migration 204. `HH:MM`, or null when
   * it did not sell out, which is most lines and so never required. It tells
   * "made the right amount" from "could have sold more", which `sold` cannot.
   */
  soldOutAt: string | null;
  /**
   * The SCHEDULE's own note — an instruction, snapshotted at generation and
   * printed on the packet as what the kitchen was told to make.
   */
  note: string | null;
  /**
   * The SUPERVISOR's note about this count — migration 081.
   *
   * A different fact from `note` and kept apart from it deliberately: one is
   * the order, the other is what happened to it. Writing the second over the
   * first would corrupt a document somebody has already worked from, which is
   * why 081 adds a column rather than flushing through to the schedule line.
   */
  countNote: string | null;
};

/**
 * FMP's page 4 — what was made and what is left.
 *
 * DELIBERATELY NOT `ScheduleLines`. That component writes `made` and `leftover`
 * straight through `set_schedule_actual`, which is the one thing this report
 * defers: nothing reaches the schedule until Send. These boxes write the
 * report's own draft rows and the flush moves them across in one transaction.
 *
 * The rows come from `v_production_schedule_lines` for TODAY at this shop —
 * the schedule the night before produced. Tomorrow's is page 7, and confusing
 * the two would have the closer counting donuts nobody has made yet.
 */
/** The table's columns, for a band's `colSpan`. Name through Note. */
const COLUMN_COUNT = 8;

export function PremadesPage({
  reportId,
  orgId,
  locationId,
  reportDate,
  scheduleTitle,
  rows: savedRows,
  editable,
}: {
  reportId: string;
  orgId: string;
  /** The report's shop — the one a missing schedule is generated for. */
  locationId: string;
  /** The report's day, which is the day being counted. */
  reportDate: string;
  scheduleTitle: string | null;
  rows: PremadeRow[];
  editable: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [failed, setFailed] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [generating, setGenerating] = useState(false);
  const [noPlan, setNoPlan] = useState(false);
  // Counts show as they are typed in, rather than after a refresh of the WHOLE
  // shift report — the heaviest page in the app.
  const { rows, optimistic } = useOptimisticRows(savedRows, (r) => r.scheduleItemId);

  /** Rows with nothing in the Left column yet — what the button below fills. */
  const uncounted = rows.filter((r) => r.leftover === null);
  /** And in the Rescued column — its own button, by the same rule. */
  const unrescued = rows.filter((r) => r.rescued === null);


  /**
   * "Nothing left over" — every EMPTY Left box becomes 0, in one write.
   *
   * The other half of making the send gate strict (Mark, 2026-09-02). Counting
   * is now required before a report can go, and measured over every report ever
   * sent nobody had counted more than 13 lines of 32 — so the requirement on
   * its own would simply have stopped reports going out. The usual answer at
   * close is "none left" and typing it thirty-two times is the whole burden.
   *
   * IT NEVER OVERWRITES A COUNT — only rows where Left is empty, which is
   * `Receive n from invoice`'s rule and for its reason: a number somebody
   * counted is a measurement, and a batch button must not silently replace one.
   * The label names how many it will fill, so there is no confirm to read: what
   * it is about to do is on its face, and pressing it again does nothing.
   *
   * `made` is deliberately untouched — the per-row arrow already takes the par,
   * and asserting that everything on the sheet was MADE is a different claim
   * from saying nothing came back.
   */
  function nothingLeftOver() {
    fillEmpty(uncounted, "leftover");
  }

  /**
   * "Nothing rescued" — the same button for the Rescued column (203). Rescued
   * is required like Left, because a blank one is the mistake that puts boxed
   * donuts back into `sold`; this is what keeps a night with no boxes one tap.
   */
  function nothingRescued() {
    fillEmpty(unrescued, "rescued");
  }

  function fillEmpty(empty: PremadeRow[], column: "leftover" | "rescued") {
    if (empty.length === 0) return;
    const ids = empty.map((r) => r.scheduleItemId);
    void optimistic(ids, column === "leftover" ? { leftover: 0 } : { rescued: 0 }, async () => {
      // ONE upsert for every row. Uniform keys, which PostgREST's bulk upsert
      // requires — and because `made` is not among them it is left alone on
      // rows that already have one rather than being reset.
      const { error } = await supabase
        .from("shift_report_counts")
        .upsert(
          empty.map((r) => ({
            org_id: orgId,
            report_id: reportId,
            schedule_item_id: r.scheduleItemId,
            [column]: 0,
          })),
          { onConflict: "report_id,schedule_item_id" }
        )
        .select("id");
      if (error) {
        setFailed(error.message);
        return false;
      }
      setFailed(null);
      router.refresh();
      return true;
    });
  }

  function save(scheduleItemId: string, patch: Record<string, number | string | null>) {
    // `note` is the column; on the row it is `countNote`, because the row's own
    // `note` is the schedule's instruction — see `PremadeRow`.
    const shown: Partial<PremadeRow> = {};
    if ("made" in patch) shown.made = patch.made as number | null;
    if ("leftover" in patch) shown.leftover = patch.leftover as number | null;
    if ("rescued" in patch) shown.rescued = patch.rescued as number | null;
    if ("sold_out_at" in patch) shown.soldOutAt = patch.sold_out_at as string | null;
    if ("note" in patch) shown.countNote = patch.note as string | null;
    void optimistic(scheduleItemId, shown, async () => {
      // UPSERT on the pair, because most lines have no draft row until somebody
      // types in one — an update would match nothing and report success.
      const { error } = await supabase
        .from("shift_report_counts")
        .upsert(
          { org_id: orgId, report_id: reportId, schedule_item_id: scheduleItemId, ...patch },
          { onConflict: "report_id,schedule_item_id" }
        )
        .select("id");
      if (error) {
        // Name the migration when the message names the column — the same
        // courtesy every other screen in this app extends, and here the fix is
        // one `alter table` rather than anything the reader did wrong.
        setFailed(
          /sold_out_at/.test(error.message)
            ? `${error.message} — if this names a missing column, migration 204 has not been applied yet.`
            : /rescued/.test(error.message)
            ? `${error.message} — if this names a missing column, migration 203 has not been applied yet.`
            : /note/.test(error.message)
              ? `${error.message} — if this names a missing column, migration 081 has not been applied yet.`
              : error.message
        );
        return false;
      }
      setFailed(null);
      router.refresh();
      return true;
    });
  }

  /**
   * GENERATE THE DAY AFTER THE FACT, so there is something to count (Mark,
   * 2026-09-18: "we should be allowed to generate the schedule if it's
   * missing, just so we can enter counts").
   *
   * Counts are keyed on `schedule_item_id`, so a night nobody generated left
   * this page with no rows and no way forward. This makes the missing schedule
   * from the plan as it stands NOW — for THIS shop and THIS day only.
   *
   * DELIBERATELY NOT `GenerateSchedules`. That dialog is for the NEXT night: it
   * defaults to tomorrow, tops up standing orders and offers to pull special
   * orders into the run. Pulling today's orders into a schedule after they
   * have been made would be wrong, so this calls the generator bare — one day,
   * one shop, no replace, no special orders pulled. An already-generated day is
   * SKIPPED by the function itself, so a double press does nothing.
   */
  function generateToday() {
    setGenerating(true);
    startTransition(async () => {
      const { data, error } = await supabase.rpc("generate_production_schedules", {
        p_start: reportDate,
        p_days: 1,
        p_location_ids: [locationId],
        p_ignore_special_orders: false,
        p_replace: false,
        p_allow_actuals: false,
      });
      setGenerating(false);
      if (error) {
        setFailed(error.message);
        return;
      }
      setFailed(null);
      const receipt = data as {
        created?: unknown[];
        skipped?: { reason?: string; name?: string }[];
      } | null;
      // 184: the calendar blacks the day out for production. Not "no plan" —
      // a plan covers it and somebody decided not to bake.
      const blackout = receipt?.skipped?.find((s) => s.reason === "blackout");
      if (blackout && !receipt?.created?.length) {
        setFailed(`The calendar has no production on this day (${blackout.name ?? "blackout"}).`);
        router.refresh();
        return;
      }
      // Nothing created and nothing already there: no plan puts anything on
      // this shop's day, which the generator reports as an empty receipt.
      setNoPlan(!receipt?.created?.length && !receipt?.skipped?.length);
      router.refresh();
    });
  }

  if (rows.length === 0) {
    return (
      <div className="mx-auto max-w-xl space-y-4 text-center text-[16px]">
        <p>No production schedule was generated for this shop today, so there is nothing to count.</p>
        {failed ? <p className="text-sm text-accent">{failed}</p> : null}
        {noPlan ? (
          <p className="text-sm text-muted">
            No production plan covers this shop on {reportDate}, so there is no schedule to make.
          </p>
        ) : editable ? (
          <button
            type="button"
            className={PRIMARY_BUTTON_CLASS}
            disabled={generating}
            onClick={generateToday}
          >
            {generating ? "Generating…" : "Generate today’s schedule"}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      {failed ? <p className="text-sm text-accent">{failed}</p> : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {scheduleTitle ? (
          <p className="text-[16px]">
            <span className="text-xs font-semibold uppercase tracking-[0.08em]">Schedule:</span>{" "}
            {scheduleTitle}
          </p>
        ) : (
          <span />
        )}
        {editable ? (
          // In the columns' order: Rescued, then Left.
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={BUTTON_CLASS}
              disabled={unrescued.length === 0}
              onClick={nothingRescued}
            >
              Nothing rescued
              {unrescued.length > 0 ? ` (${unrescued.length})` : ""}
            </button>
            <button
              type="button"
              className={BUTTON_CLASS}
              // Disabled rather than hidden once every row has a count, so the
              // control does not appear and vanish as the sheet fills in.
              disabled={uncounted.length === 0}
              onClick={nothingLeftOver}
            >
              Nothing left over
              {uncounted.length > 0 ? ` (${uncounted.length})` : ""}
            </button>
          </div>
        ) : null}
      </div>

      {/* `table-fixed` with a colgroup, or the three count columns push the
          Note header into Left's and it renders as "LEFTNOTE". A `w-28` on a
          `th` is a suggestion an auto-layout table is free to ignore. */}
      <table className="w-full table-fixed">
        <colgroup>
          {/* Sums to 100 — 203's set came to 104, which a fixed table scales
              down without saying so. Type and Sub type are bands now; their 18%
              went to Name, and then some of Name's and the three count boxes'
              to Sold out and Note (Mark, 2026-10-14), so a long name wraps. */}
          <col className="w-[24%]" />
          <col className="w-[6%]" />
          <col className="w-[5%]" />
          <col className="w-[9%]" />
          <col className="w-[9%]" />
          <col className="w-[9%]" />
          <col className="w-[16%]" />
          <col className="w-[22%]" />
        </colgroup>
        {/* THE LABELS STAY ON SCREEN (Mark, 2026-09-09: "so the user knows what
            they're entering"). Made and Left are two identical boxes eight
            pixels apart, and thirty rows down a sheet the only thing telling
            them apart is a heading that has scrolled off the top.

            UNDER THE BANNER, not at 0: that bar is sticky as of 2026-09-09 and
            publishes its own measured height, so the labels stack beneath it
            rather than sliding under it. `--rf-header-h` would be wrong here —
            there is no masthead on a `(fullscreen)` route, so it is sitting at
            its seed.

            ON THE `th`, never the `tr` — WebKit does not honour sticky on a row
            in a border-collapse table, and iPad Safari at the 16.4 floor is
            what this is walked on. The 2px rule rides in the class as an inset
            shadow for the same reason the constant does: a sticky cell loses a
            collapsed border the moment it detaches. */}
        <thead>
          <tr
            className={`text-xs font-semibold uppercase tracking-[0.08em] ${STICKY_HEAD_ROW_UNDER_RUNNER}`}
          >
            <th className="py-2 pr-3 text-left">Name</th>
            <th className="py-2 pr-1 text-right">Par</th>
            <th className="py-2" />
            <th className="py-2 pr-2 text-right">Made</th>
            {/* BETWEEN Made and Left, in the order the night happens: made
                it, boxed some for Too Good To Go, counted the rest. */}
            <th className="py-2 pr-2 text-right">Rescued</th>
            <th className="py-2 pr-2 text-right">Left</th>
            {/* AFTER the counts rather than among them: a time, not a number
                that adds up. Blank is "did not sell out". */}
            <th className="py-2 pl-3 pr-2 text-left">Sold out</th>
            <th className="py-2 pl-4 text-left">Note</th>
          </tr>
        </thead>
        <tbody>
          {premadeGroups(rows).map(({ row: r, typeHead, cutHead }) => {
            return (
              <Fragment key={r.scheduleItemId}>
                {/* GROUPED, NOT COLUMNS (Mark, 2026-10-14: "we could save some
                    horizontal space … if we removed type and subtype fields from
                    each row and, instead, grouped the donuts by type and subtype
                    with headers"). DataTable's two marks: the black band for the
                    type, the caps heading on a black rule for the cut. The groups
                    are `premadeGroups`, which the email uses too. */}
                {typeHead ? (
                  <tr className="bg-ink text-white">
                    <td
                      colSpan={COLUMN_COUNT}
                      className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em]"
                    >
                      {typeHead.label}
                      <span className="ml-2 font-normal normal-case tracking-normal text-white/55">
                        {typeHead.count}
                      </span>
                    </td>
                  </tr>
                ) : null}
                {cutHead ? (
                  <tr>
                    <td
                      colSpan={COLUMN_COUNT}
                      className="border-b border-ink pb-1 pt-3 text-xs font-semibold uppercase tracking-[0.08em]"
                    >
                      {cutHead}
                    </td>
                  </tr>
                ) : null}
                <tr className="border-b border-hairline/60">
                  <td className="py-2 pr-3 text-[16px]">{r.name}</td>
                  <td className="py-2 pr-1 text-right text-[16px]">{r.par ?? "—"}</td>
                  {/* TAKE THE PAR (Mark, 2026-08-28). The receiving screen's `→`
                      idiom, and for its reason: the usual answer is "we made what
                      we were asked to", and typing it out forty times is the work.
                      An ARROW rather than a prefilled box — a box that filled
                      itself would make merely OPENING the page look like somebody
                      had counted, which is the one thing the report must not
                      claim. Hidden when there is no par to take, and when the made
                      figure already equals it. */}
                  <td className="py-2 pr-1 text-center align-middle">
                    {editable && r.par !== null && r.made !== r.par ? (
                      <button
                        type="button"
                        className="px-2 py-2 text-lg leading-none text-muted hover:text-ink"
                        onClick={() => save(r.scheduleItemId, { made: r.par })}
                        title={`Made ${r.par}`}
                        aria-label={`Made ${r.par}, ${r.name}`}
                      >
                        &rarr;
                      </button>
                    ) : null}
                  </td>
                  <td className="py-2 pr-2">
                    <CountField
                      value={r.made}
                      onCommit={(next) => save(r.scheduleItemId, { made: next })}
                      disabled={!editable}
                      ariaLabel={`Made, ${r.name}`}
                      ink
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <CountField
                      value={r.rescued}
                      onCommit={(next) => save(r.scheduleItemId, { rescued: next })}
                      disabled={!editable}
                      ariaLabel={`Rescued, ${r.name}`}
                      ink
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <CountField
                      value={r.leftover}
                      onCommit={(next) => save(r.scheduleItemId, { leftover: next })}
                      disabled={!editable}
                      ariaLabel={`Left over, ${r.name}`}
                      ink
                    />
                  </td>
                  {/* BLACK EDGES ON EVERY BOX IN THE ROW (204): the time picker's
                      field is black-edged, and the Donut batches page settled what
                      a page mixing the two does — `ink` on the rest. */}
                  <td className="py-2 pl-3 pr-2">
                    <TimePicker
                      value={r.soldOutAt}
                      onChange={(next) => save(r.scheduleItemId, { sold_out_at: next })}
                      variant="field"
                      disabled={!editable}
                      ariaLabel={`Sold out at, ${r.name}`}
                    />
                  </td>
                  {/* TWO NOTES IN ONE COLUMN'S WIDTH — PO detail's Item cell in
                      another costume. The schedule's own note sits above as muted
                      context (it is what the kitchen was ASKED to do, and it is
                      worth having in front of you while you count), and the field
                      below is the supervisor's own. Most lines have neither, so the
                      cell is usually just the box. */}
                  <td className="py-2 pl-4 align-top">
                    {r.note ? (
                      <p className="pb-1 text-sm leading-snug text-muted">{r.note}</p>
                    ) : null}
                    <TextField
                      value={r.countNote}
                      onCommit={(next) => save(r.scheduleItemId, { note: next })}
                      disabled={!editable}
                      ariaLabel={`Note, ${r.name}`}
                      ink
                    />
                  </td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
