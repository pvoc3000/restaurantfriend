"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { PickList } from "@/components/ui/PickList";
import { BOXED_FIELDS } from "@/components/ui/fieldMetrics";
import { confirmDialog } from "@/lib/confirm";
import { useLatestWrite } from "@/lib/latestWrite";
import { FULFILLMENT_OPTIONS, money } from "@/lib/specialOrders";

/**
 * PICKUP OR DELIVERY — and switching to pickup ASKS before it takes the
 * delivery charge away (Mark, 2026-10-02: "you should prompt the user to make
 * sure they want to clear the fee before doing so").
 *
 * This cell clears the charge in the same write as the switch, and migration
 * 168's trigger does it for every other path that changes fulfillment.
 * Cancel leaves the order on delivery with its fee, because the two only make
 * sense together. No charge, no question.
 *
 * Its own cell rather than `InlineValue kind="pick"`, which writes the moment
 * a value is picked and has nowhere to ask first. Shows the pick on the tap
 * and writes behind it (`lib/latestWrite`); a refused write puts it back.
 */
export function FulfillmentCell({
  id,
  value,
  deliveryCharge,
}: {
  id: string;
  value: string | null;
  deliveryCharge: number | string | null;
}) {
  const router = useRouter();
  const supabase = createClient();
  const saved = value ?? "pickup";
  const [shown, setShown] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seen, setSeen] = useState(saved);
  if (seen !== saved) {
    setSeen(saved);
    setShown(null);
  }
  const current = shown ?? saved;

  const save = useLatestWrite<string>(
    async (next) => {
      const { data, error: e } = await supabase
        .from("special_orders")
        // The charge goes in the SAME write, so the answer the dialog got is
        // the one stored even where 168's trigger is not there to do it.
        .update(next === "delivery" ? { fulfillment: next } : { fulfillment: next, delivery_charge: null })
        .eq("id", id)
        .select("id");
      if (e) return e.message;
      if (!data?.length) return "The change wasn't saved — the database refused it silently.";
      return null;
    },
    (failure) => {
      if (failure) {
        setError(failure);
        setShown(null);
      }
      router.refresh();
    }
  );

  async function pick(next: string) {
    if (!next || next === current) return;
    setError(null);
    const charge = Number(deliveryCharge ?? 0);
    if (current === "delivery" && next !== "delivery" && charge !== 0) {
      const ok = await confirmDialog({
        title: `Remove the ${money(charge)} delivery charge?`,
        body: "A pickup order has no delivery charge, so switching to pickup takes it off the order.",
        confirmLabel: "Switch to pickup",
      });
      if (!ok) return;
    }
    setShown(next);
    save(next);
  }

  return (
    <span className="inline-flex w-full flex-col">
      <PickList
        boxed={BOXED_FIELDS}
        value={current}
        options={FULFILLMENT_OPTIONS}
        ariaLabel="Pickup or delivery"
        onPick={(next) => void pick(next)}
      />
      {error ? <span className="text-xs text-accent">{error}</span> : null}
    </span>
  );
}
