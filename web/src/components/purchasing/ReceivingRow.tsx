"use client";

import { useState } from "react";
import { InlineValue } from "@/components/catalog/InlineValue";
import { money, packType, type PoLine } from "@/lib/purchaseOrders";
import type { LineMatch } from "@/lib/invoiceMatch";
import { qtyLabel, receivedClass, type PriceAction } from "@/lib/receiving";

/**
 * One PO line, as a unit of work rather than a table row.
 *
 * A person receiving a delivery goes down it box by box, and the row is what
 * they're standing in front of: what was ordered, what was billed, what
 * actually turned up, and what that costs. Three bands that wrap, so the same
 * component works in half a 1440 window and across a 768 iPad.
 *
 * Deliberately not a `DataTable`: eight columns of live controls at half width
 * would scroll sideways, and the row's controls need thumb-sized targets. The
 * order guide made the same call for the same reason.
 */
export function ReceivingRow({
  line,
  match,
  action,
  canReceive,
  saving,
  onSetReceived,
  onPrice,
}: {
  line: PoLine;
  match: LineMatch | undefined;
  /** The two-stage price button's current stage, or null when nothing's owed. */
  action: PriceAction | null;
  /** purchaser+ — below that every control renders as text. */
  canReceive: boolean;
  saving: boolean;
  onSetReceived: (value: number | null) => void;
  onPrice: (action: PriceAction) => void;
}) {
  // The GuideLine pattern: the draft is null at rest and the render falls back
  // to the prop, so a refresh landing mid-edit can't fight what's being typed
  // and there is no server value copied into state to go stale.
  const [draft, setDraft] = useState<string | null>(null);

  const pack = packType(line);
  const ordered = Number(line.qty_ordered);
  const received = line.qty_received === null ? null : Number(line.qty_received);
  const invoiceQty = match?.invoice?.qty ?? null;
  const name = line.vendor_items?.inventory_items?.name ?? line.description ?? "Untitled";

  function commit(raw: string) {
    setDraft(null);
    const text = raw.trim();
    // Empty is UNTOUCHED, not zero — the two are different answers and the box
    // colours them differently.
    const next = text === "" ? null : Number(text);
    if (next !== null && Number.isNaN(next)) return;
    if (next === received) return;
    onSetReceived(next);
  }

  function step(by: number) {
    const base = received ?? 0;
    const next = Math.max(0, base + by);
    onSetReceived(next);
  }

  return (
    <li
      className={`border-b border-hairline px-3 py-3 ${
        match?.qtyDiffers ? "bg-[var(--rf-yellow-50)]" : ""
      }`}
    >
      {/* Band 1 — what this is. */}
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-[15px] font-semibold text-ink">{name}</span>
        {match?.by === "description" && (
          <span
            className="text-accent"
            title="Matched on the description, not the vendor's item number — check it"
          >
            ≈
          </span>
        )}
        {match?.priceUncertain && match.invoice && (
          <span
            className="text-accent"
            title={`The invoice's own figures don't multiply out — it prints ${match.invoice.qty} × ${match.invoice.unit_price} but a line total of ${match.invoice.extended}. The price shown is the line total divided by the quantity. Often a catch-weight item priced by the pound; check the page before taking it.`}
          >
            ?
          </span>
        )}
      </div>
      <div className="mt-0.5 text-xs text-muted">
        {[line.product_id, line.brand, line.description].filter(Boolean).join(" · ") ||
          "—"}
      </div>

      {/* Band 2 — the three quantities, ending in the one you touch. */}
      <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2">
        <Chip
          label="Ordered"
          value={qtyLabel(ordered, pack)}
          takeable={canReceive && received !== ordered}
          saving={saving}
          title="Record this line as arriving exactly as ordered"
          onTake={() => onSetReceived(ordered)}
        />
        <Chip
          label="Invoice"
          value={invoiceQty === null ? "—" : qtyLabel(invoiceQty, pack)}
          // Enabled purely on the invoice having printed a quantity — NOT on
          // `match.qtyDiffers`, which compares against what's been received and
          // so is false on every untouched line. Gating on it was why reading an
          // invoice appeared to buy nothing (Mark, 2026-07-31).
          takeable={canReceive && invoiceQty !== null && Number(invoiceQty) !== received}
          saving={saving}
          title={
            invoiceQty === null
              ? "No quantity for this line on the invoice"
              : "Record what the invoice says arrived"
          }
          onTake={() => onSetReceived(Number(invoiceQty))}
        />

        <div className="ml-auto flex items-center gap-2 whitespace-nowrap">
          <span className="text-[11px] uppercase tracking-[0.12em] text-subtle">
            Received
          </span>
          {canReceive ? (
            <>
              <button
                type="button"
                disabled={saving}
                onClick={() => step(-1)}
                aria-label={`Decrease received ${name} by one`}
                className="flex h-11 w-11 items-center justify-center rounded-full border-[1.5px] border-ink text-ink hover:bg-neutral-100 disabled:opacity-35"
              >
                −
              </button>
              <input
                inputMode="decimal"
                disabled={saving}
                value={draft ?? (received === null ? "" : String(received))}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={(e) => commit(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  if (e.key === "Escape") setDraft(null);
                }}
                placeholder=""
                aria-label={`Received quantity for ${name}`}
                title="Blank means nobody has counted this yet; 0 means nothing arrived"
                className={`h-11 w-20 px-1 text-center text-[15px] font-semibold tabular-nums ${receivedClass(ordered, received)}`}
              />
              <button
                type="button"
                disabled={saving}
                onClick={() => step(1)}
                aria-label={`Increase received ${name} by one`}
                className="flex h-11 w-11 items-center justify-center rounded-full border-[1.5px] border-ink text-ink hover:bg-neutral-100 disabled:opacity-35"
              >
                +
              </button>
            </>
          ) : (
            <span
              className={`flex h-11 w-20 items-center justify-center text-[15px] font-semibold tabular-nums ${receivedClass(ordered, received)}`}
            >
              {received === null ? "" : received}
            </span>
          )}
          {pack && <span className="text-[11px] text-subtle">{pack}</span>}
        </div>
      </div>

      {/* Band 3 — the money, and the note that never leaves the building.
          One button, two stages, and its label says which one it's on: clicking
          a price to accept it was "a weird mechanic" (Mark, 2026-07-31). */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        {/* The arrow shows the value being REPLACED, which is a different value
            at each stage: stage 1 replaces the order's price with the invoice's,
            stage 2 replaces the CATALOG's with the order's. Printing the line
            price on both sides — which is what stage 2 did at first — reads as
            "$51.23 → $51.23" and says nothing. */}
        <span className="tabular-nums text-muted">
          {action?.stage === "vendor" && (
            <span className="mr-1 text-[11px] uppercase tracking-[0.12em] text-subtle">
              Catalog
            </span>
          )}
          {money(action ? action.current : line.unit_price)}
          {action && (
            <>
              {" → "}
              <span className="text-ink">{money(action.price)}</span>
            </>
          )}
        </span>

        {action && canReceive && (
          <button
            type="button"
            disabled={saving}
            onClick={() => onPrice(action)}
            title={
              action.stage === "po"
                ? `Set this line's price to the ${money(action.price)} you were billed. The catalog is a separate, second step.`
                : `Set the vendor's catalog price to ${money(action.price)}${
                    action.hasOverride ? " for this location" : ""
                  }, so future orders quote it.`
            }
            className="h-9 border border-ink bg-white px-3 text-[12px] font-semibold uppercase tracking-[0.06em] transition-colors hover:bg-ink hover:text-white disabled:opacity-35"
          >
            {action.stage === "po" ? "Update PO" : "Update vendor"}
            {action.uncertain && <span className="ml-1 text-accent">?</span>}
          </button>
        )}

        <span className="ml-auto min-w-40 max-w-full">
          {canReceive ? (
            <InlineValue
              table="purchase_order_items"
              id={line.id}
              column="discrepancy_note"
              value={line.discrepancy_note}
              placeholder="Receiving note"
              className="text-muted"
            />
          ) : (
            <span className="text-muted">{line.discrepancy_note ?? ""}</span>
          )}
        </span>
      </div>
    </li>
  );
}

/** A quantity you can read, and take in one tap. The guide's suggestion chip. */
function Chip({
  label,
  value,
  takeable,
  saving,
  title,
  onTake,
}: {
  label: string;
  value: string;
  takeable: boolean;
  saving: boolean;
  title: string;
  onTake: () => void;
}) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-[11px] uppercase tracking-[0.12em] text-subtle">{label}</span>
      {takeable ? (
        <button
          type="button"
          disabled={saving}
          onClick={onTake}
          title={title}
          className="px-1 text-sm tabular-nums text-ink underline decoration-dotted underline-offset-4 hover:bg-neutral-100 disabled:opacity-35"
        >
          {value}
        </button>
      ) : (
        <span className="px-1 text-sm tabular-nums text-muted" title={title}>
          {value}
        </span>
      )}
    </span>
  );
}
