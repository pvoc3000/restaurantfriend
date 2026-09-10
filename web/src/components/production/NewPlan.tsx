"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { TextInput } from "@/components/ui/TextInput";
import { PickList } from "@/components/ui/PickList";
import { defaultKitchenStrip } from "@/lib/productionPlans";
import { DateField } from "@/components/ui/DateField";

/**
 * A new plan — `NewEmployee`'s template.
 *
 * It asks for the three things a plan cannot be without: what it is called,
 * where it SELLS, and when it starts. The trays come next, on the record,
 * because building a display case is the work rather than a field.
 *
 * IT NO LONGER ASKS WHERE IT IS MADE (migration 101). A plan's kitchen is now
 * per WEEKDAY, edited in the matrix's own column headers, so there is nothing
 * here that could ask the question once and be right — and a field that set all
 * seven days would be the second answer 101 exists to remove. Every day starts
 * at the selling shop, which is what the old field defaulted to anyway.
 */
export function NewPlan({
  orgId,
  locations,
  today,
}: {
  orgId: string;
  /** Active locations only — design rule 3. */
  locations: { id: string; code: string; name: string }[];
  today: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [locationId, setLocationId] = useState("");
  const [startsOn, setStartsOn] = useState<string | null>(today);
  const [endsOn, setEndsOn] = useState<string | null>(null);

  const ready = title.trim() !== "" && locationId !== "" && !!startsOn;

  function close() {
    if (pending) return;
    setOpen(false);
    setTitle(""); setLocationId("");
    setStartsOn(today); setEndsOn(null); setFailed(null);
  }

  function add() {
    if (!ready) return;
    setFailed(null);
    start(async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("production_plans")
        .insert({
          org_id: orgId,                 // explicitly — design rule 1
          location_id: locationId,
          // SEVEN EXPLICIT COPIES OF THE SELLING SHOP, never null (101). It
          // costs nothing and it keeps `kitchen_assumed` meaning "nobody said"
          // — left null, the generation receipt would carry that warning per
          // item per day for every ordinary day, which is the noise that
          // teaches people to stop reading receipts.
          kitchen_by_weekday: defaultKitchenStrip(locationId),
          title: title.trim(),
          starts_on: startsOn,
          ends_on: endsOn,
        })
        .select("id")
        .single();
      if (error || !data) {
        setFailed(error?.message ?? "The plan could not be created.");
        return;
      }
      router.refresh();
      router.push(`/plans/${data.id as string}`);
    });
  }

  const options = locations.map((l) => ({ value: l.id, label: l.code, hint: l.name }));

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-9 shrink-0 items-center whitespace-nowrap mac-control border border-ink bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink transition-colors hover:bg-ink hover:text-white"
      >
        New plan
      </button>

      {open && (
        <Dialog
          title="New plan"
          onClose={close}
          busy={pending}
          // Enter commits, guarded by exactly what the commit button's
          // `disabled` asks — an Enter that fires a refused write is worse
          // than one that does nothing.
          onSubmit={() => {
            if (ready && !pending) add();
          }}
          width="max-w-lg"
          footer={
            <>
              <button type="button" onClick={close} disabled={pending} className={DIALOG_CANCEL_CLASS}>
                Cancel
              </button>
              <button
                type="button"
                onClick={add}
                disabled={!ready || pending}
                className={DIALOG_COMMIT_CLASS}
              >
                {pending ? "Creating…" : "Create plan"}
              </button>
            </>
          }
        >
          <div className="space-y-5">
            <Field label="Title">
              <TextInput
                value={title}
                onValueChange={setTitle}
                placeholder="October"
                aria-label="Plan title"
                autoFocus
              />
            </Field>

            <Field label="Sells at">
              <PickList
                variant="field"
                ariaLabel="Selling location"
                value={locationId}
                onPick={setLocationId}
                options={options}
                placeholder="Which shop…"
              />
            </Field>

            <div className="flex flex-wrap gap-6">
              <Field label="Starts">
                <DateField value={startsOn} onChange={setStartsOn} ariaLabel="Starts on" />
              </Field>
              <Field label="Ends">
                <DateField value={endsOn} onChange={setEndsOn} ariaLabel="Ends on" />
                <p className="text-[13px] text-muted">Leave empty to run until you say otherwise.</p>
              </Field>
            </div>

            {failed ? <p className="text-[13px] text-accent">{failed}</p> : null}
          </div>
        </Dialog>
      )}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
        {label}
      </span>
      {children}
    </div>
  );
}
