"use client";

import { useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import {
  Dialog,
  DIALOG_CANCEL_CLASS,
  DIALOG_COMMIT_CLASS,
} from "@/components/ui/Dialog";
import { TextInput } from "@/components/ui/TextInput";
import { PickList } from "@/components/ui/PickList";
import { DateField } from "@/components/ui/DateField";
import {
  employeeDetailHref,
  employeeName,
  findPossibleRehires,
  STATUS_LABEL,
  STATUS_OPTIONS,
  SCHEDULE_OPTIONS,
  type EmployeeStatus,
} from "@/lib/employees";
import type { EmployeeRow } from "./EmployeesList";

/**
 * Hire someone — the app's first create form for a top-level record.
 *
 * It asks for the ROSTER fields and stops: the columns the list shows, groups
 * and filters by, because a record missing those is invisible in the roster's
 * own organizing scheme. Address, date of birth, employment type, food handler
 * expiry and notes are left to the detail screen, where `InlineValue` already
 * edits every one of them — a create form that restated all nineteen columns
 * would be a second editor to keep in step with the first.
 *
 * Which is also why it lands you on the new record rather than closing: hiring
 * someone is more than a row, and the next two steps — filing their paperwork
 * and giving them app access — are already blocks on that screen. Per
 * `docs/hr-access-brief.md` §0, an employee and a user are two records; granting
 * access is a separate action taken on the record afterwards, never a field on
 * this form.
 *
 * Status defaults to NEW HIRE, which is the whole point of the button.
 */
export function NewEmployee({
  orgId,
  /** Every employee on the roster — the FULL set, for the rehire check. */
  roster,
  /** Where someone can be hired to: active locations only (design rule 3). */
  locationOptions,
  /** The positions already in use — the vocabulary, same as the filter's. */
  positions,
  /** The org's today, for the Started default. */
  today,
}: {
  orgId: string;
  roster: EmployeeRow[];
  locationOptions: { id: string; code: string; name: string }[];
  positions: string[];
  today: string;
}) {
  const router = useRouter();
  const supabase = createClient();

  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [nickname, setNickname] = useState("");
  const [status, setStatus] = useState<EmployeeStatus>("new_hire");
  const [locationId, setLocationId] = useState("");
  const [position, setPosition] = useState("");
  const [schedule, setSchedule] = useState("");
  const [startDate, setStartDate] = useState<string | null>(today);
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  // First and last are the only NOT NULLs without a default (migration 020).
  const ready = firstName.trim() !== "" && lastName.trim() !== "";

  // Costs no query: the list already holds all 445 rows, former employees
  // included — which is the set that matters, since a rehire is by definition
  // inactive.
  const rehires = findPossibleRehires(roster, firstName, lastName);

  function reset() {
    setFirstName("");
    setLastName("");
    setNickname("");
    setStatus("new_hire");
    setLocationId("");
    setPosition("");
    setSchedule("");
    setStartDate(today);
    setPhone("");
    setEmail("");
    setFailed(null);
  }

  function close() {
    if (pending) return;
    setOpen(false);
    reset();
  }

  /** "" from a cleared TextInput or PickList is a blank, and a blank is null. */
  const orNull = (s: string) => (s.trim() === "" ? null : s.trim());

  function add() {
    if (!ready) return;
    setFailed(null);
    startTransition(async () => {
      const { data, error } = await supabase
        .from("employees")
        .insert({
          org_id: orgId,
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          nickname: orNull(nickname),
          status,
          main_location_id: orNull(locationId),
          position: orNull(position),
          schedule: orNull(schedule),
          start_date: startDate,
          phone: orNull(phone),
          email: orNull(email),
        })
        .select("id")
        .single();

      if (error || !data) {
        setFailed(error?.message ?? "The record could not be created.");
        return;
      }

      // Refresh before navigating so the roster behind us already has them when
      // the breadcrumb comes back to it.
      router.refresh();
      router.push(employeeDetailHref(data.id as string));
    });
  }

  return (
    <>
      {/* Outlined, like every other button in the app — black fill is reserved
          for a SET FILTER (see CLAUDE.md's button rule, swept 2026-08-02). This
          shipped black and was wrong: a filled cell among outlined ones reads as
          a different KIND of control rather than as the important one, and it
          sat inches from a TabPicker whose black cell means "selected". */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="ml-auto inline-flex h-9 shrink-0 items-center whitespace-nowrap border border-ink bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink transition-colors hover:bg-ink hover:text-white disabled:opacity-35"
      >
        New employee
      </button>

      {open && (
        <Dialog
          title="New employee"
          onClose={close}
          busy={pending}
          width="max-w-2xl"
          footer={
            <>
              <button
                type="button"
                onClick={close}
                disabled={pending}
                className={DIALOG_CANCEL_CLASS}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={add}
                disabled={!ready || pending}
                className={DIALOG_COMMIT_CLASS}
              >
                {pending ? "Adding…" : "Add employee"}
              </button>
            </>
          }
        >
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-x-6 gap-y-4">
              <Field label="First name" required>
                <TextInput
                  value={firstName}
                  onValueChange={setFirstName}
                  aria-label="First name"
                  autoFocus
                  className="h-9 w-full text-sm"
                />
              </Field>
              <Field label="Last name" required>
                <TextInput
                  value={lastName}
                  onValueChange={setLastName}
                  aria-label="Last name"
                  className="h-9 w-full text-sm"
                />
              </Field>
            </div>

            {rehires.length > 0 && <RehireNotice matches={rehires} />}

            <div className="grid grid-cols-2 gap-x-6 gap-y-4">
              <Field label="Nickname">
                <TextInput
                  value={nickname}
                  onValueChange={setNickname}
                  aria-label="Nickname"
                  className="h-9 w-full text-sm"
                />
              </Field>
              <Field label="Status">
                <PickList
                  value={status}
                  options={STATUS_OPTIONS}
                  onPick={(next) => setStatus((next || "new_hire") as EmployeeStatus)}
                  variant="field"
                  ariaLabel="Status"
                  className="w-full"
                />
              </Field>

              <Field label="Main location">
                <PickList
                  value={locationId || null}
                  options={locationOptions.map((l) => ({
                    value: l.id,
                    label: l.code,
                    hint: l.name,
                  }))}
                  onPick={setLocationId}
                  variant="field"
                  placeholder="—"
                  ariaLabel="Main location"
                  className="w-full"
                />
              </Field>
              <Field label="Position">
                <PickList
                  value={position || null}
                  options={positions.map((p) => ({ value: p, label: p }))}
                  onPick={setPosition}
                  allowNew
                  variant="field"
                  placeholder="choose or type"
                  ariaLabel="Position"
                  className="w-full"
                />
              </Field>

              <Field label="Schedule">
                <PickList
                  value={schedule || null}
                  options={SCHEDULE_OPTIONS}
                  onPick={setSchedule}
                  variant="field"
                  placeholder="—"
                  ariaLabel="Schedule"
                  className="w-full"
                />
              </Field>
              <Field label="Started">
                {/* `ui/DateField`, never a bare <input type="date">: this box
                    starts EMPTY the moment you clear it, which is the state
                    Safari paints today's date into. */}
                <DateField
                  value={startDate}
                  onChange={setStartDate}
                  ariaLabel="Start date"
                />
              </Field>

              <Field label="Phone">
                <TextInput
                  value={phone}
                  onValueChange={setPhone}
                  type="tel"
                  aria-label="Phone"
                  className="h-9 w-full text-sm"
                />
              </Field>
              <Field label="Email">
                <TextInput
                  value={email}
                  onValueChange={setEmail}
                  type="email"
                  aria-label="Email"
                  className="h-9 w-full text-sm"
                />
              </Field>
            </div>

            <p className="text-sm text-muted">
              Address, date of birth, food handler card and notes are on the
              record — you&rsquo;ll land there next, where you can also file
              their paperwork and give them access to the app.
            </p>

            {failed && <p className="text-sm text-accent">{failed}</p>}
          </div>
        </Dialog>
      )}
    </>
  );
}

/**
 * Someone by this name has worked here before.
 *
 * It links out rather than offering to merge, and that IS the rehire flow:
 * clicking through abandons this form, which is the right outcome, because if
 * it's the same person you want their record back — not a second one carrying
 * none of their history. Setting them to Active is one cell on that screen, so
 * there is nothing else to build.
 */
function RehireNotice({ matches }: { matches: EmployeeRow[] }) {
  return (
    <div className="border border-ink bg-mark-fill px-3 py-2 text-sm text-ink">
      <p className="font-semibold">
        {matches.length === 1
          ? "Someone by that name is already on the roster."
          : "People by that name are already on the roster."}
      </p>
      <ul className="mt-1 space-y-0.5">
        {matches.map((m) => (
          <li key={m.id}>
            <Link
              href={employeeDetailHref(m.id)}
              className="underline decoration-neutral-500 underline-offset-[3px] hover:decoration-ink"
            >
              {employeeName(m)}
            </Link>
            <span className="text-muted">
              {" · "}
              {STATUS_LABEL[m.status]}
              {m.location_code ? ` · ${m.location_code}` : ""}
              {m.position ? ` · ${m.position}` : ""}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-1">
        Rehiring? Open their record and set them back to Active. Otherwise carry
        on — two people really can share a name.
      </p>
    </div>
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
