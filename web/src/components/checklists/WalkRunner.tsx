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
 * One dress for both footer buttons, so the pair cannot drift — and it carries
 * NO COLOUR, deliberately.
 *
 * It held `text-white` once, and the commit appended `bg-white text-ink` over
 * it. That renders WHITE ON WHITE: Tailwind resolves competing utilities by
 * STYLESHEET ORDER, not by the order they appear in a class attribute, so
 * `text-white` won and the Finish button was invisible. Caught by measuring the
 * computed style rather than by looking — at a glance the footer simply appears
 * to have one button. The rule this file follows: a shared class string states
 * LAYOUT, each caller states its own colours, nothing is overridden.
 *
 * IT IS NOT `BUTTON_CLASS` / `PRIMARY_BUTTON_CLASS`, whose colours and hovers
 * these two borrow, because those are `h-9` at 12px — the DESK metrics. This
 * screen is tablet-first, where 36px is under the 44px a thumb wants, so the
 * sizing is its own and only the dress is shared.
 */
const FOOTER_CELL =
  "inline-flex min-h-14 items-center justify-center border border-ink px-6 py-3 text-sm font-bold uppercase tracking-[0.08em] transition-colors disabled:opacity-35";

/**
 * The walk's own chrome: FileMaker's furniture, and the shift report runner's.
 *
 * A black band naming the checklist and its progress, the scrolling body, and a
 * white footer of two commands under a hairline. `ChecklistWalk` is the body and
 * knows nothing about any of this, which is what lets the shift report mount it
 * as a page.
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
          noun={noun}
        />
      </main>

      {/* A WHITE FOOTER, and the commit is BLACK the ordinary way round (Mark,
          2026-08-30). It was a black bar with the colours inverted — white
          Finish on black — which said the same thing backwards and made this
          the one screen in the app where the important button is the pale one.
          Now it matches the receiving screen exactly, which is this footer's
          closest sibling: `Close` beside a black `Complete`, an escape beside a
          commit rather than a row of peers. That is the panel-commit exception
          (`PRIMARY_BUTTON_CLASS`'s own case) applied to a screen that behaves
          like a panel, because a run produces ONE outcome.

          THE TOP RULE IS NOT OPTIONAL — Mark asked, and the app has already
          answered it twice: `SpecialOrdersList`'s pinned legend draws one for
          the stated reason that "without a top rule the rows scroll up into an
          unmarked white band", and a hairline is the weight it uses. On a black
          bar the band separated itself; on a white one, nothing does.

          Both buttons are ONE BOX — same border, same height, only the fill
          differs — so the pair reads as a pair and the right edge does not move
          when Finish is absent on a submitted run. `WorkingHere`'s rule. */}
      <footer className="sticky bottom-0 z-20 flex items-center justify-end gap-3 border-t border-hairline bg-white px-4 py-3">
        <button
          type="button"
          className={`${FOOTER_CELL} bg-white text-ink hover:bg-ink hover:text-white`}
          onClick={() => router.push(`/checklists/${run.id}`)}
        >
          Close
        </button>
        {isOpen && editable && (
          <button
            type="button"
            onClick={finish}
            disabled={busy}
            className={`${FOOTER_CELL} bg-ink text-white hover:bg-white hover:text-ink`}
          >
            {busy ? "Finishing…" : "Finish"}
          </button>
        )}
      </footer>
    </>
  );
}
