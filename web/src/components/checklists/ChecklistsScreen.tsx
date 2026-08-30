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
 * different QUERIES and the server has to run the other one. That is `/events`'
 * split exactly: its date window pushes where every filter beside it replaces.
 *
 * The tabs carry `href`, so each view is a real address you can middle-click,
 * bookmark and come back to; the `onChange` is the same navigation for a plain
 * click. The DEFAULT writes no parameter, so `/checklists` stays canonical.
 */
export function ChecklistsScreen({
  view,
  runs,
  startable,
  templates,
  today,
  windowDays,
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
  windowDays: number;
  orgId: string;
  locationId: string;
  locationCode: string;
  canWalk: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
          Checklists
        </h1>
        {/* The sentence follows the view: one describes a record of what
            happened, the other describes what a walk asks for, and a single
            paragraph covering both would describe neither. */}
        <p className="max-w-[72ch] text-sm text-muted">
          {view === "walks" ? (
            <>
              What has been walked at {locationCode} in the last {windowDays} days,
              and what today still wants. A walk records what a named person saw,
              at a time — so it is superseded, never erased.
            </>
          ) : (
            <>
              What a walk at {locationCode} asks for. A checklist is walked at the
              end of a shift; a walkthrough is a manager’s round; an inspection
              log records an outside visit. Items are grouped by shop section, so
              a walk follows the same route through the building as the order
              guide.
            </>
          )}
        </p>
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
          today={today}
          orgId={orgId}
          locationId={locationId}
          locationCode={locationCode}
          editable={canWalk}
        />
      ) : (
        <ChecklistTemplatesList
          rows={templates}
          orgId={orgId}
          locationId={locationId}
          locationCode={locationCode}
          editable={canEdit}
        />
      )}
    </div>
  );
}
