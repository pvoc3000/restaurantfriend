"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { confirmDialog, splitConfirmMessage } from "@/lib/confirm";
import { InlineValue } from "@/components/catalog/InlineValue";
import { PickList, type PickOption } from "@/components/ui/PickList";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { UNIT_PICK_OPTIONS } from "@/lib/units";
import { formatCost, type Cost } from "@/lib/productionCost";

/** One component of the item — a `production_item_elements` row. */
export type ComponentRow = {
  id: string;
  elementId: string | null;
  name: string;
  qty: number | null;
  unit: string | null;
  /** Resolved here and now; null where the catalog cannot price it. */
  cost: number | null;
  /**
   * Read by the page to order the table, not by this component. Null on all 324
   * migrated edges, which is why a new row is inserted with none — see `add`.
   */
  sort: number | null;
};

/**
 * What an item costs, one row per contributor — and, since 2026-08-11, the
 * place you change them (Mark: "delete elements from the 'cost' section of a
 * production item … add them … and edit their amounts").
 * */
export function ItemComponents({
  itemId,
  orgId,
  rows,
  total,
  options,
  editable,
}: {
  itemId: string;
  orgId: string;
  rows: ComponentRow[];
  total: Cost;
  /** Active elements, for the Add picker. */
  options: PickOption[];
  editable: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [adding, setAdding] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  /**
   * THE NEW ROW GETS NO `sort`, which is the opposite of `AddRecipeRow`'s
   * last-plus-ten and deliberate. Measured: all 324 migrated edges have `sort`
   * null — the transform never filled it and no screen has ever reordered one —
   * so this table is sorted by name in practice. Writing 10 onto one row of
   * seven does not put it last, it puts it FIRST, ahead of every null, and the
   * list stops being alphabetical for one row with nothing to explain it
   * (caught by adding one and watching it jump to the top).
   *
   * Null instead, so it lands in alphabetical order with everything else. The
   * column stays honoured — the render puts anything WITH a sort ahead of the
   * nulls — so the day a reorder control exists it works, and until then the
   * order is one rule rather than two.
   *
   * `org_id` is passed explicitly, as every insert in this app must. No table
   * has a default or a trigger for it, and an insert policy's WITH CHECK runs
   * BEFORE the NOT NULL constraint — so omitting it reports "new row violates
   * row-level security policy" and sends you off to look at roles.
   */
  function add(elementId: string) {
    if (!elementId) return;
    setError(null);
    setAdding(false);
    start(async () => {
      const { data, error: e } = await supabase
        .from("production_item_elements")
        .insert({
          org_id: orgId,
          item_id: itemId,
          element_id: elementId,
        })
        .select("id");
      if (e) {
        setError(e.message);
        return;
      }
      if (!data?.length) {
        setError("Nothing was added — the database refused the insert and said nothing.");
        return;
      }
      router.refresh();
    });
  }

  async function remove(row: ComponentRow) {
    if (
      !(await confirmDialog({
        ...splitConfirmMessage(
          `Take ${row.name} off this item?\n\nIt stops counting toward what the item costs. The element itself is not touched.`
        ),
        confirmLabel: "Remove",
        tone: "danger",
      }))
    ) {
      return;
    }
    setError(null);
    start(async () => {
      // `.select()` on a delete is the only way to know it happened: with no
      // matching policy Postgres removes zero rows and PostgREST returns no
      // error, so a bare call reports success and the row is still there after
      // the refresh — which reads as the button being broken rather than
      // refused.
      const { data, error: e } = await supabase
        .from("production_item_elements")
        .delete()
        .eq("id", row.id)
        .select("id");
      if (e) {
        setError(e.message);
        return;
      }
      if (!data?.length) {
        setError("Nothing was removed — the database refused it and said nothing.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <section className="space-y-2">
      <SectionHeading count={rows.length}>What it costs</SectionHeading>

      <table className="w-full max-w-[70ch] border-collapse text-[14px]">
        <thead>
          <tr className="border-b-2 border-ink text-[11px] uppercase tracking-[0.12em]">
            <th className="px-3 py-2 text-left">Component</th>
            <th className="px-3 py-2 text-right">Amount</th>
            <th className="px-3 py-2 text-right">Cost</th>
            {editable ? <th className="w-8 px-1 py-2" /> : null}
          </tr>
        </thead>
        <tbody>
          
          {rows.map((row) => (
            <tr key={row.id} className="hover:bg-neutral-50">
              <td className="px-3 py-2">
                {row.elementId ? (
                  <Link href={`/elements/${row.elementId}`} className="hover:underline">
                    {row.name}
                  </Link>
                ) : (
                  <span className="text-muted">{row.name}</span>
                )}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {editable ? (
                  // A number and its unit, two fields — the recipe sheet's
                  // portion-size shape. `allowNew` on the unit because a BOM
                  // counts in whatever the kitchen counts in, and both are
                  // nullable, so both offer the clear row: 176 of the migrated
                  // edges carry no quantity at all, and so do the 58 bases
                  // whose old size rule never matched — a real state, and now a
                  // box to type into rather than a missing row in a table.
                  <span className="inline-flex items-baseline justify-end gap-1">
                    <InlineValue
                      table="production_item_elements"
                      id={row.id}
                      column="qty"
                      kind="number"
                      value={row.qty}
                      ariaLabel={`Amount of ${row.name}`}
                      className="text-right"
                    />
                    <InlineValue
                      table="production_item_elements"
                      id={row.id}
                      column="unit"
                      kind="pick"
                      allowNew
                      value={row.unit}
                      options={UNIT_PICK_OPTIONS}
                      ariaLabel={`Unit for ${row.name}`}
                    />
                  </span>
                ) : (
                  <span className="text-muted">
                    {row.qty === null ? "—" : `${row.qty} ${row.unit ?? ""}`.trim()}
                  </span>
                )}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {row.cost === null ? (
                  <span className="text-mark">—</span>
                ) : (
                  `$${row.cost.toFixed(4)}`
                )}
              </td>
              {editable ? (
                <td className="px-1 py-2 text-right">
                  {/* The recipe sheet's `×`, and its reasons: a small quiet
                      control at the end of the row, with a confirm that NAMES
                      the row — a table of near-identical rows is exactly where
                      a delete lands on the wrong one. */}
                  <button
                    type="button"
                    disabled={pending}
                    title={`Remove ${row.name}`}
                    aria-label={`Remove ${row.name}`}
                    onClick={() => void remove(row)}
                    className="px-1 py-0.5 text-[14px] leading-none text-subtle hover:text-accent disabled:opacity-35"
                  >
                    ×
                  </button>
                </td>
              ) : null}
            </tr>
          ))}

          <tr className="border-t border-ink font-medium">
            <td className="px-3 py-2" colSpan={2}>
              Total
            </td>
            <td className="px-3 py-2 text-right tabular-nums">{formatCost(total)}</td>
            {editable ? <td className="px-1 py-2" /> : null}
          </tr>
        </tbody>
      </table>

      {rows.length === 0 ? (
        <p className="text-[13px] text-muted">
          Nothing recorded — this item has no components, so it costs nothing
          until one is added.
        </p>
      ) : null}

      {editable ? (
        <div className="flex max-w-[70ch] items-center gap-3 pt-1">
          {adding ? (
            // `defaultOpen`, the plan matrix's idiom: pressing the button has
            // already said "I want to choose something", so a second tap to open
            // the list is a tap spent on nothing. `onClose` fires only on the
            // DISMISS path, so an abandoned choice puts the command back rather
            // than leaving an empty field where it used to be.
            <PickList
              variant="field"
              value={null}
              options={options}
              defaultOpen
              onClose={() => setAdding(false)}
              onPick={(v) => add(v)}
              ariaLabel="Element to add as a component"
              placeholder="Choose an element…"
              className="w-72"
            />
          ) : (
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setError(null);
                setAdding(true);
              }}
              className="border border-ink bg-white px-3 py-1.5 text-[13px] hover:bg-ink hover:text-white disabled:opacity-35"
            >
              {pending ? "Working…" : "Add component"}
            </button>
          )}
          {/* The amount is deliberately not asked for here. An element on the
              BOM with no quantity is a real, migrated state, and the row you
              just made is the best place to type one — which is now possible. */}
          <span className="text-[12px] text-muted">
            Adds it with no amount; type one on the row.
          </span>
        </div>
      ) : null}

      {error ? <p className="text-[13px] text-accent">{error}</p> : null}
    </section>
  );
}
