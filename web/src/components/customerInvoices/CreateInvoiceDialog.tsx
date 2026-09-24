"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { DateField } from "@/components/ui/DateField";
import { money } from "@/lib/specialOrders";
import { withFrom } from "@/lib/breadcrumbs";
import {
  addDays,
  createRefusals,
  invoiceLinesFor,
  readInvoiceTerms,
  sendIntent,
  type InvoiceCandidate,
} from "@/lib/customerInvoices";

/**
 * CREATE AN INVOICE, THEN SEND IT — one dialog for both doors (Mark,
 * 2026-09-23: "the user chooses send invoice, the create invoice dialogue
 * appears, the user sets it up to their liking, the invoice is created, and
 * the user is then taken to the send invoice screen").
 *
 * Opened by the Special Orders list's Create Invoice… (several orders) and by
 * an order's own Send ▸ Invoice (one). Either way it says what cannot be
 * invoiced before anything is written, creates the invoice in one call, and
 * lands on the new invoice with its Send card already open (`?send=1`).
 * Cancelling that card leaves a draft, which is all an unsent invoice is.
 *
 * The amounts shown are the list's own `orderTotals`; the database derives
 * them again when it writes the lines (128), so the two cannot disagree for
 * long even if an order changes while this is open.
 */
export function CreateInvoiceDialog({
  candidates,
  orgId,
  today,
  onClose,
  from,
}: {
  candidates: InvoiceCandidate[];
  orgId: string;
  /** The ORG's calendar day — the issue date, and where the due date counts from. */
  today: string;
  onClose: () => void;
  /** Where the new invoice's breadcrumb leads back to. */
  from?: { href: string; label: string };
}) {
  const supabase = createClient();
  const router = useRouter();
  const [due, setDue] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refusals = createRefusals(candidates);
  const lines = refusals.length ? [] : invoiceLinesFor(candidates);
  const total = lines.reduce((a, l) => a + l.amount, 0);

  // The org's terms (design rule 2): Sunday's invoice due Thursday is four
  // days, and that is a setting, not code.
  useEffect(() => {
    let live = true;
    void supabase
      .from("orgs")
      .select("settings")
      .eq("id", orgId)
      .maybeSingle()
      .then(({ data }) => {
        if (!live) return;
        const terms = readInvoiceTerms((data?.settings ?? {}) as Record<string, unknown>);
        setDue((d) => d ?? addDays(today, terms.termsDays));
      });
    return () => {
      live = false;
    };
    // Once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function create() {
    setBusy(true);
    setError(null);
    const { data, error: e } = await supabase.rpc("create_customer_invoice", {
      p_org_id: orgId,
      p_lines: lines,
      p_issued_on: today,
      p_due_on: due,
      p_notes: null,
    });
    if (e) {
      setBusy(false);
      setError(e.message);
      return;
    }
    const href = `/customer-invoices/${data as string}?send=${sendIntent()}`;
    router.push(from ? withFrom(href, from) : href);
  }

  const ready = refusals.length === 0 && !!due && !busy;
  const count = lines.length;

  return (
    <Dialog
      title="Create an invoice"
      onClose={() => {
        if (!busy) onClose();
      }}
      busy={busy}
      width="max-w-xl"
      onSubmit={() => {
        if (ready) void create();
      }}
      footer={
        <div className="flex items-center justify-end gap-4">
          <button type="button" className={DIALOG_CANCEL_CLASS} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={DIALOG_COMMIT_CLASS} onClick={() => void create()} disabled={!ready}>
            {busy ? "Creating…" : `Create and Send ${money(total)}`}
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        {refusals.length > 0 ? (
          <ul className="space-y-1 text-[13px]">
            {refusals.map((r) => (
              <li key={r}>
                <span className="box-decoration-clone bg-mark-fill px-1">{r}</span>
              </li>
            ))}
          </ul>
        ) : (
          <>
            <p className="text-[13px] text-muted">
              {candidates[0]?.customer_name} · {count} {count === 1 ? "order" : "orders"}
              {count === 1 ? "" : ", one line each"}. Next comes the email — cancel it and the
              invoice stays a draft.
            </p>
            <table className="w-full border-collapse text-[14px]">
              <tbody>
                {lines.map((l) => (
                  <tr key={l.order_id} className="border-b border-hairline">
                    <td className="py-1.5 pr-3">{l.description}</td>
                    <td className="py-1.5 text-right tabular-nums">{money(l.amount)}</td>
                  </tr>
                ))}
              </tbody>
              {count > 1 ? (
                <tfoot>
                  <tr className="border-t-2 border-ink font-semibold">
                    <td className="py-1.5">Total</td>
                    <td className="py-1.5 text-right tabular-nums">{money(total)}</td>
                  </tr>
                </tfoot>
              ) : null}
            </table>
            <label className="block max-w-[14rem] space-y-1.5">
              <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                Due
              </span>
              <DateField value={due} onChange={setDue} ariaLabel="Due date" boxed />
            </label>
          </>
        )}
        {error && <p className="text-sm text-accent">{error}</p>}
      </div>
    </Dialog>
  );
}
