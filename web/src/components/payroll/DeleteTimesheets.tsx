"use client";

import type { ReactNode } from "react";
import type { ActionMenuItem } from "@/components/ui/ActionMenu";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_DANGER_CLASS } from "@/components/ui/Dialog";
import { Radio } from "@/components/ui/Radio";

type Scope = "all" | "imported" | "manual";

/**
 * Clear a pay period's timesheets, in bulk (Mark, 2026-09-29: "add the ability
 * to delete timesheets from a pay period").
 *
 * The case it exists for is a bad import — the wrong file, or one read before
 * the importer learned something (the wage rate, the same day) — where the
 * clean answer is to empty the period and import again. THREE SCOPES because
 * the two sources are replaced differently: an imported row comes back on the
 * next import, a hand-entered one comes back only if somebody types it again.
 *
 * "Imported" is every source but `manual`. In an open period that means
 * Homebase; FileMaker's history all sits in closed periods, which 028's
 * policies make undeletable anyway.
 *
 * What goes with the rows: their benefit accruals (033, `on delete cascade`).
 * What stays: meal-break premium decisions and tip pools, which are keyed by
 * person-and-day or shop-and-day rather than by row — so a re-import finds
 * them again rather than having to decide them twice.
 */
export function DeleteTimesheets({
  periodId,
  periodLabel,
  editable,
  importedCount,
  manualCount,
  children,
}: {
  periodId: string;
  periodLabel: string;
  /** The period is open or in review — 028's write policies. */
  editable: boolean;
  importedCount: number;
  manualCount: number;
  /** Hand this component's row to an `ActionMenu` instead of drawing a
   *  button — `OrderCommandMenu`'s arrangement, so the dialog, its writes and
   *  its confirms stay here and only the command's PLACE moves. */
  children: (items: ActionMenuItem[]) => ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<Scope>("imported");
  const [failed, setFailed] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const total = importedCount + manualCount;
  const count = scope === "all" ? total : scope === "imported" ? importedCount : manualCount;
  const noun = (n: number) => `${n} timesheet${n === 1 ? "" : "s"}`;

  function close() {
    if (pending) return;
    setOpen(false);
    setFailed(null);
  }

  function run() {
    if (count === 0 || pending) return;
    setFailed(null);
    startTransition(async () => {
      let q = createClient()
        .from("timesheets")
        .delete({ count: "exact" })
        .eq("pay_period_id", periodId);
      if (scope === "imported") q = q.neq("source", "manual");
      if (scope === "manual") q = q.eq("source", "manual");
      const { error, count: deleted } = await q;
      if (error) {
        setFailed(error.message);
        return;
      }
      // A delete RLS refuses — a period no longer open — matches zero rows and
      // returns no error. Say so rather than closing on a success that wasn't.
      if (!deleted) {
        setFailed("Nothing was deleted — this pay period may no longer be open.");
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      {children([
        {
          label: "Delete Timesheets…",
          disabled: !editable || total === 0,
          onSelect: () => {
            // Open on the scope that has something in it.
            setScope(importedCount > 0 ? "imported" : "manual");
            setOpen(true);
          },
        },
      ])}

      {open && (
        <Dialog
          title={`Delete timesheets · ${periodLabel}`}
          onClose={close}
          busy={pending}
          width="max-w-xl"
          // No `onSubmit`: Enter must not delete (ui/Dialog's rule for a
          // destructive commit).
          footer={
            <>
              <button type="button" onClick={close} disabled={pending} className={DIALOG_CANCEL_CLASS}>
                Cancel
              </button>
              <button
                type="button"
                onClick={run}
                disabled={pending || count === 0}
                className={DIALOG_DANGER_CLASS}
              >
                {pending ? "Deleting…" : `Delete ${noun(count)}`}
              </button>
            </>
          }
        >
          <div className="space-y-5">
            <Radio
              ariaLabel="Which timesheets"
              vertical
              value={scope}
              onChange={setScope}
              options={[
                { value: "all", label: `All Timesheets (${total})` },
                { value: "imported", label: `Imported Timesheets (${importedCount})` },
                { value: "manual", label: `Manually Entered Timesheets (${manualCount})` },
              ]}
            />

            <p className="max-w-[60ch] text-sm text-muted">
              {scope === "manual"
                ? "Hand-entered rows cannot be brought back — they would have to be typed again."
                : scope === "imported"
                  ? "Importing this period’s Homebase files again brings them back, with any overtime decisions made since reset to Homebase’s figures."
                  : "Imported rows come back by importing again; hand-entered ones would have to be typed again."}{" "}
              Meal-break decisions and tip figures are kept.
            </p>

            {failed && (
              <p className="border border-accent px-4 py-3 text-sm text-accent">{failed}</p>
            )}
          </div>
        </Dialog>
      )}
    </>
  );
}
