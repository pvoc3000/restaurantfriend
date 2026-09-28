"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { confirmDialog, splitConfirmMessage } from "@/lib/confirm";
import { DataTable, type DataColumn } from "@/components/catalog/DataTable";
import { InlineValue } from "@/components/catalog/InlineValue";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { Radio } from "@/components/ui/Radio";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { TextInput } from "@/components/ui/TextInput";
import { SMALL_BUTTON_CLASS } from "@/components/ui/buttons";
import { money } from "@/lib/specialOrders";
import { parseMoney } from "@/lib/newPayment";
import { FREE_LINE_TYPES } from "@/lib/customerInvoices";

/** One OTHER CHARGE — a free line of the invoice's own (141) — as plain data
 *  built on the server. */
export type InvoiceLineRow = {
  id: string;
  /** Its place on the paper. */
  position: number;
  description: string;
  /** Where it prints: an Item in Subtotal, Delivery in Delivery. */
  lineType: "item" | "delivery";
  qty: number | null;
  unitPrice: number | null;
  amount: number;
};

const figure = (v: number | null) => (v === null ? "" : money(v));

/**
 * OTHER CHARGES (Mark, 2026-09-27: "My expectations were 'lines' were for
 * items that aren't orders") — the invoice's own lines (141): a delivery fee,
 * a setup fee. Each is one charge of one TYPE, which is where the printed
 * invoice puts it — an Item in the Subtotal column, Delivery in Delivery —
 * rather than a row with a column per fee, which would let one line be a fee
 * and a tax and a rush at once. Untaxed in v1: anything taxable belongs on an
 * order. Edited here while the invoice is a draft; the amount is qty × price
 * when both are set. An order's copied lines are under its row in Orders.
 */
export function InvoiceLines({
  invoiceId,
  orgId,
  rows,
  draft,
}: {
  invoiceId: string;
  orgId: string;
  rows: InvoiceLineRow[];
  /** Supervisor+ on an invoice that has not gone out and holds no money. */
  draft: boolean;
}) {
  const supabase = createClient();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  async function remove(r: InvoiceLineRow) {
    const ok = await confirmDialog({
      ...splitConfirmMessage(`Remove “${r.description}” (${money(r.amount)}) from this invoice?`),
      confirmLabel: "Remove",
      tone: "danger",
    });
    if (!ok) return;
    setError(null);
    start(async () => {
      const { data, error: e } = await supabase.from("customer_invoice_lines").delete().eq("id", r.id).select("id");
      if (e) setError(e.message);
      else if (!data?.length) setError("Nothing was removed — the database refused it silently.");
      else router.refresh();
    });
  }

  const editable = () => draft;

  const columns: DataColumn<InvoiceLineRow>[] = [
    {
      key: "line",
      label: "Charge",
      width: 340,
      pinned: true,
      wrap: true,
      sortValue: (r) => r.position,
      render: (r) =>
        editable() ? (
          <InlineValue table="customer_invoice_lines" id={r.id} column="description" value={r.description}
                       nullable={false} ariaLabel="Line description" />
        ) : (
          r.description
        ),
    },
    {
      key: "type",
      label: "Type",
      width: 130,
      sortValue: (r) => r.lineType,
      render: (r) =>
        editable() ? (
          <InlineValue table="customer_invoice_lines" id={r.id} column="line_type" kind="pick" nullable={false}
                       value={r.lineType} options={FREE_LINE_TYPES} ariaLabel={`Type of ${r.description}`} />
        ) : (
          <span className="text-muted">{FREE_LINE_TYPES.find((t) => t.value === r.lineType)?.label}</span>
        ),
    },
    {
      key: "qty",
      label: "Qty",
      width: 90,
      align: "right",
      sortValue: (r) => r.qty ?? 0,
      render: (r) =>
        editable() ? (
          <InlineValue table="customer_invoice_lines" id={r.id} column="qty" kind="number" value={r.qty}
                       align="right" className="text-right" ariaLabel={`Quantity for ${r.description}`} />
        ) : (
          <span className="tabular-nums text-muted">{r.qty === null ? "" : r.qty % 1 === 0 ? r.qty : r.qty.toFixed(2)}</span>
        ),
    },
    {
      key: "price",
      label: "Price",
      width: 110,
      align: "right",
      sortValue: (r) => r.unitPrice ?? 0,
      render: (r) =>
        editable() ? (
          <InlineValue table="customer_invoice_lines" id={r.id} column="unit_price" kind="number" value={r.unitPrice}
                       align="right" className="text-right" ariaLabel={`Price for ${r.description}`}
                       format={(v) => money(Number(v))} />
        ) : (
          <span className="tabular-nums text-muted">{figure(r.unitPrice)}</span>
        ),
    },
    {
      key: "amount",
      label: "Amount",
      width: 130,
      align: "right",
      sortValue: (r) => r.amount,
      render: (r) =>
        // A free line with no qty × price takes a typed amount; with them, the
        // database works it out.
        editable() && (r.qty === null || r.unitPrice === null) ? (
          <InlineValue table="customer_invoice_lines" id={r.id} column="amount" kind="number" value={r.amount}
                       nullable={false} align="right" className="text-right" ariaLabel={`Amount for ${r.description}`}
                       format={(v) => money(Number(v))} />
        ) : (
          <span className="tabular-nums">{money(r.amount)}</span>
        ),
    },
    ...(draft
      ? [
          {
            key: "remove",
            label: "",
            width: 44,
            render: (r: InvoiceLineRow) =>
              draft ? (
                <button
                  type="button"
                  onClick={() => void remove(r)}
                  disabled={pending}
                  aria-label={`Remove ${r.description}`}
                  className="px-1 text-[15px] leading-none text-subtle hover:text-accent disabled:opacity-35"
                >
                  ×
                </button>
              ) : null,
          } satisfies DataColumn<InvoiceLineRow>,
        ]
      : []),
  ];

  const total = Math.round(rows.reduce((a, r) => a + r.amount, 0) * 100) / 100;

  // A sent invoice with none has nothing to show here.
  if (!draft && rows.length === 0) return null;

  return (
    <section className="space-y-2">
      <div className="flex max-w-[60rem] items-center justify-between gap-4">
        <SectionHeading count={rows.length}>Other Charges</SectionHeading>
        {draft ? (
          <button type="button" className={SMALL_BUTTON_CLASS} onClick={() => setAdding(true)}>
            Add Charge…
          </button>
        ) : null}
      </div>
      <div className="max-w-[60rem]">
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(r) => r.id}
          storageKey="customer-invoice-charges.v1"
          defaultSort={{ key: "line", dir: "asc" }}
          totals={() => ({
            line: "Total",
            amount: <span className="tabular-nums font-semibold">{money(total)}</span>,
          })}
          empty={<p className="text-sm text-muted">Nothing here.</p>}
        />
      </div>
      {error ? <p className="text-[13px] text-accent">{error}</p> : null}
      {adding ? (
        <AddLineDialog
          invoiceId={invoiceId}
          orgId={orgId}
          nextSort={rows.length}
          onClose={() => setAdding(false)}
        />
      ) : null}
    </section>
  );
}

