"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Checkbox } from "@/components/ui/Checkbox";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { GenerateSchedules } from "@/components/production/GenerateSchedules";
import { PrintPacket } from "@/components/production/PrintPacket";

/**
 * One special order tomorrow — AN ID AND NOTHING ELSE.
 *
 * It carried a number, a title, a time and a printed date while this page
 * listed them. It no longer does (Mark, 2026-09-01: "we no longer need the
 * special orders section on page 7"), because Print All Documents prints them
 * and its dialog names the count — so the list was a second place saying what
 * the packet already says. What the page still needs is which orders to hand
 * the packet.
 */
export type TomorrowOrder = { id: string };

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
  const [, startTransition] = useTransition();

  function flag(column: string, value: boolean) {
    startTransition(async () => {
      await supabase
        .from("shift_reports")
        .update({ [column]: value })
        .eq("id", reportId)
        .select("id");
      router.refresh();
    });
  }

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
        <div className="flex flex-wrap items-center gap-3">
          {/* WHICHEVER ONE IS NEXT IS BLACK, and never both (Mark,
              2026-08-28). With no schedule for that night the only thing to do
              is generate; once one exists the only thing left is to print it.
              That is the panel-commit exception applied to a screen — a state
              with exactly one obvious next act — rather than a standing
              "primary", which this app does not have. */}
          <GenerateSchedules
            locations={locations}
            today={nextProductionDate}
            kitchenId={kitchenId}
            kitchenCode={kitchenCode}
            plans={plans}
            primary={schedules.length === 0}
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
              specialOrderIds={orders.map((o) => o.id)}
              printedOn={today}
              stampable={stampable}
              // NEVER BOTH BLACK (Mark, 2026-08-28). This button now also
              // appears on a night that has orders and NO schedule — where the
              // next act is plainly still Generate, which is already filled. So
              // the fill is on having something generated, not on the button
              // merely being pressable.
              primary={schedules.length > 0}
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
          checked={schedulesDone}
          disabled={!editable}
          onChange={(next) => flag("task_schedules_done", next)}
        >
          Tomorrow&rsquo;s production logs are printed
        </Checkbox>
      </section>
    </div>
  );
}
