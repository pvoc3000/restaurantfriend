"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { TextInput } from "@/components/ui/TextInput";
import { PickList } from "@/components/ui/PickList";
import { BUTTON_CLASS } from "@/components/ui/buttons";

/**
 * Open a shop — `NewEmployee`'s template, and the first thing in this app that
 * has ever inserted a `locations` row. 001 created the table with a generic
 * purchaser+ write policy, so no migration was needed; what was missing was a
 * door.
 *
 * IT ASKS FOR THE THREE THINGS EVERY OTHER SCREEN READS and stops. The code is
 * what the masthead shows and what every list's count line leads with; the name
 * is what the picker and the PO's ship-to print; the kind decides whether this
 * is a building or a book (EVENT and ONLINE are virtual). The addresses, hours,
 * tax rate, labour rate, registers and production mapping are all
 * `InlineValue`s on the record, which is where they are already edited — a
 * create form that also set them would be a second editor to keep in step.
 *
 * THE CODE IS UPPERCASED AS YOU TYPE, visibly rather than on the way to the
 * database. Every existing code is upper case, `unique (org_id, code)` is
 * CASE-SENSITIVE, and "df01" beside "DF01" is two shops that read as one.
 *
 * A DUPLICATE CODE DISABLES THE COMMIT rather than warning, which is the
 * opposite of `findPossibleRehires` and right for the opposite reason: that
 * check is about a record which may legitimately exist twice, and this one
 * cannot exist at all — the unique index would refuse it. The error is mapped
 * anyway, as the backstop for a code added in another tab.
 */
export function NewLocation({ orgId, existingCodes }: { orgId: string; existingCodes: string[] }) {
  const router = useRouter();
  const supabase = createClient();

  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"physical" | "virtual">("physical");

  const taken = existingCodes.some((c) => c.toUpperCase() === code.trim());
  const ready = code.trim() !== "" && name.trim() !== "" && !taken;

  function close() {
    if (pending) return;
    setOpen(false);
    setCode("");
    setName("");
    setKind("physical");
    setFailed(null);
  }

  function add() {
    if (!ready) return;
    setFailed(null);
    startTransition(async () => {
      const { data, error } = await supabase
        .from("locations")
        .insert({
          // EXPLICITLY (design rule 1): a WITH CHECK is evaluated before the
          // NOT NULL, so an omitted org_id reports as an RLS violation and
          // sends you looking at roles.
          org_id: orgId,
          code: code.trim(),
          name: name.trim(),
          kind,
        })
        .select("id")
        .single();

      if (error || !data) {
        setFailed(
          /duplicate key|unique/.test(error?.message ?? "")
            ? `There is already a location with the code ${code.trim()}.`
            : error?.message ?? "The location could not be created."
        );
        return;
      }

      router.refresh();
      router.push(`/locations/${data.id as string}`);
    });
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={BUTTON_CLASS}>
        New location
      </button>

      {open && (
        <Dialog
          title="New location"
          onClose={close}
          busy={pending}
          onSubmit={() => {
            if (ready && !pending) add();
          }}
          width="max-w-lg"
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
                {pending ? "Adding…" : "Add location"}
              </button>
            </>
          }
        >
          <div className="space-y-5">
            <Field label="Code">
              <TextInput
                value={code}
                onValueChange={(next) => setCode(next.toUpperCase())}
                placeholder="DF06"
                aria-label="Location code"
                autoFocus
              />
              {taken ? (
                <p className="text-sm">
                  <span className="bg-mark-fill px-1">
                    {code.trim()} is already in use.
                  </span>
                </p>
              ) : null}
            </Field>

            <Field label="Name">
              <TextInput
                value={name}
                onValueChange={setName}
                placeholder="Donut Friend 06 Pasadena"
                aria-label="Location name"
              />
            </Field>

            <Field label="Kind">
              <PickList
                variant="field"
                value={kind}
                onPick={(v) => setKind(v as "physical" | "virtual")}
                options={[
                  { value: "physical", label: "Physical", hint: "a building you walk into" },
                  { value: "virtual", label: "Virtual", hint: "off-site events, the online store" },
                ]}
                ariaLabel="Kind"
              />
            </Field>

            <p className="text-[13px] text-muted">
              It opens ACTIVE. The addresses, hours, tax and labour rates and the
              production mapping are set on the record.
            </p>

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
