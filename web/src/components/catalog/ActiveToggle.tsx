"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Checkbox } from "@/components/ui/Checkbox";
import { Switch } from "@/components/ui/Switch";

/**
 * Table-agnostic active/inactive control — every catalog table, vendors
 * included since 2026-09-04, when `VendorActiveToggle` (a hand-rolled copy
 * that predated this part and never learned `readOnly`) was deleted.
 * Optimistic, reverts on failure, then refreshes so dependent UI re-resolves.
 *
 * A LARGE CHECKBOX since 2026-09-11 (Mark: "replace any switches in the app
 * with it"). It was a switch, with a Mac-checkbox appearance for the location
 * record; now there is one appearance, so the prop went.
 *
 * …AND A SWITCH AGAIN WHERE A SCREEN ASKS FOR ONE, the same day (Mark, of
 * `/vendors`: the Active checkboxes "make me think they're ways to select rows
 * like on the other pages we've been working on"). He is right, and the cause
 * is us: selection checkboxes became the norm on three lists in two days, so a
 * checkbox came to mean two unrelated things — transiently "this row is ticked"
 * and durably "this record is live" — with no way to tell them apart but the
 * column heading.
 *
 * `control="switch"` is therefore OPT-IN, and it is being rolled out RECORD BY
 * RECORD (Mark: "Vendors now, then decide", then on 2026-09-12 "apply some of
 * the changes we made to the vendor detail page to other detail pages, starting
 * with the inventory detail page"). So far: every `/vendors` surface, and the
 * inventory item's record — its Info tab and its per-location table, the two
 * that were still checkboxes there. Its LIST is not converted, which is the
 * fork still standing: `/items` has selection boxes down one column and an
 * Active checkbox down another, which is exactly the confusion this exists to
 * end. Finish it or take it out; do not leave it here indefinitely. The write,
 * the optimistic revert and the read-only words are identical either way — only
 * the dress differs, which is the whole point.
 */
export function ActiveToggle({
  table,
  id,
  column = "is_active",
  active,
  label,
  readOnly = false,
  yesNo = false,
  control = "checkbox",
  onWrite,
}: {
  table: string;
  id: string;
  /** The boolean column it writes. `is_active` unless a record has a second
   *  on/off fact of the same shape — a production item's "offered on the
   *  inquiry form" (migration 132). The words it reads out stay Active /
   *  Inactive, so a caller writing another column passes `label`. */
  column?: string;
  active: boolean;
  label?: string;
  /** Say the state in a word and offer no box — a Read Only cell of the
   *  Page Permissions sheet. A disabled box would read as broken. */
  readOnly?: boolean;
  /** Read-only words Yes/No rather than Active/Inactive — for a record whose
   *  label column already says "Active" (the location record). */
  yesNo?: boolean;
  /** Which shape the control takes. A SWITCH where a checkbox in the same row
   *  would be mistaken for a selection box — see the note above. */
  control?: "checkbox" | "switch";
  /** Replaces the UPDATE and nothing else — `InlineValue`'s prop of the same
   *  name. The /interface page hands it a local write. */
  onWrite?: (next: boolean) => Promise<{ error: string | null }>;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [on, setOn] = useState(active);
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  const name =
    label ?? (on ? "Active — click to deactivate" : "Inactive — click to activate");

  function toggle() {
    const next = !on;
    setOn(next);
    setFailed(false);
    startTransition(async () => {
      const { error } = onWrite
        ? await onWrite(next)
        : await supabase
            .from(table)
            .update({ [column]: next })
            .eq("id", id);
      if (error) {
        setOn(!next);
        setFailed(true);
        return;
      }
      router.refresh();
    });
  }

  if (readOnly) {
    return (
      <span className="text-sm text-muted">
        {yesNo ? (active ? "Yes" : "No") : active ? "Active" : "Inactive"}
      </span>
    );
  }

  return (
    // `flex`, not `inline-flex`: inline, the wrapper sits on a line box whose
    // descender space made the 36px row a 41px one.
    <span className="flex items-center gap-2">
      {control === "switch" ? (
        <Switch
          checked={on}
          disabled={pending}
          onChange={toggle}
          label={name}
        />
      ) : (
        <Checkbox size="lg" checked={on} disabled={pending} onChange={toggle} label={name} />
      )}
      {failed && (
        <span className="text-[12px] uppercase tracking-[0.12em] text-accent">
          retry
        </span>
      )}
    </span>
  );
}
