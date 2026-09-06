"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import { TextInput } from "@/components/ui/TextInput";
import { DateField } from "@/components/ui/DateField";
import { PickList } from "@/components/ui/PickList";
import { BOXED_FIELD, BOXED_FIELDS } from "@/components/ui/fieldMetrics";

/**
 * Record a visit (093). The fields the LIST reads and nothing more — date,
 * type, score, inspector — with the report, the violations and the follow-up
 * on the record it lands on (`NewEmployee`'s rule). Closes on commit.
 */
export function NewInspection({
  orgId,
  locationId,
  today,
  types,
}: {
  orgId: string;
  locationId: string;
  /** The org's calendar day, seeded as the default — an inspection is usually
   *  filed the day it happened, and never from `current_date`. */
  today: string;
  /** Every inspection type already recorded; the picker offers them and takes
   *  a new one (`allowNew`), 059's `todo` argument. */
  types: string[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState<string>(today);
  const [type, setType] = useState("Health");
  const [score, setScore] = useState("");
  const [inspector, setInspector] = useState("");
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  const canCommit = !!date && type.trim().length > 0 && !busy;

  function create() {
    if (!canCommit) return;
    setFailed(null);
    startTransition(async () => {
      const uid = (await supabase.auth.getUser()).data.user?.id ?? null;
      const { data, error } = await supabase
        .from("inspections")
        .insert({
          org_id: orgId,
          location_id: locationId,
          inspected_on: date,
          inspection_type: type.trim(),
          score: score.trim() || null,
          inspector: inspector.trim() || null,
          created_by: uid,
        })
        .select("id")
        .single();
      if (error || !data) {
        setFailed(error?.message ?? "The inspection was not recorded.");
        return;
      }
      setOpen(false);
      router.push(`/inspection-logs/${data.id}?from=%2Finspection-logs&fromLabel=Inspection+logs`);
    });
  }

  const field = BOXED_FIELDS ? BOXED_FIELD : "";
  const options = [...new Set(["Health", ...types])].map((t) => ({ value: t, label: t }));

  return (
    <>
      <button type="button" className={`${BUTTON_CLASS} ml-auto`} onClick={() => setOpen(true)}>
        New inspection
      </button>
      {open && (
        <Dialog
          title="New inspection"
          onClose={() => setOpen(false)}
          width="max-w-md"
          busy={busy}
          onSubmit={canCommit ? create : undefined}
          footer={
            <div className="flex items-center justify-end gap-3">
              <button type="button" className={DIALOG_CANCEL_CLASS} onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button type="button" className={DIALOG_COMMIT_CLASS} onClick={create} disabled={!canCommit}>
                Record it
              </button>
            </div>
          }
        >
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                  Date
                </span>
                <DateField value={date} onChange={(v) => setDate(v ?? "")} ariaLabel="Inspection date" />
              </div>
              <div className="space-y-1.5">
                <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                  Type
                </span>
                <PickList
                  variant="field"
                  value={type}
                  ariaLabel="Inspection type"
                  boxed={BOXED_FIELDS}
                  className={field}
                  options={options}
                  allowNew
                  onPick={setType}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <label className="block space-y-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                  Score
                </span>
                <TextInput value={score} onValueChange={setScore} fullWidth aria-label="Score" />
              </label>
              <label className="block space-y-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                  Inspector
                </span>
                <TextInput value={inspector} onValueChange={setInspector} fullWidth aria-label="Inspector" />
              </label>
            </div>
            {failed && <p className="text-sm text-accent">{failed}</p>}
          </div>
        </Dialog>
      )}
    </>
  );
}
