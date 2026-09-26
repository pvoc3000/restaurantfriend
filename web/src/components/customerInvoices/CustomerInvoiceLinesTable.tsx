"use client";

import Link from "next/link";

import { DataTable, type DataColumn } from "@/components/catalog/DataTable";
import { InlineValue } from "@/components/catalog/InlineValue";
import { money } from "@/lib/specialOrders";
import { SQUARE_ITEM_LABEL, SQUARE_ITEM_OPTIONS, type SquareItem } from "@/lib/customerInvoices";

/** One invoice line with its order's money today — all plain data, built on
 *  the server. */
export type InvoiceLineRow = {
  id: string;
  /** The order the line bills — Sold as is the ORDER's field (129). */
  orderId: string;
  /** The line's place on the invoice, the default order. */
  position: number;
  description: string;
  href: string;
  orderStatus: string;
  square_item: SquareItem;
  items: number;
  discount: number;
  delivery: number;
  rush: number;
  tax: number;
  paid: number;
  balance: number;
  /** What the customer was last sent for this line, shown only when the
   *  line has moved since (128). */
  sentAmount: number | null;
  /** What THIS invoice bills for the order (139: a deposit or part payment is
   *  less than the order's balance). */
  amount: number;
  /** A deposit or part payment on a draft — its amount may be changed here;
   *  the database checks it against what is not yet invoiced. */
  amountEditable: boolean;
};

const figure = (v: number, negative = false) => (v ? `${negative ? "−" : ""}${money(v)}` : "—");
const sum = (rows: InvoiceLineRow[], pick: (r: InvoiceLineRow) => number) =>
  Math.round(rows.reduce((a, r) => a + pick(r), 0) * 100) / 100;

/**
 * THE INVOICE'S ORDERS, as a `DataTable` like every list (Mark, 2026-09-23) —
 * sortable, hideable and reorderable columns, a Total row under the money.
 *
 * The money columns are the ORDER's payments figures today (Mark: "Items,
 * Discount, Delivery, Tax, Paid, Balance", then rush fee), so a row reads
 * across. Sold as is the ORDER's field (129), edited here too until the
 * invoice is paid or void — the line follows it.
 */
export function CustomerInvoiceLinesTable({
  rows,
  itemEditable,
}: {
  rows: InvoiceLineRow[];
  /** Supervisor+ on an invoice still collecting. */
  itemEditable: boolean;
}) {
  const money_ = (key: keyof InvoiceLineRow & string, label: string, negative = false): DataColumn<InvoiceLineRow> => ({
    key,
    label,
    width: 110,
    align: "right",
    sortValue: (r) => r[key] as number,
    render: (r) => <span className="tabular-nums text-muted">{figure(r[key] as number, negative)}</span>,
  });

  const columns: DataColumn<InvoiceLineRow>[] = [
    {
      key: "line",
      label: "Line",
      width: 320,
      pinned: true,
      wrap: true,
      sortValue: (r) => r.position,
      render: (r) => (
        <Link href={r.href} className="hover:underline">
          {r.description}
        </Link>
      ),
    },
    {
      key: "status",
      label: "Order status",
      width: 110,
      sortValue: (r) => r.orderStatus,
      render: (r) => <span className="text-muted">{r.orderStatus}</span>,
    },
    {
      key: "sold_as",
      label: "Sold as",
      width: 170,
      sortValue: (r) => r.square_item,
      render: (r) =>
        itemEditable ? (
          <InlineValue
            table="special_orders"
            id={r.orderId}
            column="square_item"
            kind="pick"
            nullable={false}
            value={r.square_item}
            options={SQUARE_ITEM_OPTIONS}
            ariaLabel={`Square item for ${r.description}`}
          />
        ) : (
          <span className="text-muted">{SQUARE_ITEM_LABEL[r.square_item]}</span>
        ),
    },
    money_("items", "Items"),
    money_("discount", "Discount", true),
    money_("delivery", "Delivery"),
    money_("rush", "Rush fee"),
    money_("tax", "Tax"),
    money_("paid", "Paid"),
    {
      key: "balance",
      label: "Balance",
      width: 120,
      align: "right",
      sortValue: (r) => r.balance,
      render: (r) => (
        <span className="tabular-nums">
          {money(r.balance)}
          {r.sentAmount !== null ? (
            <span className="block text-[12px] text-accent">sent as {money(r.sentAmount)}</span>
          ) : null}
        </span>
      ),
    },
    {
      key: "amount",
      label: "This invoice",
      width: 130,
      align: "right",
      sortValue: (r) => r.amount,
      render: (r) =>
        r.amountEditable ? (
          <InlineValue
            table="customer_invoice_lines"
            id={r.id}
            column="amount"
            kind="number"
            nullable={false}
            value={r.amount}
            align="right"
            className="text-right"
            ariaLabel={`Amount for ${r.description}`}
            format={(v) => money(Number(v))}
          />
        ) : (
          <span className="tabular-nums font-semibold">{money(r.amount)}</span>
        ),
    },
  ];

  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={(r) => r.id}
      storageKey="customer-invoice-lines.v1"
      defaultSort={{ key: "line", dir: "asc" }}
      columnChooser
      totals={(shown) => ({
        line: "Total",
        items: <span className="tabular-nums">{figure(sum(shown, (r) => r.items))}</span>,
        discount: <span className="tabular-nums">{figure(sum(shown, (r) => r.discount), true)}</span>,
        delivery: <span className="tabular-nums">{figure(sum(shown, (r) => r.delivery))}</span>,
        rush: <span className="tabular-nums">{figure(sum(shown, (r) => r.rush))}</span>,
        tax: <span className="tabular-nums">{figure(sum(shown, (r) => r.tax))}</span>,
        paid: <span className="tabular-nums">{figure(sum(shown, (r) => r.paid))}</span>,
        balance: <span className="tabular-nums">{money(sum(shown, (r) => r.balance))}</span>,
        amount: <span className="tabular-nums font-semibold">{money(sum(shown, (r) => r.amount))}</span>,
      })}
      empty={<p className="text-sm text-muted">No orders on this invoice.</p>}
    />
  );
}
