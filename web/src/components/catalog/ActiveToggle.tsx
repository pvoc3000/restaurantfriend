"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Checkbox } from "@/components/ui/Checkbox";

/**
 * Table-agnostic active/inactive control — every catalog table, vendors
 * included since 2026-09-04, when `VendorActiveToggle` (a hand-rolled copy
 * that predated this part and never learned `readOnly`) was deleted.
 * Optimistic, reverts on failure, then refreshes so dependent UI re-resolves.
 *
 * A LARGE CHECKBOX since 2026-09-11 (Mark: "replace any switches in the app
 * with it"). It was a switch, with a Mac-checkbox appearance for the location
 * record; now there is one appearance, so the prop went.
 */
export function ActiveToggle({
  table,
  id,
  active,
  label,
  readOnly = false,
  yesNo = false,
  onWrite,
}: {
  table: string;
  id: string;
  active: boolean;
  label?: string;
  /** Say the state in a word and offer no box — a Read Only cell of the
   *  Page Permissions sheet. A disabled box would read as broken. */
  readOnly?: boolean;
  /** Read-only words Yes/No rather than Active/Inactive — for a record whose
   *  label column already says "Active" (the location record). */
  yesNo?: boolean;
  /** Replaces the UPDATE and nothing else — `InlineValue`'s prop of the same
   *  name. The /interface page hands it a local write. */
  onWrite?: (next: boolean) => Promise<{ error: string | null }>;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [on, setOn] = useState(active);
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  function toggle() {
    const next = !on;
    setOn(next);
    setFailed(false);
    startTransition(async () => {
      const { error } = onWrite
        ? await onWrite(next)
        : await supabase
            .from(table)
            .update({ is_active: next })
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
      <Checkbox
        size="lg"
        checked={on}
        disabled={pending}
        onChange={toggle}
        label={label ?? (on ? "Active — click to deactivate" : "Inactive — click to activate")}
      />
      {failed && (
        <span className="text-[12px] uppercase tracking-[0.12em] text-accent">
          retry
        </span>
      )}
    </span>
  );
}
