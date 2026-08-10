"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  PROBLEM_LABEL,
  favoritesMissingContent,
  favoritesMissingPrice,
  favoritesWithStaleContent,
  type CleanupFavorite,
} from "@/lib/cleanup";
import { derivedPackContent } from "@/lib/catalog";
import { UNIT_OPTIONS, UNIT_PICK_OPTIONS, packageContent, unitFamily } from "@/lib/units";
import { PickList } from "@/components/ui/PickList";
import { evaluateNumeric } from "@/lib/calc";
import { BaseUnitEditor } from "@/components/catalog/BaseUnitEditor";
import type { QueueItem } from "@/app/(app)/cleanup/page";
import { FavoritesEditor } from "./FavoritesEditor";
import { useCalcField } from "@/components/ui/CalcPad";

/** Which favorite an editor is about — several can be broken on one item. */
function FavoriteHeading({ f }: { f: CleanupFavorite }) {
  return (
    <p className="text-xs text-subtle">
      <span className="font-medium text-body">{f.vendor_name ?? "—"}</span>
      {f.brand ? ` · ${f.brand}` : ""}
      {f.description ? ` · ${f.description}` : ""}
      {f.package_desc ? ` · ${f.package_desc}` : ""}
    </p>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2 border-t border-hairline pt-3">
      <h3 className="text-sm font-semibold text-body">{title}</h3>
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
      <aside className="fixed inset-y-0 right-0 z-50 w-full max-w-md overflow-y-auto border-l-2 border-ink bg-white p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">
              {item?.inventory_items.name ?? "Item"}
            </h2>
            {item && (
              <p className="text-sm text-subtle">
                {item.location_code} · {item.inventory_items.category ?? "—"} ·
                base unit{" "}
                <span className="font-medium text-body">
                  {item.inventory_items.base_unit}
                </span>
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="px-2 py-1 text-sm text-subtle hover:bg-neutral-100"
          >
            Close
          </button>
        </div>

        {resolved || !item ? (
          <p className="mt-6 border border-ink bg-[var(--rf-green-50)] px-3 py-2 text-sm text-ink">
            ✓ Resolved — this row is off the queue.
          </p>
        ) : (
          <div className="mt-4 space-y-4">
            {/* One editor per offending FAVORITE, not one for "the" vendor
                item: an item can be sourced from several, and the guide uses
                each line's own content and price. */}
            {favoritesMissingContent(item).map((f) => (
              <Section key={`content-${f.id}`} title={PROBLEM_LABEL.no_package_content}>
                <FavoriteHeading f={f} />
                <PackageContentEditor
                  vendorItemId={f.id}
                  packageDesc={f.package_desc}
                  baseUnit={item.inventory_items.base_unit}
                  price={f.price}
                  onChanged={onChanged}
                />
              </Section>
            ))}

            {/* Same editor as a missing content, because the fix is the same
                act — restate what one package holds. What differs is that
                there's a wrong number to show you first, so you can see what
                you're overruling. */}
            {favoritesWithStaleContent(item).map((f) => (
              <Section
                key={`stale-${f.id}`}
                title={PROBLEM_LABEL.stale_package_content}
              >
                <FavoriteHeading f={f} />
                <StaleContentNote f={f} baseUnit={item.inventory_items.base_unit} />
                <PackageContentEditor
                  vendorItemId={f.id}
                  packageDesc={f.package_desc}
                  baseUnit={item.inventory_items.base_unit}
                  price={f.price}
                  onChanged={onChanged}
                />
              </Section>
            ))}

            {favoritesMissingPrice(item).map((f) => (
              <Section key={`price-${f.id}`} title={PROBLEM_LABEL.no_price}>
                <FavoriteHeading f={f} />
                <PriceEditor vendorItemId={f.id} onChanged={onChanged} />
              </Section>
            ))}

            {item.problems.includes("no_par") && (
              <Section title={PROBLEM_LABEL.no_par}>
                <ParEditor
                  itemLocationId={item.id}
                  baseUnit={item.inventory_items.base_unit}
                  onChanged={onChanged}
                />
              </Section>
            )}

            {/* Not a problem check — a property of the item, shown for any
                opened row (Mark, 2026-07-29). It's here because this is the
                screen where a wrong counting unit becomes obvious: every
                broken content and impossible par below is downstream of it. */}
            <Section title="Base unit (all locations)">
              <BaseUnitEditor
                key={`${item.inventory_item_id}:${item.inventory_items.base_unit}`}
                inventoryItemId={item.inventory_item_id}
                baseUnit={item.inventory_items.base_unit}
                defaultPar={item.default_par}
                onChanged={onChanged}
              />
            </Section>

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

/**
 * What the stored total says versus what the pack says, so the disagreement is
 * on screen rather than asserted. Two readings, because the two failure shapes
 * need different words: a convertible pack has a right answer to offer, an
 * unconvertible one only has "this cannot be a conversion of that".
 */
function StaleContentNote({
  f,
  baseUnit,
}: {
  f: CleanupFavorite;
  baseUnit: string;
}) {
  const derived = derivedPackContent(f, baseUnit);
  const packText = `${Number(f.pack_count ?? 1)} × ${Number(f.pack_size)} ${
    f.pack_unit ?? baseUnit
  }`;
  return (
    <p className="mb-2 border border-hairline bg-neutral-50 px-2 py-1.5 text-xs text-body">
      Pack says <span className="font-semibold">{packText}</span>, content says{" "}
      <span className="font-semibold">
        {Number(f.package_content)} {baseUnit}
      </span>
      .{" "}
      {derived === null ? (
        <>
          That&apos;s {Number(f.pack_count ?? 1)} × {Number(f.pack_size)} with the{" "}
          {f.pack_unit} thrown away — and {f.pack_unit} doesn&apos;t convert to{" "}
          {baseUnit}, so nothing can work it out for you. Enter what one package
          holds in {baseUnit}.
        </>
      ) : (
        <>
          That pack works out to{" "}
          <span className="font-semibold">
            {Number(derived.toFixed(3))} {baseUnit}
          </span>
          .
        </>
      )}
    </p>
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
  const calcField = useCalcField();
  const [amount, setAmount] = useState("1");
  const [size, setSize] = useState("");
  const [unit, setUnit] = useState(baseUnit);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Arithmetic allowed in both boxes (lib/calc.ts): a pack of "3*4" is 12.
  const a = evaluateNumeric(amount) ?? NaN;
  const s = evaluateNumeric(size) ?? NaN;
  const valid = amount !== "" && size !== "" && a > 0 && s > 0;
  const content = valid ? packageContent(a, s, unit, baseUnit) : null;
  // "Both units are ones we know, and they still don't convert." Asking whether
  // the FAMILIES differ isn't enough any more: two package units share the
  // family `package` and deliberately don't convert to each other (a case is
  // not n bags), so a cs → bag mistake would have fallen through to "Enter
  // amount and size" instead of saying what was wrong.
  const incompatible =
    valid &&
    content === null &&
    unitFamily(unit) !== null &&
    unitFamily(baseUnit) !== null;
  const unitPrice =
    content && content > 0 && price ? Number(price) / content : null;
  // Name the unit the way the menu named it — the message said "cs" about an
  // option labelled "case".
  const unitLabel = UNIT_OPTIONS.find((o) => o.value === unit)?.label ?? unit;

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
          {...calcField}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-16 border border-ink px-2 py-1"
          aria-label="amount"
        />
        <span className="text-subtle">×</span>
        <input
          {...calcField}
          value={size}
          onChange={(e) => setSize(e.target.value)}
          placeholder="size"
          className="w-20 border border-ink px-2 py-1"
          aria-label="size"
        />
        <span className="inline-block w-28 border border-ink px-1">
          <PickList
            value={unit}
            options={UNIT_PICK_OPTIONS}
            onPick={setUnit}
            ariaLabel="unit"
          />
        </span>
        <span className="text-subtle">per {packageDesc ?? "pkg"}</span>
      </div>

      {incompatible ? (
        <p className="text-accent">
          {unitLabel} can’t convert to the item’s base unit ({baseUnit}). Pick a
          compatible unit.
        </p>
      ) : content !== null ? (
        <p className="text-muted">
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
        <p className="text-faint">Enter amount and size.</p>
      )}

      {error && <p className="text-accent">{error}</p>}

      <button
        disabled={busy || content === null}
        onClick={save}
        className="border border-ink bg-white px-4 py-2 text-[12px] font-semibold uppercase tracking-[0.06em] transition-colors hover:bg-ink hover:text-white disabled:opacity-35"
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
  const calcField = useCalcField();
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const p = evaluateNumeric(price) ?? NaN;
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
        <span className="text-subtle">$</span>
        <input
          {...calcField}
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="0.00"
          className="w-28 border border-ink px-2 py-1"
          aria-label="price"
        />
      </div>
      {error && <p className="text-accent">{error}</p>}
      <button
        disabled={busy || !valid}
        onClick={save}
        className="border border-ink bg-white px-4 py-2 text-[12px] font-semibold uppercase tracking-[0.06em] transition-colors hover:bg-ink hover:text-white disabled:opacity-35"
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
  const calcField = useCalcField();
  const [par, setPar] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The field Mark asked for this in: "4*9*25" is 25 cases of 4 x 9 lbs.
  const p = evaluateNumeric(par) ?? NaN;
  const valid = par !== "" && p >= 0;

  async function save() {
    setBusy(true);
    setError(null);
    // Default par changes are logged by a DB trigger (CLAUDE.md rule 6).
    const { error } = await supabase
      .from("inventory_item_locations")
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
          {...calcField}
          value={par}
          onChange={(e) => setPar(e.target.value)}
          placeholder={`e.g. 100 (${baseUnit})`}
          className="w-40 border border-ink px-2 py-1"
          aria-label="par"
        />
        <span className="text-subtle">{baseUnit}</span>
      </div>
      {error && <p className="text-accent">{error}</p>}
      <button
        disabled={busy || !valid}
        onClick={save}
        className="border border-ink bg-white px-4 py-2 text-[12px] font-semibold uppercase tracking-[0.06em] transition-colors hover:bg-ink hover:text-white disabled:opacity-35"
      >
        Save par
      </button>
    </div>
  );
}

function round(n: number) {
  return Math.round(n * 1000) / 1000;
}
