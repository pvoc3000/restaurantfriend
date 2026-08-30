"use client";

import { useRouter } from "next/navigation";
import { TabPicker } from "@/components/ui/TabPicker";
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
 * `TabPicker` over two populations fetched under different rules.
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
 * THE COMMAND SITS WITH THE TITLE (Mark, 2026-08-30), which is where every
 * record screen in this app already puts its commands, and it is the VIEW's own
 * command rather than the screen's — Start a walk on one tab, New template on
 * the other. The tab decides what "new" means here, which is clarifying rather
 * than a special case.
 *
 * There is NO explanatory paragraph under the heading (Mark, same day). Both
 * tabs are named, the counts are on them, and the lists say what they hold when
 * they are empty — so the sentence was telling you something the screen was
 * already showing you.
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

  return (
    <div className="space-y-6">
      {/* `items-start`, so the command lines up with the TOP of the heading
          rather than centring against it — the rule every other record screen
          follows, and what keeps the row honest if the title ever wraps. */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
          Checklists
        </h1>
        {view === "walks"
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
            )}
      </div>

      <TabPicker
        ariaLabel="Which view"
        value={view}
        options={CHECKLIST_VIEWS.map((v) => ({
          key: v,
          label: CHECKLIST_VIEW_LABEL[v],
          count: v === "walks" ? runs.length : templates.length,
          href: checklistViewHref(v),
        }))}
        onChange={(v) => router.push(checklistViewHref(v as ChecklistView))}
      />

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
  );
}
