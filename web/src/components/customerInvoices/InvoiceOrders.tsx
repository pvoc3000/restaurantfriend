"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { confirmDialog, splitConfirmMessage } from "@/lib/confirm";
import { InlineValue } from "@/components/catalog/InlineValue";
import { Checkbox } from "@/components/ui/Checkbox";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { SMALL_BUTTON_CLASS } from "@/components/ui/buttons";
import { money } from "@/lib/specialOrders";
import { usDate } from "@/lib/specialOrderDocs";
import { SQUARE_ITEM_LABEL, SQUARE_ITEM_OPTIONS, type InvoiceGroupKind, type SquareItem } from "@/lib/customerInvoices";

/** One order on the invoice, as plain data built on the server. */
export type InvoiceOrderRow = {
  orderId: string;
  label: string;
  /** The order's record, its breadcrumb leading back here (`withFrom`). */
  href: string;
  status: string;
  kind: InvoiceGroupKind;
  /** A fixed line's own word — "Deposit", "Part payment" — beside the order. */
  note: string | null;
  soldAs: SquareItem;
  /** What it bills on this invoice. */
  billed: number;
  /** What a fresh copy of the order would bill here now (141). */
  expected: number;
  /** The draft's copy no longer matches the order. */
  stale: boolean;
  /** What it copied here: its items, then its discount, delivery, rush, tax. */
  lines: { description: string; qty: number | null; unitPrice: number | null; amount: number }[];
};

type Unbilled = {
  id: string;
  number: string;
  title: string | null;
  event_date: string | null;
  status: string;
  total: number;
  billed: number;
  unbilled: number;
};

/**
 * THE INVOICE'S ORDERS (141) — one row each, for what it bills HERE, with the
 * draft's commands: Add Orders… on the heading's line, and Update / Remove on
 * a row. An order's lines are a COPY of its charges, so an order that has
 * changed since it was added says so ("now $x") and Update re-takes it; Send
 * refuses until it has been. A deposit is a fixed figure, edited in place.
 * Sold as is the ORDER's (129), and follows to the lines until the invoice is
 * paid or void.
 */
