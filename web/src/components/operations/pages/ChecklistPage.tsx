import { ChecklistWalk } from "@/components/checklists/ChecklistWalk";
import { LinkChecklistRun } from "@/components/checklists/LinkChecklistRun";
import { progressLabel } from "@/lib/checklists";
import type { ShiftSlot } from "@/lib/shiftReports";
import type { ChecklistRunData } from "@/lib/checklistRunData";

/**
 * The checklist, inside the shift report.
 *
 * THE REPORT EMBEDS THE RUN; IT NEVER OWNS IT OR COPIES IT. One record, two
 * doors — the pattern `ExportTimesheets` and the receiving screen already set,
 * and here it is load-bearing rather than tidy: the walk happens ACROSS the
 * shift, over hours, while the report is written at the end. Force the walk to
 * live only in here and you get either a report left open from 6pm or a walk
 * done at 11:55 from memory, which is precisely the failure the feature exists
 * to prevent.
 *
 * So `ChecklistWalk` is mounted with no chrome of its own, exactly as it is at
 * `/checklists/[id]/run`, and this page adds the sentence that says which
 * checklist it is — and the one command that chrome was carrying.
 *
 * THERE IS NO FINISH BUTTON HERE ANY MORE (Mark, 2026-09-01: "have the
 * checklist finished automatically when the shift report is completed. It feels
 * like an unnecessary extra step to the user"). He is right, and the reason is
 * the same one that put the button here in the first place: this checklist
 * belongs to THIS report, so the report being finished is the checklist being
 * finished. Two commits for one decision is a step, not a safeguard.
 *
 * A short history, because the button was itself a fix and this is not a
 * revert of it. `WalkRunner`'s footer used to own the act, so from inside a
 * report there was NO WAY to finish a run at all (Mark, 2026-08-30) — you left
 * the report, finished it full-screen, and came back. `FinishChecklist` was
 * extracted so both surfaces could offer it. It is still there, still the one
 * implementation, and still the ONLY route for a standalone walk at
 * `/checklists/[id]/run`, which has no report to be finished by.
 *
 * WHAT THE CONFIRM DID, AND WHERE IT WENT. `FinishChecklist` names what is
 * outstanding and then lets you through. The submit page does exactly that
 * already — it lists how many items nobody looked at — so nothing is lost. Its
 * one caveat that HAS gone is "answered but has not been finished", which is no
 * longer true of anything: see `submitReadiness`.
 *
 * The act itself lives in `ShiftReportRunner.send`, between the flush and the
 * mail — not inside `submit_shift_report`, and that file says why.
 */
export function ChecklistPage({
  reportId,
  orgId,
  locationId,
  reportDate,
  shift,
  run,
  askedFor,
  today,
  editable,
}: {
  reportId: string;
  orgId: string;
  locationId: string;
  reportDate: string;
  shift: ShiftSlot;
  run: ChecklistRunData | null;
  askedFor: { id: string; name: string }[];
  today: string;
  editable: boolean;
}) {
  // Nothing asked for and nothing linked: `LinkChecklistRun` returns null with
  // no candidates, so this sentence is the whole page and sits in the middle of
  // it (Mark, 2026-09-03).
  if (!run && askedFor.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="max-w-[60ch] text-center text-[16px]">
          No checklist is set up for this shift at this shop.
        </p>
      </div>
    );
  }

  if (!run) {
    return (
      <div className="space-y-4">
        <p className="max-w-[60ch] text-[16px]">
          {askedFor.length === 1
            ? // It is being started as this renders, so the sentence says what
              // is happening rather than what has not happened.
              "This shift is asked for a checklist."
            : `This shift is asked for ${askedFor.length} checklists, and none has been started.`}
        </p>
        <ul className="space-y-1 text-[16px]">
          {askedFor.map((t) => (
            <li key={t.id}>
              <span className="bg-mark-fill px-1">{t.name}</span>
            </li>
          ))}
        </ul>
        {editable && (
          <LinkChecklistRun
            reportId={reportId}
            orgId={orgId}
            locationId={locationId}
            reportDate={reportDate}
            shift={shift}
            askedFor={askedFor}
            // ONE candidate starts itself; two are a choice. Gated on
            // `editable` so opening somebody else's report, or a sent one,
            // never creates a record.
            autoStart={editable}
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-[16px] font-medium">{run.run.title}</p>
        <span className="text-[14px] text-muted">
          {progressLabel(run.items)}
          {run.run.status === "submitted" ? " · finished" : ""}
        </span>
      </div>

      <ChecklistWalk
        runId={run.run.id}
        orgId={orgId}
        locationId={locationId}
        items={run.items}
        tasks={run.tasks}
        taskWarning={run.taskWarning}
        today={today}
        editable={editable}
        isOpen={run.run.status === "open"}
      />

      {editable && run.run.status === "open" && (
        /* Said once, quietly, where the missing button was. Without it the page
           looks like a checklist you can fill in and never close — which is the
           reading the button existed to prevent. */
        <p className="text-right text-[14px] text-muted">
          Sending the report finishes this checklist.
        </p>
      )}
    </div>
  );
}
