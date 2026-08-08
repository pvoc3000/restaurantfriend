"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { TextInput } from "@/components/ui/TextInput";
import { PickList } from "@/components/ui/PickList";
import { DateField } from "@/components/ui/DateField";

/**
 * A new plan — `NewEmployee`'s template.
 *
 * It asks for the four things a plan cannot be without: what it is called,
 * where it SELLS, where it is MADE, and when it starts. The trays come next, on
 * the record, because building a display case is the work rather than a field.
 *
 * The kitchen defaults to the selling shop, which is true of most plans and
 * makes the exception — decision 9's whole reason for existing — an explicit
 * choice rather than something you have to remember to check.
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
  const [kitchenId, setKitchenId] = useState("");
  const [startsOn, setStartsOn] = useState<string | null>(today);
  const [endsOn, setEndsOn] = useState<string | null>(null);

  const ready = title.trim() !== "" && locationId !== "" && !!startsOn;

  function close() {
    if (pending) return;
    setOpen(false);
    setTitle(""); setLocationId(""); setKitchenId("");
    setStartsOn(today); setEndsOn(null); setFailed(null);
  }

  function pickLocation(id: string) {
    setLocationId(id);
    // Default the kitchen to the shop, but never overwrite a deliberate choice.
    if (!kitchenId) setKitchenId(id);
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
          kitchen_location_id: kitchenId || null,
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
        className="inline-flex h-9 shrink-0 items-center whitespace-nowrap border border-ink bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink transition-colors hover:bg-ink hover:text-white"
      >
        New plan
      </button>

      {open && (
        <Dialog
          title="New plan"
          onClose={close}
          busy={pending}
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
                onPick={pickLocation}
                options={options}
                placeholder="Which shop…"
              />
            </Field>

            <Field label="Made at">
              <PickList
                variant="field"
                ariaLabel="Kitchen"
                value={kitchenId}
                onPick={setKitchenId}
                options={options}
                placeholder="Which kitchen…"
              />
              <p className="text-[13px] text-muted">
                Usually the same shop. Set a different kitchen when one shop
                makes part of another&rsquo;s menu — that plan&rsquo;s items then
                appear on the kitchen&rsquo;s own paperwork.
              </p>
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
