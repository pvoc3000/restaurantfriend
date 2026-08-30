"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import { TextInput } from "@/components/ui/TextInput";
import { PickList } from "@/components/ui/PickList";
import { PickSet } from "@/components/ui/PickSet";
import { BOXED_FIELD, BOXED_FIELDS } from "@/components/ui/fieldMetrics";
import { SHIFT_SLOT_LABEL, SHIFT_SLOT_OPTIONS } from "@/lib/employeeEvents";
import {
  CHECKLIST_KIND_HINT,
  CHECKLIST_KIND_LABEL,
  WEEKDAY_ABBR,
  type ChecklistKind,
} from "@/lib/checklists";

const KINDS: ChecklistKind[] = ["checklist", "walkthrough", "inspection"];

/**
 * Start a master list.
 *
 * It asks for the ROSTER fields only — the ones the list itself groups and
 * filters by — and leaves everything else to the record's inline cells.
 * `NewEmployee`'s rule, and for its reason: a second editor kept in step with
 * the first is a second place to forget something.
 *
 * IT CLOSES ON CREATE and lands you on the new record, because the next thing
 * you do is add its items. That is `NewSpecialOrder`'s ending rather than
 * `AddShopSection`'s stay-open one, and the distinction is whether you are
 * about to do the same thing again: you seed a shop's whole walk order in a
 * sitting, but you write one checklist and then fill it in.
 */
export function NewChecklistTemplate({
  orgId,
  locationId,
  locationCode,
}: {
  orgId: string;
  locationId: string;
  locationCode: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ChecklistKind>("checklist");
  const [weekdays, setWeekdays] = useState<string[]>([]);
  const [shifts, setShifts] = useState<string[]>([]);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  const canCommit = name.trim().length > 0 && !busy;

  function reset() {
    setName("");
    setKind("checklist");
    setWeekdays([]);
    setShifts([]);
    setFailed(null);
  }

  function create() {
    if (!canCommit) return;
    setFailed(null);
    startTransition(async () => {
      const { data, error } = await supabase
        .from("checklist_templates")
        .insert({
          // EVERY insert passes org_id explicitly. No table in this schema has
          // a default or a trigger for it, and an omitted one arrives null,
          // fails the insert policy's WITH CHECK, and reports "violates
          // row-level security policy" — which sends you to look at roles when
          // the fault is a missing column.
          org_id: orgId,
          location_id: locationId,
          kind,
          name: name.trim(),
          // An EMPTY set is stored as NULL, never as `{}`. 076 refuses the
          // empty array precisely so there is one spelling of "any", and
          // `PickSet` hands back `[]` for "all".
          weekdays: weekdays.length ? weekdays.map(Number) : null,
          shifts: shifts.length ? shifts : null,
        })
        // `.select()` its own result: a write that matches no policy inserts
        // nothing and returns NO error, so a bare insert would report a
        // cheerful success and navigate to a record that doesn't exist.
        .select("id")
        .single();

      if (error || !data) {
        setFailed(error?.message ?? "The list was not created.");
        return;
      }
      setOpen(false);
      reset();
      router.push(`/checklist-templates/${data.id}`);
    });
  }

  const field = BOXED_FIELDS ? BOXED_FIELD : "w-full";

  return (
    <>
      <button type="button" className={BUTTON_CLASS} onClick={() => setOpen(true)}>
        New master list
      </button>

      {open && (
        <Dialog
          title="New master list"
          onClose={() => {
            setOpen(false);
            reset();
          }}
          width="max-w-lg"
          busy={busy}
          // Enter commits, guarded by the same test the button's `disabled`
          // uses — an Enter that fires a refused write is worse than one that
          // does nothing.
          onSubmit={canCommit ? create : undefined}
          footer={
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                className={DIALOG_CANCEL_CLASS}
                onClick={() => {
                  setOpen(false);
                  reset();
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className={DIALOG_COMMIT_CLASS}
                onClick={create}
                disabled={!canCommit}
              >
                Create
              </button>
            </div>
          }
        >
          <div className="space-y-5">
            <label className="block space-y-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                Name
              </span>
              <TextInput
                value={name}
                onValueChange={setName}
                fullWidth
                autoFocus
                placeholder={`${locationCode} Closing`}
                aria-label="Name"
              />
            </label>

            <div className="space-y-1.5">
              <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                Kind
              </span>
              <PickList
                variant="field"
                value={kind}
                ariaLabel="Kind"
                boxed={BOXED_FIELDS}
                className={field}
                options={KINDS.map((k) => ({
                  value: k,
                  label: CHECKLIST_KIND_LABEL[k],
                  hint: CHECKLIST_KIND_HINT[k],
                }))}
                onPick={(v) => setKind(v as ChecklistKind)}
              />
            </div>

            <div className="space-y-1.5">
              <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                Days
              </span>
              <PickSet
                label="Days"
                noun="day"
                allLabel="Not scheduled"
                boxed={BOXED_FIELDS}
                value={weekdays}
                onChange={setWeekdays}
                options={WEEKDAY_ABBR.map((d, i) => ({
                  value: String(i + 1),
                  label: d,
                }))}
              />
              <p className="text-[12px] text-muted">
                Leave it empty for a list nobody is prompted for — a
                walkthrough or an inspection, started by hand.
              </p>
            </div>

            <div className="space-y-1.5">
              <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                Shifts
              </span>
              <PickSet
                label="Shifts"
                noun="shift"
                allLabel="Any shift"
                boxed={BOXED_FIELDS}
                value={shifts}
                onChange={setShifts}
                options={SHIFT_SLOT_OPTIONS.map((o) => ({
                  value: String(o.value),
                  label: SHIFT_SLOT_LABEL[o.value as never] ?? String(o.label),
                }))}
              />
            </div>

            {failed && <p className="text-sm text-accent">{failed}</p>}
          </div>
        </Dialog>
      )}
    </>
  );
}
