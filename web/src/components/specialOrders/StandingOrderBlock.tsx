"use client";

import { useState, useTransition } from "react";
import { BOXED_FIELDS } from "@/components/ui/fieldMetrics";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Checkbox } from "@/components/ui/Checkbox";
import { WeekdayPicker } from "@/components/catalog/WeekdayPicker";
import { addDays, standingMaterializationDates } from "@/lib/specialOrders";
import { MaterializeNow } from "@/components/specialOrders/MaterializeNow";

/** For the read-only rendering below — ISO 1 = Monday, as everywhere. */
const DAY_NAME = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * A standing order's own block — decision 13.
 *
 * NOBODY INSTANTIATES. Migration 099's `ensure_standing_orders_materialized`
 * tops the horizon up from the two moments that need the orders to exist:
 * opening the list, and opening the generate-schedules dialog. So this block
 * STATES what the horizon holds rather than offering a button to fill it, and
 * `MaterializeNow` beside it is the escape hatch for a one-off further out.
 *
 * IT SAYS WHAT HAS ACTUALLY BEEN MADE, not only what the rule implies. Those
 * are two different claims and for the first three weeks of this module's life
 * they disagreed completely: the block promised "orders appear by themselves 14
 * days ahead" while ZERO existed, because the function it was describing had
 * never been written. A line naming the real count and the furthest day made is
 * what would have caught that on the screen rather than in a database probe.
 *
 * EDITING A STANDING ORDER CHANGES ONLY DAYS NOT YET MATERIALIZED, and the
 * block says so. That is not a limitation to apologise for — it is what makes
 * "add 100 this Friday" an edit to Friday's order rather than a change to every
 * Friday forever.
 */
export function StandingOrderBlock({
  id,
  standingDays,
  startsOn,
  endsOn,
  paused,
  horizonDays,
  today,
  canWrite,
  orgId,
  number,
  madeCount,
  madeThrough,
}: {
  id: string;
  standingDays: number[];
  startsOn: string | null;
  endsOn: string | null;
  paused: boolean;
  horizonDays: number;
  today: string;
  canWrite: boolean;
  orgId: string;
  number: string;
  /** Orders this standing order has actually made, ever. */
  madeCount: number;
  /** The furthest day it has made, or null when it has made none. */
  madeThrough: string | null;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function write(patch: Record<string, unknown>) {
    setError(null);
    start(async () => {
      const { data, error: e } = await supabase
        .from("special_orders")
        .update(patch)
        .eq("id", id)
        .select("id");
      if (e) setError(e.message);
      else if (!data?.length) setError("The change wasn't saved — the database refused it silently.");
      else router.refresh();
    });
  }

  const through = addDays(today, horizonDays);
  // The same rule the SQL materializer applies, in TypeScript, so the record
  // can SAY what a top-up would do before anything writes. A deliberate second
  // implementation of a small rule, and the fixtures pin both ends of it.
  const upcoming = standingMaterializationDates(
    { standing_days: standingDays, starts_on: startsOn, ends_on: endsOn, paused },
    today,
    through
  );

  return (
    <section className="space-y-3">
      <SectionHeading>Recurrence</SectionHeading>

      <div className="grid max-w-[52rem] gap-x-12 gap-y-4 sm:grid-cols-2">
        <div className="space-y-1 sm:col-span-2">
          <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
            Days it runs
          </dt>
          <dd>
            {/* ISO weekdays, 1 = Monday — the schema's convention everywhere,
                and `WeekdayPicker` already speaks it. A SET, not a seven-slot
                per-weekday array, so 009/017's `array_length = 7` guard does
                not apply here.

                It writes the column ITSELF (table/id/column, like every other
                caller) rather than taking a change handler, so there is no
                second write path to keep in step with the cells beside it.
                Below supervisor+ it is replaced by the days as words: the
                control has no read-only mode, and RLS would refuse the write
                silently. */}
            {canWrite ? (
              <WeekdayPicker
                table="special_orders"
                id={id}
                column="standing_days"
                value={standingDays.length ? standingDays : null}
                label="Which weekdays this order runs"
              />
            ) : (
              <span className={READ_ONLY_VALUE}>
                {standingDays.length
                  ? standingDays.map((d) => DAY_NAME[d]).join(" · ")
                  : "No days set"}
              </span>
            )}
          </dd>
        </div>

        <Row label="Starts">
          {canWrite ? (
            <InlineValue boxed={BOXED_FIELDS} table="special_orders" id={id} column="starts_on" kind="date"
                         value={startsOn} ariaLabel="First day this runs" />
          ) : (
            <span className={READ_ONLY_VALUE}>{startsOn ?? "—"}</span>
          )}
        </Row>
        <Row label="Ends">
          {canWrite ? (
            <InlineValue boxed={BOXED_FIELDS} table="special_orders" id={id} column="ends_on" kind="date"
                         value={endsOn} ariaLabel="Last day this runs" />
          ) : (
            <span className={READ_ONLY_VALUE}>{endsOn ?? "—"}</span>
          )}
          <span className="ml-2 text-[12px] text-muted">Open-ended is the normal case</span>
        </Row>
        <Row label="Paused">
          <span className="inline-flex items-center gap-2">
            <Checkbox
              size="lg"
              checked={paused}
              disabled={!canWrite || pending}
              onChange={() => write({ paused: !paused })}
              label="Pause this standing order"
            />
            <span className="text-[12px] text-muted">
              Paused makes nothing new; days already made are untouched
            </span>
          </span>
        </Row>
      </div>

      <div className="max-w-[70ch] space-y-1 text-[13px]">
        <p className="text-muted">
          Orders appear by themselves {horizonDays} days ahead — the moment
          anyone opens the list or generates a production schedule. Nobody has
          to remember.
        </p>
        {paused ? (
          <p><span className="bg-mark-fill px-1">Paused, so nothing new is being made.</span></p>
        ) : upcoming.length === 0 ? (
          <p>
            <span className="bg-mark-fill px-1">
              No days in the next {horizonDays} — check the weekdays and the
              date range above.
            </span>
          </p>
        ) : (
          <p className="text-muted">
            Next {horizonDays} days: <span className="tabular-nums">{upcoming.length}</span> order
            {upcoming.length === 1 ? "" : "s"}, from {upcoming[0]} to {upcoming[upcoming.length - 1]}.
          </p>
        )}
        <p className="text-muted">
          Editing this changes only days that have not been made yet. A day
          already made is an ordinary order — edit it there, and cancel it
          rather than deleting it, or the next top-up makes it again.
        </p>
        {/* THE FACT, under the rule. `madeThrough` can legitimately be behind
            the horizon — a paused order, or one whose `ends_on` has passed —
            so it is stated rather than compared to anything. */}
        <p className="text-muted">
          {madeCount === 0 ? (
            <span className="bg-mark-fill px-1">No orders have been made from this yet.</span>
          ) : (
            <>
              Made so far: <span className="tabular-nums">{madeCount}</span> order
              {madeCount === 1 ? "" : "s"}, through{" "}
              <span className="tabular-nums">{madeThrough}</span>.
            </>
          )}
        </p>
      </div>

      {canWrite ? (
        <MaterializeNow
          orgId={orgId}
          standingOrderId={id}
          number={number}
          today={today}
          horizonDays={horizonDays}
        />
      ) : null}

      {error ? <p className="text-[13px] text-accent">{error}</p> : null}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
