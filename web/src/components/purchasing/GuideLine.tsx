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
import { packLabel, packageDivisor, parPackageLabel } from "@/lib/catalog";
import { evaluateNumeric } from "@/lib/calc";
import { useCalcField } from "@/components/ui/CalcPad";

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
  const calcField = useCalcField();
  const [qtyDraft, setQtyDraft] = useState<string | null>(null);
  const [onHandDraft, setOnHandDraft] = useState<string | null>(null);

  // Par is a fact about the ITEM at this location on this weekday, never about
  // which vendor you buy it from (migration 009), so every line under an item
  // resolves the same number — `itemPar` is just the fallback if the view ever
  // hands us a null.
  const par = row.par_qty ?? itemPar;
  const onHand = entry?.on_hand ?? null;
  const qty = entry?.qty_to_order ?? null;
  // ONE divisor for the whole line: the par restatement and the suggestion have
  // to agree about how big a package is, or the row states two package sizes.
  // Falls back to the pack structure where `package_content` was never filled
  // in (Mark, 2026-07-29) — see packageDivisor.
  const divisor = packageDivisor(row, baseUnit);
  const suggestion = suggestQty(par, onHand, divisor);
  const state = qtyState(qty);

  function commitQty(raw: string) {
    const trimmed = raw.trim();
    // "4*9" is a valid quantity here too (lib/calc.ts). A bare number is an
    // expression that evaluates to itself, so nothing about typing 3 changes.
    const next = trimmed === "" ? null : evaluateNumeric(trimmed);
    setQtyDraft(null);
    if (trimmed !== "" && next === null) return;
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
    // Counting a shelf is where this earns its keep: "2*24+6" is three cases
    // and six loose, without doing it in your head first.
    const next = trimmed === "" ? null : evaluateNumeric(trimmed);
    setOnHandDraft(null);
    if (trimmed !== "" && next === null) return;
    if (next === onHand) return;

    // Counting proposes a quantity, it never dictates one — but only fill an
    // untouched box, so a count never silently overwrites a decision.
    const proposed = suggestQty(par, next, divisor);
    onCommit(
      qty === null && proposed !== null
        ? { on_hand: next, qty_to_order: proposed }
        : { on_hand: next }
    );
  }

  const arrives = deliveryLabel(row.vendor_delivery_days);
  const pack = packLabel(row, baseUnit);
  // The same par the item header states, said in THIS line's packages — the
  // unit the box beside it counts in.
  const parPack = parPackageLabel(par, divisor, row.package_desc);

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
    // data-untouched marks the lines "Next favorite" walks (OrderGuide's
    // scrollToNext): an order box with nothing in it. Absent once the line
    // carries a quantity OR an explicit zero — a zero is a decision, and the
    // burn-down shouldn't send you back to it. The attribute rather than a ref
    // registry because the DOM already holds the one thing the jump needs,
    // which is where each row sits.
    <tr
      className="border-b border-hairline"
      data-guide-line=""
      data-untouched={qty === null ? "" : undefined}
    >
      {/* Vendor over brand, the way the printed guide reads. Generous row
          padding on purpose — the walk is read standing up. */}
      <td className="whitespace-nowrap py-4 pl-4 pr-4 align-middle max-[1180px]:whitespace-normal max-[1180px]:px-2">
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

      {/* Description over pack, one cell (Mark, 2026-07-29). They were two
          columns and are now the same shape as the vendor cell beside them:
          the thing you're looking for on top, the fact that qualifies it
          underneath. Pack still reads the way the case is labelled — "12 × 32
          oz" — because that's what you check a delivery against (§4.6), and it
          stays nowrap at every width so "12 ×" never parts from "32 oz". */}
      <td className="px-4 py-4 align-middle text-body max-[1180px]:px-2">
        <Link
          href={withFrom(`/vendor-items/${row.vendor_item_id}`, here)}
          className="no-underline hover:underline"
        >
          {row.vendor_item_description ?? "—"}
        </Link>
        {pack && (
          <div className="mt-0.5 whitespace-nowrap text-xs tabular-nums text-muted">
            {pack}
          </div>
        )}
      </td>

      <td className="whitespace-nowrap px-4 py-4 align-middle text-right tabular-nums text-muted max-[1180px]:whitespace-normal max-[1180px]:px-2">
        {money(row.effective_price)}
        {/* Two decimals to read, four to compare (Mark, 2026-07-29). The view
            already computes this to 4dp — `toFixed` only ever changed the
            rendering, so nothing was lost, it just stopped being visible. That
            matters on the cheap per-each rows, where $0.0128 and $0.0102 are a
            25% difference and both print as $0.01. */}
        {row.unit_price !== null && (
          <div
            className="text-xs text-subtle"
            title={`$${Number(row.unit_price).toFixed(4)} per ${baseUnit}`}
          >
            (${Number(row.unit_price).toFixed(2)} per {baseUnit})
          </div>
        )}
      </td>

      {/* The unit belongs ON the row, not only in the input's tooltip (Mark,
          2026-07-29). On hand is counted in base units while the box beside it
          counts packages, and a case count typed in here is the easiest
          mistake on the screen to make — so each input now names its own unit:
          "oz" here, "par 3 CS" under the order box. */}
      <td className="px-4 py-4 align-middle text-right max-[1180px]:px-2">
        <span className="inline-flex items-baseline gap-1.5">
          <input
            {...calcField}
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
          <span className="text-[11px] text-subtle">{baseUnit}</span>
        </span>
      </td>

      {/* Stays at every width (Mark, 2026-07-29): the suggestion is the point
          of counting, and one tap to accept it is the walk's fastest move. */}
      <td className="px-1 py-4 align-middle text-right text-xs text-subtle">
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

      {/* The only column that goes below 880px — see the header for why. */}
      <td className="px-4 py-4 align-middle text-right text-[15px] tabular-nums text-body max-[880px]:hidden">
        {qty !== null && Number(qty) > 0
          ? money(Number(qty) * Number(row.effective_price ?? 0))
          : ""}
      </td>

      {/* Pack label + stepper, mirroring the FMP control: minus, box, plus.
          The row's LAST cell (Mark, 2026-07-27): this is the only thing on the
          line you touch, so it's pinned to the right edge where a thumb lands
          rather than sitting inboard of a line total you only read. */}
      {/* Never wraps, at any width: the −/box/+ is the one thing on the line
          you touch, and it has to stay one object. It and the on-hand box are
          the row's two hard floors — everything else gives way around them. */}
      <td className="whitespace-nowrap py-4 pl-4 pr-0 align-middle max-[1180px]:pl-2">
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
            {...calcField}
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
        {/* The par in this line's packages, CENTERED under the box that counts
            them (Mark, 2026-07-29). Quieter than the number above it — smaller
            and at 75% — because it's the target you're aiming at, not the
            decision you're making.

            The geometry is mirrored from the stepper rather than guessed: a
            w-20 box matching the input's width, pushed left by mr-11 — the +
            button (2.25rem) plus its gap (0.5rem) — so centering inside it
            centers under the input. Right-aligning the whole line instead
            would sit it under the + button. */}
        {parPack && (
          <div className="mt-1 flex justify-end">
            <span
              title={`Par ${Number(par)} ${baseUnit} ÷ ${divisor} ${baseUnit} per package`}
              className="mr-11 w-20 text-center text-[11px] font-semibold text-accent opacity-75"
            >
              par {parPack}
            </span>
          </div>
        )}
      </td>
    </tr>
  );
}
