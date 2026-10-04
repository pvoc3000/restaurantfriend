"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useOptimisticRows } from "@/lib/useOptimisticRows";
import { Checkbox } from "@/components/ui/Checkbox";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { GenerateSchedules } from "@/components/production/GenerateSchedules";
import { PrintPacket } from "@/components/production/PrintPacket";
import { sellingShopsForKitchen } from "@/lib/productionPlans";

/**
 * One special order tomorrow — what the packet needs to print it and NAME it.
 *
 * This page stopped listing them on 2026-09-01 (Mark: "we no longer need the
 * special orders section on page 7"), because Print All Documents prints them.
 * The number and title came back on 2026-10-04 for the packet's dialog, which
 * now names each order rather than counting them — a count of 2 could not say
 * that one of the two was a quote.
 */
export type TomorrowOrder = { id: string; number: string | null; title: string | null };

export type TomorrowSchedule = {
  id: string;
  title: string | null;
  sellsCode: string;
  source: string;
  printedAt: string | null;
};

/**
 * Tomorrow's production — FMP's pages 8 and 9, merged.
 *
 * They stopped being two tasks on 2026-08-27, when `GenerateSchedules` grew the
 * special-order pull: generating a night already offers that night's ready
 * orders and schedules them, and `fetchPacketData` calls `companionScheduleIds`
 * itself, so printing a plan schedule already expands to include the
 * special-order schedules for that kitchen and date. FileMaker split them
 * because FileMaker's generation did not pull. Presenting one mechanism as two
 * screens would teach a distinction the app no longer makes.
 *
 * TWO TASK FLAGS SURVIVE, not one: a per-order kitchen document and the tray
 * guide packet are different pieces of paper, and the submit page has to be
 * able to say which one was not printed. Only ONE of them is set here now —
 * Print All Documents ticks both, and `task_special_orders_done` keeps its own
 * control on the submit page, which is where it was always also offered.
 *
 * THE SPECIAL ORDERS SECTION IS GONE (Mark, 2026-09-01). Once the packet
 * printed them, the list was a second place saying what the dialog says, with
 * its own Print buttons for a job the one button now does. What went with it,
 * so it can be judged rather than rediscovered: the per-order REPRINT, and the
 * only place on this page naming WHICH orders tomorrow holds and at what time.
 * The dialog names the count and says "None" when there are none, which is what
 * makes the silence here honest rather than an omission.
 *
 * THIS PAGE IS EXEMPT from "nothing writes until Send", and obviously so —
 * generating a schedule and stamping a printed order are ACTS, not report
 * data. The kitchen needs the paper tonight.
 */
