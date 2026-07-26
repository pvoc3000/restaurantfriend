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
        // Black when on, not green: green is spoken for by the order box.
        className={`relative inline-flex h-[26px] w-[46px] shrink-0 items-center rounded-full border-[1.5px] border-ink transition-colors disabled:opacity-35 ${
          on ? "bg-ink" : "bg-white"
        }`}
      >
        {/* Off is the exact inverse of on (Mark, 2026-07-25): black track /
            white knob ↔ white track / black knob. */}
        <span
          className={`inline-block h-[18px] w-[18px] transform rounded-full transition-transform ${
            on ? "translate-x-[22px] bg-white" : "translate-x-[2px] bg-ink"
          }`}
        />
      </button>
      {failed && (
        <span className="text-[12px] uppercase tracking-[0.12em] text-accent">
          retry
        </span>
      )}
    </span>
  );
}
