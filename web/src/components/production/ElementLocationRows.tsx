"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { DataTable, type DataColumn } from "@/components/catalog/DataTable";
import { ActiveToggle } from "@/components/catalog/ActiveToggle";
import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { Checkbox } from "@/components/ui/Checkbox";
import { SectionHeading } from "@/components/ui/SectionHeading";

export type ElementLocationRow = {
  id: string;
  location_id: string;
  par_by_weekday: number[] | null;
  stock_count: number | null;
  stock_size: number | null;
  stock_unit: string | null;
  is_active: boolean;
  notes: string | null;
  /** Migration 045 — the weekly round, which is what generation reads. */
  on_weekly_log: boolean;
  weekly_sort: number | null;
  weekly_amount: number | null;
  weekly_unit: string | null;
};

/**
 * What each shop keeps on hand, and whether it makes this at all.
 *
 * FileMaker kept the stock par as free text on the ELEMENT ("6x 1.5 GAL",
 * "10 BAGS", and one row reading "?"), with a calculation showing whichever
 * location you happened to be standing in. It is really per (element, location)
 * — the export proves it, DF01 49 rows and DF02 11 — so migration 036 gives it
 * `inventory_item_locations`' shape and the text parses to count × size × unit,
 * which is the batch log's own shape and the only form that can be multiplied.
 *
 * EDITABLE, and the columns that were missing are the point (Mark, 2026-08-09:
 * "I need to be able to edit the per location fields"). Only "Keeps on hand"
 * could be changed here; the four columns 045 added — the ones that decide
 * whether an element generates onto a batch log at all, in what order, and what
 * the round asks for — were not on screen anywhere in the app. So the only way
 * to put an element on a kitchen's round was the migration that loaded it.
 *
 * WHAT EACH COLUMN ACTUALLY DOES, because they are easy to confuse:
 *
 * - **Active** and **On round** are both required for generation and are not the
 *   same question. Inactive means this shop does not deal with the element at
 *   all; off the round means it deals with it but not on the weekly bake — an
 *   AB or donut element, made to order.
 * - **Order** is `weekly_sort`, which becomes the batch's `sort` and orders the
 *   printed log.
 * - **Round asks for** is `weekly_amount` × `weekly_unit` — "make 2 X". It lands
 *   on the batch as "Asked for" and is distinct from **Par**, which is the
 *   stock level this shop keeps and lands as the batch's Par.
 *
 * PAR BY WEEKDAY IS DELIBERATELY READ-ONLY. Nothing in `web/src` reads
 * `production_element_locations.par_by_weekday` — it is displayed here and
 * nowhere else, and generation ignores it entirely (045 reads the four weekly
 * columns and the stock trio). An editor over it would take numbers and change
 * nothing, which is precisely the objection recorded against building one for
 * `production_item_locations.par_by_weekday` after 043. If it turns out to be
 * wanted, it wants a reader first.
 *
 * Enumerating over `activeLocations`, never `locations` — design rule 3: a row
 * per location is exactly the case where three closed shops would sprout dead
 * rows.
 */
