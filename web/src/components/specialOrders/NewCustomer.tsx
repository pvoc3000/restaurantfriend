"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import { TextInput } from "@/components/ui/TextInput";
import { customerLabel } from "@/lib/specialOrders";
import type { CustomerRow } from "./CustomersList";

/**
 * Add a customer — `NewEmployee`'s template again.
 *
 * IT WARNS ON A NEAR-MATCH AND LETS YOU THROUGH, which is
 * `findPossibleRehires`' rule and the right one here for a reason of its own:
 * 187 email addresses genuinely repeat across the 5,874 real customers
 * (families, offices, one person entered twice), and 138 rows have no email at
 * all. A unique constraint would refuse the honest cases and turn "is this the
 * same person?" into a database error.
 *
 * A MERGE TOOL IS DEFERRED (the brief's kill list). FileMaker has a Remove
 * Duplicates button; the precedent here is warn-and-let-through first, tooling
 * when the pile hurts.
 */
export function NewCustomer({
  orgId,
  roster,
}: {
  orgId: string;
  /** Every customer, for the duplicate check — the FULL set, not the filtered
   *  one, since a filter is exactly what would hide the match. */
  roster: CustomerRow[];
}) {
  const router = useRouter();
  const supabase = createClient();

  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [company, setCompany] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  // A person needs a name; a company needs a company. Either satisfies it,
  // because Cafe Knotted is a customer whose contact nobody has asked for yet.
  const ready = lastName.trim() !== "" || company.trim() !== "";

  /**
   * Possible duplicates — email first, then the exact name, then the company.
   * Email is the strongest signal and the one `create_inquiry` will match on,
   * so it leads.
   */
  const matches = useMemo(() => {
    const e = email.trim().toLowerCase();
    const last = lastName.trim().toLowerCase();
    const first = firstName.trim().toLowerCase();
    const co = company.trim().toLowerCase();
    if (!e && !last && !co) return [];
    return roster
      .filter((r) => {
        if (e && (r.email ?? "").toLowerCase() === e) return true;
        if (co && (r.company ?? "").toLowerCase() === co) return true;
        if (last && (r.last_name ?? "").toLowerCase() === last) {
          // A shared surname alone is noise in a 5,874-row book, so the first
          // name has to agree too — unless nobody typed one yet.
          return !first || (r.first_name ?? "").toLowerCase() === first;
        }
        return false;
      })
      .slice(0, 5);
  }, [roster, email, lastName, firstName, company]);

  function reset() {
    setFirstName("");
    setLastName("");
    setCompany("");
    setPhone("");
    setEmail("");
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
      const { data, error } = await supabase
        .from("customers")
        .insert({
          org_id: orgId, // Explicit — design rule 1.
          first_name: orNull(firstName),
          last_name: orNull(lastName),
          company: orNull(company),
          phone: orNull(phone),
          email: email.trim() ? email.trim().toLowerCase() : null,
          source: "app",
        })
        .select("id")
        .single();

      if (error || !data) {
        setFailed(error?.message ?? "The customer could not be created.");
        return;
      }
      router.refresh();
      router.push(`/customers/${data.id as string}`);
    });
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={BUTTON_CLASS}>
        New customer
      </button>

      {open && (
        <Dialog
          title="New customer"
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
              <button type="button" onClick={add} disabled={!ready || pending} className={DIALOG_COMMIT_CLASS}>
                {pending ? "Adding…" : "Add customer"}
              </button>
            </>
          }
        >
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-x-6 gap-y-4">
              <Field label="First name">
                <TextInput value={firstName} onValueChange={setFirstName} aria-label="First name" autoFocus className="w-full" />
              </Field>
              <Field label="Last name">
                <TextInput value={lastName} onValueChange={setLastName} aria-label="Last name" className="w-full" />
              </Field>
            </div>
            <Field label="Company">
              <TextInput value={company} onValueChange={setCompany} placeholder="Cafe Knotted" aria-label="Company" className="w-full" />
            </Field>
            <div className="grid grid-cols-2 gap-x-6 gap-y-4">
              <Field label="Phone">
                <TextInput value={phone} onValueChange={setPhone} aria-label="Phone" className="w-full" />
              </Field>
              <Field label="Email">
                <TextInput value={email} onValueChange={setEmail} aria-label="Email" className="w-full" />
              </Field>
            </div>

            {matches.length > 0 ? (
              <div className="border border-[var(--rf-yellow-600)] bg-[var(--rf-yellow-50)] p-3 text-[13px]">
                <p className="font-semibold">This may already be someone.</p>
                <ul className="mt-1 space-y-0.5">
                  {matches.map((m) => (
                    <li key={m.id}>
                      <Link href={`/customers/${m.id}`} className="underline underline-offset-2">
                        {customerLabel(m)}
                      </Link>
                      {m.email ? <span className="text-muted"> · {m.email}</span> : null}
                      <span className="text-muted"> · {m.orderCount} order{m.orderCount === 1 ? "" : "s"}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-muted">
                  Adding anyway is fine — plenty of families share an address
                  and an email.
                </p>
              </div>
            ) : null}

            <p className="text-[13px] text-muted">
              The address and any notes are set on the record. A name or a
              company is enough to start.
            </p>

            {failed && <p className="text-sm text-accent">{failed}</p>}
          </div>
        </Dialog>
      )}
    </>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
        {label}
      </span>
      {children}
    </label>
  );
}
