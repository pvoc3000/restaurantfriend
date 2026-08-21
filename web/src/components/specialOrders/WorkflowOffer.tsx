"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Checkbox } from "@/components/ui/Checkbox";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { createClient } from "@/lib/supabase/client";
import { consequenceSummary, type Consequence } from "@/lib/orderWorkflow";

/**
 * "…and should I also?" — the one prompt every workflow trigger shares.
 *
 * `lib/orderWorkflow` decides WHAT to offer; this asks, and writes what was
 * accepted. Every trigger goes through it so the question always looks and
 * behaves the same, whether it came from emailing a quote, setting a date by
 * hand, or taking a payment.
 *
 * ---------------------------------------------------------------------------
 * ONE DIALOG PER ACT, WITH A LINE PER CONSEQUENCE
 * ---------------------------------------------------------------------------
 * A paid invoice implies two things — the order is an Order, and somebody has
 * to print it — and `whatFollows` returns both. Asking them as two dialogs
 * would make the second look like the app second-guessing the answer you had
 * just given, so they are one question with two ticks.
 *
 * EVERY LINE IS INDIVIDUALLY UNTICKABLE, and that is not decoration. Decision 4
 * of the brief says the app may suggest a to-do and must never write one; a
 * pre-ticked box that you can clear keeps the human as the author while saving
 * them the typing. The same applies to the status: taking the date without the
 * status is a legitimate thing to want, and an all-or-nothing confirm would
 * make it impossible.
 *
 * ONE UPDATE STATEMENT. All the accepted lines land together, so an order can
 * never come to rest half-advanced — status moved and to-do not, or the other
 * way about — which is the state nothing downstream knows how to read.
 *
 * IT WRITES ITS OWN LOG ENTRY ONLY IF THE TRIGGER DID NOT. Migration 054's
 * trigger already narrates a column change ("Status changed from lead to
 * quote"), so this adds nothing — the history reads the same whether a person
 * typed it or accepted it here, which is the honest record: they did accept it.
 */
export function WorkflowOffer({
  orderId,
  consequences,
  onClose,
  title = "One more thing",
}: {
  orderId: string;
  /** From `lib/orderWorkflow`. An empty list renders nothing. */
  consequences: Consequence[];
  onClose: () => void;
  title?: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  // Pre-ticked: the app's proposal is the likely answer, and the reason to open
  // this at all is that somebody usually says yes.
  const [taken, setTaken] = useState<boolean[]>(() => consequences.map(() => true));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (consequences.length === 0) return null;

  const chosen = consequences.filter((_, i) => taken[i]);

  async function apply() {
    if (chosen.length === 0) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);

    const patch: Record<string, string | null> = {};
    for (const c of chosen) patch[c.column] = c.value;

    // `.select()` its own result: an update matching no RLS policy changes
    // nothing and PostgREST returns NO error, so a bare update would report a
    // cheerful success and the order would sit exactly where it was.
    const { data, error: e } = await supabase
      .from("special_orders")
      .update(patch)
      .eq("id", orderId)
      .select("id");

    setSaving(false);
    if (e) {
      setError(e.message);
      return;
    }
    if (!data?.length) {
      setError("That wasn't saved — the database refused it silently.");
      return;
    }
    router.refresh();
    onClose();
  }

  return (
    <Dialog
      title={title}
      onClose={saving ? () => {} : onClose}
      busy={saving}
      width="max-w-md"
      onSubmit={() => {
        if (!saving) void apply();
      }}
      footer={
        <div className="flex items-center justify-end gap-4">
          <button
            type="button"
            className={DIALOG_CANCEL_CLASS}
            onClick={onClose}
            disabled={saving}
          >
            {/* NOT "Cancel". Nothing is being cancelled — the thing that
                triggered this already happened and stands either way. */}
            No thanks
          </button>
          <button
            type="button"
            className={DIALOG_COMMIT_CLASS}
            onClick={() => void apply()}
            disabled={saving || chosen.length === 0}
          >
            {saving ? "Saving…" : "Do it"}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-[15px] leading-relaxed">
          {consequences.length === 1
            ? consequenceSummary(consequences)
            : "Shall I also:"}
        </p>

        {/* A single consequence is stated in the sentence above, so a lone
            checkbox restating it would be the same words twice. */}
        {consequences.length > 1 && (
          <ul className="space-y-2">
            {consequences.map((c, i) => (
              <li key={c.column}>
                <Checkbox
                  checked={taken[i]}
                  onChange={(next) =>
                    setTaken((t) => t.map((v, j) => (j === i ? next : v)))
                  }
                >
                  {c.label}
                </Checkbox>
              </li>
            ))}
          </ul>
        )}

        {error && <p className="text-[13px] text-accent">{error}</p>}
      </div>
    </Dialog>
  );
}