export function ElementLocationRows({
  elementId,
  rows,
  locations,
  orgId,
  editable,
  manual,
}: {
  elementId: string;
  rows: ElementLocationRow[];
  locations: { id: string; code: string; name: string }[];
  orgId: string;
  editable: boolean;
  /**
   * A MANUAL element's per-shop cost — migration 050. Absent on made and
   * purchased elements, which resolve their cost through a recipe or a vendor
   * item and have no set cost to vary.
   *
   * This is where labour lives now (Mark, 2026-08-13: "make manual costing in
   * an element a Per Location thing … The cost for the element would then be
   * the working locations' cost"). A recipe line pointing at a `Labor` element
   * carries HOURS; this is what an hour costs at each shop.
   */
  manual?: {
    /** `production_elements.manual_cost` — the fallback where a shop has no row. */
    base: number | null;
    unit: string | null;
    costs: { location_id: string; cost: number }[];
  };
}) {
  const byLocation = new Map(rows.map((r) => [r.location_id, r]));
  const costByLocation = new Map((manual?.costs ?? []).map((c) => [c.location_id, c.cost]));

  type Line = {
    location: { id: string; code: string; name: string };
    row: ElementLocationRow | null;
    cost: number | null;
  };
  const lines: Line[] = locations.map((l) => ({
    location: l,
    row: byLocation.get(l.id) ?? null,
    cost: costByLocation.get(l.id) ?? null,
  }));

  const columns: DataColumn<Line>[] = [
    {
      // The Active column LEADS every catalog table, and where a row does not
      // exist yet it carries the command that creates one — the "Stock here"
      // slot the inventory tables have always used.
      key: "active",
      label: "Active",
      width: 130,
      sortValue: (l) => (l.row ? (l.row.is_active ? 0 : 1) : 2),
      render: (l) =>
        l.row && editable ? (
          <ActiveToggle
            table="production_element_locations"
            id={l.row.id}
            active={l.row.is_active}
            label={`Active at ${l.location.code}`}
          />
        ) : l.row ? (
          // `ActiveToggle` has no disabled state — it writes and lets RLS
          // answer. Below purchaser+ that would be a control offering a change
          // the database will refuse, so the state is stated instead.
          <span className={`${READ_ONLY_VALUE} text-muted`}>
            {l.row.is_active ? "Active" : "Inactive"}
          </span>
        ) : editable ? (
          <MakeHere elementId={elementId} locationId={l.location.id} orgId={orgId} />
        ) : (
          <span className={`${READ_ONLY_VALUE} text-subtle`}>—</span>
        ),
    },
    {
      key: "location",
      label: "Location",
      width: 200,
      pinned: true,
      sortValue: (l) => l.location.code,
      render: (l) => (
        <span>
          <span className="font-medium">{l.location.code}</span>
          <span className="ml-2 text-muted">{l.location.name}</span>
        </span>
      ),
    },
    // COST PER SHOP — migration 050, and only on a MANUAL element. A made or
    // purchased one resolves its cost through a recipe or a vendor item, where
    // the per-shop variation already lives (design rule 6).
    //
    // The column is present but the cell is a "set" button where no row exists,
    // for the reason `/price-grid` needs the same: a cell with no override row
    // has nothing to write to, so it CANNOT be an `InlineValue`. What it shows
    // in the meantime is the element's own `manual_cost`, in grey, because that
    // is genuinely what this shop pays — an empty cell would read as free.
    ...(manual
      ? [
          {
            key: "cost",
            label: "Cost",
            width: 170,
            align: "right" as const,
            sortValue: (l: Line) => l.cost ?? manual.base,
            render: (l: Line) =>
              l.cost !== null ? (
                editable ? (
                  <span className="inline-flex items-baseline gap-1">
                    <InlineValue
                      table="production_element_location_costs"
                      match={{ element_id: elementId, location_id: l.location.id }}
                      column="cost"
                      kind="number"
                      nullable={false}
                      value={l.cost}
                      ariaLabel={`Cost at ${l.location.code}`}
                    />
                    {manual.unit ? (
                      <span className="text-[12px] text-muted">/ {manual.unit}</span>
                    ) : null}
                  </span>
                ) : (
                  <span className={`${READ_ONLY_VALUE} tabular-nums`}>
                    {l.cost}
                    {manual.unit ? ` / ${manual.unit}` : ""}
                  </span>
                )
              ) : (
                <span className="inline-flex items-baseline gap-2">
                  <span className={`${READ_ONLY_VALUE} tabular-nums text-muted`}>
                    {manual.base === null ? "—" : `${manual.base}${manual.unit ? ` / ${manual.unit}` : ""}`}
                  </span>
                  {editable ? (
                    <SetCost
                      elementId={elementId}
                      locationId={l.location.id}
                      orgId={orgId}
                      seed={manual.base}
                    />
                  ) : null}
                </span>
              ),
          } as DataColumn<Line>,
        ]
      : []),
    {
      key: "weekly",
      label: "On round",
      width: 110,
      sortValue: (l) => (l.row?.on_weekly_log ? 0 : 1),
      render: (l) =>
        !l.row ? (
          <span className={`${READ_ONLY_VALUE} text-subtle`}>—</span>
        ) : (
          <WeeklyToggle
            id={l.row.id}
            on={l.row.on_weekly_log}
            disabled={!editable}
            label={`On ${l.location.code}'s weekly round`}
          />
        ),
    },
    {
      key: "weekly_sort",
      label: "Order",
      width: 90,
      align: "right",
      sortValue: (l) => l.row?.weekly_sort ?? Number.MAX_SAFE_INTEGER,
      render: (l) =>
        !l.row ? (
          <span className={`${READ_ONLY_VALUE} text-subtle`}>—</span>
        ) : editable ? (
          <InlineValue
            table="production_element_locations"
            id={l.row.id}
            column="weekly_sort"
            kind="number"
            value={l.row.weekly_sort}
            ariaLabel={`Order on ${l.location.code}'s round`}
          />
        ) : (
          <span className={`${READ_ONLY_VALUE} tabular-nums`}>
            {l.row.weekly_sort ?? "—"}
          </span>
        ),
    },
    {
      key: "asks",
      label: "Round asks for",
      width: 200,
      wrap: true,
      sortValue: (l) => l.row?.weekly_amount ?? null,
      render: (l) =>
        !l.row ? (
          <span className={`${READ_ONLY_VALUE} text-subtle`}>—</span>
        ) : editable ? (
          <span className="flex flex-wrap items-baseline gap-1">
            <InlineValue
              table="production_element_locations"
              id={l.row.id}
              column="weekly_amount"
              kind="number"
              value={l.row.weekly_amount}
              ariaLabel={`What ${l.location.code}'s round asks for`}
            />
            <InlineValue
              table="production_element_locations"
              id={l.row.id}
              column="weekly_unit"
              value={l.row.weekly_unit}
              ariaLabel={`The unit ${l.location.code}'s round asks in`}
            />
          </span>
        ) : (
          <span className={READ_ONLY_VALUE}>
            {l.row.weekly_amount === null
              ? "—"
              : `${l.row.weekly_amount}${l.row.weekly_unit ? ` ${l.row.weekly_unit}` : ""}`}
          </span>
        ),
    },
    {
      key: "stock",
      // PAR, not "Keeps on hand" (Mark, 2026-08-09: "why do we call it 'keeps
      // on hand' instead of just Par?"). He is right and it was one number
      // wearing two names: generation copies `stock_count/size/unit` straight
      // onto the batch's `par_count/par_size/par_unit`, and the batch log's own
      // column has always been headed Par. A second name for the same figure is
      // how somebody comes to believe they are two figures.
      label: "Par",
      width: 260,
      wrap: true,
      sortValue: (l) => l.row?.stock_count ?? null,
      render: (l) =>
        !l.row ? (
          <span className={`${READ_ONLY_VALUE} text-subtle`}>—</span>
        ) : editable ? (
          <span className="flex flex-wrap items-baseline gap-1">
            <InlineValue
              table="production_element_locations"
              id={l.row.id}
              column="stock_count"
              kind="number"
              value={l.row.stock_count}
              ariaLabel={`How many ${l.location.code} keeps`}
            />
            <span className="text-subtle">×</span>
            <InlineValue
              table="production_element_locations"
              id={l.row.id}
              column="stock_size"
              kind="number"
              value={l.row.stock_size}
              ariaLabel={`The size ${l.location.code} keeps`}
            />
            <InlineValue
              table="production_element_locations"
              id={l.row.id}
              column="stock_unit"
              value={l.row.stock_unit}
              ariaLabel={`The unit ${l.location.code} keeps`}
            />
          </span>
        ) : (
          <span className={READ_ONLY_VALUE}>{describeStock(l.row)}</span>
        ),
    },
    {
      key: "notes",
      label: "Note",
      width: 220,
      wrap: true,
      hideWhenCompact: true,
      sortValue: (l) => l.row?.notes ?? "",
      render: (l) =>
        !l.row ? (
          <span className={`${READ_ONLY_VALUE} text-subtle`}>—</span>
        ) : editable ? (
          <InlineValue
            table="production_element_locations"
            id={l.row.id}
            column="notes"
            value={l.row.notes}
            ariaLabel={`Note for ${l.location.code}`}
          />
        ) : (
          <span className={READ_ONLY_VALUE}>{l.row.notes ?? "—"}</span>
        ),
    },
    {
      // Read-only on purpose — see the note above. It stays visible because the
      // migration loaded real numbers into it and hiding them would be its own
      // kind of lie.
      key: "par",
      label: "Par by weekday",
      width: 220,
      hideWhenCompact: true,
      sortValue: undefined,
      render: (l) => (
        <span className="tabular-nums text-muted">
          {l.row?.par_by_weekday?.some((v) => v !== null)
            ? l.row.par_by_weekday.map((v) => (v === null ? "–" : String(v))).join("  ")
            : "—"}
        </span>
      ),
    },
  ];

  return (
    <section>
      <DataTable
        rows={lines}
        columns={columns}
        rowKey={(l) => l.location.id}
        storageKey="production-element-locations-v2"
        compactBelow={1280}
        columnChooser
        leading={<SectionHeading count={rows.length}>Per location</SectionHeading>}
      />
    </section>
  );
}

