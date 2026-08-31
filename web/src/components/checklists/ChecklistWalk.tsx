"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { TabPicker } from "@/components/ui/TabPicker";
import {
  CHECK_STATUS_LABEL,
  outstandingCount,
  progressLabel,
  readingLabel,
  statusForReading,
  type CheckStatus,
} from "@/lib/checklists";
import { taskAgeLabel, taskTone, type CarryableTask } from "@/lib/facilityTasks";
import { WalkItem, type WalkItemRow } from "./WalkItem";

export type WalkTask = CarryableTask & { title: string; details: string | null };

/**
 * THE WALK — one scrolling document, black shop-section bands, big targets, and
 * every tap writing immediately.
 *
 * This is the order guide's posture rather than a `DataTable`, and for its
 * reasons: it is read on an iPad by somebody holding a mop, the sections are
 * the shop's own walk order so the route matches the ordering walk, and there
 * is no draft of a walk to save.
 *
 * ONE COMPONENT, TWO DOORS. It is mounted standalone at
 * `/checklists/[id]/run` in the `(fullscreen)` group, and as a page of the
 * shift-report runner. One record, one write path, two entrances — the pattern
 * `ExportTimesheets` and the receiving screen already set. It renders the BODY
 * only; each door supplies its own chrome.
 */
export function ChecklistWalk({
  runId,
  orgId,
  locationId,
  items,
  tasks,
  today,
  editable,
  isOpen,
  noun = "checklist",
}: {
  runId: string;
  orgId: string;
  locationId: string;
  items: WalkItemRow[];
  tasks: WalkTask[];
  today: string;
  editable: boolean;
  /** A submitted run is a document: it reads, it does not write. */
  isOpen: boolean;
  /**
   * What this record is CALLED, lowercase — `WalkRunner` reads it off the run's
   * snapshotted `kind`, so an inspection log does not call itself a checklist.
   * Defaults for the shift report's page, which only ever shows a checklist.
   */
  noun?: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [tier, setTier] = useState<"remaining" | "issues" | "all">("remaining");
  const [failed, setFailed] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const writable = editable && isOpen;

  const shown = useMemo(() => {
    if (tier === "all") return items;
    if (tier === "issues") return items.filter((i) => i.status === "issue");
    return items.filter((i) => i.status === "pending");
  }, [items, tier]);

  // Bands, in the shop's own walk order — which is the order the server sent.
  const bands = useMemo(() => {
    const order: string[] = [];
    const bucket = new Map<string, WalkItemRow[]>();
    for (const i of shown) {
      const key = i.section_name ?? "No section";
      if (!bucket.has(key)) {
        bucket.set(key, []);
        order.push(key);
      }
      bucket.get(key)!.push(i);
    }
    return order.map((section) => ({ section, rows: bucket.get(section)! }));
  }, [shown]);

  async function actOnTask(task: WalkTask, done: boolean) {
    setFailed(null);
    startTransition(async () => {
      // Two writes and only the FIRST is the truth: the task's own status is
      // its one identity, and the pointer row records what tonight's walk did
      // about it. A task marked done here is done everywhere, which is the
      // whole reason it is a record rather than a row copied onto each night.
      const { data, error } = await supabase
        .from("location_tasks")
        .update(
          done
            ? { status: "done", done_at: new Date().toISOString() }
            : { status: "open", done_at: null },
        )
        .eq("id", task.id)
        .select("id");
      if (error || !data || data.length === 0) {
        setFailed(error?.message ?? "That change was not saved.");
        return;
      }
      await supabase.from("checklist_run_tasks").upsert(
        {
          org_id: orgId,
          run_id: runId,
          task_id: task.id,
          acted: done ? "done" : "pending",
        },
        { onConflict: "run_id,task_id" },
      );
      router.refresh();
    });
  }

  const remaining = outstandingCount(items);

  return (
    <div className="space-y-6">
      {/* ── What was asked for before you set off ──────────────────────────
          Carried-forward tasks band the TOP of the walk, which is the order
          guide's `GuideBand` idiom and its reason: you read this before you
          start, which is when it can still change what you do. */}
      {tasks.length > 0 && (
        <section className="border-2 border-hairline p-3">
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
            Carried over — {tasks.length}
          </h2>
          <ul className="space-y-2">
            {tasks.map((t) => {
              const tone = taskTone(t, today);
              const age = taskAgeLabel(t, today);
              return (
                <li key={t.id} className="flex items-start gap-3 text-[16px]">
                  {writable ? (
                    <button
                      type="button"
                      onClick={() => void actOnTask(t, t.status !== "done")}
                      aria-pressed={t.status === "done"}
                      className={`min-h-11 shrink-0 border px-3 text-[12px] font-semibold uppercase tracking-[0.06em] transition-colors ${
                        t.status === "done"
                          ? "border-ink bg-ink text-white"
                          : "border-ink bg-white text-ink hover:bg-ink hover:text-white"
                      }`}
                    >
                      {t.status === "done" ? "Done" : "Mark done"}
                    </button>
                  ) : null}
                  <span className="min-w-0 flex-1 pt-2">
                    <span className={t.status === "done" ? "line-through opacity-50" : ""}>
                      {t.title}
                    </span>
                    {t.details && (
                      <span className="block text-[13px] text-muted">{t.details}</span>
                    )}
                    {age && (
                      // Yellow is a FILL, never an ink — `text-mark` is 1.43:1
                      // on white, which is not a legibility complaint, it is
                      // text you cannot read.
                      <span
                        className={`mt-1 inline-block px-1 text-[12px] ${
                          tone === "loud"
                            ? "bg-accent text-white"
                            : "bg-mark-fill text-ink"
                        }`}
                      >
                        {age}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {failed && <p className="text-sm text-accent">{failed}</p>}

      {/* The filters go WITH the list they act on, never in a command bar. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabPicker
          ariaLabel="Which items"
          value={tier}
          options={[
            { key: "remaining", label: "Remaining", count: remaining },
            {
              key: "issues",
              label: "Issues",
              count: items.filter((i) => i.status === "issue").length,
            },
            { key: "all", label: "All", count: items.length },
          ]}
          onChange={(v) => setTier(v as typeof tier)}
        />
        <span className="text-[13px] text-muted">{progressLabel(items)}</span>
      </div>

      {bands.length === 0 && (
        <p className="text-[16px] text-muted">
          {tier === "remaining"
            ? `Nothing left on this ${noun}.`
            : tier === "issues"
              ? "Nothing flagged."
              : `This ${noun} has no items.`}
        </p>
      )}

      {bands.map((band) => (
        <section key={band.section} className="space-y-0">
          {/* A band that DELIMITS is black — the mark this app uses for the
              masthead, the ActionBar and every grouped list. */}
          <h2 className="flex items-baseline justify-between gap-3 bg-ink px-3 py-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-white">
            <span>{band.section}</span>
            <span className="text-white/55">
              {band.rows.filter((r) => r.status !== "pending").length} of{" "}
              {band.rows.length}
            </span>
          </h2>
          <ul className="divide-y divide-hairline border border-t-0 border-hairline">
            {band.rows.map((row) => (
              <WalkItem
                key={row.id}
                row={row}
                orgId={orgId}
                locationId={locationId}
                runId={runId}
                writable={writable}
                onError={setFailed}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Re-exported so a caller needs one import. */
export type { WalkItemRow };
export { CHECK_STATUS_LABEL, readingLabel, statusForReading };
export type { CheckStatus };
