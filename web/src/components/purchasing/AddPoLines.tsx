"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  addableQty,
  isPendingAdd,
  mergeTargetLine,
  PO_STATUS_LABEL,
  samePrice,
  unaddedWarning,
  type PendingAdd,
  type PoLine,
  type PurchaseOrder,
} from "@/lib/purchaseOrders";
import { confirmDialog } from "@/lib/confirm";
import { packLabel } from "@/lib/catalog";
import { evaluateNumeric } from "@/lib/calc";
import { TextInput } from "@/components/ui/TextInput";
import { SearchGlyph } from "@/components/ui/SearchGlyph";
import { PickList } from "@/components/ui/PickList";
import { PACKAGE_DESC_OPTIONS } from "@/lib/units";
import { Dialog, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { BUTTON_CLASS, PRIMARY_BUTTON_CLASS } from "@/components/ui/buttons";
import { useCalcField } from "@/components/ui/CalcPad";

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
 *
 * **AT THE SAME PRICE, AND ONLY THEN** (Mark, 2026-09-19: "we ordered 13 bags
 * of that mix, they gave us a free bag. I'd like to have the master mix appear
 * twice, once at $50 ea. and once at 0 ea."). So the row carries a PRICE box
 * beside its quantity, filled with what the catalog resolves to and yours to
 * overwrite; an add at a price no line on the order has starts a new line, and
 * an add at a price one already has joins it. `mergeTargetLine` is the whole
 * rule and it is tested, because "which line does this land on" is the kind of
 * question that is obvious until the day it silently averages two prices.
 *
 * ONE-OFF LINES ARE THE PANEL'S SECOND MODE (Mark, 2026-08-24: "add an item to a
 * purchase order that isn't linked to a vendor item… one-off items we need to
 * purchase but don't necessarily want to be a regular vendor item"). They cost
 * NO migration: `purchase_order_items.vendor_item_id` has been nullable since
 * 001 — it is `on delete set null`, so a line whose vendor item was deleted has
 * always been a real state, and every reader in the app already guards for it.
 * A line's own snapshot columns are the record either way; what a one-off gives
 * up is the catalog behind them, which is the point of it.
 *
 * ONE PANEL, TWO MODES, rather than a second button on the order bar: the bar
 * already carries five, and "put something on this order" is one question
 * whether or not the vendor sells it under a SKU we keep. They were TABS until
 * 2026-09-19 and are now the toolbar's Show picker — see the `toolbar` below.
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

/** What a row is called on screen: the catalog name, else the vendor's wording. */
function rowLabel(vi: PickerRow): string {
  return (
    vi.inventory_items?.name ??
    ([vi.brand, vi.description].filter(Boolean).join(" · ") || "this item")
  );
}

/**
 * The one-off form's fields, which are exactly the line's own snapshot columns
 * — there is no catalog row to copy from, so the person types what a vendor
 * item would have lent it.
 *
 * `packageDesc` is the pack TYPE and not a composed size, because that is what
 * `packType` prints in the vendor PDF's Pack column: a composed label
 * ("12 × 32 oz") is deliberately dropped there, so a free-text box would let
 * somebody type something that silently prints nothing. Hence the same
 * `PACKAGE_DESC_OPTIONS` vocabulary the vendor-item screen offers.
 */
const BLANK_ONE_OFF = {
  description: "",
  brand: "",
  productId: "",
  packageDesc: "",
  price: "",
  qty: "",
  notes: "",
};

/**
 * The price box's resting content — plain digits, not `money`'s "$1,234.00".
 * You do arithmetic in this field (lib/calc), and a comma is a thousands
 * separator to a reader and noise to a parser. An empty box is not a zero: it
 * is "no price known", which is what a catalog row with no price writes today
 * and what the line stores as null.
 */
function priceText(price: number | null): string {
  return price === null ? "" : price.toFixed(2);
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
  children,
  autoOpen = false,
}: {
  /** Open the panel on arrival — a PO just created from the list's New
   *  Purchase Order…, which has no lines yet (Mark, 2026-09-14). */
  autoOpen?: boolean;
  order: PurchaseOrder;
  orgId: string;
  /** The PO's current lines — what's already on order, per vendor item. */
  lines: PoLine[];
  /** Draw the trigger yourself — PO detail makes it a row of its Actions menu.
   *  Omitted, this draws its own button (the receiving screen). */
  children?: (openPanel: () => void) => ReactNode;
}) {
  const vendorName = order.vendors?.name ?? "Vendor";
  const router = useRouter();
  const supabase = createClient();

  const calcField = useCalcField();

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<PickerRow[]>([]);
  const [search, setSearch] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  /** Per-row price overrides. A row with no key here is at its catalog price —
   *  seeded lazily rather than filled on load, so "untouched" stays legible
   *  and a catalog price that changes under an open panel is still followed. */
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({});
  const [addingId, setAddingId] = useState<string | null>(null);
  const [added, setAdded] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"catalog" | "oneOff">("catalog");
  const [oneOff, setOneOff] = useState(BLANK_ONE_OFF);
  const [addingOneOff, setAddingOneOff] = useState(false);
  const [oneOffAdded, setOneOffAdded] = useState<string[]>([]);

  // What's on the order right now, by vendor item — EVERY line, because since
  // prices are per line the same item can hold several. Recomputed from props,
  // so it follows the router.refresh() after every add.
  const onOrder = useMemo(() => {
    const map = new Map<string, PoLine[]>();
    for (const l of lines) {
      if (!l.vendor_item_id) continue;
      const at = map.get(l.vendor_item_id);
      if (at) at.push(l);
      else map.set(l.vendor_item_id, [l]);
    }
    return map;
  }, [lines]);

  /**
   * Everything typed into the panel that has not been added. The catalog side
   * is iterated over `drafts` rather than `rows` — only a row somebody has
   * typed into ever gets a key, so a vendor with 300 items costs nothing — and
   * over ALL of them rather than the filtered set, since a quantity typed and
   * then searched past is exactly the one that gets lost.
   */
  const pending = useMemo<PendingAdd[]>(() => {
    const out: PendingAdd[] = [];
    // THE AMOUNT IS WHAT MAKES A ROW PENDING, AND THE PRICE DELIBERATELY IS
    // NOT (2026-09-19, the first thing the price box got wrong). A price alone
    // cannot be added — `add` refuses without an amount — so it is not work
    // waiting to be done; and `add` leaves the price box AS TYPED after a
    // successful add, on purpose, so that adding thirteen at $50 and then one
    // at $0 is two amounts rather than two amounts and two prices. Counting it
    // meant the confirm fired on the way out of every add that had touched a
    // price, naming a row that was already on the order — a warning about
    // nothing, which is how people learn to dismiss warnings unread.
    for (const [id, qty] of Object.entries(drafts)) {
      if (qty.trim() === "") continue;
      const vi = rows.find((r) => r.id === id);
      out.push({ label: vi ? rowLabel(vi) : "this item", values: [qty] });
    }
    // Always offered; `unaddedWarning` drops it when every field is blank. The
    // amount leads, and the description is what names it — a form holding only
    // a brand is still work somebody will lose.
    out.push({
      label: oneOff.description.trim() || "a one-off item",
      values: [
        oneOff.qty,
        oneOff.description,
        oneOff.brand,
        oneOff.productId,
        oneOff.packageDesc,
        oneOff.price,
        oneOff.notes,
      ],
    });
    return out;
  }, [drafts, rows, oneOff]);

  /**
   * Whether the panel is holding anything at all — the same question the
   * confirm asks (`isPendingAdd`), because the fill and the warning are two
   * halves of one fact: while something is typed, Add to PO is the button that
   * finishes the task and Done is the one that throws it away.
   *
   * It goes false again the moment an add succeeds, since that clears the
   * draft — which is what puts the fill back on Done "after the user has
   * entered an item" (Mark, 2026-09-08).
   */
  const typedIn = useMemo(() => pending.some(isPendingAdd), [pending]);

  /** The one-off's half of it, for its own Add button. */
  const oneOffTyped = useMemo(
    () => Object.values(oneOff).some((v) => v.trim() !== ""),
    [oneOff]
  );

  // Both dialogs listen for Escape on the window, and `stopPropagation` does
  // not stop a listener on the same target — so without this, Escape while the
  // confirm is up would cancel it and immediately ask again.
  const asking = useRef(false);

  /**
   * The one way out of the panel: Done, the ✕, Escape and the backdrop all come
   * through here, so a quantity is as safe from a stray Escape as it is from
   * the button. See `unaddedWarning`.
   */
  async function closePanel() {
    if (asking.current) return;
    const warning = unaddedWarning(pending);
    if (warning) {
      asking.current = true;
      const discard = await confirmDialog({
        ...warning,
        confirmLabel: "Close and discard",
        cancelLabel: "Keep adding",
        tone: "danger",
      });
      asking.current = false;
      if (!discard) return;
    }
    setOpen(false);
  }

  async function openPanel() {
    setOpen(true);
    setError(null);
    setAdded({});
    setDrafts({});
    setPriceDrafts({});
    setOneOff(BLANK_ONE_OFF);
    setOneOffAdded([]);
    setTab("catalog");
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

  // Once per mount, and never again on a refresh.
  const autoOpened = useRef(false);
  useEffect(() => {
    if (!autoOpen || autoOpened.current) return;
    autoOpened.current = true;
    // Drop `add=1` from the address so a reload or a return trip doesn't open
    // the panel again.
    const url = new URL(window.location.href);
    if (url.searchParams.has("add")) {
      url.searchParams.delete("add");
      window.history.replaceState(window.history.state, "", url.toString());
    }
    void openPanel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpen]);

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

  /**
   * What a row's price box comes to: the typed override where there is one,
   * the catalog price where there isn't.
   *
   * Three outcomes and they are genuinely three. A number is a price. An EMPTY
   * box is "no price known" and writes null — the state a catalog row with no
   * price already produces, so the box has to be able to say it. Anything else
   * is a typo, and quietly treating a typo as null would file a line at no
   * price because somebody typed "5o".
   */
  function draftedPrice(
    vi: PickerRow
  ): { ok: true; price: number | null } | { ok: false } {
    const draft = priceDrafts[vi.id];
    if (draft === undefined) {
      return { ok: true, price: effectivePrice(vi, order.location_id) };
    }
    const raw = draft.trim();
    if (raw === "") return { ok: true, price: null };
    const n = evaluateNumeric(raw);
    if (n === null || !Number.isFinite(n)) return { ok: false };
    return { ok: true, price: n };
  }

  async function add(vi: PickerRow) {
    // Arithmetic allowed, same as every other numeric field (lib/calc.ts) —
    // and the same call that decides whether this button wears the fill.
    const n = addableQty(drafts[vi.id] ?? "");
    if (n === null) {
      setError("Enter an order amount greater than zero.");
      return;
    }

    const resolved = draftedPrice(vi);
    if (!resolved.ok) {
      setError("That unit price is not a number.");
      return;
    }
    const price = resolved.price;
    if (price !== null && price < 0) {
      setError("A unit price cannot be negative.");
      return;
    }

    setAddingId(vi.id);
    setError(null);

    // The line this lands on — the one already at THIS price, if there is one.
    // A different price is a different line (`mergeTargetLine`), which is what
    // puts a free bag beside the thirteen it came with.
    const existing = mergeTargetLine(onOrder.get(vi.id) ?? [], vi.id, price);
    const { error } = existing
      ? // Same SKU at the same price: raise its quantity, and leave its own
        // price snapshot alone — it already says what this add says.
        await supabase
          .from("purchase_order_items")
          .update({ qty_ordered: Number(existing.qty_ordered ?? 0) + n })
          .eq("id", existing.id)
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
          unit_price: price,
        });

    setAddingId(null);
    if (error) {
      setError(error.message);
      return;
    }

    setDrafts((prev) => ({ ...prev, [vi.id]: "" }));
    // The PRICE is deliberately left as typed. Adding four bags at a negotiated
    // rate is one gesture repeated, and re-typing the rate each time is the
    // thing the panel staying open exists to avoid; `openPanel` clears it.
    setAdded((prev) => ({ ...prev, [vi.id]: (prev[vi.id] ?? 0) + n }));
    // The table behind the panel is server-rendered, so this is what makes the
    // new line appear there — and what keeps `onOrder` above honest.
    router.refresh();
  }

  /**
   * A line with NO vendor item. It never merges with an existing line the way
   * `add` does: two one-offs reading the same thing are two things somebody
   * typed twice, and there is no SKU to say otherwise.
   */
  async function addOneOff() {
    const description = oneOff.description.trim();
    if (!description) {
      setError("Give the item a description — it is what the vendor reads.");
      return;
    }
    const n = addableQty(oneOff.qty);
    if (n === null) {
      setError("Enter an order amount greater than zero.");
      return;
    }
    // Optional, and null rather than 0 when it is left empty: a price nobody
    // knows yet is not a price of nothing, and receiving reads the difference.
    const rawPrice = oneOff.price.trim();
    const price = rawPrice === "" ? null : evaluateNumeric(rawPrice);
    if (rawPrice !== "" && (price === null || !Number.isFinite(price))) {
      setError("That unit price is not a number.");
      return;
    }

    setAddingOneOff(true);
    setError(null);
    const { error } = await supabase.from("purchase_order_items").insert({
      org_id: orgId,
      po_id: order.id,
      vendor_item_id: null,
      description,
      brand: oneOff.brand.trim() || null,
      product_id: oneOff.productId.trim() || null,
      package_desc: oneOff.packageDesc.trim() || null,
      notes: oneOff.notes.trim() || null,
      qty_ordered: n,
      unit_price: price,
    });
    setAddingOneOff(false);
    if (error) {
      setError(error.message);
      return;
    }
    setOneOff(BLANK_ONE_OFF);
    setOneOffAdded((prev) => [...prev, `${n} × ${description}`]);
    router.refresh();
  }

  return (
    <>
      {children ? (
        children(() => void openPanel())
      ) : (
        <button
          type="button"
          onClick={openPanel}
          className="h-9 mac-control border border-ink bg-white px-4 text-[12px] font-semibold uppercase tracking-[0.06em] transition-colors hover:bg-ink hover:text-white"
        >
          Add item…
        </button>
      )}

      {open && (
        <Dialog
          title={`Add items · ${vendorName} → ${order.po_number}`}
          onClose={() => void closePanel()}
          width="max-w-4xl"
          bodyClassName="px-6 py-4"
          // The search sits in the dialog's TOOLBAR rather than in the scrolling
          // body: on a vendor with hundreds of items it's the first thing you
          // use and it must not scroll away.
          toolbar={
            <>
              {/* A PICKER, NOT TABS (Mark, 2026-09-19). Both halves of this
                  panel are ways of putting a line on the order, and a segmented
                  bar spending 313px to say so was what crowded this row; the
                  picker says the same thing in 166px.

                  ITS LABEL IS INLINE, WHICH IS THE EXCEPTION AND NOT A LAPSE
                  (Mark, same day: "make the label inline with the picklist not
                  above it"). `ControlField` — caption ABOVE, never beside — is
                  the rule for a FILTER ROW, where several collapsed controls
                  have to begin on one margin and line up with what sits above
                  them. This row is one control and a search box: there is no
                  column to keep, and a caption above is the only thing that
                  would make the toolbar two lines tall. `shrink-0` so the pair
                  is never squashed — the search takes the leftover. */}
              <span className="flex shrink-0 items-center gap-2">
                {/* VISUAL ONLY, the same as `ControlField`'s caption: the
                    picker keeps its own `ariaLabel`, which is the longer
                    sentence, so a screen reader hears it once and hears the
                    better one. */}
                <span className="text-xs uppercase tracking-[0.12em] text-subtle">
                  Show:
                </span>
                <PickList
                  ariaLabel="What to add"
                  variant="field"
                  fit
                  value={tab}
                  onPick={(k) => {
                    setTab(k as "catalog" | "oneOff");
                    setError(null);
                  }}
                  options={[
                    { value: "catalog", label: "This vendor's items" },
                    { value: "oneOff", label: "One-off item" },
                  ]}
                />
              </span>
              {tab === "catalog" && (
                <TextInput
                  autoFocus
                  value={search}
                  onValueChange={setSearch}
                  aria-label="Search this vendor's items"
                  clearLabel="Clear the search"
                  search
                  icon={<SearchGlyph />}
                />
              )}
            </>
          }
          footer={
            <>
              {/* THE COUNT AND THE WARNING LIVE HERE, NOT IN THE TOOLBAR (Mark,
                  2026-09-19: "the record count and warning message could live
                  in the footer with the Done button if needed"). Four things in
                  the toolbar did not fit and failed SILENTLY: the TabPicker is
                  `min-w-0 flex-1` and the search box `flex-[999_1_0%]`, so both
                  have a flex BASIS OF ZERO and neither can ever claim the next
                  line — `flex-wrap` on the row is therefore dead — and the tab
                  group, being the one with no floor, was squashed to nothing
                  and drew One-off item underneath the search box, which paints
                  over it. Two readouts and a search are also not the same kind
                  of thing: the toolbar is what you ACT with, and these two only
                  say where you are. */}
              <div className="mr-auto flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
                {tab === "catalog" && !loading && (
                  <span className="text-[12px] uppercase tracking-[0.12em] text-subtle">
                    {filtered.length} of {rows.length} active
                  </span>
                )}
                {order.status !== "draft" && (
                  <span className="border border-ink bg-[var(--rf-yellow-200)] px-2 py-0.5 text-xs text-ink">
                    This order is {PO_STATUS_LABEL[order.status].toLowerCase()} —
                    adding changes order history
                  </span>
                )}
              </div>
              {/* BLACK ONLY WHILE NOTHING IS TYPED IN (Mark, 2026-09-08).
                  The panel-commit exception is about the one outcome a panel is
                  for, and here that outcome MOVES: the moment anything is typed,
                  Add to PO is what finishes the task and Done is the escape beside
                  it. Two black buttons would say nothing about which one to press
                  — and the pale one would be the one that discards the typing. */}
              <button
                type="button"
                onClick={() => void closePanel()}
                className={`shrink-0 ${typedIn ? BUTTON_CLASS : DIALOG_COMMIT_CLASS}`}
              >
                Done
              </button>
            </>
          }
        >
              {error && <p className="mb-3 text-sm text-accent">{error}</p>}

              {tab === "oneOff" ? (
                <OneOffForm
                  ready={oneOffTyped}
                  draft={oneOff}
                  onDraft={(patch) => setOneOff((prev) => ({ ...prev, ...patch }))}
                  onAdd={() => void addOneOff()}
                  busy={addingOneOff}
                  added={oneOffAdded}
                  calcField={calcField}
                />
              ) : loading ? (
                <p className="text-sm text-subtle">Loading this vendor&rsquo;s items…</p>
              ) : filtered.length === 0 ? (
                <p className="text-sm text-muted">
                  {rows.length === 0
                    ? "This vendor has no active items."
                    : "Nothing matches that search."}
                </p>
              ) : (
                <>
                {/* COLUMN LABELS OVER THE ROWS (Mark, 2026-09-21, sweeping the
                    app's placeholders). The price and quantity boxes carried
                    the words "price" and "qty" as placeholder text, which is a
                    label written inside the box — so it is a label now, said
                    once above the list instead of a hundred times inside it.
                    The widths mirror the row's own `w-24` / `w-32` / `w-16`. */}
                <div className="flex flex-wrap items-end gap-x-4 px-4 pb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                  <span className="min-w-0 flex-1">Item</span>
                  <span className="w-24 shrink-0 text-right">Price</span>
                  <span className="w-32 shrink-0 text-right">On order</span>
                  <span className="w-16 shrink-0 text-center">Qty</span>
                  {/* The button's column — see its own note. */}
                  <span className="w-32 shrink-0" />
                </div>
                <ul className="divide-y divide-hairline border border-ink">
                  {filtered.map((vi) => {
                    const existingLines = onOrder.get(vi.id) ?? [];
                    const onOrderQty = existingLines.reduce(
                      (t, l) => t + Number(l.qty_ordered ?? 0),
                      0
                    );
                    const catalogPrice = effectivePrice(vi, order.location_id);
                    const resolved = draftedPrice(vi);
                    // Which line this add would land on, live — so the button
                    // can say whether it is joining a line or starting one
                    // BEFORE it is pressed, rather than leaving the person to
                    // discover it in the table afterwards.
                    const joins = resolved.ok
                      ? mergeTargetLine(existingLines, vi.id, resolved.price)
                      : null;
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

                        {/* THE PRICE IS A FIELD, NOT A READOUT (Mark,
                            2026-09-19). It rests at what the catalog resolves
                            to — the location override, else the base price
                            (design rule 6) — and typing over it is how the
                            same item goes onto the order twice at two rates.
                            No `$`: the box takes arithmetic like every other
                            numeric field, and a currency sign inside one is
                            something to delete before you can type. */}
                        <span className="w-24 shrink-0">
                          <input
                            {...calcField}
                            value={priceDrafts[vi.id] ?? priceText(catalogPrice)}
                            onChange={(e) =>
                              setPriceDrafts((prev) => ({
                                ...prev,
                                [vi.id]: e.target.value,
                              }))
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                void add(vi);
                              }
                            }}
                            aria-label={`Unit price for ${
                              vi.inventory_items?.name ?? orderedAs
                            }`}
                            className={`h-9 w-full border px-1 text-right tabular-nums ${
                              // The only cue the panel gives that this row is
                              // not at the catalog price — colour means record
                              // STATE, and "priced by hand" is one.
                              resolved.ok && !samePrice(resolved.price, catalogPrice)
                                ? "border-2 border-ink font-semibold"
                                : "border-ink"
                            }`}
                          />
                        </span>

                        {/* What's already on the order, and what this panel has
                            put there this session. */}
                        <span className="w-32 shrink-0 text-right text-xs">
                          {existingLines.length > 0 ? (
                            <span className="text-muted tabular-nums">
                              {onOrderQty} on order
                              {existingLines.length > 1 &&
                                ` · ${existingLines.length} lines`}
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
                          {...calcField}
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
                          className="h-9 w-16 shrink-0 border border-ink px-1 text-center tabular-nums"
                        />
                        <button
                          type="button"
                          onClick={() => void add(vi)}
                          disabled={addingId === vi.id}
                          // ONE WIDTH FOR EVERY ROW, so the columns beside it
                          // land on one line down the list — the button says
                          // "Add to PO", "Add to line" or "New line" depending
                          // on the row, and at its natural width each of those
                          // shifted that row's price and quantity boxes by a
                          // few pixels. Nothing noticed while the boxes named
                          // themselves; with the names in a header strip above,
                          // a column that wanders is a column that lies.
                          className={`${
                            (drafts[vi.id] ?? "").trim() === ""
                              ? BUTTON_CLASS
                              : PRIMARY_BUTTON_CLASS
                          } w-32 shrink-0`}
                        >
                          {addingId === vi.id
                            ? "Adding…"
                            : joins
                              ? "Add to line"
                              : existingLines.length > 0
                                ? "New line"
                                : "Add to PO"}
                        </button>
                      </li>
                    );
                  })}
                </ul>
                </>
              )}
        </Dialog>
      )}
    </>
  );
}

