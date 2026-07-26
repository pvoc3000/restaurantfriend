"use client";

import { useState } from "react";
import Link from "next/link";
import { withFrom } from "@/lib/breadcrumbs";
import {
  deliveryLabel,
  notGreenReason,
  qtyClass,
  qtyState,
  suggestQty,
  type EntryState,
  type GuideRow,
} from "@/lib/orderGuide";
import { money } from "@/lib/purchaseOrders";
import { packLabel } from "@/lib/catalog";

/**
 * One plan line, laid out in the columns the FMP guide used because they're the
 * ones that get read while walking: who sells it, what it is, what a package
 * holds, what a base unit costs, and the quantity box.
 *
 * Both entry modes coexist (§4.3) — type a package quantity, or count what's on
 * the shelf and take the suggestion. Text boxes commit on blur/Enter rather
 * than per keystroke; the steppers commit immediately, since a click is already
 * a complete decision.
 */
export function GuideLine({
  row,
  entry,
  weekday,
  ignoreDays,
  itemPar,
  baseUnit,
  onCommit,
  saving,
}: {
  row: GuideRow;
  entry: EntryState | undefined;
  weekday: number;
  ignoreDays: boolean;
  itemPar: number | null;
  baseUnit: string;
  onCommit: (patch: Partial<EntryState>) => void;
  saving: boolean;
}) {
  const [qtyDraft, setQtyDraft] = useState<string | null>(null);
  const [onHandDraft, setOnHandDraft] = useState<string | null>(null);

  // Par is a fact about the ITEM at this location on this weekday, never about
  // which vendor you buy it from (migration 009), so every line under an item
  // resolves the same number — `itemPar` is just the fallback if the view ever
  // hands us a null.
  const par = row.par_qty ?? itemPar;
  const onHand = entry?.on_hand ?? null;
  const qty = entry?.qty_to_order ?? null;
  const suggestion = suggestQty(par, onHand, row.package_content);
  const state = qtyState(qty);

  function commitQty(raw: string) {
    const trimmed = raw.trim();
    const next = trimmed === "" ? null : Number(trimmed);
    setQtyDraft(null);
    if (next !== null && Number.isNaN(next)) return;
    if (next === qty) return;
    onCommit({ qty_to_order: next });
  }

  /** Steppers move by one, never below zero. Untouched + 1 = 1, − = 0. */
  function step(delta: number) {
    const base = qty === null ? 0 : Number(qty);
    const next = Math.max(0, base + delta);
    if (next === qty) return;
    onCommit({ qty_to_order: next });
  }

  function commitOnHand(raw: string) {
    const trimmed = raw.trim();
    const next = trimmed === "" ? null : Number(trimmed);
    setOnHandDraft(null);
    if (next !== null && Number.isNaN(next)) return;
    if (next === onHand) return;

    // Counting proposes a quantity, it never dictates one — but only fill an
    // untouched box, so a count never silently overwrites a decision.
    const proposed = suggestQty(par, next, row.package_content);
    onCommit(
      qty === null && proposed !== null
        ? { on_hand: next, qty_to_order: proposed }
        : { on_hand: next }
    );
  }

  const arrives = deliveryLabel(row.vendor_delivery_days);
  const pack = packLabel(row, baseUnit);

  // Should-order is a statement about a day, so it means nothing while the day
  // gates are lifted — no green, and no reason to explain the absence of it.
  const shouldOrder = ignoreDays ? false : row.should_order;

  // Why a quiet line isn't green, named per failing condition — the model's
  // complexity stops being something you carry in your head. On the box
  // itself, where the question gets asked. Under the day-gated list every
  // visible line already clears the vendor and item days, so in practice this
  // names the favorite check.
  const quietReason = ignoreDays ? null : notGreenReason(row, weekday);

  // Leaving a line must lead back to the day being walked, same as the item
  // header. Vendor name → vendor detail; the description names THIS vendor
  // item, so it opens the vendor item — where its favorite days, per-location
  // price and order history live. (The item header above links to the
  // inventory item.)
  const here = { href: `/order-guide?day=${weekday}`, label: "Order Guide" };

  // Only orderable lines reach the guide — the page filters on the view's
  // active cascade — so there's no blocked state to render here.
  return (
    <tr className="border-b border-hairline">
      {/* Vendor over brand, the way the printed guide reads. Generous row
          padding on purpose — the walk is read standing up. */}
      <td className="whitespace-nowrap py-4 pl-4 pr-4 align-top">
        <div className="flex items-baseline gap-1.5">
          {/* Favorites carry a marker so "All" can be scanned: the source
              you'd normally take, whether or not it's today's work. */}
          <span
            aria-hidden
            className={
              row.is_favorite ? "text-[var(--rf-yellow-500)]" : "text-transparent"
            }
            title={row.is_favorite ? "Favorite — the preferred source this day" : undefined}
          >
            ★
          </span>
          <Link
            href={withFrom(`/vendors/${row.vendor_id}`, here)}
            className="text-[13px] font-semibold uppercase tracking-[0.06em] text-ink no-underline hover:underline"
          >
            {row.vendor_name}
          </Link>
        </div>
        {row.brand && <div className="pl-5 text-xs text-muted">{row.brand}</div>}
        {/* Delivery day lives with the vendor, not the description — it's a
            fact about the source, and it kept pushing the columns apart. */}
        {arrives && <div className="pl-5 text-[11px] text-faint">{arrives}</div>}
      </td>

      <td className="px-4 py-4 align-top text-body">
        <Link
          href={withFrom(`/vendor-items/${row.vendor_item_id}`, here)}
          className="no-underline hover:underline"
        >
          {row.vendor_item_description ?? "—"}
        </Link>
      </td>

      {/* Pack and unit price: the $/oz comparison across pack sizes is the
          reason this column exists (§4.6). Reads the way the case is labelled —
          "12 × 32 oz" — because that's what you check a delivery against. */}
      <td className="whitespace-nowrap px-4 py-4 align-top tabular-nums text-body">
        {pack ?? <span className="text-faint">—</span>}
      </td>

      <td className="whitespace-nowrap px-4 py-4 align-top text-right tabular-nums text-muted">
        {money(row.effective_price)}
        {row.unit_price !== null && (
          <div className="text-xs text-subtle">
            (${Number(row.unit_price).toFixed(4)} per {baseUnit})
          </div>
        )}
      </td>

      <td className="px-4 py-4 align-top text-right">
        <input
          inputMode="decimal"
          disabled={saving}
          value={onHandDraft ?? (onHand === null ? "" : String(onHand))}
          onChange={(e) => setOnHandDraft(e.target.value)}
          onBlur={(e) => commitOnHand(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setOnHandDraft(null);
          }}
          placeholder="—"
          title={`On hand in ${baseUnit}`}
          className="h-9 w-16 border border-ink px-1 text-right text-sm tabular-nums"
        />
      </td>

      <td className="px-1 py-4 align-top text-right text-xs text-subtle">
        {suggestion === null ? (
          <span title={par === null ? "No par set for this line" : "No package content"}>
            —
          </span>
        ) : (
          <button
            type="button"
            disabled={saving || suggestion === qty}
            onClick={() => onCommit({ qty_to_order: suggestion })}
            title="Use the suggested quantity"
            className="px-1 hover:bg-neutral-100 disabled:opacity-35"
          >
            {suggestion}
          </button>
        )}
      </td>

      {/* Pack label + stepper, mirroring the FMP control: minus, box, plus. */}
      <td className="whitespace-nowrap px-4 py-4 align-top">
        <div className="flex items-center justify-end gap-2">
          <span className="mr-1 text-xs font-semibold uppercase tracking-[0.06em] text-body">
            {row.package_desc ?? ""}
          </span>
          <button
            type="button"
            disabled={saving}
            onClick={() => step(-1)}
            aria-label="Decrease by one"
            className="flex h-9 w-9 items-center justify-center rounded-full border-[1.5px] border-ink text-ink hover:bg-neutral-100 disabled:opacity-35"
          >
            −
          </button>
          <input
            inputMode="decimal"
            disabled={saving}
            value={qtyDraft ?? (qty === null ? "" : String(qty))}
            onChange={(e) => setQtyDraft(e.target.value)}
            onBlur={(e) => commitQty(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") setQtyDraft(null);
            }}
            placeholder=""
            title={quietReason ?? "Packages to order"}
            className={`h-11 w-20 px-1 text-center text-[15px] font-semibold tabular-nums ${qtyClass(state, shouldOrder, row.is_favorite)}`}
          />
          <button
            type="button"
            disabled={saving}
            onClick={() => step(1)}
            aria-label="Increase by one"
            className="flex h-9 w-9 items-center justify-center rounded-full border-[1.5px] border-ink text-ink hover:bg-neutral-100 disabled:opacity-35"
          >
            +
          </button>
        </div>
      </td>

      <td className="px-4 py-4 align-top text-right text-[15px] tabular-nums text-body">
        {qty !== null && Number(qty) > 0
          ? money(Number(qty) * Number(row.effective_price ?? 0))
          : ""}
      </td>
    </tr>
  );
}
