"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { DateField } from "@/components/ui/DateField";
import { Radio } from "@/components/ui/Radio";
import { CustomerPicker, type CustomerChoice } from "@/components/specialOrders/CustomerPicker";
import { draftIsUsable, draftToRow } from "@/lib/customerSearch";
import { addDays, PROCESSOR_OPTIONS, type InvoiceProcessor } from "@/lib/customerInvoices";

/**
 * NEW INVOICE… (Mark, 2026-09-27: "I would like to be able to create invoices
 * that don't require an order. I would like to be able to create an invoice
 * and then decide to add an order to it. Or a bunch of orders.")
 *
 * Asks only what the invoice itself needs — who it is for, the shop that
 * collects (the orders added later must be made there), when it is due, and
 * who takes the money — and opens the empty draft, where Add Orders… and Add
 * Line… fill it. A customer can be made here, as on a new order.
 */
export function NewCustomerInvoice({
  orgId,
  shops,
  today,
  termsDays,
}: {
  orgId: string;
  /** The open shops — where an invoice can collect. */
  shops: { id: string; code: string }[];
  /** The ORG's calendar day — the issue date, and where the due date counts from. */
  today: string;
  termsDays: number;
}) {
  const supabase = createClient();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [customer, setCustomer] = useState<CustomerChoice>(null);
  const [shop, setShop] = useState<string>(shops[0]?.id ?? "");
  const [due, setDue] = useState<string | null>(addDays(today, termsDays));
  const [processor, setProcessor] = useState<InvoiceProcessor>("square");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready =
    !busy &&
    !!shop &&
    !!due &&
    (customer?.kind === "existing" || (customer?.kind === "new" && draftIsUsable(customer.draft)));

  function close() {
    if (busy) return;
    setOpen(false);
    setError(null);
  }

  async function create() {
    if (!ready || !customer) return;
    setBusy(true);
    setError(null);
    let customerId = customer.kind === "existing" ? customer.id : null;
    if (customer.kind === "new") {
      const { data, error: e } = await supabase.from("customers").insert(draftToRow(customer.draft, orgId)).select("id");
      if (e || !data?.length) {
        setBusy(false);
        setError(e?.message ?? "The customer was not saved.");
        return;
      }
      customerId = data[0].id as string;
    }
    const { data, error: e } = await supabase.rpc("create_customer_invoice", {
      p_org_id: orgId,
      p_customer: customerId,
      p_location: shop,
      p_orders: [],
      p_issued_on: today,
      p_due_on: due,
      p_notes: null,
      p_processor: processor,
    });
    if (e || !data) {
      setBusy(false);
      setError(e?.message ?? "The invoice was not created.");
      return;
    }
    router.push(`/customer-invoices/${data as string}`);
  }

  const caption = (text: string) => (
    <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">{text}</span>
  );

  return (
    <>
      <button type="button" className={BUTTON_CLASS} onClick={() => setOpen(true)}>
        New Invoice…
      </button>
      {open ? (
        <Dialog
          title="New invoice"
          onClose={close}
          busy={busy}
          width="max-w-xl"
          onSubmit={() => void create()}
          footer={
            <div className="flex items-center justify-end gap-4">
              <button type="button" className={DIALOG_CANCEL_CLASS} onClick={close} disabled={busy}>
                Cancel
              </button>
              <button type="button" className={DIALOG_COMMIT_CLASS} onClick={() => void create()} disabled={!ready}>
                {busy ? "Creating…" : "Create"}
              </button>
            </div>
          }
        >
          <div className="space-y-5">
            <div className="space-y-1.5">
              {caption("Customer")}
              <CustomerPicker value={customer} onChange={setCustomer} disabled={busy} />
            </div>
            <div className="flex flex-wrap items-end gap-6">
              <div className="space-y-1.5">
                {caption("Shop")}
                <div className="flex h-9 items-center">
                  <Radio
                    options={shops.map((s) => ({ value: s.id, label: s.code }))}
                    value={shop}
                    onChange={setShop}
                    ariaLabel="The shop that collects"
                  />
                </div>
              </div>
              <label className="block w-[14rem] space-y-1.5">
                {caption("Due")}
                <DateField value={due} onChange={setDue} ariaLabel="Due date" boxed />
              </label>
              <div className="space-y-1.5">
                {caption("Collect through")}
                <div className="flex h-9 items-center">
                  <Radio options={PROCESSOR_OPTIONS} value={processor} onChange={setProcessor} ariaLabel="Collect through" />
                </div>
              </div>
            </div>
            {error ? <p className="text-sm text-accent">{error}</p> : null}
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
