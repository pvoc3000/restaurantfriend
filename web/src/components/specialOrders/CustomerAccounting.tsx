"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { invokeQbo } from "@/lib/qboClient";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { PickList } from "@/components/ui/PickList";
import { BOXED_FIELDS } from "@/components/ui/fieldMetrics";
import { qboVendorId, type AccountingRef } from "@/lib/quickbooks";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import { QuickBooksCustomerStep } from "./QuickBooksCustomerStep";

/**
 * Which QuickBooks customer this is.
 *
 * ORG-LEVEL, unlike a vendor's — which lives on the per-location row because a
 * bill has to say which shop it belongs to. A customer belongs to the business
 * rather than to a shop (`/customers` is exempt from `InactiveLocationGate` for
 * the same reason), so 081's `customers.external_ref` is the right home.
 *
 * PICK ONE, OR FIND-OR-CREATE BY EMAIL (2026-09-24). Nothing is matched by
 * NAME automatically — 187 of the 5,874 real email addresses repeat and names
 * collide far more — and since the catch-all failed, a wrong link is a privacy
 * fault as well as a books one: QuickBooks' pay page shows every open invoice
 * on a customer. `QuickBooksCustomerStep` links only an exact email match, and
 * otherwise creates the customer from this record.
 */
export function CustomerAccounting({
  customerId,
  orgId,
  customerName,
}: {
  customerId: string;
  orgId: string;
  customerName: string;
}) {
  const supabase = createClient();
  const [connected, setConnected] = useState(false);
  const [options, setOptions] = useState<{ id: string; name: string }[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stepOpen, setStepOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [conn, mine] = await Promise.all([
        supabase.rpc("accounting_connection_status", { p_org: orgId }),
        supabase.from("customers").select("external_ref").eq("id", customerId).maybeSingle(),
      ]);
      if (cancelled) return;
      const row = Array.isArray(conn.data)
        ? (conn.data[0] as { status?: string } | undefined)
        : undefined;
      const live = row?.status === "connected";
      setConnected(live);
      setPicked(qboVendorId((mine.data?.external_ref ?? null) as AccountingRef | null));
      if (!live) return;
      const { data, message } = await invokeQbo(supabase, { mode: "customers" });
      if (cancelled) return;
      // Never dropped on the floor: an empty picker with nothing said reads as
      // QuickBooks having no customers rather than as something being wrong.
      if (message) setError(message);
      if (data?.customers) setOptions(data.customers as { id: string; name: string }[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, orgId, customerId]);

  if (!connected) return null;

  async function pick(next: string | null) {
    setBusy(true);
    setError(null);
    // The whole `qbo` branch as an OBJECT — the column is jsonb, and an id must
    // never outlive what it was chosen as.
    const { data, error: writeError } = await supabase
      .from("customers")
      .update({ external_ref: next ? { qbo: { id: next } } : {} })
      .eq("id", customerId)
      .select("id");
    setBusy(false);
    if (writeError) {
      setError(writeError.message);
      return;
    }
    // Row count, not the absence of an error: below the role 051 requires the
    // policy matches nothing and PostgREST still reports success.
    if (!data || data.length === 0) {
      setError("That wasn't saved — changing a customer needs supervisor access or above.");
      return;
    }
    setPicked(next);
  }

  return (
    <section className="space-y-3">
      <SectionHeading>QuickBooks</SectionHeading>
      <dl className="grid max-w-2xl grid-cols-[8rem_1fr] items-center gap-x-4 gap-y-2 text-sm">
        <dt className="text-subtle">Customer</dt>
        <dd>
          <PickList
            variant="field"
            boxed={BOXED_FIELDS}
            ariaLabel="Which QuickBooks customer this is"
            disabled={busy}
            // Held back until the list can NAME it, or a value with no matching
            // option renders as a bare QuickBooks id.
            value={options ? picked : null}
            placeholder={
              !options
                ? "Reading QuickBooks…"
                : options.length === 0
                  ? "No customers in QuickBooks"
                  : "Not linked"
            }
            options={(options ?? []).map((o) => ({ value: o.id, label: o.name }))}
            onPick={(next) => void pick(next)}
            clearable
            clearLabel="Not linked"
            panelMinWidth={320}
          />
        </dd>
      </dl>
      {!picked && options && (
        <div className="flex max-w-2xl items-center gap-4">
          <button type="button" className={BUTTON_CLASS} onClick={() => setStepOpen(true)}>
            Find or Create in QuickBooks…
          </button>
          <p className="text-[13px] text-muted">
            {customerName}’s QuickBooks invoices can’t be sent until this is linked.
          </p>
        </div>
      )}
      {stepOpen && (
        <QuickBooksCustomerStep
          customerId={customerId}
          onClose={() => setStepOpen(false)}
          onLinked={(qboId) => {
            setStepOpen(false);
            setPicked(qboId);
            // A new customer is not in the list read on arrival; read it again
            // so the picker can name it.
            void invokeQbo(supabase, { mode: "customers" }).then(({ data }) => {
              if (data?.customers) setOptions(data.customers as { id: string; name: string }[]);
            });
          }}
        />
      )}
      {error && <p className="max-w-2xl text-[13px] text-accent">{error}</p>}
    </section>
  );
}
