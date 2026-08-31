import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canWalkChecklists } from "@/lib/roles";
import { serverTimeZone, todayInTimeZone } from "@/lib/today";
import { loadChecklistRun } from "@/lib/checklistRunData";
import { WalkRunner } from "@/components/checklists/WalkRunner";

/**
 * The walk, full screen.
 *
 * `(fullscreen)` for the shift report's reasons, restated because they are the
 * same ones: this is read on an iPad by somebody walking a shop, so a masthead,
 * a nav and a page gutter are all room the walk needs. The layout is already
 * signed-in and already carries `ConfirmProvider` and `CalcPad`.
 */
export default async function ChecklistRunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getAppSession();
  const supabase = await createClient();

  const { data, error } = await loadChecklistRun(supabase, id);

  if (error) {
    return (
      <div className="p-8">
        <p className="max-w-[72ch] text-sm text-accent">
          Could not open this checklist: {error}
          {/checklist_runs|facility_photos|location_tasks/.test(error) &&
            " — migrations 075–077 may not have been applied yet."}
        </p>
      </div>
    );
  }
  if (!data) notFound();

  const { run, items, tasks } = data;
  const today = todayInTimeZone(session.orgSettings.timezone ?? serverTimeZone());
  const locationCode =
    session.locations.find((l) => l.id === run.location_id)?.code ?? "";

  return (
    <WalkRunner
      run={run}
      items={items}
      tasks={tasks}
      today={today}
      locationCode={locationCode}
      orgId={session.membership.org_id}
      editable={canWalkChecklists(session.membership.role)}
    />
  );
}
