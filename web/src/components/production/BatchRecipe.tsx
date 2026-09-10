"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { TabPicker } from "@/components/ui/TabPicker";
import { columnCell, formatCell, scaleColumns, type ScaleColumn } from "@/lib/production";

type Line = {
  id: string;
  label: string | null;
  qty: number | null;
  unit: string | null;
  note: string | null;
  sort: number | null;
  element_id: string | null;
  scale_auto: boolean | null;
  scale_amounts: (number | string | null)[] | null;
  scale_units: (string | null)[] | null;
  hide_on_print: boolean | null;
  production_elements: { name: string } | null;
};

type Step = { id: string; sort: number | null; body: string };

type Loaded = {
  recipeId: string;
  versionLabel: string;
  columns: ScaleColumn[];
  lines: Line[];
  steps: Step[];
};

/**
 * THE RECIPE, BESIDE THE BATCH — FileMaker's second tab (Mark, 2026-08-09: "we
 * need a way to switch the detail pane from info to the element's recipe").
 *
 * It is a READER, not `RecipeVersionSheet`. That component is the recipe's own
 * screen: every cell editable, the AUTO switch, per-row delete, a measured
 * frame. None of that belongs half a screen down under a work list — you are
 * standing at a mixer wanting to know how much flour, and an editable grid
 * there is a way to damage the recipe with your elbow. The sheet is one link
 * away and says so.
 *
 * WHICH VERSION: the one the BATCH says it followed, falling back to the
 * element's master. That order is the point — a batch run against v19 must not
 * show v20's amounts just because somebody has since made v20 the master, which
 * is the same reason 044 snapshots `recipe_version_label` beside the id.
 *
 * ONE SCALE COLUMN AT A TIME, chosen with a TabPicker. FileMaker sets the chosen
 * batch beside a second, fainter one — a comparison — and a picker gives the
 * same comparison by switching, in a third of the width. Width is the whole
 * constraint here: this pane is ~400px tall and shares the screen, where the
 * recipe screen has a window to itself and shows all four columns at once for
 * exactly the reason it can.
 *
 * Fetched when the tab is first opened for a version and cached per version —
 * a baker flips between Info and Recipe on one batch repeatedly, and re-reading
 * three tables each time would make the tab feel broken.
 */
