"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { confirmDialog } from "@/lib/confirm";
import { checklistReadiness, CHECKLIST_KIND_LABEL, type ChecklistKind } from "@/lib/checklists";
import { SHIFT_SLOT_LABEL } from "@/lib/employeeEvents";
import { ChecklistWalk, type WalkTask } from "./ChecklistWalk";
import type { WalkItemRow } from "./WalkItem";
import type { ChecklistRunData } from "@/lib/checklistRunData";

/**
 * One dress for both footer cells, so a two-across row cannot drift — and it
 * carries NO COLOUR, deliberately.
 *
 * It held `text-white` first, and the commit appended `bg-white text-ink` over
 * it. That renders WHITE ON WHITE: Tailwind resolves competing utilities by
 * STYLESHEET ORDER, not by the order they appear in a class attribute, so
 * `text-white` won and the Finish button was invisible on a black bar. Caught
 * by measuring the computed style rather than by looking — at a glance the
 * footer simply appears to have one button.
 *
 * The rule this file now follows: a shared class string states LAYOUT, and
 * each caller states its own colours. Nothing is overridden.
 */
const FOOTER_CELL =
  "min-h-14 px-6 py-3 text-sm font-bold uppercase tracking-[0.08em] disabled:opacity-35";

/**
 * The walk's own chrome: FileMaker's furniture, and the shift report runner's.
 *
 * A black band naming the walk and its progress, the scrolling body, and a
 * black footer of two commands. `ChecklistWalk` is the body and knows nothing
 * about any of this, which is what lets the shift report mount it as a page.
 */
export function WalkRunner({
  run,
  items,
  tasks,
  today,
  locationCode,
  orgId,
  editable,
}: {
  run: ChecklistRunData["run"];
  items: WalkItemRow[];
  tasks: WalkTask[];
  today: string;
  locationCode: string;
  orgId: string;
  editable: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  const isOpen = run.status === "open";
  // The runner serves checklists, walkthroughs AND inspection logs, so its copy
  // names the KIND rather than assuming one — "Finish this checklist?" would be
  // wrong on two of the three. `run.kind` is snapshotted, so it says what this
  // record IS rather than what its template happens to be now.
  const noun = CHECKLIST_KIND_LABEL[run.kind as ChecklistKind].toLowerCase();
  const done = items.filter((i) => i.status !== "pending").length;

  async function finish() {
    const outstanding = checklistReadiness(
      items.map((i) => ({
        status: i.status,
        requires_photo: i.requires_photo,
        photoCount: i.photos.length,
      })),
    );

    // `closeReadiness`'s rule and its reason: it NAMES what is unresolved and
    // then LETS YOU THROUGH. Gate finishing on a complete set and the night the
    // walk-in floods is a walk that is never finished — and a confirm that
    // names something and then blocks you is how people learn to stop reading
    // confirms.
    const ok = await confirmDialog({
      title: `Finish this ${noun}?`,
      body:
        outstanding.length > 0
          ? `Still outstanding:\n\n${outstanding.map((s) => `· ${s}`).join("\n")}\n\n` +
            `You can finish anyway — the ${noun} records what you found, including what you did not get to.`
          : "Everything on the list has been answered.",
      confirmLabel: "Finish it",
    });
    if (!ok) return;

    setFailed(null);
    startTransition(async () => {
      const uid = (await supabase.auth.getUser()).data.user?.id ?? null;
      const { data, error } = await supabase
        .from("checklist_runs")
        .update({
          status: "submitted",
          submitted_at: new Date().toISOString(),
          submitted_by: uid,
        })
        .eq("id", run.id)
        // An update matching no policy changes nothing and returns NO error, so
        // a bare write would report a cheerful success AND navigate — which
        // reads exactly like the walk having been filed. The receiving screen's
        // Finalize learned this the same way.
        .select("id");

      if (error || !data || data.length === 0) {
        setFailed(error?.message ?? `The ${noun} was not finished — nothing changed.`);
        return;
      }
      // Finishing IS the end of the task, so it leaves. Staying put would make
      // you press Close afterwards for the same destination.
      router.push(`/checklists/${run.id}`);
    });
  }

  return (
    <>
      <header className="sticky top-0 z-20 bg-ink px-4 py-3 text-white">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h1 className="text-[15px] font-bold uppercase tracking-[0.08em]">
            {run.title}
          </h1>
          <p className="text-[12px] uppercase tracking-[0.08em] text-white/60">
            {CHECKLIST_KIND_LABEL[run.kind as ChecklistKind]}
            {locationCode && ` · ${locationCode}`} · {run.business_date}
            {run.shift && ` · ${SHIFT_SLOT_LABEL[run.shift as never] ?? run.shift}`} ·{" "}
            {done} of {items.length}
          </p>
        </div>
      </header>

      <main className="flex-1 px-4 py-6">
        {!isOpen && (
          <p className="mb-6 border-2 border-hairline p-3 text-[15px]">
            This {noun} was finished on{" "}
            {run.submitted_at?.slice(0, 10) ?? "an earlier day"}. It reads, but it
            does not change.
          </p>
        )}
        {failed && <p className="mb-4 text-sm text-accent">{failed}</p>}
        <ChecklistWalk
          runId={run.id}
          orgId={orgId}
          locationId={run.location_id}
          items={items}
          tasks={tasks}
          today={today}
          editable={editable}
          isOpen={isOpen}
        />
      </main>

      <footer className="sticky bottom-0 z-20 flex items-stretch justify-end gap-px bg-ink">
        <button
          type="button"
          className={`${FOOTER_CELL} text-white hover:bg-white/10`}
          onClick={() => router.push(`/checklists/${run.id}`)}
        >
          Close
        </button>
        {isOpen && editable && (
          // BLACK on black is nothing, so the commit is the INVERSE here: the
          // one outcome this screen exists to produce is picked out in white,
          // which is the panel-commit exception (`DIALOG_COMMIT_CLASS`) applied
          // to a screen that behaves like a panel — an escape beside a commit
          // rather than a row of peers. Receiving's `Complete` made the same
          // call in the same words.
          <button
            type="button"
            onClick={finish}
            disabled={busy}
            className={`${FOOTER_CELL} bg-white text-ink hover:bg-white/85`}
          >
            {busy ? "Finishing…" : "Finish"}
          </button>
        )}
      </footer>
    </>
  );
}