/**
 * ADD CHARGE… — a charge of the invoice's own (141): a delivery fee, an item.
 * Untaxed in v1; anything taxable belongs on an order. Qty × price.
 */
function AddLineDialog({
  invoiceId,
  orgId,
  nextSort,
  onClose,
}: {
  invoiceId: string;
  orgId: string;
  nextSort: number;
  onClose: () => void;
}) {
  const supabase = createClient();
  const router = useRouter();
  const [type, setType] = useState<"item" | "delivery">("delivery");
  const [description, setDescription] = useState("Delivery Fee");
  const [qty, setQty] = useState("1");
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const q = Number(qty.trim() || "1");
  const p = parseMoney(price);
  const amount = p !== null && Number.isFinite(q) && q > 0 ? Math.round(q * p * 100) / 100 : null;
  const ready = !busy && description.trim() !== "" && amount !== null;

  async function add() {
    if (!ready || amount === null) return;
    setBusy(true);
    setError(null);
    const { data, error: e } = await supabase
      .from("customer_invoice_lines")
      .insert({
        // Explicit — design rule 1.
        org_id: orgId,
        invoice_id: invoiceId,
        line_type: type,
        description: description.trim(),
        qty: q,
        unit_price: p,
        amount,
        sort: nextSort,
      })
      .select("id");
    setBusy(false);
    if (e || !data?.length) {
      setError(e?.message ?? "Nothing was added — the database refused it and said nothing.");
      return;
    }
    onClose();
    router.refresh();
  }

  const caption = (text: string) => (
    <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">{text}</span>
  );

  return (
    <Dialog
      title="Add a charge"
      onClose={() => {
        if (!busy) onClose();
      }}
      busy={busy}
      width="max-w-lg"
      onSubmit={() => void add()}
      footer={
        <div className="flex items-center justify-end gap-4">
          <button type="button" className={DIALOG_CANCEL_CLASS} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={DIALOG_COMMIT_CLASS} onClick={() => void add()} disabled={!ready}>
            {busy ? "Adding…" : amount !== null ? `Add ${money(amount)}` : "Add"}
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="space-y-1.5">
          {caption("Type")}
          <Radio
            options={FREE_LINE_TYPES}
            value={type}
            onChange={(next) => {
              setType(next);
              if (next === "delivery" && description.trim() === "") setDescription("Delivery Fee");
            }}
            ariaLabel="Type of charge"
          />
        </div>
        <label className="block space-y-1.5">
          {caption("Description")}
          <TextInput value={description} onValueChange={setDescription} clearLabel="Clear description" className="w-full" />
        </label>
        <div className="flex flex-wrap gap-6">
          <label className="block space-y-1.5">
            {caption("Qty")}
            <TextInput value={qty} onValueChange={setQty} inputMode="decimal" aria-label="Quantity"
                       className="w-24 text-right tabular-nums" />
          </label>
          <label className="block space-y-1.5">
            {caption("Price")}
            <TextInput value={price} onValueChange={setPrice} inputMode="decimal" aria-label="Price"
                       className="w-32 text-right tabular-nums" />
          </label>
        </div>
        {error ? <p className="text-sm text-accent">{error}</p> : null}
      </div>
    </Dialog>
  );
}
