"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { invokeQbo } from "@/lib/qboClient";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { PickList } from "@/components/ui/PickList";
import { BOXED_FIELDS } from "@/components/ui/fieldMetrics";
import { qboVendorId, type AccountingRef } from "@/lib/quickbooks";

/**
 * Which QuickBooks customer this is.
 *
 * ORG-LEVEL, unlike a vendor's — which lives on the per-location row because a
 * bill has to say which shop it belongs to. A customer belongs to the business
 * rather than to a shop (`/customers` is exempt from `InactiveLocationGate` for
 * the same reason), so 081's `customers.external_ref` is the right home.
 *
 * WE NEVER CREATE ONE. QuickBooks enforces a globally unique `DisplayName` and
 * raises 6240 on a collision, and 187 of the 5,874 real email addresses repeat
 * with 138 carrying none at all — so name-matching customers automatically
 * would collide constantly. Picking is the honest interface.
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
        <p className="max-w-2xl text-[13px] text-muted">
          {customerName}&rsquo;s invoices cannot be sent until this is linked. We
          never create one — pick it here, or add it in QuickBooks first.
        </p>
      )}
      {error && <p className="max-w-2xl text-[13px] text-accent">{error}</p>}
    </section>
  );
}
