"use client";

import { useRouter } from "next/navigation";
import { TabPicker } from "@/components/ui/TabPicker";
import { PageHeading } from "@/components/ui/PageHeading";
import {
  CHECKLIST_VIEWS,
  CHECKLIST_VIEW_LABEL,
  checklistViewHref,
  type ChecklistView,
} from "@/lib/checklists";
import { ChecklistsList, type RunRow, type StartableTemplate } from "./ChecklistsList";
import { ChecklistTemplatesList, type TemplateRow } from "./ChecklistTemplatesList";
import { StartWalk } from "./StartWalk";
import { NewChecklistTemplate } from "./NewChecklistTemplate";

/**
 * Checklists — what has been walked, and what gets walked.
 *
 * ONE SCREEN, TWO VIEWS (Mark, 2026-08-30). They are the same subject at two
 * moments, and two adjacent nav entries made you decide which one you wanted
 * before you could look at either. `/events` is the precedent for the shape: a
 * view switch over two populations fetched under different rules. It is a
 * `TabPicker` on its own line under the heading (Mark, 2026-10-16, after a
 * month as a captioned `PickList` in the filter row) — tabs over their content,
 * so each view's own filters and the "asked for today" box sit INSIDE its tab.
 *
 * The view rides in the URL — this app's rule for view state — through a real
 * navigation rather than `history.replaceState`, because the two halves are
 * different QUERIES and the server has to run the other one. That is `/events'`
 * split exactly: its date window pushes where every filter beside it replaces.
 *
 * The tabs carry `href`, so each view is a real address you can middle-click,
 * bookmark and come back to; the `onChange` is the same navigation for a plain
 * click. The DEFAULT writes no parameter, so `/checklists` stays canonical.
 *
 * THE COMMAND SITS IN THE TITLE ROW (Mark, 2026-09-10, reversing 2026-09-03's
 * move into the filter row). It is still the VIEW's own command — Start a walk
 * on one view, New template on the other — so it follows `view`.
 *
 * There IS a one-line description under the heading again (Mark, 2026-09-03) —
 * what the screen is for, in a sentence, rather than the paragraph explaining
 * how it works that was removed on 2026-08-30.
 */
export function ChecklistsScreen({
  view,
  runs,
  startable,
  templates,
  today,
  orgId,
  locationId,
  locationCode,
  canWalk,
  canEdit,
}: {
  view: ChecklistView;
  runs: RunRow[];
  startable: StartableTemplate[];
  templates: TemplateRow[];
  today: string;
  orgId: string;
  locationId: string;
  locationCode: string;
  canWalk: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();

  // A real navigation — the two views are different queries. Each tab carries
  // its `href` too, so it can be middle-clicked and bookmarked.
  const viewTabs = (
    <TabPicker
      ariaLabel="Which view"
      value={view}
      options={CHECKLIST_VIEWS.map((v) => ({
        key: v,
        label: CHECKLIST_VIEW_LABEL[v],
        count: v === "walks" ? runs.length : templates.length,
        href: checklistViewHref(v),
      }))}
      onChange={(v) => router.push(checklistViewHref(v))}
    />
  );

  return (
    <div className="space-y-6">
      {/* The TOTAL for the view on screen, with no "of": the filtered count
          lives inside each list, below the tabs, and a heading above them
          cannot reach it. The tabs carry their own counts. */}
      <PageHeading
        title="Checklists"
        code={locationCode}
        total={view === "walks" ? runs.length : templates.length}
        noun={view === "walks" ? "checklists" : "templates"}
        action={
          view === "walks"
            ? canWalk && (
                <StartWalk
                  templates={startable}
                  today={today}
                  orgId={orgId}
                  locationId={locationId}
                />
              )
            : canEdit && (
                <NewChecklistTemplate
                  orgId={orgId}
                  locationId={locationId}
                  locationCode={locationCode}
                />
              )
        }
      />

      <div className="space-y-4">
        {viewTabs}
        {view === "walks" ? (
          <ChecklistsList
            rows={runs}
            startable={startable}
            locationCode={locationCode}
          />
        ) : (
          <ChecklistTemplatesList
            rows={templates}
            locationCode={locationCode}
            editable={canEdit}
          />
        )}
      </div>
    </div>
  );
}