export function TomorrowPage({
  reportId,
  orgId,
  horizonDays,
  nextProductionDate,
  today,
  kitchenId,
  kitchenCode,
  locations,
  plans,
  orders,
  schedules,
  schedulesDone,
  editable,
  stampable,
}: {
  reportId: string;
  orgId: string;
  /** `orgs.settings.special_orders.horizon_days`, for the standing-order
   *  top-up that runs when the generate dialog opens. */
  horizonDays: number;
  nextProductionDate: string | null;
  /** The org's calendar day — the kitchen sheet's AS OF line. */
  today: string;
  kitchenId: string;
  kitchenCode: string;
  locations: { id: string; code: string; name: string }[];
  plans: React.ComponentProps<typeof GenerateSchedules>["plans"];
  /** Tomorrow's special orders — the packet prints them; see `TomorrowOrder`. */
  orders: TomorrowOrder[];
  schedules: TomorrowSchedule[];
  schedulesDone: boolean;
  editable: boolean;
  stampable: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  // THE TICK SHOWS ON THE TAP (Mark, 2026-09-30) — `useOptimisticRows` over
  // the report's one row, as the Info page does.
  const saved = useMemo(
    () => [{ id: reportId, task_schedules_done: schedulesDone }],
    [reportId, schedulesDone]
  );
  const {
    rows: [flags],
    optimistic,
  } = useOptimisticRows(saved);

  function flag(column: "task_schedules_done" | "task_special_orders_done", value: boolean) {
    void optimistic(reportId, { [column]: value }, async () => {
      const { data, error } = await supabase
        .from("shift_reports")
        .update({ [column]: value })
        .eq("id", reportId)
        .select("id");
      if (error || !data?.length) return false;
      router.refresh();
      return true;
    });
  }

  // IS THE PLAN'S SCHEDULE STILL OWED? (2026-10-03.) A special-order schedule
  // can exist before the night is generated, and `schedules.length > 0` then
  // made Print the black button over a night with no plan schedule — whose
  // tray guides print the special orders alone and look complete. Owed only
  // when a plan bakes here that day: a kitchen with no plan has nothing to
  // generate, and its special orders are the whole night.
  const planOwed =
    nextProductionDate !== null &&
    !schedules.some((s) => s.source === "plan") &&
    sellingShopsForKitchen(plans, kitchenId, {
      starts_on: nextProductionDate,
      ends_on: nextProductionDate,
    }).length > 0;

  if (!nextProductionDate) {
    return (
      <p className="text-center text-[16px]">
        <span className="bg-mark-fill px-1">No next production day is set</span>{" "}
        <span className="text-muted">— go back to page 1 and give it one.</span>
      </p>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-12">

      <section className="space-y-4">
        <SectionHeading count={schedules.length}>
          Production schedules for {nextProductionDate}
        </SectionHeading>
        {schedules.length === 0 ? (
          <p className="text-sm text-muted">None.</p>
        ) : (
          <ul className="divide-y divide-hairline border border-hairline">
            {/* A PRINT PER ROW (Mark, 2026-08-29), the special orders' shape
                above. The button below prints the whole night in one file,
                which is what you want at the end of a shift; this is for the
                one sheet that jammed, or the one a baker walked off with.
                It says "printed <date>" the same way an order does, and the
                verb changes to "Print again" once it has been — a button that
                said "Print" on something already printed would make you check
                the row twice. */}
            {schedules.map((s) => (
              <li key={s.id} className="flex items-center gap-4 px-4 py-3">
                <span className="w-16 text-[16px]">{s.sellsCode}</span>
                <span className="flex-1 text-[16px]">{s.title ?? "Premade schedule"}</span>
                {s.printedAt ? (
                  <span className="text-sm text-muted">printed {s.printedAt.slice(0, 10)}</span>
                ) : null}
                <PrintPacket
                  scheduleIds={[s.id]}
                  stampable={stampable}
                  label={s.printedAt ? "Print again" : "Print"}
                />
              </li>
            ))}
          </ul>
        )}
        {planOwed && schedules.length > 0 ? (
          <p className="text-[16px]">
            <span className="bg-mark-fill px-1">
              The plan&rsquo;s schedule for {kitchenCode} has not been generated
            </span>{" "}
            <span className="text-muted">— the tray guides would hold special orders only.</span>
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          {/* WHICHEVER ONE IS NEXT IS BLACK, and never both (Mark,
              2026-08-28). With no schedule for that night the only thing to do
              is generate; once one exists the only thing left is to print it.
              That is the panel-commit exception applied to a screen — a state
              with exactly one obvious next act — rather than a standing
              "primary", which this app does not have. */}
          <GenerateSchedules
            orgId={orgId}
            horizonDays={horizonDays}
            locations={locations}
            today={today}
            startDate={nextProductionDate}
            kitchenId={kitchenId}
            kitchenCode={kitchenCode}
            plans={plans}
            primary={schedules.length === 0 || planOwed}
          />
          {schedules.length > 0 || orders.length > 0 ? (
            <PrintPacket
              // Every schedule this KITCHEN is filling that night, special
              // orders included — which is what `schedules` already holds, and
              // `fetchPacketData` widens further through `companionScheduleIds`
              // so nothing depends on this list being complete.
              scheduleIds={schedules.map((s) => s.id)}
              // AND THE KITCHEN ORDER SHEETS, so "Print All Documents" means
              // it (Mark, 2026-09-01: "why not include a 'Special Orders'
              // option … so we don't need to do it as a separate process?").
              //
              // THE SAME LIST THE SECTION ABOVE IS SHOWING, never the orders
              // that happen to have a production schedule. Generating a night
              // does pull special orders into schedules — but almost nothing is
              // scheduled in practice (measured: 2 of the 33 orders printed
              // since 2026-08-01), so a packet built from the schedules would
              // print two sheets in thirty-three under a button claiming all of
              // them.
              specialOrders={orders}
              printedOn={today}
              stampable={stampable}
              // NEVER BOTH BLACK (Mark, 2026-08-28). This button now also
              // appears on a night that has orders and NO schedule — where the
              // next act is plainly still Generate, which is already filled. So
              // the fill is on having something generated, not on the button
              // merely being pressable.
              primary={schedules.length > 0 && !planOwed}
              // BOTH FLAGS, because one act now produces both papers. They stay
              // two columns — the submit page has to be able to say WHICH is
              // missing when somebody prints only one from a row above — but
              // the packet answers both at once.
              onPrinted={() => {
                flag("task_schedules_done", true);
                flag("task_special_orders_done", true);
              }}
            />
          ) : null}
        </div>
        <Checkbox
          checked={flags.task_schedules_done}
          disabled={!editable}
          onChange={(next) => flag("task_schedules_done", next)}
        >
          Tomorrow&rsquo;s production logs are printed
        </Checkbox>
      </section>
    </div>
  );
}
