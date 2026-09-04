"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Switch } from "@/components/ui/Switch";

/**
 * Table-agnostic active/inactive switch — every catalog table, vendors
 * included since 2026-09-04, when `VendorActiveToggle` (a hand-rolled copy
 * that predated this part and never learned `readOnly`) was deleted.
 * Optimistic, reverts on failure, then refreshes so dependent UI re-resolves.
 */
export function ActiveToggle({
  table,
  id,
  active,
  label,
  readOnly = false,
}: {
  table: string;
  id: string;
  active: boolean;
  label?: string;
  /** Say the state in a word and offer no switch — a Read Only cell of the
   *  Page Permissions sheet. A disabled switch would read as broken. */
  readOnly?: boolean;
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
      const { error } = await supabase
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
    return <span className="text-sm text-muted">{active ? "Active" : "Inactive"}</span>;
  }

  return (
    <span className="inline-flex items-center gap-2">
      {/* The box itself is `ui/Switch` — black when on, not green, since green
          is spoken for by the order box, and off is the exact inverse. This was
          the app's only switch until the recipe sheet needed one; the markup
          moved rather than being copied. */}
      <Switch
        on={on}
        disabled={pending}
        onToggle={toggle}
        ariaLabel={
          label ?? (on ? "Active — click to deactivate" : "Inactive — click to activate")
        }
      />
      {failed && (
        <span className="text-[12px] uppercase tracking-[0.12em] text-accent">
          retry
        </span>
      )}
    </span>
  );
}
