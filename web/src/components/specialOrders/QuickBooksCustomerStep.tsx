"use client";

import { useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import { invokeQbo } from "@/lib/qboClient";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import {
  buildQboCustomerPayload,
  customerLinkRefusals,
  qboDisplayName,
  type OurCustomer,
} from "@/lib/quickbooks";

type Match = { id: string; name: string; email: string; linked_elsewhere: boolean };

/**
 * LINK OR CREATE THIS CUSTOMER IN QUICKBOOKS — one QuickBooks customer for each
 * of ours (Mark, 2026-09-24). A shared one is out: QuickBooks' pay page shows
 * every open invoice on a customer, so two of ours on one record can read each
 * other's.
 *
 * It looks for a QuickBooks customer with the SAME EMAIL — never the same name
 * — and offers to link it; otherwise it creates one from our record. A name
 * QuickBooks already has (fault 6240) is retried once with our short tag on it,
 * "Dana Reyes (5b1e0c)", and the dialog says so. `qbo-sync` re-checks every
 * one of these rules, so this screen is the explanation, not the guard.
 *
 * Used by the customer record and by an invoice's Send, where it stands in for
 * the refusal an unlinked customer used to get.
 */
export function QuickBooksCustomerStep({
  customerId,
  onLinked,
  onClose,
}: {
  customerId: string;
  onLinked: (qboId: string) => void;
  onClose: () => void;
}) {
  const supabase = createClient();
  const [customer, setCustomer] = useState<OurCustomer | null>(null);
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, error: e } = await supabase
        .from("customers")
        .select("id, legacy_id, first_name, last_name, company, email, phone, address")
        .eq("id", customerId)
        .maybeSingle();
      if (cancelled) return;
      if (e || !data) {
        setError(e?.message ?? "That customer is gone.");
        return;
      }
      const c = data as OurCustomer;
      setCustomer(c);
      const refusal = customerLinkRefusals(c)[0];
      if (refusal) {
        setError(refusal);
        return;
      }
      const { data: found, message } = await invokeQbo(supabase, { mode: "find_customer", customer_id: customerId });
      if (cancelled) return;
      if (message) setError(message);
      else setMatches((found?.matches as Match[]) ?? []);
    })();
    return () => {
      cancelled = true;
    };
    // Once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  async function link(qboId: string) {
    setBusy(true);
    setError(null);
    const { message } = await invokeQbo(supabase, { mode: "link_customer", customer_id: customerId, qbo_id: qboId });
    setBusy(false);
    if (message) setError(message);
    else onLinked(qboId);
  }

  async function create() {
    if (!customer) return;
    setBusy(true);
    setError(null);
    let res = await invokeQbo(supabase, {
      mode: "create_customer",
      customer_id: customerId,
      payload: buildQboCustomerPayload(customer),
    });
    // The name is taken in QuickBooks: once more, with our tag on it.
    if (res.message && /6240|duplicate name|already (been )?used/i.test(res.message)) {
      res = await invokeQbo(supabase, {
        mode: "create_customer",
        customer_id: customerId,
        payload: buildQboCustomerPayload(customer, true),
      });
    }
    setBusy(false);
    if (res.message) setError(res.message);
    else onLinked(String(res.data?.qbo_id ?? ""));
  }

  const available = (matches ?? []).filter((m) => !m.linked_elsewhere);
  const elsewhere = (matches ?? []).filter((m) => m.linked_elsewhere);
  const name = customer ? qboDisplayName(customer) : "";

  return (
    <Dialog
      title="Link to QuickBooks"
      onClose={() => {
        if (!busy) onClose();
      }}
      busy={busy}
      width="max-w-lg"
      footer={
        <div className="flex items-center justify-end gap-4">
          <button type="button" className={DIALOG_CANCEL_CLASS} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          {matches && customer ? (
            <button type="button" className={DIALOG_COMMIT_CLASS} onClick={() => void create()} disabled={busy}>
              {busy ? "Working…" : available.length ? "Create a new one instead" : `Create ${name}`}
            </button>
          ) : null}
        </div>
      }
    >
      <div className="space-y-4 text-[14px]">
        {!matches && !error ? <p className="text-muted">Looking in QuickBooks for {customer?.email ?? "…"}</p> : null}

        {matches && customer ? (
          available.length ? (
            <>
              <p>QuickBooks already has a customer with {customer.email?.trim()}:</p>
              <ul className="space-y-2">
                {available.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-4 border-b border-hairline pb-2">
                    <span>{m.name}</span>
                    <button type="button" className={BUTTON_CLASS} disabled={busy} onClick={() => void link(m.id)}>
                      Link
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p>
              No QuickBooks customer has {customer.email?.trim()}. Create one named <strong>{name}</strong> from
              this record — its email, phone and address go with it.
            </p>
          )
        ) : null}

        {elsewhere.length ? (
          <p className="text-[13px] text-muted">
            {elsewhere.map((m) => m.name).join(", ")} {elsewhere.length === 1 ? "has" : "have"} this email in
            QuickBooks but {elsewhere.length === 1 ? "is" : "are"} already linked to another of your customers, so{" "}
            {elsewhere.length === 1 ? "it is" : "they are"} not offered.
          </p>
        ) : null}

        {error ? <p className="text-sm text-accent">{error}</p> : null}
      </div>
    </Dialog>
  );
}
