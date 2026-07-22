"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Inline active/inactive switch for a vendor. Writes vendors.is_active via
 * supabase-js under RLS (owner/admin/purchaser), optimistic, then refreshes so
 * dependent UI (row dimming; hidden vendor-item choices elsewhere) re-resolves.
 */
export function VendorActiveToggle({
  vendorId,
  active,
}: {
  vendorId: string;
  active: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [on, setOn] = useState(active);
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  function toggle() {
    const next = !on;
    setOn(next); // optimistic
    setFailed(false);
    startTransition(async () => {
      const { error } = await supabase
        .from("vendors")
        .update({ is_active: next })
        .eq("id", vendorId);
      if (error) {
        setOn(!next); // revert
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
        aria-label={on ? "Active — click to deactivate" : "Inactive — click to activate"}
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