export function BatchRecipe({
  versionId,
  elementName,
  show = "both",
  size = "md",
  scaleLabel = null,
  batchId = null,
}: {
  /** The batch's version, or the element's master. Null when the element has no
   *  recipe at all — which is legitimate: generation warns about it and makes
   *  the batch anyway, because somebody will make it from memory. */
  versionId: string | null;
  elementName: string;
  /**
   * Which half. The pane shows them as TWO TABS — Ingredients, Instructions
   * (Mark, 2026-09-09) — because side by side they were the widest thing in
   * the pane and what stopped the split fitting a portrait iPad. `both` is the
   * two-column form for anywhere with the room.
   */
  show?: "both" | "ingredients" | "instructions";
  /** "lg" is the tablet's — 16px ingredients and steps, read at arm's length
   *  from a bench (Mark, 2026-09-09). */
  size?: "md" | "lg";
  /** The size the BATCH says it made (`scale_label`) — the column the tab
   *  opens on, so the amounts shown are the ones that were weighed. */
  scaleLabel?: string | null;
  /**
   * ONE FIELD, TWO PLACES (Mark, 2026-09-09: "setting the scale on the info
   * tab changes the scale on the ingredient tab, but not the other way around.
   * make them the same field"). With a batch id the size picker above the
   * ingredients WRITES `scale_label`, the same column the Info tab's Scale
   * field writes, and the shown column is derived from it; without one — a
   * reader with no batch — the picker is local to the tab.
   */
  batchId?: string | null;
}) {
  const body = size === "lg" ? "text-[16px]" : "text-[12px]";
  const cell = size === "lg" ? "px-3 py-2" : "px-2 py-1";
  const supabase = createClient();
  // Keyed by the version it describes, both of them — see BatchHistory for why
  // the key beats clearing in an effect. Here it also means the chosen batch
  // size resets when you move to another batch WITHOUT an effect to do it, and
  // that the cached sheet is still there when you flip back to Info and return.
  const [state, setState] = useState<{
    key: string;
    loaded: Loaded | null;
    failed: string | null;
  } | null>(null);
  const [pickedColumn, setPickedColumn] = useState<{ key: string; index: number } | null>(null);
  // While the write is in flight the picker shows the size just chosen, so it
  // does not snap back to the old column for the second before the refresh.
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const router = useRouter();

  async function pickSize(index: number, label: string) {
    if (!batchId) {
      setPickedColumn({ key: versionId ?? "", index });
      return;
    }
    setWriteError(null);
    setPendingLabel(label);
    const { data, error } = await supabase
      .from("production_batches")
      .update({ scale_label: label })
      .eq("id", batchId)
      .select("id");
    if (error || (data ?? []).length === 0) {
      setPendingLabel(null);
      setWriteError(error?.message ?? "That change was not saved.");
      return;
    }
    router.refresh();
  }

  const current = state?.key === versionId ? state : null;
  const column = pickedColumn?.key === versionId ? pickedColumn.index : 0;

  useEffect(() => {
    if (!versionId) return;
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from("production_recipe_versions")
        .select(
          `id, version_label, scale_labels, scale_multipliers, recipe_id,
           production_recipe_lines (
             id, label, qty, unit, note, sort, element_id,
             scale_auto, scale_amounts, scale_units, hide_on_print,
             production_elements ( name )
           ),
           production_recipe_steps ( id, sort, body )`
        )
        .eq("id", versionId)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        setState({
          key: versionId,
          loaded: null,
          failed: error?.message ?? "That recipe version could not be read.",
        });
        return;
      }
      const v = data as unknown as {
        recipe_id: string;
        version_label: string;
        scale_labels: string[] | null;
        scale_multipliers: number[] | null;
        production_recipe_lines: Line[];
        production_recipe_steps: Step[];
      };
      setState({
        key: versionId,
        failed: null,
        loaded: {
          recipeId: v.recipe_id,
          versionLabel: v.version_label,
          columns: scaleColumns(v.scale_labels, v.scale_multipliers),
          // The embed arrives in no particular order; `sort` is the sheet's own.
          lines: [...(v.production_recipe_lines ?? [])].sort(bySort),
          steps: [...(v.production_recipe_steps ?? [])].sort(bySort),
        },
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [versionId, supabase]);

  if (!versionId) {
    return (
      <p className="text-sm text-muted">
        {elementName} has no recipe on file — generation says so when it makes
        the batch, and somebody makes it from memory.
      </p>
    );
  }
  if (current?.failed) return <p className="text-sm text-accent">{current.failed}</p>;
  const loaded = current?.loaded;
  if (!loaded) return <p className="text-sm text-muted">Reading the recipe…</p>;

  // THE `%` COLUMN IS NOT A BATCH SIZE and is dropped from the picker. It is
  // each line's baker's percentage — a share of the first ingredient, not a
  // multiple of it — so `columnCell` returns no amount for it and choosing it
  // would blank every row. The recipe's own screen has room to show it as a
  // column beside the others; here there is only one column, and it has to be
  // one you could weigh something with.
  const columns = loaded.columns.filter((c) => !c.isPercent);
  // The batch's own size IS the column (the pending one while a write lands);
  // only a reader with no batch keeps a local pick.
  const effectiveLabel = pendingLabel ?? scaleLabel;
  const batchIndex = effectiveLabel
    ? columns.findIndex((c) => c.label.trim().toLowerCase() === effectiveLabel.trim().toLowerCase())
    : -1;
  const shownIndex = batchId
    ? batchIndex >= 0
      ? batchIndex
      : 0
    : pickedColumn?.key === versionId
      ? column
      : batchIndex >= 0
        ? batchIndex
        : 0;
  const chosen = columns[Math.min(shownIndex, Math.max(columns.length - 1, 0))];
  // The base is the FIRST column rendered — not necessarily slot 0, if a label
  // has been cleared (`lib/production`'s own caveat).
  const baseMultiplier = columns[0]?.multiplier ?? 1;
  const baseIndex = columns[0]?.index ?? 0;
  // The printed sheet's rule: a line marked hide stays in the record and off the
  // page, and this IS the page as far as a baker is concerned.
  const lines = loaded.lines.filter((l) => !l.hide_on_print);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2">
        {columns.length > 1 ? (
          <TabPicker
            ariaLabel="Which batch size"
            size="sm"
            value={String(shownIndex)}
            onChange={(k) => void pickSize(Number(k), columns[Number(k)]?.label ?? "")}
            options={columns.map((c, i) => ({ key: String(i), label: c.label }))}
          />
        ) : null}
        <Link
          href={`/recipes/${loaded.recipeId}?tab=recipe&v=${encodeURIComponent(
            loaded.versionLabel
          )}`}
          className="text-[12px] uppercase tracking-[0.08em] text-subtle hover:underline"
        >
          Open recipe v{loaded.versionLabel} ↗
        </Link>
        {writeError ? <span className="text-sm text-accent">{writeError}</span> : null}
      </div>

      <div className={`grid min-h-0 flex-1 gap-4 ${show === "both" ? "lg:grid-cols-2" : ""}`}>
        {/* -- what goes in ------------------------------------------------- */}
        {show !== "instructions" ? (
        <div className="min-h-0 overflow-y-auto border border-hairline">
          <table className={`w-full table-fixed border-collapse ${body}`}>
            {/* INGREDIENT · AMOUNT · NOTE (Mark, 2026-08-09), where FileMaker
                prints amount first. The ingredient is what you scan down the
                column for — the amount only means anything once you have found
                the row — which is the same argument that puts the disclosure
                triangle to the RIGHT of an item's name on the order guide. */}
            <colgroup>
              <col style={{ width: "44%" }} />
              <col style={{ width: "26%" }} />
              <col style={{ width: "30%" }} />
            </colgroup>
            <thead>
              <tr className="sticky top-0 z-10 bg-white text-left">
                {["Ingredient", "Amount", "Note"].map((h) => (
                  <th
                    key={h}
                    className={`border-b border-hairline ${cell} ${size === "lg" ? "text-[12px]" : "text-[10px]"} font-semibold uppercase tracking-[0.08em] text-muted`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-2 py-2 text-muted">
                    No ingredients on this version.
                  </td>
                </tr>
              ) : (
                lines.map((line) => (
                  <tr key={line.id} className="align-top">
                    {/* THE ELEMENT'S NAME LEADS; `label` is only a fallback —
                        FMP's `columnName_t` override goes stale when a version
                        is copied (2026-08-08's lesson, same order here). */}
                    <td className={cell}>
                      {line.production_elements?.name ?? line.label ?? "—"}
                    </td>
                    {/* THE FIGURE RIGHT, THE UNIT LEFT, A GAP BETWEEN (Mark,
                        2026-09-09) — so the numbers line up on their ones
                        column down the list and the units line up on their
                        first letter, which is how a printed recipe sets them
                        and how a baker reads down one. Two spans, never one
                        string: `formatCell` with no unit is the bare figure. */}
                    <td className={`${cell} tabular-nums whitespace-nowrap`}>
                      {(() => {
                        if (!chosen) return null;
                        const amount = columnCell(
                          {
                            qty: line.qty,
                            unit: line.unit,
                            scaleAuto: line.scale_auto ?? true,
                            scaleAmounts: numbers(line.scale_amounts),
                            scaleUnits: line.scale_units,
                          },
                          chosen,
                          baseMultiplier,
                          baseIndex
                        );
                        if (amount.qty === null) return null;
                        return (
                          <span className="flex gap-2">
                            <span className="flex-1 text-right">
                              {formatCell({ qty: amount.qty, unit: null })}
                            </span>
                            <span className="w-12 text-left">{amount.unit ?? ""}</span>
                          </span>
                        );
                      })()}
                    </td>
                    <td className={`${cell} text-muted`}>{line.note ?? ""}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        ) : null}

        {/* -- what to do with it -------------------------------------------- */}
        {show !== "ingredients" ? (
        <div className="min-h-0 overflow-y-auto border border-hairline p-2">
          {show === "both" ? (
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
              Instructions
            </h3>
          ) : null}
          {loaded.steps.length === 0 ? (
            <p className={`mt-1 ${body} text-muted`}>No procedure on this version.</p>
          ) : (
            <ol className={`mt-1 ${size === "lg" ? "space-y-4" : "space-y-2"}`}>
              {loaded.steps.map((s, i) => (
                <li key={s.id} className={`flex gap-2 ${body}`}>
                  <span className="shrink-0 tabular-nums text-subtle">{i + 1}.</span>
                  <span className="whitespace-pre-wrap">{s.body}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
        ) : null}
      </div>
    </div>
  );
}

function bySort(a: { sort: number | null }, b: { sort: number | null }) {
  return (a.sort ?? Number.MAX_SAFE_INTEGER) - (b.sort ?? Number.MAX_SAFE_INTEGER);
}

/** Postgres numerics arrive as strings over PostgREST. */
function numbers(raw: (number | string | null)[] | null): (number | null)[] | null {
  if (!raw) return null;
  return raw.map((v) => (v === null || v === "" ? null : Number(v)));
}
