"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PROBLEM_LABEL } from "@/lib/cleanup";
import { UNIT_OPTIONS, packageContent, unitFamily } from "@/lib/units";
import type { QueueItem } from "@/app/(app)/cleanup/page";
import { AssignVendorItem } from "./AssignVendorItem";
import { FavoritesEditor } from "./FavoritesEditor";

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2 border-t border-neutral-200 pt-3">
      <h3 className="text-sm font-semibold text-neutral-800">{title}</h3>
      {children}
    </section>
  );
}

export function FixDrawer({
  item,
  orgId,
  resolved,
  onClose,
  onChanged,
}: {
  item: QueueItem | null;
  orgId: string;
  resolved: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/20"
        onClick={onClose}
        aria-hidden
      />
      <aside className="fixed inset-y-0 right-0 z-50 w-full max-w-md overflow-y-auto border-l border-neutral-200 bg-white p-4 shadow-xl">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">
              {item?.inventory_items.name ?? "Item"}
            </h2>
            {item && (
              <p className="text-sm text-neutral-500">
                {item.location_code} · {item.inventory_items.category ?? "—"} ·
                base unit{" "}
                <span className="font-medium text-neutral-700">
                  {item.inventory_items.base_unit}
                </span>
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded px-2 py-1 text-sm text-neutral-500 hover:bg-neutral-100"
          >
            Close
          </button>
        </div>

        {resolved || !item ? (
          <p className="mt-6 rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
            ✓ Resolved — this row is off the queue.
          </p>
        ) : (
          <div className="mt-4 space-y-4">
            {(item.problems.includes("no_default") ||
              item.problems.includes("default_inactive")) && (
              <Section
                title={
                  item.problems.includes("no_default")
                    ? PROBLEM_LABEL.no_default
                    : PROBLEM_LABEL.default_inactive
                }
              >
                <AssignVendorItem
                  itemLocationId={item.id}
                  inventoryItemId={item.inventory_items.id}
                  currentDefaultId={item.default_vendor_item_id}
                  onChanged={onChanged}
                />
              </Section>
            )}

            {item.problems.includes("no_package_content") && item.vendor_items && (
              <Section title={PROBLEM_LABEL.no_package_content}>
                <PackageContentEditor
                  vendorItemId={item.vendor_items.id}
                  packageDesc={item.vendor_items.package_desc}
                  baseUnit={item.inventory_items.base_unit}
                  price={item.vendor_items.price}
                  onChanged={onChanged}
                />
              </Section>
            )}

            {item.problems.includes("no_price") && item.vendor_items && (
              <Section title={PROBLEM_LABEL.no_price}>
                <PriceEditor
                  vendorItemId={item.vendor_items.id}
                  onChanged={onChanged}
                />
              </Section>
            )}

            {item.problems.includes("no_par") && (
              <Section title={PROBLEM_LABEL.no_par}>
                <ParEditor
                  itemLocationId={item.id}
                  baseUnit={item.inventory_items.base_unit}
                  onChanged={onChanged}
                />
              </Section>
            )}

            {/* Multi-favorite plan rows (brief §A) — orthogonal to the
                problem checks, shown for any opened item. */}
            <Section title="Favorites (this location)">
              <FavoritesEditor
                itemLocationId={item.id}
                inventoryItemId={item.inventory_item_id}
                orgId={orgId}
                onChanged={onChanged}
              />
            </Section>
          </div>
        )}
      </aside>
    </>
  );
}

// --- fixes #3: package content ------------------------------------------------

function PackageContentEditor({
  vendorItemId,
  packageDesc,
  baseUnit,
  price,
  onChanged,
}: {
  vendorItemId: string;
  packageDesc: string | null;
  baseUnit: string;
  price: number | null;
  onChanged: () => void;
}) {
  const supabase = createClient();
  const [amount, setAmount] = useState("1");
  const [size, setSize] = useState("");
  const [unit, setUnit] = useState(baseUnit);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const a = Number(amount);
  const s = Number(size);
  const valid = amount !== "" && size !== "" && a > 0 && s > 0;
  const content = valid ? packageContent(a, s, unit, baseUnit) : null;
  const incompatible =
    valid && content === null && unitFamily(unit) !== unitFamily(baseUnit);
  const unitPrice =
    content && content > 0 && price ? Number(price) / content : null;

  async function save() {
    if (content === null) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase
      .from("vendor_items")
      .update({ package_content: content })
      .eq("id", vendorItemId);
    setBusy(false);
    if (error) setError(error.message);
    else onChanged();
  }

  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-center gap-2">
        <input
          type="number"
          min="0"
          step="any"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-16 rounded border border-neutral-300 px-2 py-1"
          aria-label="amount"
        />
        <span className="text-neutral-500">×</span>
        <input
          type="number"
          min="0"
          step="any"
          value={size}
          onChange={(e) => setSize(e.target.value)}
          placeholder="size"
          className="w-20 rounded border border-neutral-300 px-2 py-1"
          aria-label="size"
        />
        <select
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          className="rounded border border-neutral-300 px-2 py-1"
          aria-label="unit"
        >
          {UNIT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <span className="text-neutral-500">per {packageDesc ?? "pkg"}</span>
      </div>

      {incompatible ? (
        <p className="text-amber-700">
          {unit} can’t convert to the item’s base unit ({baseUnit}). Pick a
          compatible unit.
        </p>
      ) : content !== null ? (
        <p className="text-neutral-600">
          = <span className="font-medium">{round(content)} {baseUnit}</span> per{" "}
          {packageDesc ?? "package"}
          {unitPrice !== null && (
            <>
              {" "}
              → ${unitPrice.toFixed(4)}/{baseUnit}
            </>
          )}
        </p>
      ) : (
        <p className="text-neutral-400">Enter amount and size.</p>
      )}

      {error && <p className="text-red-700">{error}</p>}

      <button
        disabled={busy || content === null}
        onClick={save}
        className="rounded bg-neutral-900 px-3 py-1 text-white disabled:opacity-40"
      >
        Save package content
      </button>
    </div>
  );
}

// --- fixes #4: price ----------------------------------------------------------

function PriceEditor({
  vendorItemId,
  onChanged,
}: {
  vendorItemId: string;
  onChanged: () => void;
}) {
  const supabase = createClient();
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const p = Number(price);
  const valid = price !== "" && p > 0;

  async function save() {
    setBusy(true);
    setError(null);
    // The DB trigger logs price_history automatically (CLAUDE.md rule 6).
    const { error } = await supabase
      .from("vendor_items")
      .update({ price: p })
      .eq("id", vendorItemId);
    setBusy(false);
    if (error) setError(error.message);
    else onChanged();
  }

  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-center gap-2">
        <span className="text-neutral-500">$</span>
        <input
          type="number"
          min="0"
          step="0.01"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="0.00"
          className="w-28 rounded border border-neutral-300 px-2 py-1"
          aria-label="price"
        />
      </div>
      {error && <p className="text-red-700">{error}</p>}
      <button
        disabled={busy || !valid}
        onClick={save}
        className="rounded bg-neutral-900 px-3 py-1 text-white disabled:opacity-40"
      >
        Save price
      </button>
    </div>
  );
}

// --- fixes #5: par ------------------------------------------------------------

function ParEditor({
  itemLocationId,
  baseUnit,
  onChanged,
}: {
  itemLocationId: string;
  baseUnit: string;
  onChanged: () => void;
}) {
  const supabase = createClient();
  const [par, setPar] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const p = Number(par);
  const valid = par !== "" && p >= 0;

  async function save() {
    setBusy(true);
    setError(null);
    // Default par changes are logged by a DB trigger (CLAUDE.md rule 6).
    const { error } = await supabase
      .from("item_locations")
      .update({ default_par: p })
      .eq("id", itemLocationId);
    setBusy(false);
    if (error) setError(error.message);
    else onChanged();
  }

  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-center gap-2">
        <input
          type="number"
          min="0"
          step="any"
          value={par}
          onChange={(e) => setPar(e.target.value)}
          placeholder={`e.g. 100 (${baseUnit})`}
          className="w-40 rounded border border-neutral-300 px-2 py-1"
          aria-label="par"
        />
        <span className="text-neutral-500">{baseUnit}</span>
      </div>
      {error && <p className="text-red-700">{error}</p>}
      <button
        disabled={busy || !valid}
        onClick={save}
        className="rounded bg-neutral-900 px-3 py-1 text-white disabled:opacity-40"
      >
        Save par
      </button>
    </div>
  );
}

function round(n: number) {
  return Math.round(n * 1000) / 1000;
}
