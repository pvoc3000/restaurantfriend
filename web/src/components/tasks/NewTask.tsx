"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import { TextInput } from "@/components/ui/TextInput";
import { PickList } from "@/components/ui/PickList";
import { Checkbox } from "@/components/ui/Checkbox";
import { BOXED_FIELD, BOXED_FIELDS } from "@/components/ui/fieldMetrics";
import { SHIFT_SLOT_LABEL, SHIFT_SLOT_OPTIONS } from "@/lib/employeeEvents";
import { TASK_PRIORITY_LABEL, type TaskKind, type TaskPriority } from "@/lib/facilityTasks";

/**
 * File a task by hand — the third door into the table, beside a checklist issue
 * and a walkthrough finding.
 */
export function NewTask({
  kind,
  orgId,
  locationId,
  equipment,
  sections,
}: {
  kind: TaskKind;
  orgId: string;
  locationId: string;
  equipment: { id: string; name: string; shop_section_id: string | null }[];
  sections: { id: string; display_name: string }[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("normal");
  const [shift, setShift] = useState("");
  const [equipmentId, setEquipmentId] = useState("");
  const [sectionId, setSectionId] = useState("");
  // Whether the section on screen was filled in BY US rather than chosen.
  // Picking a fryer fills in where the fryer stands (Mark, 2026-08-30) — but a
  // section somebody typed is theirs, so it is never overwritten, and changing
  // equipment only moves a section this flag says we put there. Same shape as
  // `createSpecialOrder` seeding a contact: filled once, never slaved.
  const [sectionWasFilled, setSectionWasFilled] = useState(false);
  const [carry, setCarry] = useState(true);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  const canCommit = title.trim().length > 0 && !busy;

  function create() {
    if (!canCommit) return;
    setFailed(null);
    startTransition(async () => {
      const uid = (await supabase.auth.getUser()).data.user?.id ?? null;
      const { data, error } = await supabase
        .from("location_tasks")
        .insert({
          org_id: orgId,
          location_id: locationId,
          kind,
          title: title.trim(),
          details: details.trim() || null,
          priority,
          target_shift: shift || null,
          equipment_id: equipmentId || null,
          shop_section_id: sectionId || null,
          carry_forward: carry,
          created_by: uid,
        })
        .select("id");
      if (error || !data || data.length === 0) {
        setFailed(error?.message ?? "The task was not created.");
        return;
      }
      setOpen(false);
      setTitle("");
      setDetails("");
      router.refresh();
    });
  }

  const field = BOXED_FIELDS ? BOXED_FIELD : "";
  const noun = kind === "maintenance" ? "maintenance request" : "task";

  return (
    <>
      <button type="button" className={BUTTON_CLASS} onClick={() => setOpen(true)}>
        New {noun}
      </button>

      {open && (
        <Dialog
          title={`New ${noun}`}
          onClose={() => setOpen(false)}
          width="max-w-lg"
          busy={busy}
          onSubmit={canCommit ? create : undefined}
          footer={
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                className={DIALOG_CANCEL_CLASS}
                onClick={() => setOpen(false)}
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
                What needs doing
              </span>
              <TextInput
                value={title}
                onValueChange={setTitle}
                fullWidth
                autoFocus
                aria-label="What needs doing"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                Details
              </span>
              <textarea
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                rows={3}
                aria-label="Details"
                className="w-full border border-ink bg-white px-2 py-1 text-sm outline-none focus:border-2"
              />
            </label>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                  Priority
                </span>
                <PickList
                  variant="field"
                  value={priority}
                  ariaLabel="Priority"
                  boxed={BOXED_FIELDS}
                  className={field}
                  options={(["high", "normal", "low"] as const).map((p) => ({
                    value: p,
                    label: TASK_PRIORITY_LABEL[p],
                  }))}
                  onPick={(v) => setPriority(v as TaskPriority)}
                />
              </div>
              <div className="space-y-1.5">
                <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                  Shift
                </span>
                <PickList
                  variant="field"
                  value={shift}
                  ariaLabel="Shift"
                  boxed={BOXED_FIELDS}
                  className={field}
                  options={[
                    { value: "", label: "Any shift" },
                    ...SHIFT_SLOT_OPTIONS.map((o) => ({
                      value: String(o.value),
                      label: SHIFT_SLOT_LABEL[o.value as never] ?? String(o.label),
                    })),
                  ]}
                  onPick={setShift}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                  About
                </span>
                <PickList
                  variant="field"
                  value={equipmentId}
                  ariaLabel="Equipment"
                  boxed={BOXED_FIELDS}
                  className={field}
                  options={[
                    { value: "", label: "Nothing in particular" },
                    ...equipment.map((e) => ({ value: e.id, label: e.name })),
                  ]}
                  onPick={(next) => {
                    setEquipmentId(next);
                    const where = equipment.find((e) => e.id === next)?.shop_section_id;
                    // Only when the field is empty or holds a value we put
                    // there. Clearing the equipment leaves the section alone:
                    // "where" is still true of the job even once it stops being
                    // about a particular machine.
                    if (where && (sectionId === "" || sectionWasFilled)) {
                      setSectionId(where);
                      setSectionWasFilled(true);
                    }
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                  Where
                </span>
                <PickList
                  variant="field"
                  value={sectionId}
                  ariaLabel="Section"
                  boxed={BOXED_FIELDS}
                  className={field}
                  options={[
                    { value: "", label: "No section" },
                    ...sections.map((s) => ({ value: s.id, label: s.display_name })),
                  ]}
                  onPick={(next) => {
                    setSectionId(next);
                    setSectionWasFilled(false);
                  }}
                />
              </div>
            </div>

            <Checkbox checked={carry} onChange={setCarry} label="Carry it forward">
              Put it on every checklist until it is done
            </Checkbox>

            {failed && <p className="text-sm text-accent">{failed}</p>}
          </div>
        </Dialog>
      )}
    </>
  );
}
