"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { DateField } from "@/components/ui/DateField";
import { TextInput } from "@/components/ui/TextInput";
import { PickList } from "@/components/ui/PickList";
import { AD_HOC_EVENT_KINDS, EVENT_KIND_LABEL, EVENT_KIND_OPTIONS } from "@/lib/employeeEvents";

/**
 * Record something that happened with this person.
 *
 * `AddEmployeeBenefit`'s template rather than `NewEmployee`'s: hiring somebody
 * is more than a row and lands you on their record, while an event is a child
 * row on the record you are already standing on, with nowhere to go. So it STAYS
 * OPEN and clears only the TEXT, keeping the kind, the date and the shop —
 * because the second thing you type is usually another note about the same
 * incident, not the same note about another day.
 *
 * The kinds it offers are `AD_HOC_EVENT_KINDS`, which is not every kind: `shift`
 * belongs to the batch shift log (deferred until the Production module brings
 * sales, tips and production counts to the same screen), and `document_note` is
 * a historical kind for FileMaker's 81 filing-cabinet rows — a new filing goes
 * to the Paperwork block, which has a bucket to put the file in.
 */
export function NewEmployeeEvent({
  employeeId,
  orgId,
  userId,
  authorEmployeeId,
  locations,
  today,
  outcomes,
}: {
  employeeId: string;
  orgId: string;
  userId: string;
  /** The signed-in person's own employee row, resolved on the server so this
   *  dialog never has to query for it. Null when they have no HR record. */
  authorEmployeeId: string | null;
  /** ACTIVE shops only — this enumerates somewhere an event happened, and a
   *  closed shop is not one (design rule 3). */
  locations: { id: string; code: string }[];
  today: string;
  /** Outcomes already in use, so the vocabulary grows without a migration —
   *  the item-category pattern this screen already uses for `position`. */
  outcomes: string[];
}) {
  const router = useRouter();
  const supabase = createClient();

  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<string>("note");
  const [occurredOn, setOccurredOn] = useState<string | null>(today);
  const [locationId, setLocationId] = useState("");
  const [headline, setHeadline] = useState("");
  const [detail, setDetail] = useState("");
  const [outcome, setOutcome] = useState("");
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);

  const ready = kind !== "" && occurredOn !== null && headline.trim() !== "";
  const orNull = (s: string) => (s.trim() === "" ? null : s.trim());

  function close() {
    if (pending) return;
    setOpen(false);
    setFailed(null);
    setAdded(null);
  }

  function add() {
    setFailed(null);
    startTransition(async () => {
      const { data, error } = await supabase
        .from("employee_events")
        .insert({
          // EXPLICITLY, always. A WITH CHECK runs before the NOT NULL
          // constraint, so omitting this arrives as null, `user_has_role(null,…)`
          // is not true, and Postgres reports "new row violates row-level
          // security policy" — which sends you hunting through roles when the
          // fault is a missing column (design rule 1).
          org_id: orgId,
          employee_id: employeeId,
          occurred_on: occurredOn,
          kind,
          location_id: orNull(locationId),
          headline: orNull(headline),
          detail: orNull(detail),
          outcome: orNull(outcome),
          author_employee_id: authorEmployeeId,
          created_by: userId,
          source: "app",
        })
        .select("id");

      if (error || (data ?? []).length === 0) {
        setFailed(error?.message ?? "Nothing was recorded.");
        return;
      }

      // Keep the kind, the date and the shop; clear what is specific to this one.
      setAdded(`${EVENT_KIND_LABEL[kind as keyof typeof EVENT_KIND_LABEL] ?? kind} recorded.`);
      setHeadline("");
      setDetail("");
      setOutcome("");
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-9 shrink-0 items-center whitespace-nowrap border border-ink bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink transition-colors hover:bg-ink hover:text-white disabled:opacity-35"
      >
        New event
      </button>

      {open && (
        <Dialog
          title="New event"
          onClose={close}
          busy={pending}
          width="max-w-2xl"
          footer={
            <>
              <button type="button" onClick={close} disabled={pending} className={DIALOG_CANCEL_CLASS}>
                Done
              </button>
              <button
                type="button"
                onClick={add}
                disabled={!ready || pending}
                className={DIALOG_COMMIT_CLASS}
              >
                {pending ? "Recording…" : "Add event"}
              </button>
            </>
          }
        >
          <div className="space-y-5">
            <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
              <Field label="Kind" required>
                <PickList
                  variant="field"
                  value={kind}
                  options={EVENT_KIND_OPTIONS.filter((o) =>
                    (AD_HOC_EVENT_KINDS as string[]).includes(o.value),
                  )}
                  onPick={setKind}
                  ariaLabel="Kind of event"
                  className="w-56"
                />
              </Field>
              <Field label="When" required>
                <DateField value={occurredOn} onChange={setOccurredOn} ariaLabel="When it happened" />
              </Field>
              <Field label="Where">
                <PickList
                  variant="field"
                  value={locationId}
                  options={[
                    { value: "", label: "—" },
                    ...locations.map((l) => ({ value: l.id, label: l.code })),
                  ]}
                  onPick={setLocationId}
                  ariaLabel="Which shop"
                  className="w-32"
                />
              </Field>
            </div>

            <Field label="What happened" required>
              <TextInput
                value={headline}
                onValueChange={setHeadline}
                aria-label="What happened"
                className="h-9 w-full text-sm"
              />
            </Field>

            <Field label="More detail">
              {/* One line, deliberately: there is no ui/TextArea in this app yet
                  and inventing a second bespoke control for one field is how the
                  parts list drifts. FileMaker's own detail field averages a
                  sentence or two, and a longer account belongs in a document. */}
              <TextInput
                value={detail}
                onValueChange={setDetail}
                aria-label="More detail"
                className="h-9 w-full text-sm"
              />
            </Field>

            <Field label="Action taken">
              <PickList
                variant="field"
                value={outcome}
                options={[
                  { value: "", label: "—" },
                  ...outcomes.map((o) => ({ value: o, label: o })),
                ]}
                onPick={setOutcome}
                allowNew
                ariaLabel="What was done about it"
                className="w-72"
              />
            </Field>

            {added && !failed && <p className="text-sm text-muted">{added}</p>}
            {failed && <p className="text-sm text-accent">{failed}</p>}
          </div>
        </Dialog>
      )}
    </>
  );
}

function Field({
  label,
  required = false,
  children,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="block text-[11px] uppercase tracking-[0.12em] text-subtle">
        {label}
        {required && <span className="text-accent"> *</span>}
      </span>
      {children}
    </label>
  );
}