/**
 * `on_weekly_log` — its own control rather than an `InlineValue`, because
 * `InlineValue` has no boolean kind and a checkbox is what a yes/no wants.
 *
 * Optimistic, and it PUTS THE BOX BACK on failure: an update matching no policy
 * changes zero rows and PostgREST returns NO error, so a bare call would leave
 * the tick showing a state the database never took — `ActiveToggle`'s own
 * lesson, and the reason this `.select()`s its result.
 */
function WeeklyToggle({
  id,
  on,
  disabled,
  label,
}: {
  id: string;
  on: boolean;
  disabled: boolean;
  label: string;
}) {
  const supabase = createClient();
  const router = useRouter();
  const [checked, setChecked] = useState(on);
  const [busy, setBusy] = useState(false);

  return (
    <Checkbox
      size={18}
      checked={checked}
      disabled={disabled || busy}
      label={label}
      onChange={(next) => {
        setChecked(next);
        setBusy(true);
        void (async () => {
          const { data, error } = await supabase
            .from("production_element_locations")
            .update({ on_weekly_log: next })
            .eq("id", id)
            .select("id");
          setBusy(false);
          if (error || !data?.length) {
            setChecked(!next);
            return;
          }
          router.refresh();
        })();
      }}
    />
  );
}

/**
 * There is no row for this (element, location) yet, so there is nothing to
 * edit — the `/price-grid` problem, where a cell with no row cannot be an
 * `InlineValue`. This creates one, and every other cell on the line becomes
 * editable by existing.
 *
 * `org_id` is passed EXPLICITLY (design rule 1). No table has a default for it,
 * and an insert policy's WITH CHECK is evaluated BEFORE the NOT NULL — so an
 * omitted org_id arrives as null, `user_has_role(null, …)` is not true, and
 * Postgres reports "new row violates row-level security policy", which sends
 * you looking at roles for a missing column.
 */
