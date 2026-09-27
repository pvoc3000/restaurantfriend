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

/** One line of the invoice, as plain data built on the server. */
export type InvoiceLineRow = {
  id: string;
  /** Its place on the paper — the groups in order, then each group's lines. */
  position: number;
  /** The band: the order's label, or "Other charges". */
  group: string;
  description: string;
  qty: number | null;
  unitPrice: number | null;
  amount: number;
  /** A FREE line (141) — the invoice's own, editable on a draft. */
  free: boolean;
};

const figure = (v: number | null) => (v === null ? "" : money(v));

/**
 * THE INVOICE'S LINES (141) — what the paper says, banded by order like the
 * PDF, each band closed by what that order bills here. An order's lines are a
 * copy of its charges and change only by Update above; a FREE line — a
 * delivery fee, an item — is the invoice's own and is edited here while the
 * invoice is a draft. Its amount is qty × price when both are set.
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

  const editable = (r: InvoiceLineRow) => draft && r.free;

  const columns: DataColumn<InvoiceLineRow>[] = [
    {
      key: "line",
      label: "Line",
      width: 380,
      pinned: true,
      wrap: true,
      sortValue: (r) => r.position,
      render: (r) =>
        editable(r) ? (
          <InlineValue table="customer_invoice_lines" id={r.id} column="description" value={r.description}
                       nullable={false} ariaLabel="Line description" />
        ) : (
          r.description
        ),
    },
    {
      key: "qty",
      label: "Qty",
      width: 90,
      align: "right",
      sortValue: (r) => r.qty ?? 0,
      render: (r) =>
        editable(r) ? (
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
        editable(r) ? (
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
        editable(r) && (r.qty === null || r.unitPrice === null) ? (
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
              r.free ? (
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

  return (
    <section className="space-y-2">
      <div className="flex max-w-[60rem] items-center justify-between gap-4">
        <SectionHeading count={rows.length}>Lines</SectionHeading>
        {draft ? (
          <button type="button" className={SMALL_BUTTON_CLASS} onClick={() => setAdding(true)}>
            Add Line…
          </button>
        ) : null}
      </div>
      <div className="max-w-[60rem]">
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(r) => r.id}
          storageKey="customer-invoice-lines.v2"
          defaultSort={{ key: "line", dir: "asc" }}
          group={{
            label: (r) => r.group,
            sortKey: "line",
            summary: (rs) => ({
              amount: (
                <span className="tabular-nums font-semibold">
                  {money(Math.round(rs.reduce((a, r) => a + r.amount, 0) * 100) / 100)}
                </span>
              ),
            }),
          }}
          totals={() => ({
            line: "Total",
            amount: <span className="tabular-nums font-semibold">{money(total)}</span>,
          })}
          empty={<p className="text-sm text-muted">No lines yet — add an order or a line.</p>}
        />
      </div>
      {error ? <p className="text-[13px] text-accent">{error}</p> : null}
      {adding ? (
        <AddLineDialog
          invoiceId={invoiceId}
          orgId={orgId}
          nextSort={rows.filter((r) => r.free).length}
          onClose={() => setAdding(false)}
        />
      ) : null}
    </section>
  );
}

/**
 * ADD LINE… — a charge of the invoice's own (141): a delivery fee, an item.
 * Untaxed in v1; anything taxable belongs on an order. Qty × price, or just an
 * amount.
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
      title="Add a line"
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
          {caption("Kind")}
          <Radio
            options={FREE_LINE_TYPES}
            value={type}
            onChange={(next) => {
              setType(next);
              if (next === "delivery" && description.trim() === "") setDescription("Delivery Fee");
            }}
            ariaLabel="Kind of line"
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
