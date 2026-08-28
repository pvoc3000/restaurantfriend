"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { UNIT_OPTIONS, UNIT_PICK_OPTIONS, normalizeUnit } from "@/lib/units";
import { PickList } from "@/components/ui/PickList";
import { BOXED_FIELDS } from "@/components/ui/fieldMetrics";
import { derivedPackContent } from "@/lib/catalog";
import { confirmDialog, splitConfirmMessage } from "@/lib/confirm";

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
  // The stored unit matched against the list case-insensitively: the data holds
  // "CS", "EA" and "GAL" uppercase on a handful of rows, and those are the same
  // units the menu offers. Matching on the raw string listed them a SECOND time
  // as one-off options sitting above their own duplicates.
  const known = UNIT_OPTIONS.find((o) => o.value === normalizeUnit(baseUnit));
  // Seeded from a prop, so both call sites KEY this component on
  // (item, baseUnit) — the cleanup drawer swaps `item` without remounting, and
  // an unkeyed instance would show the previous item's unit (CLAUDE.md).
  const [next, setNext] = useState(known?.value ?? baseUnit);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ recomputed: number; manual: number } | null>(
    null
  );

  // A unit the list doesn't know at all still has to be shown as itself — a
  // select that silently reassigned it would be a data edit nobody asked for.

  // Takes the unit rather than reading `next`: setNext is async, so the state
  // this runs beside is still the OLD value on the tick `choose` fires.
  async function save(chosen: string) {
    if (chosen === baseUnit) return;
    setBusy(true);
    setError(null);
    setResult(null);

    const { error: unitError } = await supabase
      .from("inventory_items")
      .update({ base_unit: chosen })
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
      const derived = derivedPackContent(vi, chosen);
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

  /**
   * Picking a unit IS the edit (Mark, 2026-07-29 — "can't the app tell when the
   * popup menu is changed?"). It can, and a separate button made the select lie:
   * it would read "oz" while the database still said "lbs" until you clicked.
   *
   * What the button was actually carrying was the warning, and that still has to
   * be said — package contents get recomputed but PARS DO NOT, so every par at
   * every location quietly means something else afterwards and nothing else on
   * screen would tell you. So the warning becomes the confirm. Same two actions
   * as before, minus a control that showed an unsaved value.
   *
   * A confirm rather than an inline warning, matching Clear guide and the PO
   * batch delete: the house pattern for a far-reaching action is a confirm that
   * names what's about to happen. (`ui/ConfirmDialog` since 2026-08-10; it was
   * `window.confirm` until the app grew its own.)
   */
  async function choose(chosen: string) {
    if (chosen === baseUnit) return;
    const parLine =
      defaultPar !== null && defaultPar !== undefined
        ? `The par stays ${Number(defaultPar)} — now meaning ${Number(defaultPar)} ${chosen}, not ${Number(defaultPar)} ${baseUnit}.`
        : `Pars are NOT converted — each location keeps the number it has, now read as ${chosen} rather than ${baseUnit}.`;
    const ok = (await confirmDialog({ ...splitConfirmMessage(`Count this item in ${chosen} instead of ${baseUnit}?\n\n` +
        `This applies at EVERY location, not just this one.\n\n` +
        `Package contents that can be worked out from their pack are recomputed; ` +
        `the rest are left for you and will show up in the cleanup queue.\n\n` +
        parLine), confirmLabel: "Change unit" }));
    // Snap back on cancel, so the control never shows a value that isn't saved.
    if (!ok) {
      setNext(baseUnit);
      return;
    }
    setNext(chosen);
    void save(chosen);
  }

  return (
    <div className="space-y-2 text-sm">
      {/* IT WEARS THE BOX ITS NEIGHBOUR WEARS, and the 2026-08-02 note that
          said the opposite is the same argument with its premise flipped: the
          border came off then because Category directly above was a bare
          `InlineValue kind="pick"`, and "a framed field beside an unframed one
          reads as a different KIND of control". Category is boxed now, so this
          is. It fills the track like every other field, and "Saving…" moved
          BELOW rather than beside it — anything hung to a field's right breaks
          the column's right edge. */}
      <PickList
        value={next}
        options={UNIT_PICK_OPTIONS}
        disabled={busy}
        onPick={choose}
        boxed={BOXED_FIELDS}
        ariaLabel="base unit"
      />
      {busy && <p className="text-muted">Saving…</p>}

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
