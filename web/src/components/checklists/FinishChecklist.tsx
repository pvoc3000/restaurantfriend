"use client";

import { useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { confirmDialog } from "@/lib/confirm";
import { checklistIssueCount, checklistReadiness } from "@/lib/checklists";
import type { WalkItemRow } from "./WalkItem";

/**
 * Finishing a checklist — the ACT, extracted so both surfaces can offer it.
 *
 * It lived inside `WalkRunner`'s footer, which meant the shift report's own
 * checklist page — which mounts `ChecklistWalk`, the body, and none of that
 * chrome — had NO WAY TO FINISH ONE (Mark, 2026-08-30). You could answer every
 * item from inside the report and the run stayed `open`, so the submit page
 * went on saying "the checklist is answered but has not been finished" and the
 * only way out was the "Open it full screen" link, finishing there, and coming
 * back. Extracted rather than copied: this carries a confirm, a readiness list,
 * a findings sentence and a row-count check, and two of those have already been
 * got wrong once each.
 *
 * WHAT IT DOES NOT OWN IS WHERE YOU GO AFTERWARDS. The full-screen runner
 * LEAVES on success — finishing is the end of that task, and staying put would
 * make you press Close afterwards for the same destination — while the embedded
 * one must not navigate at all, because you are in the middle of a shift report
 * and the checklist is one page of it. Hence `onFinished`.
 */
export function FinishChecklist({
  runId,
  noun,
  items,
  className,
  label = "Finish",
  onFinished,
}: {
  runId: string;
  /** What this record calls itself — `WalkRunner` reads the snapshotted kind. */
  noun: string;
  items: WalkItemRow[];
  className: string;
  label?: string;
  /** Called ONLY on a write that actually changed a row. */
  onFinished?: () => void;
}) {
  const supabase = createClient();
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  async function finish() {
    const outstanding = checklistReadiness(
      items.map((i) => ({
        status: i.status,
        requires_photo: i.requires_photo,
        photoCount: i.photos.length,
      })),
    );

    // WHAT WAS FOUND IS NOT WHAT IS OUTSTANDING. The findings are stated as a
    // fact — INFORMATION, never a caveat — because a flagged
    // item has been dealt with as far as a checklist can deal with it, and the
    // report is where it goes next.
    const found = checklistIssueCount(items);
    const findings =
      found > 0
        ? `${found === 1 ? "1 issue is" : `${found} issues are`} flagged, and ${
            found === 1 ? "it goes" : "they go"
          } in the report.`
        : null;

    // `closeReadiness`'s rule and its reason: it NAMES what is unresolved and
    // then LETS YOU THROUGH. Gate finishing on a complete set and the night the
    // walk-in floods is a checklist that is never finished — and a confirm that
    // names something and then blocks you is how people learn to stop reading
    // confirms.
    const ok = await confirmDialog({
      title: `Finish this ${noun}?`,
      body: [
        outstanding.length > 0
          ? `Still outstanding:\n\n${outstanding.map((s) => `· ${s}`).join("\n")}\n\n` +
            `You can finish anyway — the ${noun} records what you found, including what you did not get to.`
          : "Everything on the list has been answered.",
        findings,
      ]
        .filter(Boolean)
        .join("\n\n"),
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
        .eq("id", runId)
        // An update matching no policy changes nothing and returns NO error, so
        // a bare write would report a cheerful success AND navigate — which
        // reads exactly like the checklist having been filed. The receiving
        // screen's Finalize learned this the same way.
        .select("id");

      if (error || !data || data.length === 0) {
        setFailed(error?.message ?? `The ${noun} was not finished — nothing changed.`);
        return;
      }
      onFinished?.();
    });
  }

  return (
    <>
      <button type="button" onClick={finish} disabled={busy} className={className}>
        {busy ? "Finishing…" : label}
      </button>
      {failed ? <p className="text-sm text-accent">{failed}</p> : null}
    </>
  );
}
