"use client";

import { useMemo, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  Dialog,
  DIALOG_CANCEL_CLASS,
  DIALOG_COMMIT_CLASS,
} from "@/components/ui/Dialog";
import { Checkbox } from "@/components/ui/Checkbox";
import { money } from "@/lib/purchaseOrders";
import { matchInvoiceToOrder } from "@/lib/invoiceMatch";
import { toInvoiceLine, type VendorInvoiceLine } from "@/lib/invoices";
import type { InvoiceLine } from "@/lib/invoiceExtraction";
import type { PoLine } from "@/lib/purchaseOrders";

export type LinkCandidate = {
  id: string;
  po_number: string;
  order_date: string;
  status: string;
  /** Named so `matchPrintedPoNumber` can refuse a number that resolves outside
   *  this invoice's own vendor and location. */
  vendor_id: string;
  location_id: string;
  lines: PoLine[];
};

/**
 * Attach this invoice to a purchase order — and this IS the merge UI.
 *
 * One invoice covering two orders is handled by running this twice: each pass
 * links whatever it can match and leaves the rest, because the join lives on
 * the LINE (migration 025) and there is no header to contradict.
 *
 * The OTHER direction — one order invoiced in two parts — needs no UI at all:
 * invoice A links lines 1–5, invoice B links 6–9, and nothing collides because
 * there is no unique constraint on purchase_order_item_id. Only the merge
 * direction costs anything to build.
 *
 * Each candidate shows how many of this invoice's still-unlinked lines it would
 * claim, computed live — 20 lines against 20 is nothing, and a number you can
 * see beats a promise you can't.
 */
