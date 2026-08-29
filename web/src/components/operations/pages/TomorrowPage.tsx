"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import { Checkbox } from "@/components/ui/Checkbox";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { GenerateSchedules } from "@/components/production/GenerateSchedules";
import { PrintPacket } from "@/components/production/PrintPacket";
import { openWindowNow, showBlob } from "@/lib/poProcessing";
import { fetchOrderDocData, documentFileName } from "@/lib/specialOrderDocs";

export type TomorrowOrder = {
  id: string;
  number: string;
  title: string | null;
  eventTime: string | null;
  printedAt: string | null;
};

export type TomorrowSchedule = {
  id: string;
  title: string | null;
  sellsCode: string;
  source: string;
  printedAt: string | null;
};

/**
 * Tomorrow's paper — FMP's pages 8 and 9, merged.
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
 * able to say which one was not printed.
 *
 * THIS PAGE IS EXEMPT from "nothing writes until Send", and obviously so —
 * generating a schedule and stamping a printed order are ACTS, not report
 * data. The kitchen needs the paper tonight.
 */
export function TomorrowPage({
  reportId,
  nextProductionDate,
  kitchenId,
  kitchenCode,
  locations,
  plans,
  orders,
  schedules,
  specialOrdersDone,
  schedulesDone,
  editable,
  stampable,
}: {
  reportId: string;
  nextProductionDate: string | null;
  kitchenId: string;
  kitchenCode: string;
  locations: { id: string; code: string; name: string }[];
  plans: React.ComponentProps<typeof GenerateSchedules>["plans"];
  orders: TomorrowOrder[];
  schedules: TomorrowSchedule[];
  specialOrdersDone: boolean;
  schedulesDone: boolean;
  editable: boolean;
  stampable: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [failed, setFailed] = useState<string | null>(null);
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

  async function printOrder(order: TomorrowOrder) {
    // Synchronously, BEFORE any await: a window.open after one is silently
    // blocked, which is the oldest gotcha in this codebase.
    const win = openWindowNow();
    try {
      const [{ pdf }, docs, data] = await Promise.all([
        import("@react-pdf/renderer"),
        import("@/components/specialOrders/pdf/SpecialOrderPdfs"),
        fetchOrderDocData(supabase, [order.id]),
      ]);
      const blob = await pdf(
        docs.documentElement("order", data.orders, data.org)
      ).toBlob();
      showBlob(win, blob, documentFileName("order", order.number, nextProductionDate ?? ""));

      // The stamp the kitchen document has always carried. Only when empty: a
      // second copy printed next week is not a second send, and overwriting
      // would move the date the record already claims.
      if (order.printedAt === null && nextProductionDate) {
        await supabase
          .from("special_orders")
          .update({ order_printed_at: nextProductionDate })
          .eq("id", order.id)
          .select("id");
        router.refresh();
      }
    } catch (e) {
      win?.close();
      setFailed((e as Error).message);
    }
  }

  if (!nextProductionDate) {
    return (
      <p className="mx-auto max-w-3xl text-sm">
        <span className="bg-mark-fill px-1">No next production day is set</span>{" "}
        <span className="text-muted">— go back to page 1 and give it one.</span>
      </p>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-12">
      {failed ? <p className="text-sm text-accent">{failed}</p> : null}

      <section className="space-y-4">
        <SectionHeading count={orders.length}>
          Special orders for {nextProductionDate}
        </SectionHeading>
        {orders.length === 0 ? (
          <p className="text-sm text-muted">Nothing is due at {kitchenCode} that day.</p>
        ) : (
          <ul className="divide-y divide-hairline border border-hairline">
            {orders.map((o) => (
              <li key={o.id} className="flex items-center gap-4 px-4 py-3">
                <span className="flex-1 text-[15px]">
                  #{o.number}
                  {o.title ? ` — ${o.title}` : ""}
                  {o.eventTime ? <span className="text-muted"> ({o.eventTime})</span> : null}
                </span>
                {o.printedAt ? (
                  <span className="text-xs text-muted">printed {o.printedAt}</span>
                ) : null}
                <button
                  type="button"
                  className={BUTTON_CLASS}
                  onClick={() => void printOrder(o)}
                >
                  {o.printedAt ? "Print again" : "Print"}
                </button>
              </li>
            ))}
          </ul>
        )}
        <Checkbox
          checked={specialOrdersDone}
          disabled={!editable}
          onChange={(next) => flag("task_special_orders_done", next)}
        >
          Tomorrow&rsquo;s special orders are printed
        </Checkbox>
      </section>

      <section className="space-y-4">
        <SectionHeading count={schedules.length}>
          Production schedules for {nextProductionDate}
        </SectionHeading>
        {schedules.length === 0 ? (
          <p className="text-sm text-muted">
            No schedule has been generated for that night yet.
          </p>
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
                <span className="w-16 text-[15px]">{s.sellsCode}</span>
                <span className="flex-1 text-[15px]">{s.title ?? "Premade schedule"}</span>
                {s.printedAt ? (
                  <span className="text-xs text-muted">printed {s.printedAt.slice(0, 10)}</span>
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
          {schedules.length > 0 ? (
            <PrintPacket
              // Every schedule this KITCHEN is filling that night, special
              // orders included — which is what `schedules` already holds, and
              // `fetchPacketData` widens further through `companionScheduleIds`
              // so nothing depends on this list being complete.
              scheduleIds={schedules.map((s) => s.id)}
              stampable={stampable}
              primary
              onPrinted={() => flag("task_schedules_done", true)}
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