/**
 * The one-off form. Description and quantity are the only required fields —
 * everything else is what a vendor item would have LENT the line, and a line
 * that carries none of it is still a perfectly good instruction to a vendor
 * ("2 × dry ice, whatever it costs").
 *
 * There is deliberately no inventory item here and no way to reach one: linking
 * a line to the catalog is what MAKING it a vendor item does, and that is the
 * other half of this feature, offered on the line itself once it exists. Asking
 * for it up front would turn "add the one thing we need" into a catalog chore,
 * which is the thing a one-off exists to avoid.
 */
function OneOffForm({
  draft,
  onDraft,
  onAdd,
  busy,
  ready,
  added,
  calcField,
}: {
  draft: typeof BLANK_ONE_OFF;
  onDraft: (patch: Partial<typeof BLANK_ONE_OFF>) => void;
  onAdd: () => void;
  busy: boolean;
  /** Anything typed into the form — the Add button takes the fill. */
  ready: boolean;
  /** What this session has already put on the order, so the panel staying open
   *  after each add still tells you what it did. */
  added: string[];
  calcField: ReturnType<typeof useCalcField>;
}) {
  const field = "h-9 w-full border border-ink px-2 text-sm";
  const label = "block text-[12px] uppercase tracking-[0.12em] text-subtle";

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        A line on this order and nothing else — no catalog entry, so it is on no
        order guide and has no price history. Once it is on the order you can
        still save it to {"this vendor's"} items from the line itself.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="sm:col-span-2">
          <span className={label}>Description</span>
          <input
            autoFocus
            value={draft.description}
            onChange={(e) => onDraft({ description: e.target.value })}
            className={`${field} mt-1`}
          />
        </label>

        <label>
          <span className={label}>Brand</span>
          <input
            value={draft.brand}
            onChange={(e) => onDraft({ brand: e.target.value })}
            className={`${field} mt-1`}
          />
        </label>

        <label>
          <span className={label}>Product ID</span>
          <input
            value={draft.productId}
            onChange={(e) => onDraft({ productId: e.target.value })}
            className={`${field} mt-1`}
          />
        </label>

        <div>
          {/* The pack TYPE, from the catalog's own vocabulary — see
              BLANK_ONE_OFF. A composed size typed here would print nothing. */}
          <span className={label}>Sold as</span>
          <div className="mt-1">
            <PickList
              variant="field"
              value={draft.packageDesc}
              onPick={(v) => onDraft({ packageDesc: v })}
              options={PACKAGE_DESC_OPTIONS}
              placeholder="none"
              ariaLabel="Sold as"
            />
          </div>
        </div>

        <label>
          <span className={label}>Unit price</span>
          <input
            {...calcField}
            value={draft.price}
            onChange={(e) => onDraft({ price: e.target.value })}
            className={`${field} mt-1 tabular-nums`}
          />
        </label>

        <label className="sm:col-span-2">
          <span className={label}>Note to the vendor</span>
          <input
            value={draft.notes}
            onChange={(e) => onDraft({ notes: e.target.value })}
            className={`${field} mt-1`}
          />
        </label>
      </div>

      <div className="flex items-center gap-3 border-t border-hairline pt-4">
        <span className={label}>Order amount</span>
        <input
          {...calcField}
          value={draft.qty}
          onChange={(e) => onDraft({ qty: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onAdd();
            }
          }}
          aria-label="Order amount"
          className="h-9 w-20 border border-ink px-1 text-center tabular-nums"
        />
        <button
          type="button"
          onClick={onAdd}
          disabled={busy}
          className={ready ? PRIMARY_BUTTON_CLASS : BUTTON_CLASS}
        >
          {busy ? "Adding…" : "Add to PO"}
        </button>
      </div>

      {added.length > 0 && (
        <ul className="space-y-0.5 text-xs text-[var(--rf-green-600)]">
          {added.map((line, i) => (
            <li key={i}>Added {line}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