export function LinkToPo({
  lines,
  candidates,
  onDone,
}: {
  lines: VendorInvoiceLine[];
  /** This vendor's orders at this location, in a recent window. */
  candidates: LinkCandidate[];
  onDone: () => void;
}) {
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const [attributeRest, setAttributeRest] = useState(false);
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);

  const unlinked = useMemo(
    () => lines.filter((l) => l.purchase_order_id === null),
    [lines]
  );

  // What each candidate would take. The matcher is pure over two arrays, so
  // asking it a hypothetical costs nothing and commits to nothing.
  const previews = useMemo(() => {
    const asInvoiceLines = unlinked.map(toInvoiceLine);
    return new Map(
      candidates.map((c) => {
        const { matches } = matchInvoiceToOrder(c.lines, asInvoiceLines);
        return [c.id, matches.filter((m) => m.invoice !== null).length];
      })
    );
  }, [candidates, unlinked]);

  function close() {
    if (pending) return;
    setOpen(false);
    setChosen(null);
    setAttributeRest(false);
    setFailed(null);
  }

  function link() {
    const order = candidates.find((c) => c.id === chosen);
    if (!order) return;
    setFailed(null);

    startTransition(async () => {
      // Keyed by the OBJECT handed to the matcher, so its answer maps back to a
      // row with no index arithmetic to get wrong.
      const rowOf = new Map<InvoiceLine, VendorInvoiceLine>();
      const asInvoiceLines: InvoiceLine[] = unlinked.map((l) => {
        const shape = toInvoiceLine(l);
        rowOf.set(shape, l);
        return shape;
      });

      const { matches } = matchInvoiceToOrder(order.lines, asInvoiceLines);
      const linked = new Set<string>();

      for (const match of matches) {
        if (!match.invoice) continue;
        const row = rowOf.get(match.invoice);
        if (!row) continue;
        const { error } = await supabase
          .from("vendor_invoice_lines")
          .update({
            purchase_order_id: order.id,
            purchase_order_item_id: match.line.id,
          })
          .eq("id", row.id);
        if (error) {
          setFailed(error.message);
          return;
        }
        linked.add(row.id);
      }

      // The coarse attribution — the answer to freight, to a fuel surcharge,
      // and to an order you know is right where every line match failed. It
      // sets purchase_order_id only, which is exactly what migration 025's
      // check constraint permits: naming a LINE obliges you to name its order,
      // but naming an order alone is fine.
      if (attributeRest) {
        const rest = unlinked.filter((l) => !linked.has(l.id)).map((l) => l.id);
        if (rest.length > 0) {
          const { error } = await supabase
            .from("vendor_invoice_lines")
            .update({ purchase_order_id: order.id })
            .in("id", rest);
          if (error) {
            setFailed(error.message);
            return;
          }
        }
      }

      close();
      onDone();
    });
  }

  const chosenPreview = chosen ? previews.get(chosen) ?? 0 : 0;
  const restCount = unlinked.length - chosenPreview;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={candidates.length === 0}
        title={
          candidates.length === 0
            ? "This vendor has no recent orders at this location to link to"
            : undefined
        }
        // A TEXT BUTTON, matching the Reconcile links it now sits with (Mark,
        // 2026-09-02) — a bordered button on a row of its own cost this column
        // a whole line, and on a screen whose point is vertical room that is a
        // line the lines table wanted.
        className="text-sm text-ink underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900 disabled:opacity-35 disabled:no-underline"
      >
        Link to PO…
      </button>

      {open && (
        <Dialog
          title="Link to a purchase order"
          onClose={close}
          busy={pending}
          width="max-w-2xl"
          footer={
            <>
              <button
                type="button"
                onClick={close}
                disabled={pending}
                className={DIALOG_CANCEL_CLASS}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={link}
                disabled={!chosen || pending}
                className={DIALOG_COMMIT_CLASS}
              >
                {pending ? "Linking…" : "Link"}
              </button>
            </>
          }
        >
          <div className="space-y-4">
            <p className="text-sm text-muted">
              {unlinked.length} of {lines.length}{" "}
              {lines.length === 1 ? "line" : "lines"} on this invoice
              {unlinked.length === 1 ? " isn't" : " aren't"} linked yet. Link to
              one order at a time — run this again for a second.
            </p>

            <ul className="divide-y divide-hairline border border-hairline">
              {candidates.map((c) => {
                const would = previews.get(c.id) ?? 0;
                return (
                  <li key={c.id}>
                    <label className="flex cursor-pointer items-center gap-3 px-4 py-3 text-sm hover:bg-neutral-50">
                      <input
                        type="radio"
                        name="link-po"
                        checked={chosen === c.id}
                        onChange={() => setChosen(c.id)}
                        className="accent-black"
                      />
                      <span className="font-semibold">{c.po_number}</span>
                      <span className="text-muted">{c.order_date}</span>
                      <span className="text-muted">{c.status}</span>
                      <span className="ml-auto tabular-nums text-muted">
                        {money(
                          c.lines.reduce(
                            (s, l) =>
                              s + Number(l.qty_ordered ?? 0) * Number(l.unit_price ?? 0),
                            0
                          )
                        )}
                      </span>
                      <span
                        className={
                          would > 0
                            ? "font-semibold text-[var(--rf-green-600)]"
                            : "text-faint"
                        }
                      >
                        {would > 0 ? `${would} would match` : "no matches"}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>

            {chosen && (
              <label className="flex items-start gap-3 text-sm">
                <Checkbox
                  checked={attributeRest}
                  onChange={() => setAttributeRest((v) => !v)}
                  label="Attribute the remaining lines to this PO too"
                  size={18}
                />
                <span>
                  Attribute the other{" "}
                  {restCount === 1 ? "line" : `${restCount} lines`} to this order
                  too
                  <span className="block text-muted">
                    Without a specific order line — which is what a delivery fee
                    or a fuel surcharge needs, and what an order you know is
                    right needs when no line matched.
                  </span>
                </span>
              </label>
            )}

            {failed && <p className="text-sm text-accent">{failed}</p>}
          </div>
        </Dialog>
      )}
    </>
  );
}
