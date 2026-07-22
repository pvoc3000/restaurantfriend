"use client";

import { useState } from "react";
import {
  deliveryLabel,
  QTY_CLASS,
  qtyState,
  suggestQty,
  type EntryState,
  type GuideRow,
} from "@/lib/orderGuide";
import { money } from "@/lib/purchaseOrders";

/**
 * One plan line: the vendor item, its pack and unit price, and the two entry
 * modes that coexist (§4.3) — type a package quantity directly, or count what's
 * on the shelf and take the suggestion.
 *
 * Both boxes commit on blur/Enter rather than per keystroke: a walk generates a
 * lot of typing and every write is a round trip.
 */
export function GuideLine({
  row,
  entry,
  itemPar,
  baseUnit,
  onCommit,
  saving,
}: {
  row: GuideRow;
  entry: EntryState | undefined;
  itemPar: number | null;
  baseUnit: string;
  onCommit: (patch: Partial<EntryState>) => void;
  saving: boolean;
}) {
  const [qtyDraft, setQtyDraft] = useState<string | null>(null);
  const [onHandDraft, setOnHandDraft] = useState<string | null>(null);

  // Per-line par overrides the item's (brief §A: par_qty on a plan row is a
  // PER-LINE par, not a share of the item total).
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

  // Only orderable lines reach the guide — the page filters on the view's
  // active cascade — so there's no blocked state to render here.
  return (
    <tr className="border-b border-neutral-100">
      <td className="py-1 pl-6 pr-2">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-medium text-neutral-800">{row.vendor_name}</span>
          <span className="text-neutral-600">
            {[row.brand, row.vendor_item_description].filter(Boolean).join(" · ")}
          </span>
        </div>
        <div className="text-xs text-neutral-500">
          {row.package_desc ?? "?"}
          {row.package_content !== null ? ` · ${row.package_content} ${baseUnit}` : ""}
          {" · "}
          {money(row.effective_price)}
          {row.unit_price !== null ? ` · $${Number(row.unit_price).toFixed(4)}/${baseUnit}` : ""}
          {arrives ? ` · ${arrives}` : ""}
        </div>
      </td>

      <td className="px-2 py-1 text-right">
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
          className="w-16 rounded border border-neutral-300 px-1 py-0.5 text-right text-sm tabular-nums"
        />
      </td>

      <td className="px-2 py-1 text-right text-xs text-neutral-500">
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
            className="rounded px-1 hover:bg-neutral-200 disabled:opacity-50"
          >
            {suggestion}
          </button>
        )}
      </td>

      <td className="px-2 py-1 text-right">
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
          placeholder="—"
          title="Packages to order"
          className={`w-16 rounded border px-1 py-0.5 text-right text-sm font-medium tabular-nums ${QTY_CLASS[state]}`}
        />
      </td>

      <td className="px-2 py-1 text-right text-sm tabular-nums text-neutral-600">
        {qty !== null && Number(qty) > 0
          ? money(Number(qty) * Number(row.effective_price ?? 0))
          : ""}
      </td>
    </tr>
  );
}
