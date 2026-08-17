"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import { TextInput } from "@/components/ui/TextInput";
import { PickList } from "@/components/ui/PickList";
import { DateField } from "@/components/ui/DateField";
import { KIND_LABEL, type SpecialOrderKind } from "@/lib/specialOrders";

/**
 * Start an order — `NewEmployee`'s template, which CLAUDE.md names as the one
 * every create in this app follows: a command right-aligned in the list's
 * filter row, a `ui/Dialog`, an insert, and you land on the new record.
 *
 * IT ASKS FOR ALMOST NOTHING, and that is the design rather than an unfinished
 * form. An order acquires a customer, a date, lines, money and a kitchen as
 * the conversation happens; the record screen edits every one of those in
 * place. What this needs is enough to exist and be findable — which for a
 * LEAD is the title somebody will search for.
 *
 * The three paths that are NOT this button, so nobody adds them here:
 *   · the public inquiry form (decision 18) creates a lead with no login;
 *   · pasting an inquiry email (decision 10) creates one from a parse;
 *   · Duplicate on an existing order (decision 13) covers templates, standing
 *     orders and "same as last year".
 */
export function NewSpecialOrder({
  kitchens,
}: {
  /** Active shops — design rule 3: you cannot plan work at a closed one. */
  kitchens: { id: string; code: string }[];
}) {
  const router = useRouter();
  const supabase = createClient();

  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);

  const [kind, setKind] = useState<SpecialOrderKind>("order");
  const [title, setTitle] = useState("");
  const [eventDate, setEventDate] = useState<string | null>(null);
  const [kitchenId, setKitchenId] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");

  // A title is the only thing asked for, because it is the only thing that
  // makes the row findable before anything else is known.
  const ready = title.trim() !== "";

  function reset() {
    setKind("order");
    setTitle("");
    setEventDate(null);
    setKitchenId("");
    setContactName("");
    setContactPhone("");
    setContactEmail("");
    setFailed(null);
  }

  function close() {
    if (pending) return;
    setOpen(false);
    reset();
  }

  const orNull = (s: string) => (s.trim() === "" ? null : s.trim());

  function add() {
    if (!ready) return;
    setFailed(null);
    startTransition(async () => {
      // The org comes from the number function's own answer being scoped to
      // it, so ask for the number first: `next_special_order_number` is a
      // definer that re-checks supervisor+ membership, which means a refusal
      // here is a role problem stated plainly rather than an RLS insert
      // failure reading "new row violates row-level security policy".
      const { data: org, error: orgError } = await supabase
        .from("org_members")
        .select("org_id")
        .maybeSingle();
      if (orgError || !org) {
        setFailed(orgError?.message ?? "Could not resolve your organisation.");
        return;
      }

      const { data: number, error: numberError } = await supabase.rpc(
        "next_special_order_number",
        { p_org_id: org.org_id }
      );
      if (numberError || !number) {
        setFailed(numberError?.message ?? "Could not allocate an order number.");
        return;
      }

      const { data, error } = await supabase
        .from("special_orders")
        .insert({
          // EXPLICIT, always — no table in this schema defaults it, and a
          // WITH CHECK is evaluated before the NOT NULL, so omitting it
          // reports an RLS violation and sends you looking at roles
          // (design rule 1's hard-won lesson).
          org_id: org.org_id,
          number,
          kind,
          // Decision 3's biconditional: status exists exactly when kind is
          // `order`. The database enforces it; this is the app agreeing.
          status: kind === "order" ? "lead" : null,
          title: title.trim(),
          event_date: eventDate,
          kitchen_location_id: orNull(kitchenId),
          contact_name: orNull(contactName),
          contact_phone: orNull(contactPhone),
          contact_email: orNull(contactEmail),
          // Decision 4: the app suggests and never writes the to-do. This one
          // is the exception that proves it — a brand-new lead's to-do is not
          // a guess about a workflow, it is what the button just created.
          todo: kind === "order" ? "Respond to Email/Call" : null,
          source: "app",
        })
        .select("id")
        .single();

      if (error || !data) {
        setFailed(error?.message ?? "The order could not be created.");
        return;
      }

      router.refresh();
      router.push(`/special-orders/${data.id as string}`);
    });
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={BUTTON_CLASS}>
        New special order
      </button>

      {open && (
        <Dialog
          title="New special order"
          onClose={close}
          busy={pending}
          onSubmit={() => {
            if (ready && !pending) add();
          }}
          width="max-w-2xl"
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
                {pending ? "Creating…" : "Create"}
              </button>
            </>
          }
        >
          <div className="space-y-5">
            <Field label="What is it" required>
              <TextInput
                value={title}
                onValueChange={setTitle}
                placeholder="Ruiz wedding, 8/30"
                aria-label="What the order is for"
                autoFocus
                className="w-full"
              />
            </Field>

            <div className="grid grid-cols-2 gap-x-6 gap-y-4">
              <Field label="Kind">
                <PickList
                  value={kind}
                  onPick={(next) => setKind((next || "order") as SpecialOrderKind)}
                  variant="field"
                  ariaLabel="Kind of record"
                  options={(["order", "template", "standing_order"] as SpecialOrderKind[]).map((k) => ({
                    value: k,
                    label: KIND_LABEL[k],
                    hint:
                      k === "order"
                        ? "a real order, starting as a lead"
                        : k === "template"
                          ? "a shape to duplicate from"
                          : "recurring wholesale, materialized by weekday",
                  }))}
                  className="w-full"
                />
              </Field>
              <Field label="Event date">
                {/* A lead routinely has no date yet — that is often the first
                    question. `ui/DateField`, never a bare date input: it
                    carries the Safari empty-date apparatus, and this box
                    starts EMPTY, which is exactly where that bug bites. */}
                <DateField
                  value={eventDate}
                  onChange={setEventDate}
                  ariaLabel="Event date"
                  className="w-full"
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-x-6 gap-y-4">
              <Field label="Kitchen">
                <PickList
                  value={kitchenId}
                  onPick={setKitchenId}
                  variant="field"
                  placeholder="Not decided"
                  ariaLabel="Kitchen"
                  options={[
                    { value: "", label: "Not decided" },
                    ...kitchens.map((k) => ({ value: k.id, label: k.code })),
                  ]}
                  className="w-full"
                />
              </Field>
              <Field label="Contact">
                <TextInput
                  value={contactName}
                  onValueChange={setContactName}
                  placeholder="Who to call"
                  aria-label="Contact name"
                  className="w-full"
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-x-6 gap-y-4">
              <Field label="Phone">
                <TextInput value={contactPhone} onValueChange={setContactPhone} aria-label="Contact phone" className="w-full" />
              </Field>
              <Field label="Email">
                <TextInput value={contactEmail} onValueChange={setContactEmail} aria-label="Contact email" className="w-full" />
              </Field>
            </div>

            <p className="text-[13px] text-muted">
              The customer, the lines and the money are set on the record. An
              order starts as a <strong>lead</strong>.
            </p>

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
    <label className="block space-y-1.5">
      <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
        {label}
        {required ? <span className="text-accent"> *</span> : null}
      </span>
      {children}
    </label>
  );
}
