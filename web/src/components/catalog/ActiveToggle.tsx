"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Table-agnostic active/inactive switch (inventory_items,
 * inventory_item_locations, vendor_items). Optimistic, reverts on failure,
 * then refreshes so dependent UI re-resolves.
 *
 * Deliberately a sibling of VendorActiveToggle rather than a rewrite of it —
 * the vendors screen is shipped and this keeps it untouched.
 */
export function ActiveToggle({
  table,
  id,
  active,
  label,
}: {
  table: string;
  id: string;
  active: boolean;
  label?: string;
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

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={
          label ?? (on ? "Active — click to deactivate" : "Inactive — click to activate")
        }
        disabled={pending}
        onClick={toggle}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
          on ? "bg-green-600" : "bg-neutral-300"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
            on ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </button>
      {failed && <span className="text-xs text-red-700">retry</span>}
    </span>
  );
}
