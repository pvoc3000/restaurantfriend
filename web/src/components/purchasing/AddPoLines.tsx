"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  money,
  PO_STATUS_LABEL,
  type PoLine,
  type PurchaseOrder,
} from "@/lib/purchaseOrders";
import { packLabel } from "@/lib/catalog";
import { evaluateNumeric } from "@/lib/calc";
import { TextInput } from "@/components/ui/TextInput";
import { Dialog, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";

/**
 * "Add item" on PO detail: everything this vendor currently sells, with a
 * quantity box and an Add button per row.
 *
 * The guide is the normal way a line gets onto a PO — this is the other way,
 * for what you remember after the guide is done (the vendor called, the walk
 * missed a case). So the panel STAYS OPEN after each add: adding four things
 * is the expected shape of the task, not four trips through a dialog.
 *
 * Two rules it inherits rather than invents:
 * - lines SNAPSHOT the catalog (schema 001), and the snapshot must read exactly
 *   like the ones migration 013 writes, or the same case looks like two
 *   different products on the printed PO — see `snapshotPack` below;
 * - price resolves location override → vendor_items.price (design rule 6), the
 *   same resolution as v_order_guide and 013.
 *
 * An item already on the order ADDS TO ITS LINE rather than making a second
 * one: two lines of the same SKU is a mistake the vendor pays for, and "add 3
 * to the purchase order" reads the same either way. The row shows what's
 * already on order so the arithmetic is never a surprise.
 */

type PickerRow = {
  id: string;
  product_id: string | null;
  brand: string | null;
  description: string | null;
  package_desc: string | null;
  package_content: number | null;
  price: number | null;
  pack_count: number | null;
  pack_size: number | null;
  pack_unit: string | null;
  /** Snapshotted onto the new line, same as the description (migration 015). */
  notes: string | null;
  inventory_items: { id: string; name: string; base_unit: string } | null;
  // Every location's override, filtered to this PO's location in the browser —
  // the table is "rare per-location price override" (schema 001), so fetching
  // them all costs less than a second round trip.
  vendor_item_location_prices: { location_id: string; price: number }[];
};

/**
 * The pack label a PO line carries. Migration 013's rule: the composed
 * structure when 010 recorded one ("12 × 32 oz"), else the vendor's own pack
 * text ("BAG"). `packLabel`'s base-unit fallback covers the rows with neither,
 * so what the panel shows and what lands on the line are the same string.
 */
function snapshotPack(vi: PickerRow): string | null {
  const baseUnit = vi.inventory_items?.base_unit ?? "";
  if (vi.pack_size !== null) {
    return `${Number(vi.pack_count ?? 1)} × ${Number(vi.pack_size)} ${
      vi.pack_unit ?? baseUnit
    }`;
  }
  return vi.package_desc ?? packLabel(vi, baseUnit);
}

function effectivePrice(vi: PickerRow, locationId: string): number | null {
  const override = vi.vendor_item_location_prices.find(
    (p) => p.location_id === locationId
  );
  if (override) return Number(override.price);
  return vi.price === null ? null : Number(vi.price);
}

export function AddPoLines({
  order,
  orgId,
  lines,
}: {
  order: PurchaseOrder;
  orgId: string;
  /** The PO's current lines — what's already on order, per vendor item. */
  lines: PoLine[];
}) {
  const vendorName = order.vendors?.name ?? "Vendor";
  const router = useRouter();
  const supabase = createClient();

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<PickerRow[]>([]);
  const [search, setSearch] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [addingId, setAddingId] = useState<string | null>(null);
  const [added, setAdded] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);

  // What's on the order right now, by vendor item. Recomputed from props, so
  // it follows the router.refresh() after every add.
  const onOrder = useMemo(() => {
    const map = new Map<string, { lineId: string; qty: number }>();
    for (const l of lines) {
      if (!l.vendor_item_id) continue;
      map.set(l.vendor_item_id, {
        lineId: l.id,
        qty: Number(l.qty_ordered ?? 0),
      });
    }
    return map;
  }, [lines]);

  async function openPanel() {
    setOpen(true);
    setError(null);
    setAdded({});
    setDrafts({});
    setLoading(true);

    // Fetched on open, not at page load: the catalog is the thing most likely
    // to have changed since, and the panel is opened rarely.
    const { data, error } = await supabase
      .from("vendor_items")
      .select(
        `id, product_id, brand, description, package_desc, package_content, price,
         pack_count, pack_size, pack_unit, notes,
         inventory_items ( id, name, base_unit ),
         vendor_item_location_prices ( location_id, price )`
      )
      .eq("vendor_id", order.vendor_id)
      .eq("is_active", true)
      .order("description");

    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    setRows((data ?? []) as unknown as PickerRow[]);
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((vi) =>
      [
        vi.inventory_items?.name,
        vi.brand,
        vi.description,
        vi.product_id,
        vi.package_desc,
      ]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(q))
    );
  }, [rows, search]);

  async function add(vi: PickerRow) {
    const raw = (drafts[vi.id] ?? "").trim();
    // Arithmetic allowed, same as every other numeric field (lib/calc.ts).
    const n = raw === "" ? null : evaluateNumeric(raw);
    if (n === null || !Number.isFinite(n) || n <= 0) {
      setError("Enter an order amount greater than zero.");
      return;
    }

    setAddingId(vi.id);
    setError(null);

    const existing = onOrder.get(vi.id);
    const { error } = existing
      ? // Same SKU already on the order: raise its quantity. The line keeps its
        // own price snapshot — that's what was agreed when it was ordered.
        await supabase
          .from("purchase_order_items")
          .update({ qty_ordered: existing.qty + n })
          .eq("id", existing.lineId)
      : await supabase.from("purchase_order_items").insert({
          org_id: orgId,
          po_id: order.id,
          vendor_item_id: vi.id,
          description: vi.description,
          brand: vi.brand,
          product_id: vi.product_id,
          package_desc: snapshotPack(vi),
          notes: vi.notes,
          qty_ordered: n,
          unit_price: effectivePrice(vi, order.location_id),
        });

    setAddingId(null);
    if (error) {
      setError(error.message);
      return;
    }

    setDrafts((prev) => ({ ...prev, [vi.id]: "" }));
    setAdded((prev) => ({ ...prev, [vi.id]: (prev[vi.id] ?? 0) + n }));
    // The table behind the panel is server-rendered, so this is what makes the
    // new line appear there — and what keeps `onOrder` above honest.
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={openPanel}
        className="h-9 border border-ink bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] transition-colors hover:bg-ink hover:text-white"
      >
        Add item…
      </button>

      {open && (
        <Dialog
          title={`Add items · ${vendorName} → ${order.po_number}`}
          onClose={() => setOpen(false)}
          width="max-w-4xl"
          bodyClassName="px-6 py-4"
          // The search sits in the dialog's TOOLBAR rather than in the scrolling
          // body: on a vendor with hundreds of items it's the first thing you
          // use and it must not scroll away.
          toolbar={
            <>
              <TextInput
                autoFocus
                value={search}
                onValueChange={setSearch}
                placeholder="Search this vendor's items"
                clearLabel="Clear the search"
                className="w-72"
              />
              <span className="text-[12px] uppercase tracking-[0.12em] text-subtle">
                {filtered.length} of {rows.length} active
              </span>
              {order.status !== "draft" && (
                <span className="border border-ink bg-[var(--rf-yellow-200)] px-2 py-0.5 text-xs text-ink">
                  This order is {PO_STATUS_LABEL[order.status].toLowerCase()} —
                  adding changes order history
                </span>
              )}
            </>
          }
          footer={
            <button
              type="button"
              onClick={() => setOpen(false)}
              className={DIALOG_COMMIT_CLASS}
            >
              Done
            </button>
          }
        >
              {error && <p className="mb-3 text-sm text-accent">{error}</p>}

              {loading ? (
                <p className="text-sm text-subtle">Loading this vendor&rsquo;s items…</p>
              ) : filtered.length === 0 ? (
                <p className="text-sm text-muted">
                  {rows.length === 0
                    ? "This vendor has no active items."
                    : "Nothing matches that search."}
                </p>
              ) : (
                <ul className="divide-y divide-hairline border border-ink">
                  {filtered.map((vi) => {
                    const existing = onOrder.get(vi.id);
                    const price = effectivePrice(vi, order.location_id);
                    const pack = snapshotPack(vi);
                    const orderedAs = [vi.brand, vi.description]
                      .filter(Boolean)
                      .join(" · ");
                    return (
                      <li
                        key={vi.id}
                        className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm"
                      >
                        {/* Catalog name over what the invoice will say — the
                            Item cell of the line table, same reading. */}
                        <span className="min-w-0 flex-1 leading-snug">
                          <span className="block text-ink">
                            {vi.inventory_items?.name ?? (orderedAs || "—")}
                          </span>
                          {vi.inventory_items?.name && orderedAs && (
                            <span className="block text-xs text-muted">{orderedAs}</span>
                          )}
                          <span className="block text-xs text-faint">
                            {[vi.product_id, pack].filter(Boolean).join(" · ") || " "}
                          </span>
                        </span>

                        <span className="w-24 shrink-0 text-right tabular-nums text-body">
                          {money(price)}
                        </span>

                        {/* What's already on the order, and what this panel has
                            put there this session. */}
                        <span className="w-32 shrink-0 text-right text-xs">
                          {existing ? (
                            <span className="text-muted tabular-nums">
                              {existing.qty} on order
                            </span>
                          ) : (
                            <span className="text-faint">not on order</span>
                          )}
                          {added[vi.id] !== undefined && (
                            <span className="block tabular-nums text-[var(--rf-green-600)]">
                              +{added[vi.id]} added
                            </span>
                          )}
                        </span>

                        <input
                          inputMode="decimal"
                          // CalcKeys: the operator strip for iOS's number pad.
                          data-rf-calc=""
                          value={drafts[vi.id] ?? ""}
                          onChange={(e) =>
                            setDrafts((prev) => ({ ...prev, [vi.id]: e.target.value }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              void add(vi);
                            }
                          }}
                          aria-label={`Order amount for ${
                            vi.inventory_items?.name ?? orderedAs
                          }`}
                          placeholder="qty"
                          className="h-9 w-16 shrink-0 border border-ink px-1 text-center tabular-nums"
                        />
                        <button
                          type="button"
                          onClick={() => void add(vi)}
                          disabled={addingId === vi.id}
                          className="h-9 shrink-0 border border-ink bg-white px-3 text-[12px] font-semibold uppercase tracking-[0.06em] transition-colors hover:bg-ink hover:text-white disabled:opacity-35"
                        >
                          {addingId === vi.id ? "Adding…" : "Add to PO"}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
        </Dialog>
      )}
    </>
  );
}
