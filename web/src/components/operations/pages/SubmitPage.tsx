"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Checkbox } from "@/components/ui/Checkbox";
import { submitReadiness, salesNote, type ReadinessInput } from "@/lib/shiftReports";

/**
 * The readiness page — FMP's last one, minus checklists and minus sales.
 *
 * It NAMES what is unresolved and then lets you through, which is
 * `closeReadiness`'s rule and its reason: gate a shift report on a complete set
 * and the night the printer jams is a report that never gets sent, which is how
 * a status stops meaning anything.
 *
 * FMP had six lines. `Task_Log` is answered by the narrative existing,
 * `Task_SalesData` by Square typing the figure, and `Task_Checklist` has no
 * feature behind it yet — so three flags and two derivations.
 */
export function SubmitPage({
  reportId,
  readiness,
  editable,
}: {
  reportId: string;
  readiness: ReadinessInput;
  editable: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [, startTransition] = useTransition();

  const caveats = submitReadiness(readiness);

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

  const lines: { label: string; done: boolean; toggle?: string }[] = [
    {
      label: "Staff reviews",
      done: readiness.taskRatingsDone,
      toggle: "task_ratings_done",
    },
    {
      label: "Complete shift report",
      done: (readiness.narrative ?? "").trim() !== "",
    },
  ];

  if (readiness.shift === "closing") {
    lines.push(
      {
        label: "Print tomorrow's special orders",
        done: readiness.taskSpecialOrdersDone,
        toggle: "task_special_orders_done",
      },
      {
        label: "Print tomorrow's production logs",
        done: readiness.taskSchedulesDone,
        toggle: "task_schedules_done",
      }
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <ul className="space-y-3">
        {lines.map((l) => (
          <li key={l.label} className="flex items-center gap-4">
            {l.toggle ? (
              <Checkbox
                checked={l.done}
                disabled={!editable}
                onChange={(next) => flag(l.toggle as string, next)}
              >
                {l.label}
              </Checkbox>
            ) : (
              // A DERIVED line still looks like the others (Mark, 2026-08-28:
              // "the 'complete shift report' checkbox looks different from the
              // others"). It was drawn as ☑︎/☐︎ glyphs because nothing here is
              // clickable — the narrative existing is what ticks it — and that
              // made the one line nobody sets the one line that looks wrong.
              //
              // It is the real control now, disabled: same box, same label, same
              // baseline. Disabled reads as "this one answers itself", which is
              // true, and it is what `NewTimesheet` settled — a control that
              // looks DIFFERENT cannot be told from one that is broken.
              <Checkbox checked={l.done} disabled onChange={() => {}}>
                {l.label}
              </Checkbox>
            )}
          </li>
        ))}
      </ul>

      <p className="text-sm text-muted">{salesNote(readiness.netSalesCents)}</p>

      {caveats.length > 0 ? (
        <div className="space-y-2 border border-hairline p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.08em]">
            Still outstanding
          </p>
          <ul className="space-y-1 text-sm">
            {caveats.map((c) => (
              <li key={c}>
                <span className="bg-mark-fill px-1">{c}</span>
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted">
            You can send it anyway — this is a list, not a gate.
          </p>
        </div>
      ) : (
        <p className="text-sm">Everything is done. Send it.</p>
      )}
    </div>
  );
}
