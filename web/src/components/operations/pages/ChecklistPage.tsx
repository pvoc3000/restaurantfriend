import { BUTTON_CLASS } from "@/components/ui/buttons";
import { ChecklistWalk } from "@/components/checklists/ChecklistWalk";
import { FinishChecklist } from "@/components/checklists/FinishChecklist";
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
 * FINISHING HAS TO BE POSSIBLE FROM HERE, and for a while it was not (Mark,
 * 2026-08-30). `WalkRunner`'s footer owned the button, this page mounts only
 * the body, and the sole route out was an "open it full screen" link — so
 * finishing meant leaving the report you were in the middle of writing. The
 * act lives in `FinishChecklist` now and both surfaces call it; that link is
 * gone (Mark, same day), which also retires the one control on this page that
 * threw away where you were.
 *
 * TWO ACTS, NOT ONE. Finishing the walk submits the RUN; submitting the report
 * sends. Neither triggers the other, and `submit_shift_report` is untouched —
 * both it and `reopen_shift_report` are applied definer functions, and 072
 * exists precisely because flipping a status without undoing a flush duplicates
 * records silently. The submit page NAMES an unfinished checklist and lets you
 * through.
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
  if (!run) {
    return (
      <div className="space-y-4">
        <p className="max-w-[60ch] text-[16px]">
          {askedFor.length > 0
            ? `This shift is asked for ${askedFor.length === 1 ? "a checklist" : `${askedFor.length} checklists`}, and ${askedFor.length === 1 ? "it has" : "none has"} not been started.`
            : "No checklist is set up for this shift at this shop."}
        </p>
        {askedFor.length > 0 && (
          <ul className="space-y-1 text-[16px]">
            {askedFor.map((t) => (
              <li key={t.id}>
                <span className="bg-mark-fill px-1">{t.name}</span>
              </li>
            ))}
          </ul>
        )}
        {editable && (
          <LinkChecklistRun
            reportId={reportId}
            orgId={orgId}
            locationId={locationId}
            reportDate={reportDate}
            shift={shift}
            askedFor={askedFor}
          />
        )}
        {askedFor.length === 0 && (
          <p className="max-w-[60ch] text-[14px] text-muted">
            Master lists are set up under Facilities › Checklists › Templates.
            You can finish this report without one.
          </p>
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
        today={today}
        editable={editable}
        isOpen={run.run.status === "open"}
      />

      {editable && run.run.status === "open" && (
        // An ORDINARY command, not a filled one: this report's single outcome
        // is Send, on its submit page, and finishing the checklist is one step
        // on the way. `PRIMARY_BUTTON_CLASS` is for the act a screen exists
        // for, and on this screen that is not this.
        <div className="flex justify-end">
          <FinishChecklist
            runId={run.run.id}
            noun="checklist"
            items={run.items}
            className={BUTTON_CLASS}
            label="Finish the checklist"
          />
        </div>
      )}
    </div>
  );
}