function MakeHere({
  elementId,
  locationId,
  orgId,
}: {
  elementId: string;
  locationId: string;
  orgId: string;
}) {
  const supabase = createClient();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);

  return (
    <span className="flex flex-col items-start gap-0.5">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setFailed(null);
            const { error } = await supabase
              .from("production_element_locations")
              .insert({ org_id: orgId, element_id: elementId, location_id: locationId })
              .select("id")
              .single();
            if (error) {
              setFailed(error.message);
              return;
            }
            router.refresh();
          })
        }
        className="border border-ink bg-white px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.06em] hover:bg-ink hover:text-white disabled:opacity-35"
      >
        {pending ? "Adding…" : "Make here"}
      </button>
      {failed ? <span className="text-[11px] text-accent">{failed}</span> : null}
    </span>
  );
}

/**
 * Give this shop its own cost — the `/price-grid` "set" button, same problem.
 *
 * A cell with no override row has nothing for `InlineValue` to write to, so the
 * row has to be INSERTED before it can be edited. It seeds from the element's
 * own `manual_cost`, which is what the shop is paying anyway: the button is
 * "make this editable here", not "change it".
 */
function SetCost({
  elementId,
  locationId,
  orgId,
  seed,
}: {
  elementId: string;
  locationId: string;
  orgId: string;
  seed: number | null;
}) {
  const supabase = createClient();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);

  return (
    <span className="flex flex-col items-start gap-0.5">
      <button
        type="button"
        disabled={pending}
        title="Give this shop its own cost for this element"
        onClick={() =>
          startTransition(async () => {
            setFailed(null);
            const { data, error } = await supabase
              .from("production_element_location_costs")
              // 050 makes `cost` NOT NULL — the row IS the statement — so it
              // needs a value now. Zero rather than the element's cost would
              // assert this shop gets it free.
              .insert({ org_id: orgId, element_id: elementId, location_id: locationId, cost: seed ?? 0 })
              .select("element_id");
            if (error) {
              setFailed(error.message);
              return;
            }
            if (!data?.length) {
              setFailed("Not allowed — you need purchaser access.");
              return;
            }
            router.refresh();
          })
        }
        className="border border-ink bg-white px-1.5 py-0.5 text-[11px] uppercase tracking-[0.06em] hover:bg-ink hover:text-white disabled:opacity-35"
      >
        {pending ? "…" : "Set"}
      </button>
      {failed ? <span className="text-[11px] text-accent">{failed}</span> : null}
    </span>
  );
}

/** "6 × 1.5 GAL", "10 BAGS", or an em dash. */
function describeStock(row: ElementLocationRow): string {
  if (row.stock_count === null) return "—";
  const size = row.stock_size === null ? "" : ` × ${row.stock_size}`;
  const unit = row.stock_unit ? ` ${row.stock_unit}` : "";
  return `${row.stock_count}${size}${unit}`;
}
