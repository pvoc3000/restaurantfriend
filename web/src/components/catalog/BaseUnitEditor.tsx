"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { UNIT_OPTIONS } from "@/lib/units";
import { derivedPackContent } from "@/lib/catalog";

/**
 * The unit this item is counted in — pars, on-hand counts, and every vendor
 * item's package content are all stated in it.
 *
 * Changing it is the most far-reaching edit on this screen and the only one
 * that reaches past the location you're working at, so it says so. It also
 * repairs what it can: every package content is by definition the pack
 * expressed in base units, so where the pack converts to the NEW unit the
 * content is recomputed rather than left describing the old one. A 1 × 50 lbs
 * bag whose item moves from `lbs` to `oz` becomes 800, not a stale 50.
 *
 * What it deliberately does NOT touch is par. That conversion is arithmetic too
 * but it isn't only arithmetic — moving orange juice from ounces to bottles,
 * Mark set the par to 24 rather than the 36 the old number converts to, because
 * restating the unit is also the moment you re-decide the target. So pars are
 * left alone and called out.
 */
export function BaseUnitEditor({
  inventoryItemId,
  baseUnit,
  defaultPar,
  onChanged,
}: {
  inventoryItemId: string;
  baseUnit: string;
  /**
   * The par to name in the warning, when there is exactly one worth naming.
   * The cleanup drawer is scoped to one item-location so it can be concrete;
   * the item detail page spans every location, each with its own par, so it
   * passes null and gets the general form.
   */
  defaultPar?: number | null;
  onChanged: () => void;
}) {
  const supabase = createClient();
  const [next, setNext] = useState(baseUnit);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ recomputed: number; manual: number } | null>(
    null
  );

  // The stored unit isn't always one the dropdown offers — "GAL" is in the data
  // uppercase — and a select that silently reassigns it would be a data edit
  // nobody asked for.
  const options = UNIT_OPTIONS.some((o) => o.value === baseUnit)
    ? UNIT_OPTIONS
    : [{ value: baseUnit, label: baseUnit }, ...UNIT_OPTIONS];

  async function save() {
    if (next === baseUnit) return;
    setBusy(true);
    setError(null);
    setResult(null);

    const { error: unitError } = await supabase
      .from("inventory_items")
      .update({ base_unit: next })
      .eq("id", inventoryItemId);
    if (unitError) {
      setBusy(false);
      setError(unitError.message);
      return;
    }

    // Every content under this item is now stated in the old unit. Rewrite the
    // ones the pack can answer for; the rest are a queue entry, not a guess.
    const { data: vis, error: readError } = await supabase
      .from("vendor_items")
      .select("id, package_content, pack_count, pack_size, pack_unit")
      .eq("inventory_item_id", inventoryItemId);
    if (readError) {
      setBusy(false);
      setError(`Base unit saved, but contents could not be read: ${readError.message}`);
      onChanged();
      return;
    }

    let recomputed = 0;
    let manual = 0;
    for (const vi of vis ?? []) {
      const derived = derivedPackContent(vi, next);
      if (derived === null) {
        if (vi.package_content !== null) manual++;
        continue;
      }
      if (vi.package_content !== null && Number(vi.package_content) === derived) continue;
      const { error: writeError } = await supabase
        .from("vendor_items")
        .update({ package_content: derived })
        .eq("id", vi.id);
      if (writeError) {
        setBusy(false);
        setError(`Base unit saved, but a content failed: ${writeError.message}`);
        onChanged();
        return;
      }
      recomputed++;
    }

    setBusy(false);
    setResult({ recomputed, manual });
    onChanged();
  }

  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-center gap-2">
        <select
          value={next}
          onChange={(e) => setNext(e.target.value)}
          className="border border-ink px-2 py-1"
          aria-label="base unit"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={busy || next === baseUnit}
          onClick={save}
          className="border border-ink px-3 py-1 hover:bg-neutral-100 disabled:opacity-35"
        >
          {busy ? "Saving…" : "Change base unit"}
        </button>
      </div>

      {next !== baseUnit && !result && (
        <p className="text-muted">
          Counts this item in <span className="font-medium text-body">{next}</span>{" "}
          at <span className="font-medium text-body">every location</span>, not
          just this one. Package contents that can be worked out from their pack
          are recomputed; the rest come back to this queue.
          {defaultPar !== null && defaultPar !== undefined ? (
            <>
              {" "}
              The par stays{" "}
              <span className="font-medium text-body">{Number(defaultPar)}</span> —
              now meaning {Number(defaultPar)} {next}, not {Number(defaultPar)}{" "}
              {baseUnit}. Reset it below if that isn&apos;t what you want.
            </>
          ) : (
            <>
              {" "}
              <span className="font-medium text-body">Pars are not converted</span> —
              each location keeps the number it has, now read as {next} rather
              than {baseUnit}. Check them below.
            </>
          )}
        </p>
      )}

      {result && (
        <p className="border border-ink bg-[var(--rf-green-50)] px-2 py-1.5 text-ink">
          Base unit changed. {result.recomputed}{" "}
          {result.recomputed === 1 ? "package content" : "package contents"}{" "}
          recomputed
          {result.manual > 0 ? (
            <>
              , {result.manual} couldn&apos;t be — those packs don&apos;t convert
              to {next}, so they need setting by hand and will show in the queue.
            </>
          ) : (
            "."
          )}
        </p>
      )}

      {error && <p className="text-accent">{error}</p>}
    </div>
  );
}
