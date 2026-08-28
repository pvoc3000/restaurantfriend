"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { statusCatchUp, type WorkflowOrder } from "@/lib/orderWorkflow";

/**
 * "→ move to Quote" — the quiet half of the workflow.
 *
 * The prompts catch the MOMENT something happens. This catches everything
 * else, and there is a great deal of everything else: 8,330 orders came out of
 * FileMaker with their own idea of the ladder, a date can be set from a screen
 * that does not ask, and somebody who declined a prompt on Tuesday may want it
 * on Thursday. Without this, saying "No thanks" once is final until you go and
 * edit the field again.
 *
 * It is the receiving screen's `→` idiom, which is this app's standing answer
 * to "we can see what this should be, and you decide": the figure the app would
 * write, shown beside the one in force, taken by tapping it. Never an automatic
 * write, and it simply is not there when there is nothing to say.
 *
 * IT IS YELLOW, NOT RED. A status behind its own dates is worth an eye, not an
 * error — the order is not broken, it is just out of step, and the progress bar
 * has been quietly taking the max of the two all along.
 */
export function StatusCatchUp({
  id,
  order,
  canWrite,
}: {
  id: string;
  order: WorkflowOrder;
  canWrite: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [saving, setSaving] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const proposal = statusCatchUp(order);
  if (!proposal || !canWrite || dismissed) return null;

  async function take() {
    if (!proposal) return;
    setSaving(true);
    setError(null);
    const { data, error: e } = await supabase
      .from("special_orders")
      .update({ status: proposal.value })
      .eq("id", id)
      .select("id");
    setSaving(false);
    if (e) return setError(e.message);
    if (!data?.length) return setError("refused");
    router.refresh();
  }

  return (
    <span className="ml-2 inline-flex items-center gap-1 align-middle">
      <button
        type="button"
        onClick={() => void take()}
        disabled={saving}
        title="The dates say this order has got further than its status does."
        className="text-[11px] font-semibold uppercase tracking-[0.06em] bg-mark-fill px-1 text-ink underline underline-offset-2 hover:bg-ink hover:text-white disabled:opacity-35"
      >
        {saving ? "…" : `→ ${proposal.label.replace(/^Move the order to /, "")}`}
      </button>
      {/* Dismissible like every other offer in this app. Not stored: it is a
          question about a record, not a fact about one, and next time the
          screen loads it is worth asking again. */}
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="text-[11px] text-subtle hover:text-ink"
      >
        ✕
      </button>
      {error && <span className="text-[11px] text-accent">{error}</span>}
    </span>
  );
}
