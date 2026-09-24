"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { invokeQbo } from "@/lib/qboClient";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import { money } from "@/lib/specialOrders";

type Recorded = { number: number; amount: number; payment: string };

/** What a check found, in a sentence. */
function summary(recorded: Recorded[], problems: string[]): string | null {
  if (problems.length) return problems.join(" ");
  if (!recorded.length) return null;
  return recorded
    .map((r) => `Recorded ${money(r.amount)} paid through QuickBooks on invoice ${r.number}.`)
    .join(" ");
}

/**
 * THE WEBHOOK'S BACKUP, on the invoice record (2026-09-24): opening an open
 * QuickBooks invoice asks QuickBooks what it has been paid and records
 * anything new (`qbo-sync` `sync_qbo_payments`). Silent when there is nothing
 * — which is the usual answer — and the page redraws when something landed.
 */
export function QuickBooksPaymentCheck({ id }: { id: string }) {
  const supabase = createClient();
  const router = useRouter();
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, message } = await invokeQbo(supabase, { mode: "sync_qbo_payments", customer_invoice_id: id });
      if (cancelled) return;
      if (message) {
        setError(true);
        setNote(`Could not check QuickBooks for payments: ${message}`);
        return;
      }
      const recorded = (data?.recorded as Recorded[]) ?? [];
      const problems = (data?.problems as string[]) ?? [];
      setError(problems.length > 0);
      setNote(summary(recorded, problems));
      if (recorded.length) router.refresh();
    })();
    return () => {
      cancelled = true;
    };
    // Once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!note) return null;
  return <p className={`text-[13px] ${error ? "text-accent" : "text-[var(--rf-green-600)]"}`}>{note}</p>;
}

/**
 * The same check over EVERY open QuickBooks invoice, from the Invoices list's
 * command strip.
 */
export function CheckQuickBooksPayments() {
  const supabase = createClient();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);

  async function check() {
    setBusy(true);
    setNote(null);
    const { data, message } = await invokeQbo(supabase, { mode: "sync_qbo_payments" });
    setBusy(false);
    if (message) {
      setNote({ text: message, error: true });
      return;
    }
    const recorded = (data?.recorded as Recorded[]) ?? [];
    const problems = (data?.problems as string[]) ?? [];
    const checked = Number(data?.checked ?? 0);
    setNote({
      text:
        summary(recorded, problems) ??
        (checked === 0
          ? "No open QuickBooks invoices to check."
          : `Checked ${checked} open QuickBooks invoice${checked === 1 ? "" : "s"} — nothing new.`),
      error: problems.length > 0,
    });
    if (recorded.length) router.refresh();
  }

  return (
    <div className="flex items-center gap-4">
      {note ? (
        <p className={`text-[13px] ${note.error ? "text-accent" : "text-muted"}`}>{note.text}</p>
      ) : null}
      <button type="button" className={BUTTON_CLASS} disabled={busy} onClick={() => void check()}>
        {busy ? "Checking…" : "Check QuickBooks for Payments"}
      </button>
    </div>
  );
}
