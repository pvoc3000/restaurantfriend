"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { PickList } from "@/components/ui/PickList";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { gridAxes, sortGrid, type PriceGridCell, type PriceGridOverride } from "@/lib/productionPrice";

export type GridLocation = { id: string; code: string; name: string };

/**
 * The price grid — (price class × tier) → price, decision 10.
 *
 * A MATRIX rather than a `DataTable`, deliberately. The table component is for
 * a list of records, and this is one record with two axes: eight classes down,
 * five tiers across. Reading it as 40 rows of (class, tier, price) would lose
 * the whole point, which is that a tier is a COLUMN — change Tier 3 and the
 * entire menu at that tier reprices, which is what tiers are for.
 *
 * FileMaker had no such screen because it had no grid: it kept 125 rows, 40
 * numbers copied across four shops, and three of those shops hand-maintained
 * identical copies. This is the inheritance that replaces that.
 */
export function PriceGrid({
  grid,
  overrides,
  locations,
  orgId,
  editable,
}: {
  grid: PriceGridCell[];
  overrides: PriceGridOverride[];
  /** Every ACTIVE location — design rule 3: a scope over shops enumerates these. */
  locations: GridLocation[];
  orgId: string;
  editable: boolean;
}) {
  // Which shop's prices are on screen. "" is the org grid itself — the one
  // every shop inherits, and the one you edit to move a whole tier.
  const [locationId, setLocationId] = useState("");
  const { classes, tiers } = gridAxes(grid);
  const sorted = sortGrid(grid);

  const cellFor = (klass: string, tier: string) =>
    sorted.find((c) => c.price_class === klass && c.price_tier === tier) ?? null;
  const overrideFor = (gridId: string) =>
    overrides.find((o) => o.grid_id === gridId && o.location_id === locationId) ?? null;

  const overrideCount = locationId
    ? overrides.filter((o) => o.location_id === locationId).length
    : 0;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SectionHeading count={grid.length}>Price grid</SectionHeading>
        <PickList
          variant="field"
          ariaLabel="Which prices"
          value={locationId}
          onPick={setLocationId}
          options={[
            { value: "", label: "Org prices", hint: "what every shop inherits" },
            ...locations.map((l) => ({
              value: l.id,
              label: l.code,
              hint: l.name,
            })),
          ]}
          className="w-56"
        />
      </div>

      <p className="max-w-[80ch] text-[13px] text-muted">
        {locationId ? (
          <>
            {overrideCount === 0
              ? "This shop overrides nothing — every cell below is the org price, shown in grey. Type in one to override it here only."
              : `This shop overrides ${overrideCount} of ${grid.length} cells. The rest are the org price, shown in grey.`}
          </>
        ) : (
          "What every shop charges unless it says otherwise. Changing one cell reprices every item on that class and tier."
        )}
      </p>

      <div className="overflow-x-auto">
        <table className="border-collapse text-[14px]">
          <thead>
            <tr className="border-b-2 border-ink text-[11px] uppercase tracking-[0.12em]">
              <th className="px-3 py-2 text-left">Class</th>
              {tiers.map((t) => (
                <th key={t} className="px-3 py-2 text-right">
                  {t}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {classes.map((klass) => (
              <tr key={klass} className="hover:bg-neutral-50">
                <td className="whitespace-nowrap px-3 py-2 font-medium">{klass}</td>
                {tiers.map((tier) => {
                  const cell = cellFor(klass, tier);
                  if (!cell) {
                    // A combination the grid has no row for. Blank, not zero —
                    // an item on it has no price at all, which the item list's
                    // Unpriced tier is how you find.
                    return (
                      <td key={tier} className="px-3 py-2 text-right text-subtle">
                        —
                      </td>
                    );
                  }
                  return (
                    <td key={tier} className="px-3 py-2 text-right tabular-nums">
                      {locationId ? (
                        <LocationCell
                          cell={cell}
                          override={overrideFor(cell.id)}
                          locationId={locationId}
                          orgId={orgId}
                          editable={editable}
                        />
                      ) : editable ? (
                        <InlineValue
                          table="production_price_grid"
                          id={cell.id}
                          column="price"
                          kind="number"
                          align="right"
                          value={cell.price}
                          format={(v) => `$${Number(v).toFixed(2)}`}
                        />
                      ) : (
                        <span className={READ_ONLY_VALUE}>
                          {cell.price === null ? "—" : `$${cell.price.toFixed(2)}`}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * One cell at one shop: its override if it has one, otherwise the org price in
 * grey so the inheritance is visible rather than implied.
 *
 * The override row is keyed `(grid_id, location_id)` with NO surrogate id —
 * 037's `vendor_item_location_prices` idiom — so this edits through
 * `InlineValue`'s `match`, which exists for exactly that shape.
 *
 * A cell with no override yet has no ROW to write to, so it cannot be an
 * `InlineValue` at all: there is nothing to update. It renders the inherited
 * price with an "override" affordance beside it, and that button is what
 * inserts the row.
 */
function LocationCell({
  cell,
  override,
  locationId,
  orgId,
  editable,
}: {
  cell: PriceGridCell;
  override: PriceGridOverride | null;
  locationId: string;
  orgId: string;
  editable: boolean;
}) {
  if (override) {
    return editable ? (
      <InlineValue
        table="production_price_grid_locations"
        match={{ grid_id: cell.id, location_id: locationId }}
        column="price"
        kind="number"
        align="right"
        value={override.price}
        format={(v) => `$${Number(v).toFixed(2)}`}
      />
    ) : (
      <span className={READ_ONLY_VALUE}>
        {override.price === null ? "—" : `$${override.price.toFixed(2)}`}
      </span>
    );
  }
  return (
    <InheritedCell
      cell={cell}
      locationId={locationId}
      orgId={orgId}
      editable={editable}
    />
  );
}

function InheritedCell({
  cell,
  locationId,
  orgId,
  editable,
}: {
  cell: PriceGridCell;
  locationId: string;
  orgId: string;
  editable: boolean;
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);

  function override() {
    if (!editable || busy) return;
    setFailed(null);
    startTransition(async () => {
      const supabase = createClient();
      // org_id EXPLICITLY — design rule 1. A WITH CHECK is evaluated before the
      // NOT NULL, so omitting it reports as an RLS violation and sends you
      // looking at roles instead of at the missing column.
      //
      // And `.select()` its own result: with no matching policy Postgres
      // changes nothing and PostgREST returns no error, which reads as success.
      const { data, error } = await supabase
        .from("production_price_grid_locations")
        .insert({
          org_id: orgId,
          grid_id: cell.id,
          location_id: locationId,
          price: cell.price,
        })
        .select("grid_id");
      if (error || !data?.length) {
        setFailed(error?.message ?? "That override could not be created.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <span className="inline-flex items-baseline gap-1">
      <span className={`${READ_ONLY_VALUE} text-subtle`} title="Inherited from the org grid">
        {cell.price === null ? "—" : `$${cell.price.toFixed(2)}`}
      </span>
      {editable ? (
        <button
          type="button"
          onClick={override}
          disabled={busy}
          title={failed ?? "Set a price for this shop only"}
          className={`text-[11px] uppercase tracking-[0.08em] ${failed ? "text-accent" : "text-muted"} hover:text-ink disabled:opacity-40`}
        >
          {busy ? "…" : failed ? "failed" : "set"}
        </button>
      ) : null}
    </span>
  );
}
