"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { TextInput } from "@/components/ui/TextInput";
import { PickList } from "@/components/ui/PickList";
import { ELEMENT_KIND_OPTIONS, type ElementKind } from "@/lib/production";

/**
 * Add an element — `NewEmployee`'s template: a command in the list's own row, a
 * Dialog, an insert carrying `org_id` EXPLICITLY (design rule 1: a WITH CHECK
 * is evaluated before the NOT NULL, so an omitted org_id reports as an RLS
 * violation and sends you looking at roles), then land on the new record.
 *
 * It asks for the CATALOG fields and stops. What an element costs from — the
 * inventory item, the manual amount, the recipe — is set on the record, where
 * `InlineValue` already edits every one of them and where the recipe has to be
 * created anyway. A create form that also chose the cost source would be a
 * second editor to keep in step with the first.
 */
export function NewElement({ orgId, types }: { orgId: string; types: string[] }) {
  const router = useRouter();
  const supabase = createClient();

  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [kind, setKind] = useState<ElementKind>("made");
  const [elementType, setElementType] = useState("");

  const ready = name.trim() !== "";

  function close() {
    if (pending) return;
    setOpen(false);
    setName("");
    setKind("made");
    setElementType("");
    setFailed(null);
  }

  function add() {
    if (!ready) return;
    setFailed(null);
    startTransition(async () => {
      const { data, error } = await supabase
        .from("production_elements")
        .insert({
          org_id: orgId,
          name: name.trim(),
          kind,
          element_type: elementType.trim() === "" ? null : elementType.trim(),
        })
        .select("id")
        .single();

      if (error || !data) {
        // 036 makes (org_id, name) unique — the identity the BOM groups by —
        // so say what happened rather than handing back the raw constraint.
        setFailed(
          /duplicate key|unique/.test(error?.message ?? "")
            ? `There is already an element called “${name.trim()}”.`
            : error?.message ?? "The element could not be created."
        );
        return;
      }

      router.refresh();
      router.push(`/elements/${data.id as string}`);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-9 shrink-0 items-center whitespace-nowrap border border-ink bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink transition-colors hover:bg-ink hover:text-white disabled:opacity-35"
      >
        New element
      </button>

      {open && (
        <Dialog
          title="New element"
          onClose={close}
          busy={pending}
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
                {pending ? "Adding…" : "Add element"}
              </button>
            </>
          }
        >
          <div className="space-y-5">
            <Field label="Name">
              <TextInput
                value={name}
                onValueChange={setName}
                placeholder="Strawberry Glaze"
                aria-label="Element name"
                autoFocus
              />
            </Field>

            <Field label="Kind">
              <PickList
                variant="field"
                value={kind}
                onPick={(v) => setKind(v as ElementKind)}
                options={ELEMENT_KIND_OPTIONS}
                ariaLabel="Kind"
              />
            </Field>

            <Field label="Type">
              <PickList
                variant="field"
                value={elementType}
                onPick={setElementType}
                options={types.map((t) => ({ value: t, label: t }))}
                allowNew
                ariaLabel="Type"
                placeholder="Glaze, Topping, Cream…"
              />
            </Field>

            <p className="text-[13px] text-muted">
              {kind === "made"
                ? "A made element costs what its recipe costs. Add the recipe on the element’s own screen."
                : kind === "purchased"
                  ? "A purchased element costs what its inventory item costs today. Link it on the element’s own screen."
                  : "A manual element carries a set cost per unit. Set it on the element’s own screen."}
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