export function InvoiceOrders({
  invoiceId,
  customerId,
  locationId,
  rows,
  draft,
  soldAsEditable,
}: {
  invoiceId: string;
  customerId: string;
  locationId: string | null;
  rows: InvoiceOrderRow[];
  /** Supervisor+ on an invoice that has not gone out and holds no money. */
  draft: boolean;
  soldAsEditable: boolean;
}) {
  const supabase = createClient();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // The rows opened to show what they copied (Mark, 2026-09-27: the Lines
  // section repeated this section; now an order's lines are under its row).
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setOpen((was) => {
      const next = new Set(was);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function call(key: string, fn: string, args: Record<string, unknown>) {
    setBusy(key);
    setError(null);
    const { error: e } = await supabase.rpc(fn, args);
    setBusy(null);
    if (e) setError(e.message);
    else router.refresh();
  }

  async function remove(r: InvoiceOrderRow) {
    const ok = await confirmDialog({
      ...splitConfirmMessage(`Take ${r.label} off this invoice?\n\nIts lines come off with it. The order is untouched.`),
      confirmLabel: "Remove",
      tone: "danger",
    });
    if (ok) await call(r.orderId, "remove_order_from_customer_invoice", { p_invoice: invoiceId, p_order: r.orderId });
  }

  return (
    <section className="space-y-2">
      <div className="flex max-w-[60rem] items-center justify-between gap-4">
        <SectionHeading count={rows.length}>Orders</SectionHeading>
        {draft && locationId ? (
          <button type="button" className={SMALL_BUTTON_CLASS} onClick={() => setAdding(true)}>
            Add Orders…
          </button>
        ) : null}
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">No orders on this invoice.</p>
      ) : (
        <table className="w-full max-w-[60rem] border-collapse text-[14px]">
          <thead>
            <tr className="border-b-2 border-ink text-[11px] uppercase tracking-[0.12em]">
              <th className="px-3 py-2 text-left">Order</th>
              <th className="w-28 px-3 py-2 text-left">Status</th>
              <th className="w-44 px-3 py-2 text-left">Sold as</th>
              <th className="w-32 px-3 py-2 text-right">This invoice</th>
              {draft ? <th className="w-44 px-3 py-2" /> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Fragment key={r.orderId}>
              <tr className={`${open.has(r.orderId) ? "" : "border-b border-hairline"} align-top`}>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => toggle(r.orderId)}
                    aria-expanded={open.has(r.orderId)}
                    aria-label={`${open.has(r.orderId) ? "Hide" : "Show"} what ${r.label} bills`}
                    className="mr-1.5 inline-block w-4 text-subtle hover:text-ink"
                  >
                    {open.has(r.orderId) ? "▾" : "▸"}
                  </button>
                  <Link href={r.href} className="hover:underline">
                    {r.label}
                  </Link>
                  {r.note ? <span className="ml-2 text-[13px] text-muted">{r.note}</span> : null}
                  {r.stale ? (
                    <span className="mt-0.5 block text-[13px]">
                      <span className="box-decoration-clone bg-mark-fill px-1">
                        The order has changed — it now comes to {money(r.expected)} here.
                      </span>
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-muted">{r.status}</td>
                <td className="px-3 py-2">
                  {soldAsEditable ? (
                    <InlineValue
                      table="special_orders"
                      id={r.orderId}
                      column="square_item"
                      kind="pick"
                      nullable={false}
                      value={r.soldAs}
                      options={SQUARE_ITEM_OPTIONS}
                      ariaLabel={`Square item for ${r.label}`}
                    />
                  ) : (
                    <span className="text-muted">{SQUARE_ITEM_LABEL[r.soldAs]}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold">
                  {draft && r.kind === "deposit" ? (
                    <InlineValue
                      table="customer_invoice_lines"
                      column="amount"
                      kind="number"
                      nullable={false}
                      value={r.billed}
                      align="right"
                      className="text-right"
                      ariaLabel={`Deposit for ${r.label}`}
                      format={(v) => money(Number(v))}
                      onWrite={async (next) => {
                        const { error: e } = await supabase.rpc("set_invoice_deposit", {
                          p_invoice: invoiceId,
                          p_order: r.orderId,
                          p_amount: Number(next),
                        });
                        return { error: e?.message ?? null };
                      }}
                    />
                  ) : (
                    money(r.billed)
                  )}
                </td>
                {draft ? (
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {r.stale ? (
                      <button
                        type="button"
                        className={`${SMALL_BUTTON_CLASS} mr-2`}
                        disabled={busy !== null}
                        onClick={() =>
                          void call(r.orderId, "update_order_on_customer_invoice", { p_invoice: invoiceId, p_order: r.orderId })
                        }
                      >
                        {busy === r.orderId ? "Updating…" : "Update"}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className={SMALL_BUTTON_CLASS}
                      disabled={busy !== null}
                      onClick={() => void remove(r)}
                    >
                      Remove
                    </button>
                  </td>
                ) : null}
              </tr>
              {open.has(r.orderId) ? (
                <tr className="border-b border-hairline">
                  <td colSpan={draft ? 5 : 4} className="px-3 pb-3 pl-9">
                    <table className="w-full max-w-[40rem] text-[13px]">
                      <tbody>
                        {r.lines.map((l, i) => (
                          <tr key={i}>
                            <td className="py-0.5 pr-3">{l.description}</td>
                            <td className="w-20 py-0.5 pr-3 text-right tabular-nums text-muted">
                              {l.qty === null ? "" : l.qty % 1 === 0 ? l.qty : l.qty.toFixed(2)}
                            </td>
                            <td className="w-24 py-0.5 pr-3 text-right tabular-nums text-muted">
                              {l.unitPrice === null ? "" : money(l.unitPrice)}
                            </td>
                            <td className={`w-28 py-0.5 text-right tabular-nums ${l.amount < 0 ? "text-muted" : ""}`}>
                              {money(l.amount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </td>
                </tr>
              ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
      {error ? <p className="text-[13px] text-accent">{error}</p> : null}
      {adding && locationId ? (
        <AddOrdersDialog
          invoiceId={invoiceId}
          customerId={customerId}
          locationId={locationId}
          onClose={() => setAdding(false)}
        />
      ) : null}
    </section>
  );
}

/**
 * ADD ORDERS… — the customer's orders at this invoice's shop with something
 * left to bill (`customer_unbilled_orders`, 141), oldest first, none ticked.
 * Each is copied onto the draft for what it has left: its charges, less what
 * its other invoices bill.
 */
function AddOrdersDialog({
  invoiceId,
  customerId,
  locationId,
  onClose,
}: {
  invoiceId: string;
  customerId: string;
  locationId: string;
  onClose: () => void;
}) {
  const supabase = createClient();
  const router = useRouter();
  const [rows, setRows] = useState<Unbilled[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void supabase
      .rpc("customer_unbilled_orders", { p_customer: customerId, p_location: locationId })
      .then(({ data, error: e }) => {
        if (!live) return;
        if (e) setError(e.message);
        setRows(((data ?? []) as Unbilled[]).map((r) => ({ ...r, unbilled: Number(r.unbilled), total: Number(r.total), billed: Number(r.billed) })));
      });
    return () => {
      live = false;
    };
    // Once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chosen = (rows ?? []).filter((r) => picked.has(r.id));
  const sum = Math.round(chosen.reduce((a, r) => a + r.unbilled, 0) * 100) / 100;

  async function add() {
    setBusy(true);
    setError(null);
    const { error: e } = await supabase.rpc("add_orders_to_customer_invoice", {
      p_invoice: invoiceId,
      p_orders: chosen.map((r) => r.id),
    });
    setBusy(false);
    if (e) {
      setError(e.message);
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <Dialog
      title="Add orders"
      onClose={() => {
        if (!busy) onClose();
      }}
      busy={busy}
      width="max-w-xl"
      onSubmit={() => {
        if (chosen.length && !busy) void add();
      }}
      footer={
        <div className="flex items-center justify-end gap-4">
          <button type="button" className={DIALOG_CANCEL_CLASS} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={DIALOG_COMMIT_CLASS} onClick={() => void add()} disabled={!chosen.length || busy}>
            {busy ? "Adding…" : chosen.length ? `Add ${chosen.length} · ${money(sum)}` : "Add"}
          </button>
        </div>
      }
    >
      {rows === null ? (
        <p className="text-sm text-muted">Finding their orders…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted">Nothing of theirs at this shop is left to bill.</p>
      ) : (
        <ul className="divide-y divide-hairline">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-4 py-1.5">
              <Checkbox
                checked={picked.has(r.id)}
                onChange={(on) =>
                  setPicked((p) => {
                    const next = new Set(p);
                    if (on) next.add(r.id);
                    else next.delete(r.id);
                    return next;
                  })
                }
              >
                <span>
                  #{r.number}
                  {r.title ? ` · ${r.title}` : ""}
                  {r.event_date ? <span className="text-muted"> · {usDate(r.event_date)}</span> : null}
                </span>
              </Checkbox>
              <span className="shrink-0 text-right tabular-nums">
                {money(r.unbilled)}
                {r.billed > 0 ? <span className="block text-[12px] text-muted">of {money(r.total)}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      {error ? <p className="mt-3 text-sm text-accent">{error}</p> : null}
    </Dialog>
  );
}
