"use client";

import { useState } from "react";
import { InlineValue } from "@/components/catalog/InlineValue";
import { BOXED_FIELDS } from "@/components/ui/fieldMetrics";
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
  sku,
  canMatch,
  canReceive,
  saving,
  onSetReceived,
  onPrice,
  onMatch,
  onAdoptSku,
}: {
  line: PoLine;
  match: LineMatch | undefined;
  /** The two-stage price button's current stage, or null when nothing's owed. */
  action: PriceAction | null;
  /** Set when the catalog's SKU disagrees with this line's — stage 2 of a match. */
  sku: { from: string | null; to: string } | null;
  /** There are invoice lines nothing paired with, so a manual match is possible. */
  canMatch: boolean;
  /** purchaser+ — below that every control renders as text. */
  canReceive: boolean;
  saving: boolean;
  onSetReceived: (value: number | null) => void;
  onPrice: (action: PriceAction) => void;
  onMatch: () => void;
  onAdoptSku: () => void;
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

  // Money to read, the raw number to type — PO detail's own price cell, so the
  // two screens write the same column the same way. Fixed-width because
  // `InlineValue` renders `w-full`: without a box to sit in it would stretch
  // across the band and put the arrow at the far edge of the row.
  const priceCell = canReceive ? (
    <span className="w-24 shrink-0">
      <InlineValue
        boxed={BOXED_FIELDS}
        table="purchase_order_items"
        id={line.id}
        column="unit_price"
        value={line.unit_price}
        kind="number"
        className="text-ink"
        format={(v) => money(Number(v))}
      />
    </span>
  ) : (
    <span className="text-ink">{money(line.unit_price)}</span>
  );

  return (
    <li
      className={`border-b border-hairline px-3 py-3 ${
        match?.qtyDiffers ? "bg-[var(--rf-yellow-50)]" : ""
      }`}
    >
      {/* Band 1 — what this is. */}
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-[15px] font-semibold text-ink">{name}</span>
        {/* Marked, not alarmed. These say "worth your eye", which is the yellow
            family; red is for something being WRONG, and wearing it here made
            two description matches read as price errors (Mark, 2026-07-31).
            They also carry their meaning in WORDS: a bare glyph explains itself
            only on hover, and the iPad this is used on has no hover. */}
        {match?.by === "description" && (
          <Marker title="The vendor's item number didn't match ours, so these were paired by their wording. Worth a glance that it's the same product.">
            ≈ matched by description
          </Marker>
        )}
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
        <span>
          {[line.product_id, line.brand, line.description].filter(Boolean).join(" · ") ||
            "—"}
        </span>
        {/* Stage 2 of a manual match: this order now says 50021 and the catalog
            still says 08779, so the NEXT order would need matching by hand
            again. Separate button, like the price stages — fixing this order is
            not consent to edit the catalog. */}
        {sku && canReceive && (
          <button
            type="button"
            disabled={saving}
            onClick={onAdoptSku}
            title={`The catalog still calls this ${sku.from ?? "nothing"}. Update it to ${sku.to} so the next order matches on its own.`}
            className="border border-ink bg-white px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink hover:bg-ink hover:text-white disabled:opacity-35"
          >
            Catalog says {sku.from ?? "—"} · update
          </button>
        )}
      </div>

      {/* Band 2 — the three quantities, ending in the one you touch.
          Nothing is PREFILLED (Mark, 2026-07-31): the numbers stay numbers, and
          each carries a → that pushes it into the received box. An arrow is an
          unmistakable action where an underlined number was only a hint, and a
          box that fills itself would make merely opening an order look like
          someone had checked the delivery. */}
      <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2">
        <Quantity
          label="Ordered"
          value={qtyLabel(ordered, pack)}
          takeable={canReceive && received !== ordered}
          saving={saving}
          title="Record this line as arriving exactly as ordered"
          onTake={() => onSetReceived(ordered)}
        />
        <Quantity
          label="Invoiced"
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
          trailing={
            // Nothing on the invoice paired with this line, but the invoice has
            // lines nothing paired with — so there's something to pair BY HAND.
            // Vendors renumber items and no matcher will ever catch them all.
            !match?.invoice && canMatch && canReceive ? (
              <button
                type="button"
                disabled={saving}
                onClick={onMatch}
                title="Pick the invoice line this is, when the vendor billed it under a different item number"
                className="h-9 border border-ink bg-white px-2 text-[11px] font-semibold uppercase tracking-[0.06em] hover:bg-ink hover:text-white disabled:opacity-35"
              >
                Match&hellip;
              </button>
            ) : undefined
          }
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
            "$51.23 → $51.23" and says nothing.

            The LINE's price is typed straight in (Mark, 2026-07-31) — the two
            buttons only ever offered the two prices the app already knew, and a
            delivery produces plenty it doesn't: a catch-weight line the reader
            got wrong (the `?` beside this very number), a credit agreed at the
            door, a price nobody billed at all. The received quantity has always
            been typeable and the money beside it wasn't, which is the asymmetry.
            It's the same cell and the same column PO detail edits, so a price
            corrected here and a price corrected at the desk are one act.

            Which SIDE of the arrow it sits on follows what the stage is
            replacing, so the editable number is always the line's own. */}
        <span className="flex items-center gap-1 tabular-nums text-muted">
          {action?.stage === "vendor" ? (
            <>
              <span className="text-[11px] uppercase tracking-[0.12em] text-subtle">
                Catalog
              </span>
              <span>{money(action.current)}</span>
              <span aria-hidden="true">→</span>
              {priceCell}
            </>
          ) : (
            <>
              {priceCell}
              {action && (
                <>
                  <span aria-hidden="true">→</span>
                  <span className="text-ink">{money(action.price)}</span>
                </>
              )}
            </>
          )}
        </span>

        {/* The `?` belongs BESIDE THE PRICE, which is what it's about — it used
            to sit up by the item name, where it read as a doubt about the item.
            It shows whether or not there's a button, because a catch-weight
            price you're merely looking at still deserves the warning. */}
        {match?.priceUncertain && match.invoice && (
          <Marker
            title={`The invoice's own figures don't multiply out — it prints ${match.invoice.qty} × ${match.invoice.unit_price} but a line total of ${match.invoice.extended}. The price shown is that line total divided by the quantity. Often a catch-weight item priced by the pound; check the page before taking it.`}
          >
            ? invoice math
          </Marker>
        )}

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
          </button>
        )}

        {/* `flex-1`, not `ml-auto`: a boxed field is `w-full`, and a
            shrink-to-fit wrapper gives that nothing to resolve against — so
            the note takes the row's remaining width, which is where an auto
            margin was pushing it anyway. */}
        <span className="min-w-40 max-w-full flex-1">
          {canReceive ? (
            <InlineValue
              boxed={BOXED_FIELDS}
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

/**
 * "Worth your eye" — the `≈` and `?` the brief insists must survive.
 *
 * Yellow, not red: red means something is WRONG, and neither of these is. One
 * says a pair was made on wording rather than an item number; the other that
 * the invoice's own arithmetic doesn't close. Both are "check this", which is
 * exactly what the mark colour means everywhere else in the app.
 */
function Marker({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <span
      title={title}
      className="border border-ink bg-mark-fill px-1.5 py-0.5 text-[11px] uppercase tracking-[0.06em] text-ink"
    >
      {children}
    </span>
  );
}

/**
 * A quantity, and a → that puts it in the received box.
 *
 * The number is never the button. It's a fact you read while comparing three
 * columns, and making facts clickable is how you end up unsure whether looking
 * at something changed it.
 */
function Quantity({
  label,
  value,
  takeable,
  saving,
  title,
  onTake,
  trailing,
}: {
  label: string;
  value: string;
  takeable: boolean;
  saving: boolean;
  title: string;
  onTake: () => void;
  trailing?: React.ReactNode;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-[11px] uppercase tracking-[0.12em] text-subtle">{label}</span>
      <span className="text-sm tabular-nums text-ink">{value}</span>
      {takeable && (
        <button
          type="button"
          disabled={saving}
          onClick={onTake}
          aria-label={title}
          title={title}
          className="grid h-9 w-9 place-items-center border border-ink bg-white text-ink transition-colors hover:bg-ink hover:text-white disabled:opacity-35"
        >
          →
        </button>
      )}
      {trailing}
    </span>
  );
}
