"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { Radio } from "@/components/ui/Radio";
import { PROCESSOR_OPTIONS, type InvoiceProcessor } from "@/lib/customerInvoices";

/**
 * The invoice record's Collect through, as `ui/Radio` (Mark, 2026-09-24: "use
 * the radio button on the invoice collect through field too") — the same
 * control Create Invoice asks it with. Saves on the click, as an inline field
 * does. Only drawn while it may change: a draft that is not yet in QuickBooks;
 * the record shows the plain value otherwise, and 131's trigger refuses a sent
 * one regardless.
 */
export function ProcessorField({ id, value }: { id: string; value: InvoiceProcessor }) {
  const supabase = createClient();
  const router = useRouter();
  const [current, setCurrent] = useState(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function change(next: InvoiceProcessor) {
    const before = current;
    setCurrent(next);
    setBusy(true);
    setError(null);
    const { data, error: e } = await supabase
      .from("customer_invoices")
      .update({ processor: next })
      .eq("id", id)
      .select("id");
    setBusy(false);
    if (e || !data?.length) {
      setCurrent(before);
      setError(e?.message ?? "That wasn't saved — changing an invoice needs supervisor access or above.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-1">
      <div className="flex h-9 items-center">
        <Radio
          options={PROCESSOR_OPTIONS}
          value={current}
          onChange={(next) => void change(next)}
          ariaLabel="Collect through"
          disabled={busy}
        />
      </div>
      {error ? <p className="text-[13px] text-accent">{error}</p> : null}
    </div>
  );
}
