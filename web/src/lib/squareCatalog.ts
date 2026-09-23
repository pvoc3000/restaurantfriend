/**
 * THE SQUARE CATALOG, AS PICKER OPTIONS (Mark, 2026-09-23: "is there a way to
 * grab the item names and tokens from square and use a picklist in settings to
 * set it instead?"). `square-catalog` lists the items; this turns them into
 * rows a person can recognise. Pure, so it is fixture-tested.
 */

import type { PickOption } from "@/components/ui/PickList";

/** One row of what `square-catalog` answers. */
export type SquareVariation = {
  id: string;
  item: string;
  variation: string;
  /** How many live variations the item has — a lone "Regular" is not worth saying. */
  variations: number;
  category: string | null;
};

/**
 * "Special Order", or "Donut Box — Dozen" when the item has several sizes: the
 * variation name only where it tells two rows apart. The CATEGORY is the hint,
 * because it is where the money will be filed and so the thing being chosen.
 *
 * A value already saved that is NOT in the catalog — deleted in Square, or
 * typed by hand from the other environment — stays on the list under its raw
 * id, so opening the picker never silently loses what is there.
 */
export function variationOptions(rows: SquareVariation[], current: string | null): PickOption[] {
  const options: PickOption[] = rows.map((r) => ({
    value: r.id,
    label: r.variations > 1 && r.variation ? `${r.item} — ${r.variation}` : r.item || r.id,
    hint: r.category ?? "no category",
  }));
  if (current && !rows.some((r) => r.id === current)) {
    options.unshift({ value: current, label: current, hint: "not in the Square catalog" });
  }
  return options;
}
